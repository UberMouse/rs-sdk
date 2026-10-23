import { z } from 'zod/v4';
import { deposit, OPEN_BANK_WAIT_TICKS, withBank, withdraw } from '../actions/bank';
import { CLEANUP_CLOSE_WAIT_TICKS } from '../actions/modal';
import { WALK_MAX_TICKS } from '../actions/walk';
import { log, type Op } from '../core/op';
import { type Area, AreaSchema, refuseArea, WALK_FAIL_LIMIT, walkToArea } from '../lib/area';
import { accountOf } from '../lib/account';
import { type BankSite, bankArea, nearestBank } from '../lib/banks';
import { configName, objInfo } from '../lib/packs';
import { defineTask, type TaskContext } from '../lib/task';
import { countItems, exactName, INVENTORY_SLOTS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/** Consecutive failed opens before the task fails. */
const OPEN_FAIL_LIMIT = 3;
/** Walks to a far bank outlast the engine's default step timeout. */
const STEP_TIMEOUT_MS = 300_000;
/** One failed open changes nothing the watchdog sees: the open's wait, then withBank's close (a late-open wait and a second try). */
const OPEN_SILENT_TICKS = OPEN_BANK_WAIT_TICKS + 2 * CLEANUP_CLOSE_WAIT_TICKS + 1;
/**
 * The watchdog outlasts both fail streaks, so the task's own reason surfaces and not `stuck`: the walks
 * to the area (WALK_FAIL_LIMIT of them, each up to WALK_MAX_TICKS without moving the bot) and the opens.
 */
export const SILENT_STREAK_TICKS = [
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
    failStreakTicks(OPEN_FAIL_LIMIT, OPEN_SILENT_TICKS),
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);

const Params = z.object({
    /** Walk here first (a bank, e.g. Varrock West (3185,3436)). Omit to walk to the nearest bank in `lib/banks.ts`. */
    area: AreaSchema.optional(),
    /** Inventory items to deposit, by exact name. Omit `count` to deposit all of that item. */
    deposit: z.array(z.object({ item: z.string().min(1), count: z.number().int().positive().optional() })).default([]),
    /** Deposit every inventory item whose exact name is not listed here (tools stay). Runs after `deposit`. Worn gear is untouched. */
    depositAllExcept: z.array(z.string().min(1)).optional(),
    /**
     * Bank items to withdraw, by exact name, after all deposits. Fails if the bank holds fewer than `count`,
     * unless `upTo`: then it withdraws the lesser of `count`, what the open bank lists (a same-trip deposit of the item counts) and what the inventory can take (its free slots, or for a stackable item per the obj configs one free slot or a held stack), and none held or no room is skipped.
     */
    withdraw: z
        .array(
            z.object({ item: z.string().min(1), count: z.number().int().positive(), upTo: z.boolean().default(false) }),
        )
        .default([]),
});

type BankParams = z.infer<typeof Params>;
interface BankMemory {
    /** How many of the task's operations (see `operationsOf`) have gone through, in order. */
    opsMade: number;
    /**
     * The deposit or withdrawal under way: its index and how many of its item the inventory held before
     * its first send. An abort can land after the transfer did, so a resumed step counts what moved
     * since then and sends only the rest.
     *
     * The baseline is the inventory count, so it is approximate when a guard's eat consumes the very
     * item being banked between the abort and the resume: a deposit then looks that much further along
     * than it is and under-delivers by the eaten amount, and a withdrawal looks that much less along and
     * over-pulls by it (the inventory still ends at the requested count). Neither exceeds the op's
     * amount. Comparing against the bank-side count would not see the eat, but it is only published
     * while the bank is open and noted withdrawals change it by name, so the inventory count is kept.
     */
    inFlight: { opIndex: number; heldBefore: number } | null;
    /** Without `area`: the bank picked at the first walk, kept so the choice cannot flip mid-walk. */
    chosen: BankSite | null;
    /** `upTo` entries that came up short or were skipped, for the done reason. Pushed when an entry ends, so an abort never records one twice. */
    upToShort: string[];
}
type Ctx = TaskContext<BankParams, BankMemory>;
type Operation =
    | { kind: 'deposit'; item: string; count?: number }
    | { kind: 'depositAllExcept'; keep: string[] }
    | { kind: 'withdraw'; item: string; count: number; upTo: boolean };

/** Deposits first, then withdrawals, so freed slots can be refilled in one trip. */
const operationsOf = (params: BankParams): Operation[] => [
    ...params.deposit.map(d => ({ kind: 'deposit' as const, ...d })),
    ...(params.depositAllExcept ? [{ kind: 'depositAllExcept' as const, keep: params.depositAllExcept }] : []),
    ...params.withdraw.map(w => ({ kind: 'withdraw' as const, ...w })),
];

/** The next operation to make, or undefined when all are made. */
const nextOp = (ctx: Ctx): Operation | undefined => operationsOf(ctx.params)[ctx.memory.opsMade];

/**
 * Records the inventory count of `item` as the current operation's baseline on its first run (returning
 * null), and on a later run returns how many an earlier, aborted run already moved (out of the
 * inventory for a deposit, into it for a withdrawal). Never negative: an eat between the abort
 * and the resume (the item is food) must not make the resumed step ask for more than the operation.
 */
function recordOrMoved(ctx: Ctx, op: { kind: 'deposit' | 'withdraw'; item: string }): number | null {
    const held = countItems(ctx.state(), exactName(op.item));
    const { inFlight, opsMade } = ctx.memory;
    if (inFlight?.opIndex !== opsMade) {
        ctx.memory.inFlight = { opIndex: opsMade, heldBefore: held };
        return null;
    }
    return Math.max(0, op.kind === 'deposit' ? inFlight.heldBefore - held : held - inFlight.heldBefore);
}

/**
 * Records an `upTo` entry that came up short for the done reason: `<item> <got>/<count>`, or `<item> skipped (<why>)`
 * when none of it was got (`why` is read only then, so a caller that got some omits it).
 */
function noteUpToShort(ctx: Ctx, op: { item: string; count: number }, got: number, why?: string): void {
    ctx.memory.upToShort.push(got > 0 ? `${op.item} ${got}/${op.count}` : `${op.item} skipped (${why})`);
}

/** Whether the obj configs say an item stacks (one slot whatever the count); false for an id they do not list. */
function stacks(id: number): boolean {
    const obj = configName('obj', id);
    return obj !== undefined && objInfo(obj)?.stackable === true;
}

/**
 * How many of an item the inventory can take: unlimited when it stacks and a stack is already held (no slot)
 * or a slot is free (one slot whatever the count); otherwise its free slots. Stackability is the obj config's,
 * read from the id of the banked or carried rows of that name.
 */
function inventoryRoom(ctx: Ctx, pattern: RegExp): number {
    const s = ctx.state();
    const free = Math.max(0, INVENTORY_SLOTS - s.inventory.length);
    const rows = [...s.inventory, ...s.bank.items].filter(i => pattern.test(i.name));
    if (!rows.some(i => stacks(i.id))) return free;
    const held = s.inventory.some(i => pattern.test(i.name) && stacks(i.id));
    return held || free > 0 ? Infinity : 0;
}

/** Returns a failure message, or null when the operation went through. */
function* perform(ctx: Ctx, op: Operation): Op<string | null> {
    if (op.kind === 'deposit') {
        const moved = recordOrMoved(ctx, op);
        // A resumed deposit-all is done once none is left; a counted one sends only the remainder.
        const amount = op.count === undefined ? 'all' : op.count - (moved ?? 0);
        const left = countItems(ctx.state(), exactName(op.item));
        if (moved !== null && (amount === 'all' ? left === 0 : amount <= 0)) {
            yield* log(`deposit ${op.item}: ${moved} already deposited before the step was cut off`);
            return null;
        }
        const r = yield* deposit(ctx, exactName(op.item), amount);
        yield* log(`deposit ${op.item}: ${r.message}`);
        return r.ok ? null : `deposit ${op.item} failed (${r.reason}): ${r.message}`;
    }
    if (op.kind === 'depositAllExcept') {
        // Resumes by itself: a name already deposited is no longer in the inventory.
        const names = new Set<string>();
        for (const i of ctx.state().inventory) {
            if (!op.keep.some(k => exactName(k).test(i.name))) names.add(i.name);
        }
        for (const name of names) {
            const r = yield* deposit(ctx, exactName(name));
            yield* log(`deposit ${name}: ${r.message}`);
            if (!r.ok) return `deposit ${name} failed (${r.reason}): ${r.message}`;
        }
        return null;
    }
    const moved = recordOrMoved(ctx, op) ?? 0;
    const want = op.count - moved;
    if (want <= 0) {
        yield* log(`withdraw ${op.item} x${op.count}: ${moved} already withdrawn before the step was cut off`);
        return null;
    }
    const pattern = exactName(op.item);
    const banked = ctx.state().bank.items.filter(i => pattern.test(i.name));
    const have = banked.reduce((n, i) => n + i.count, 0);
    if (op.upTo && have === 0) {
        yield* log(
            moved > 0
                ? `withdraw ${op.item} x${op.count} (up to): ${moved} already withdrawn, the bank holds no more`
                : `withdraw ${op.item} x${want} (up to): skipped, the bank holds none`,
        );
        noteUpToShort(ctx, op, moved, 'bank held none');
        return null;
    }
    if (have < want && !op.upTo) return `bank holds ${have} ${op.item}, need ${want}`;
    const room = op.upTo ? inventoryRoom(ctx, pattern) : Infinity;
    const amount = Math.min(want, have, room);
    if (amount === 0) {
        yield* log(`withdraw ${op.item} x${want} (up to): skipped, no free inventory slot`);
        noteUpToShort(ctx, op, moved, 'no free inventory slot');
        return null;
    }
    const r = yield* withdraw(ctx, pattern, amount);
    yield* log(`withdraw ${op.item} x${amount}: ${r.message}`);
    if (r.ok) {
        if (moved + amount < op.count) noteUpToShort(ctx, op, moved + amount);
        return null;
    }
    return `withdraw ${op.item} x${amount} failed (${r.reason}, got ${r.amountWithdrawn}): ${r.message}`;
}

/** The operations still to make, in order, with the bank open; the first failure message ends them. */
function* performRemaining(ctx: Ctx): Op<string | null> {
    for (let op = nextOp(ctx); op; op = nextOp(ctx)) {
        const failure = yield* perform(ctx, op);
        if (failure) return failure;
        ctx.memory.opsMade++;
        ctx.memory.inFlight = null;
    }
    return null;
}

/** First z of the dungeon and underground map bands; the surface is below it. */
const UNDERGROUND_Z = 6400;

/** A booth or banker already in view: openBank uses it, no walk. */
const bankInView = (ctx: Ctx): boolean => {
    const s = ctx.state();
    return s.nearbyLocs.some(l => /^bank booth$/i.test(l.name)) || s.nearbyNpcs.some(n => /banker/i.test(n.name));
};

/** True when the player is off the surface (another level, or a dungeon band), where the bank table's coordinates mean nothing. */
const offSurface = (ctx: Ctx): boolean => {
    const p = ctx.state().player;
    return !!p && (p.level !== 0 || p.worldZ >= UNDERGROUND_Z);
};

/** The bank to walk to without an `area`: the one already chosen (until a walk to it fails), else the nearest to the bot; undefined (no walk) with a bank in view, off the surface or no player. */
function chosenSiteOf(ctx: Ctx): BankSite | undefined {
    if (ctx.memory.chosen) return ctx.memory.chosen;
    if (bankInView(ctx) || offSurface(ctx)) return undefined;
    const p = ctx.state().player;
    return p ? nearestBank({ level: p.level, x: p.worldX, z: p.worldZ }, accountOf(ctx.state())) : undefined;
}

/** Where to bank: the `area` param, else the nearest bank (see `chosenSiteOf`). */
function bankAreaOf(ctx: Ctx): Area | undefined {
    const { area } = ctx.params;
    if (area) return area;
    const site = chosenSiteOf(ctx);
    return site && bankArea(site);
}

export default defineTask({
    name: 'bank',
    description:
        'Walk to a bank (optional `area`, e.g. Varrock West {x:3185,z:3436,radius:6}; none = walk to the bank the fewest run ticks away by the world index (lib/banks.ts: any bank site the bot can reach, members ones included, through the doors its levels open and the Al Kharid toll if it carries 10 coins; quest-gated banks are never picked, as the bot state shows no quests), ' +
        'never Draynor (dark wizards; it works with an explicit area {x:3092,z:3243,radius:3}); fails if the walk cannot get there, and without an area refuses off the surface or where no walk reaches a bank, e.g. inside an agility course). ' +
        'The no-area walk can be long (from Lumbridge: Varrock West, ~120 run ticks, without coins; Al Kharid, ~56, with them), and NPCs attack unarmed low-level bots on the walks out of Lumbridge (learnings/hazards.md): wield a weapon first. Then open it, deposit (`deposit` [{item,count?}], count omitted = all; ' +
        'then `depositAllExcept` [names] deposits everything else so tools stay), then withdraw (`withdraw` [{item,count,upTo?}]; `upTo` true takes the lesser of count, what the bank holds and what the inventory can take (free slots; a stackable item needs one free slot, or none if a stack is held), and none held or no room is skipped, not a failure; it counts what the open bank lists then, so same-trip deposits of the item count; a short or skipped entry is named in the done reason), close the bank; done when every operation is made. ' +
        'Never sells or drops. Fails (no looping) if the bank holds fewer of an item than asked (unless `upTo`), or the inventory lacks a listed deposit. No bank in Lumbridge castle or anywhere in Lumbridge on this server: its map data has no booth or banker on any floor (learnings/banking.md).',
    params: Params,
    memory: (): BankMemory => ({ opsMade: 0, inFlight: null, chosen: null, upToShort: [] }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const { deposit: deposits, depositAllExcept, withdraw: withdrawals, area } = ctx.params;
        if (deposits.length === 0 && !depositAllExcept && withdrawals.length === 0)
            return 'nothing to deposit or withdraw';
        const refused = refuseArea(area);
        if (refused) return refused;
        if (!area && !bankInView(ctx) && offSurface(ctx))
            return 'not on the surface and no bank in view: pass an explicit `area` for the bank to walk to';
        const s = ctx.state();
        // A walk the world index sees no way out of (an agility course entered by a jump), or a point no bot stands on.
        if (!area && s.player && !bankInView(ctx) && !chosenSiteOf(ctx))
            return 'no bank a walk reaches from here (lib/banks.ts): pass an explicit `area` for the bank to walk to';
        const requested = new Map<string, { entries: number; all: boolean; total: number }>();
        for (const t of deposits) {
            const have = countItems(s, exactName(t.item));
            if (have === 0) return `cannot deposit ${t.item}: not in inventory`;
            const key = t.item.toLowerCase();
            const acc = requested.get(key) ?? { entries: 0, all: false, total: 0 };
            acc.entries++;
            acc.all ||= !t.count;
            acc.total += t.count ?? 0;
            requested.set(key, acc);
            if (acc.entries > 1 && acc.all)
                return `cannot deposit ${t.item}: listed more than once and an entry has no count (all)`;
            if (acc.total > have) return `cannot deposit ${acc.total} ${t.item}: only ${have} in inventory`;
        }
        return null;
    },

    steps: [
        {
            // openBank accepts any open bank; the run walks only while it is closed and the bank (area, or the nearest one) is far.
            name: 'walk-to-bank',
            when: ctx => {
                const area = bankAreaOf(ctx);
                return (
                    !!area && !ctx.state().bank.isOpen && !!nextOp(ctx) && ctx.distanceTo(area.x, area.z) > area.radius
                );
            },
            *run(ctx) {
                const area = bankAreaOf(ctx);
                // Narrowing only: when() guarantees it.
                if (!area) return;
                if (!ctx.params.area && !ctx.memory.chosen) {
                    const site = chosenSiteOf(ctx);
                    if (site) {
                        ctx.memory.chosen = site;
                        yield* log(`no area given: walking to the nearest bank, ${site.name} (${area.x},${area.z})`);
                    }
                }
                // The pick depends on the account (the Al Kharid toll needs the coins carried): a walk to it that
                // fails re-picks on the next attempt, with the account as it is then. walkToArea's one failure
                // count still bounds the attempts across picks.
                const failure = yield* walkToArea(ctx, area, () => {
                    if (!ctx.params.area) ctx.memory.chosen = null;
                });
                if (failure) return { fail: ctx.params.area ? failure : `no reachable bank: ${failure}` };
            },
        },
        {
            // Open, every remaining operation and the close are one step, so whatever cancels it (a
            // guard, a stop, the step budget) closes the bank on the way out: an open bank hides the
            // inventory the low-HP guard would eat from. An aborted step resumes at the first operation
            // not yet made, less what of it already landed (`inFlight`). Named `operate` so its failure
            // reasons keep the prefix runners know.
            name: 'operate',
            when: ctx => !!nextOp(ctx),
            *run(ctx) {
                const trip = yield* withBank(ctx, performRemaining(ctx));
                const openFails = ctx.streak('openFails');
                if (!trip.ok) {
                    yield* log(`open bank failed (${trip.reason}): ${trip.message}`);
                    if (!trip.closed.ok) yield* log(`a bank may be left open after it: ${trip.closed.message}`);
                    if (openFails.add() >= OPEN_FAIL_LIMIT)
                        return { fail: `cannot open bank (${trip.reason}): ${trip.message}` };
                    return;
                }
                openFails.reset();
                if (trip.value) return { fail: trip.value };
                // The bank modal hides the inventory, so a bank that stays open is a failure.
                if (!trip.closed.ok) return { fail: `operations done but cannot close bank: ${trip.closed.message}` };
            },
        },
        {
            name: 'finish',
            when: ctx => !nextOp(ctx),
            run: ctx => {
                const short = ctx.memory.upToShort;
                const made = `all ${operationsOf(ctx.params).length} bank operations made`;
                return { done: short.length > 0 ? `${made}; up to: ${short.join(', ')}` : made };
            },
        },
    ],
});
