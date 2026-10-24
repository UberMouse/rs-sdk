import { z } from 'zod/v4';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { dismiss } from '../actions/dismiss';
import { drop } from '../actions/drop';
import { equip } from '../actions/equip';
import { CONVERSE_MAX_TICKS, converse, type TalkProgress } from '../actions/talk';
import { unequip } from '../actions/unequip';
import { useItemOnItem } from '../actions/use';
import { WALK_MAX_TICKS } from '../actions/walk';
import { log, wait } from '../core/op';
import { AtSchema, matcher, Pattern, walkToSpotStep } from '../lib/spot';
import { defineTask, type TaskContext } from '../lib/task';
import { INVENTORY_SLOTS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness } from '../lib/wilderness';

/** Failed walks or ops in a row before the task fails. */
const FAIL_LIMIT = 3;
/** Ticks to wait after an accepted combine for its product (or a choice menu) to show: an unrelated inventory change can end the use's own wait first. */
export const COMBINE_SETTLE_TICKS = 3;
/** A walk, then the op or a dialog of up to CONVERSE_MAX_TICKS: both fit one step. */
const STEP_TIMEOUT_MS = 360_000;
const STUCK_AFTER_MS = stuckWindowMs(CONVERSE_MAX_TICKS, failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS));

/** Worn slot numbers of the equipment container, by the names a plan gives them (server obj `wearpos`). */
export const WORN_SLOTS: Record<string, number> = {
    head: 0,
    cape: 1,
    amulet: 2,
    neck: 2,
    weapon: 3,
    body: 4,
    shield: 5,
    legs: 7,
    hands: 9,
    feet: 10,
    ring: 12,
    ammo: 13,
};

/** An item by name (case-insensitive regex), optionally pinned to an obj id. */
const ItemRef = z.union([Pattern, z.object({ name: Pattern, id: z.number().int().nonnegative().optional() })]);
type ItemRef = z.infer<typeof ItemRef>;

const nameOf = (r: ItemRef) => (typeof r === 'string' ? r : r.name);
const refMatches = (r: ItemRef, i: InventoryItem) =>
    matcher(nameOf(r)).test(i.name) && (typeof r === 'string' || r.id === undefined || r.id === i.id);
const countRef = (items: InventoryItem[], r: ItemRef) =>
    items.filter(i => refMatches(r, i)).reduce((n, i) => n + i.count, 0);

const isSlotName = (s: string) => Object.hasOwn(WORN_SLOTS, s.toLowerCase());

const Params = z
    .object({
        /** Use `use` on `on` (both in the inventory): Tinderbox on Black candle. */
        combine: z
            .object({
                use: ItemRef,
                on: ItemRef,
                product: ItemRef.optional(),
                /** The option to pick when the use opens a choice menu (Pot of flour on a Bucket of water: "Pastry dough"). */
                choice: Pattern.optional(),
            })
            .optional(),
        /**
         * Drop these inventory items (name patterns; `count` = inventory slots, a stack is one) where the bot
         * stands, or at `at`. Only what is named is ever dropped.
         */
        drop: z
            .array(z.object({ item: Pattern, count: z.number().int().min(1).max(INVENTORY_SLOTS).default(1) }))
            .min(1)
            .optional(),
        /** Take worn items off: `all`, a slot name (head, cape, amulet, weapon, body, shield, legs, hands, feet, ring, ammo) or an item name pattern. */
        unequip: z.array(Pattern).min(1).optional(),
        /** Wear these inventory items. */
        equip: z.array(ItemRef).min(1).optional(),
        /** Where to stand first (for a drop on a spot, `tolerance` 1). */
        at: AtSchema.optional(),
        /** For `drop`: the choices of a dialog the drop opens, answered in order; without them it is left open for the next task. */
        choices: z.array(Pattern).default([]),
    })
    .refine(
        p => [p.combine, p.drop, p.unequip, p.equip].filter(x => x !== undefined).length === 1,
        'give exactly one of combine, drop, unequip, equip',
    )
    .refine(p => p.choices.length === 0 || p.drop !== undefined, '`choices` belongs to `drop`');

