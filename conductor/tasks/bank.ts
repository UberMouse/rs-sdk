import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { deposit, withBank, withdraw } from '../actions/bank';
import { log, type Op } from '../core/op';
import { AreaSchema, refuseArea, walkToArea } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { exactName } from '../lib/util';

/**
 * Consecutive failed opens before the task fails. Three timed-out opens, each with withBank's wait for
 * a late open, are under 35 s of nothing changing, inside the engine's default stuck window (90 s), so
 * the failure is reported instead of the watchdog.
 */
const OPEN_FAIL_LIMIT = 3;
/** Walks to a far bank outlast the engine's default step timeout. */
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    /** Walk here first (a bank, e.g. Varrock West (3185,3436)). Omit to use the nearest bank to where the bot stands. */
    area: AreaSchema.optional(),
    /** Inventory items to deposit, by exact name. Omit `count` to deposit all of that item. */
    deposit: z.array(z.object({ item: z.string().min(1), count: z.number().int().positive().optional() })).default([]),
    /** Deposit every inventory item whose exact name is not listed here (tools stay). Runs after `deposit`. Worn gear is untouched. */
    depositAllExcept: z.array(z.string().min(1)).optional(),
    /** Bank items to withdraw, by exact name, after all deposits. Fails if the bank holds fewer than `count`. */
    withdraw: z.array(z.object({ item: z.string().min(1), count: z.number().int().positive() })).default([]),
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
}
type Ctx = TaskContext<BankParams, BankMemory>;
type Operation =
    | { kind: 'deposit'; item: string; count?: number }
    | { kind: 'depositAllExcept'; keep: string[] }
    | { kind: 'withdraw'; item: string; count: number };

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const invCount = (state: BotWorldState, name: string) =>
    state.inventory.filter(i => sameName(i.name, name)).reduce((n, i) => n + i.count, 0);

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
    const held = invCount(ctx.state(), op.item);
    const { inFlight, opsMade } = ctx.memory;
    if (inFlight?.opIndex !== opsMade) {
        ctx.memory.inFlight = { opIndex: opsMade, heldBefore: held };
        return null;
    }
    return Math.max(0, op.kind === 'deposit' ? inFlight.heldBefore - held : held - inFlight.heldBefore);
}

/** Returns a failure message, or null when the operation went through. */
function* perform(ctx: Ctx, op: Operation): Op<string | null> {
    if (op.kind === 'deposit') {
        const moved = recordOrMoved(ctx, op);
        // A resumed deposit-all is done once none is left; a counted one sends only the remainder.
        const amount = op.count === undefined ? 'all' : op.count - (moved ?? 0);
        const left = invCount(ctx.state(), op.item);
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
            if (!op.keep.some(k => sameName(k, i.name))) names.add(i.name);
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
    if (have < want) return `bank holds ${have} ${op.item}, need ${want}`;
    const r = yield* withdraw(ctx, pattern, want);
    yield* log(`withdraw ${op.item} x${want}: ${r.message}`);
    if (r.ok) return null;
    return `withdraw ${op.item} x${want} failed (${r.reason}, got ${r.amountWithdrawn}): ${r.message}`;
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

export default defineTask({
    name: 'bank',
    description:
        'Walk to a bank (optional `area`, e.g. Varrock West {x:3185,z:3436,radius:6}; none = nearest to the bot), open it, deposit (`deposit` [{item,count?}], count omitted = all; ' +
        'then `depositAllExcept` [names] deposits everything else so tools stay), then withdraw (`withdraw` [{item,count}]), close the bank; done when every operation is made. ' +
        'Never sells or drops. Fails (no looping) if the bank holds fewer of an item than asked, or the inventory lacks a listed deposit. No bank in Lumbridge on this server (learnings/banking.md).',
    params: Params,
    memory: (): BankMemory => ({ opsMade: 0, inFlight: null }),
    stepTimeoutMs: STEP_TIMEOUT_MS,

    preflight(ctx) {
        const { deposit: deposits, depositAllExcept, withdraw: withdrawals, area } = ctx.params;
        if (deposits.length === 0 && !depositAllExcept && withdrawals.length === 0)
            return 'nothing to deposit or withdraw';
        const refused = refuseArea(area);
        if (refused) return refused;
        const s = ctx.state();
        const requested = new Map<string, { entries: number; all: boolean; total: number }>();
        for (const t of deposits) {
            const have = invCount(s, t.item);
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
            // openBank accepts any open bank; the run walks only while it is closed.
            name: 'walk-to-bank',
            when: ctx => {
                const { area } = ctx.params;
                return (
                    !!area && !ctx.state().bank.isOpen && !!nextOp(ctx) && ctx.distanceTo(area.x, area.z) > area.radius
                );
            },
            *run(ctx) {
                const { area } = ctx.params;
                // Narrowing only: when() guarantees it.
                if (!area) return;
                const failure = yield* walkToArea(ctx, area);
                if (failure) return { fail: failure };
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
            run: ctx => ({ done: `all ${operationsOf(ctx.params).length} bank operations made` }),
        },
    ],
});