type ItemsParams = z.infer<typeof Params>;
interface ItemsMemory {
    /** Counts at the first look, per mode (combine: product, use, on; drop: slots per entry). */
    base: number[] | null;
    /** A drop opened a dialog. */
    dialogOpened: boolean;
    /** The drop's dialog was answered with `choices`. */
    answered: boolean;
    progress: TalkProgress;
    /** Items the task has put on or taken off, for the result line (equip: bounds the put-ons). */
    moved: number;
    /** Drop: the obj id each entry was pinned to at the baseline (-1: none held). */
    ids: number[];
    /** Equip: what the last put-on pushed off, by name. */
    lastOff: string;
}
type Ctx = TaskContext<ItemsParams, ItemsMemory>;

// --- combine ---
type Combine = NonNullable<ItemsParams['combine']>;
const combineCounts = (s: BotWorldState, c: Combine) => [
    c.product ? countRef(s.inventory, c.product) : 0,
    countRef(s.inventory, c.use),
    countRef(s.inventory, c.on),
];

/** The items a combine uses, or why there are none: the first match of `use`, and a different slot matching `on`. */
function combinePair(inv: InventoryItem[], c: Combine): { item: InventoryItem; target: InventoryItem } | string {
    for (const r of [c.use, c.on]) if (countRef(inv, r) === 0) return `no ${nameOf(r)} in the inventory`;
    const item = inv.find(i => refMatches(c.use, i))!;
    const target = inv.find(i => refMatches(c.on, i) && i.slot !== item.slot);
    if (!target) return `${nameOf(c.use)} and ${nameOf(c.on)} are the same single item`;
    return { item, target };
}

/** A reference that names no id yet matches several different items in the pack. */
function ambiguousRef(inv: InventoryItem[], r: ItemRef): string | null {
    if (typeof r !== 'string' && r.id !== undefined) return null;
    const hits = inv.filter(i => matcher(nameOf(r)).test(i.name));
    if (new Set(hits.map(i => i.id)).size < 2) return null;
    return `${nameOf(r)} matches several different items (${[...new Set(hits.map(i => i.name))].join(', ')}): name one exactly or give {name, id}`;
}

function combineDone(ctx: Ctx, s: BotWorldState = ctx.state()): boolean {
    const { combine } = ctx.params;
    const base = ctx.memory.base;
    if (!combine || !base) return false;
    const now = combineCounts(s, combine);
    return (!!combine.product && now[0]! > base[0]!) || now[1]! < base[1]! || now[2]! < base[2]!;
}

/** The answers to the dialog the work opened: a drop's `choices`, a combine's `choice`. */
const answers = (ctx: Ctx): string[] => (ctx.params.combine?.choice ? [ctx.params.combine.choice] : ctx.params.choices);

// --- drop ---
/** Slots holding the entry's item: by the pinned obj id once there is one, else every name match. */
const slotsHeld = (s: BotWorldState, pattern: string, id?: number) =>
    s.inventory.filter(i => matcher(pattern).test(i.name) && (id === undefined || id < 0 || i.id === id)).length;

/** Slots of entry `i` still to drop. */
const dropLeft = (ctx: Ctx, i: number): number => {
    const entry = ctx.params.drop?.[i];
    const base = ctx.memory.base?.[i];
    if (!entry || base === undefined) return 0;
    return Math.max(0, entry.count - (base - slotsHeld(ctx.state(), entry.item, ctx.memory.ids[i])));
};

const dropEntryLeft = (ctx: Ctx) => (ctx.params.drop ?? []).findIndex((_, i) => dropLeft(ctx, i) > 0);

function dropDone(ctx: Ctx): boolean {
    if (!ctx.params.drop || !ctx.memory.base) return false;
    if (ctx.memory.dialogOpened) return ctx.params.choices.length === 0 || ctx.memory.answered;
    return dropEntryLeft(ctx) === -1;
}

// --- unequip ---
/** Worn items the `unequip` selectors name. */
function toTakeOff(ctx: Ctx): InventoryItem[] {
    const selectors = ctx.params.unequip ?? [];
    return ctx.state().equipment.filter(e =>
        selectors.some(sel => {
            const low = sel.toLowerCase();
            if (low === 'all') return true;
            if (isSlotName(low)) return e.slot === WORN_SLOTS[low];
            return matcher(sel).test(e.name);
        }),
    );
}

// --- equip ---
const wornRef = (s: BotWorldState, r: ItemRef) => s.equipment.some(e => refMatches(r, e));
const toWear = (ctx: Ctx) => (ctx.params.equip ?? []).find(r => !wornRef(ctx.state(), r));

const isDone = (ctx: Ctx): boolean => {
    const p = ctx.params;
    if (p.combine) return combineDone(ctx);
    if (p.drop) return dropDone(ctx);
    if (p.unequip) return toTakeOff(ctx).length === 0;
    return toWear(ctx) === undefined;
};

function summary(ctx: Ctx): string {
    const p = ctx.params;
    if (p.combine) return `used ${nameOf(p.combine.use)} on ${nameOf(p.combine.on)}`;
    if (p.drop)
        return ctx.memory.dialogOpened
            ? `dropping opened a dialog${ctx.memory.answered ? ' (answered)' : ' (left open)'}`
            : `dropped ${p.drop.map(d => `${d.item} x${d.count}`).join(', ')}`;
    if (p.unequip) return `nothing worn matches ${p.unequip.join(', ')} (${ctx.memory.moved} taken off)`;
    return `wearing ${(p.equip ?? []).map(nameOf).join(', ')} (${ctx.memory.moved} put on)`;
}

/** Slots short after `need` worn items come off (a stack that merges needs less; this is the cautious count). */
const roomShort = (s: BotWorldState, need: number) => need - (INVENTORY_SLOTS - s.inventory.length);

export default defineTask({
    name: 'items',
    description:
        'Inventory and equipment steps quest plans need; give exactly one of: ' +
        '`combine` {use, on, product?, choice?} uses one inventory item on another (Tinderbox on Black candle; names are case-insensitive regexes or {name, id}), done when the product appears or either item is used up (`choice` answers the menu the use opens, e.g. "Pastry dough" for Pot of flour on Bucket of water; a menu with no `choice` fails; a combine that keeps both inputs needs `product`, else it fails after 3 uses that changed nothing; a name matching several different items must be {name, id}); ' +
        '`drop` [{item, count}] drops the named items (count = slots) where the bot stands or at `at` (tolerance 1 for a spot such as the Camelot magic symbol {x:2780,z:3515}); only named items are dropped, and a name that matches different items is refused. ' +
        'Any dialog the drop opens (a level-up too) ends it: check the result reason. ' +
        'A drop that opens a dialog (Bat bones on the symbol summon Thrantax and stay in the pack) ends the task with the dialog left open for the next `talk` (an npc-less talk continues it), or answers it with `choices`; ' +
        '`unequip` ["all" | slot name (head cape amulet weapon body shield legs hands feet ring ammo) | item name regex] takes worn items off into the inventory (the Entrana boat and the Glarial tomb refuse worn gear), failing when the inventory has no room; ' +
        '`equip` [name | {name, id}] wears inventory items. It walks only when `at` is given. ' +
        'E.g. {"combine":{"use":"^Tinderbox$","on":"^Black candle$"}}; {"drop":[{"item":"^Bat bones$"}],"at":{"x":2780,"z":3515,"tolerance":1},"choices":["Snarthon Candtrick Termanto"]}. ' +
        'Recipes: wiki/quests/merlins-crystal.md.',
    params: Params,
    memory: (): ItemsMemory => ({
        base: null,
        dialogOpened: false,
        answered: false,
        progress: { answered: 0 },
        moved: 0,
        ids: [],
        lastOff: '',
    }),
    // A drop may open a dialog that is left (or answered here) on purpose: the dialog guard must not click under it.
    allow: ['dialog'],
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const p = ctx.params;
        const s = ctx.state();
        if (p.at && squareReachesWilderness(p.at.x, p.at.z, 0)) return `(${p.at.x},${p.at.z}) is in the Wilderness`;
        if (p.combine) {
            const pair = combinePair(s.inventory, p.combine);
            if (typeof pair === 'string') return pair;
            for (const r of [p.combine.use, p.combine.on]) {
                const vague = ambiguousRef(s.inventory, r);
                if (vague) return vague;
            }
        }
        for (const d of p.drop ?? []) {
            const held = s.inventory.filter(i => matcher(d.item).test(i.name));
            if (held.length === 0) return `no ${d.item} in the inventory to drop`;
            const names = [...new Set(held.map(i => i.name))];
            if (new Set(held.map(i => i.id)).size > 1)
                return `${d.item} matches several different items (${names.join(', ')}): name one exactly`;
            if (held.length < d.count) return `${held.length} slots of ${d.item} in the inventory, ${d.count} to drop`;
        }
        if (p.unequip) {
            for (const sel of p.unequip) {
                const low = sel.toLowerCase();
                if (low === 'all' || isSlotName(low)) continue;
                if (![...s.equipment, ...s.inventory].some(i => matcher(sel).test(i.name)))
                    return `nothing named ${sel} is worn or carried`;
            }
            const short = roomShort(s, toTakeOff(ctx).length);
            if (short > 0) return `the inventory has no room for ${short} more worn item${short === 1 ? '' : 's'}`;
        }
        for (const r of p.equip ?? [])
            if (!wornRef(s, r) && countRef(s.inventory, r) === 0) return `no ${nameOf(r)} in the inventory to wear`;
        return null;
    },

    steps: [
        {
            name: 'baseline',
            when: ctx => ctx.memory.base === null,
            run(ctx) {
                const { combine, drop: dropping } = ctx.params;
                const s = ctx.state();
                ctx.memory.ids = (dropping ?? []).map(
                    d => s.inventory.find(i => matcher(d.item).test(i.name))?.id ?? -1,
                );
                ctx.memory.base = combine
                    ? combineCounts(s, combine)
                    : (dropping ?? []).map((d, i) => slotsHeld(s, d.item, ctx.memory.ids[i]));
            },
        },
        {
            // A dialog open before the work (a level-up, a leftover page) would swallow its clicks; the one a drop opens is kept.
            name: 'clear-dialog',
            when: ctx => ctx.state().dialog.isOpen && !ctx.memory.dialogOpened,
            *run(ctx) {
                const r = yield* dismiss(ctx);
                if (!r.ok) return { fail: `a dialog is open and could not be cleared: ${r.message}` };
            },
        },
        {
            name: 'answer',
            when: ctx => ctx.memory.dialogOpened && !ctx.memory.answered && answers(ctx).length > 0,
            *run(ctx) {
                const r = yield* converse(ctx, answers(ctx).map(matcher), ctx.memory.progress);
                if (!r.ok) return { fail: r.message };
                if (ctx.params.combine) {
                    // A combine may need the menu again for its next use; the product can land a tick after the answer.
                    ctx.memory.dialogOpened = false;
                    ctx.memory.progress = { answered: 0 };
                    yield* wait('combine product', st => combineDone(ctx, st), COMBINE_SETTLE_TICKS);
                } else ctx.memory.answered = true;
            },
        },
        {
            name: 'finish',
            when: ctx => isDone(ctx),
            run: ctx => ({ done: summary(ctx) }),
        },
        // After the finish: a drop's summons can move the bot off the spot, and being done needs no walk back.
        walkToSpotStep<ItemsParams, ItemsMemory>(FAIL_LIMIT),
        {
            name: 'combine',
            when: ctx => !!ctx.params.combine,
            *run(ctx) {
                const { combine } = ctx.params;
                if (!combine) return;
                const pair = combinePair(ctx.state().inventory, combine);
                if (typeof pair === 'string') return { fail: `${pair} before the combine` };
                const { item, target } = pair;
                const used = yield* useItemOnItem(ctx, item, target);
                const fails = ctx.streak('combineFails');
                if (used.ok) {
                    fails.reset();
                    // The product (or the menu that asks for it) may land a tick after the use's own wait ended.
                    const settled = yield* wait(
                        'combine effect',
                        st => combineDone(ctx, st) || (st.dialog.isOpen && st.dialog.options.length > 1),
                        COMBINE_SETTLE_TICKS,
                    );
                    const menu = settled.state.dialog;
                    if (menu.isOpen && menu.options.length > 1 && !combineDone(ctx, settled.state)) {
                        if (!combine.choice)
                            return {
                                fail: `using ${item.name} on ${target.name} opened a choice (${menu.options.map(o => o.text).join(' | ')}): give \`choice\``,
                            };
                        // Each menu cycle counts as a use: a menu answered every time that never makes the product ends.
                        if (ctx.streak('combineNoEffect').add() >= FAIL_LIMIT)
                            return {
                                fail: `used ${item.name} on ${target.name} and answered its menu ${FAIL_LIMIT} times: no product appeared (a level requirement?)`,
                            };
                        ctx.memory.dialogOpened = true;
                        return;
                    }
                    // An ok use that used nothing up and made no product (both inputs kept, no `product` given).
                    const idle = ctx.streak('combineNoEffect');
                    if (combineDone(ctx)) idle.reset();
                    else if (idle.add() >= FAIL_LIMIT)
                        return {
                            fail: `used ${item.name} on ${target.name} ${FAIL_LIMIT} times: nothing was used up and no product appeared (give \`product\` if both items are kept)`,
                        };
                    return;
                }
                yield* log(`using ${item.name} on ${target.name} failed: ${used.message}`);
                // A use that already made its product (an earlier send landing late) is not a failure.
                if (combineDone(ctx)) return;
                // The game said it does nothing: trying again cannot change that.
                if (used.reason === 'nothing-happened') return { fail: used.message };
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} tries in a row failed (last: ${used.message})` };
            },
        },
        {
            name: 'drop',
            when: ctx => !!ctx.params.drop,
            *run(ctx) {
                const i = dropEntryLeft(ctx);
                const entry = ctx.params.drop?.[i];
                if (!entry) return;
                const pinned = ctx.memory.ids[i]!;
                const held = new Set(
                    ctx
                        .state()
                        .inventory.filter(it => matcher(entry.item).test(it.name))
                        .map(it => it.id),
                );
                if (held.size > 1 || (held.size === 1 && !held.has(pinned)))
                    return { fail: `${entry.item} matches several different items now: name one exactly` };
                const dropped = yield* drop(ctx, matcher(entry.item), dropLeft(ctx, i), { untilDialog: true });
                const fails = ctx.streak('dropFails');
                if (dropped.ok) {
                    fails.reset();
                    if (dropped.dialogOpened) {
                        ctx.memory.dialogOpened = true;
                        yield* log(`dropping ${entry.item} opened a dialog`);
                    }
                    return;
                }
                yield* log(`drop of ${entry.item} failed: ${dropped.message}`);
                if (dropped.reason === 'no-item' || dropped.reason === 'too-few' || dropped.reason === 'invalid-amount')
                    return { fail: dropped.message };
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} drops in a row failed (last: ${dropped.message})` };
            },
        },
        {
            name: 'unequip',
            when: ctx => !!ctx.params.unequip,
            *run(ctx) {
                const item = toTakeOff(ctx)[0];
                if (!item) return;
                const removed = yield* unequip(ctx, item);
                const fails = ctx.streak('unequipFails');
                if (removed.ok) {
                    fails.reset();
                    ctx.memory.moved++;
                    return;
                }
                yield* log(`taking off ${item.name} failed: ${removed.message}`);
                if (removed.reason === 'no-room') return { fail: removed.message };
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} tries in a row failed (last: ${removed.message})` };
            },
        },
        {
            name: 'equip',
            when: () => true,
            *run(ctx) {
                const want = toWear(ctx);
                if (!want) return;
                // Every put-on that landed counts: gear that pushes each other off would otherwise swap forever.
                if (ctx.memory.moved >= (ctx.params.equip ?? []).length + FAIL_LIMIT)
                    return {
                        fail: `wearing ${ctx.memory.lastOff || 'gear'}: they can't be worn together (${nameOf(want)} is still not on after ${ctx.memory.moved} put-ons)`,
                    };
                const item = ctx.state().inventory.find(i => refMatches(want, i));
                if (!item) return { fail: `no ${nameOf(want)} in the inventory to wear` };
                const before = ctx.state().equipment.map(e => e.name);
                const worn = yield* equip(ctx, item);
                const fails = ctx.streak('equipFails');
                if (worn.ok) {
                    fails.reset();
                    ctx.memory.moved++;
                    const off = before.filter(n => !ctx.state().equipment.some(e => e.name === n));
                    ctx.memory.lastOff = off.length ? `${item.name} took ${off.join(', ')} off` : item.name;
                    return;
                }
                yield* log(`wearing ${item.name} failed: ${worn.message}`);
                if (worn.reason === 'no-option') return { fail: worn.message };
                if (fails.add() >= FAIL_LIMIT)
                    return {
                        fail: `${FAIL_LIMIT} tries in a row failed (last: ${worn.message}; a level requirement?)`,
                    };
            },
        },
    ],
});
