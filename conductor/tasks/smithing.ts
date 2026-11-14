import { z } from 'zod/v4';
import { shortestNameMatch } from '../../sdk/action-quantity';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import {
    SMELT_MAKE_TICKS,
    SMELT_MAX_TICKS,
    SMELT_MENU_TICKS,
    SMELT_OPTION,
    smelt,
    type SmeltResult,
    smith,
    SMITH_CLOSE_TICKS,
    SMITH_INTERFACE_TICKS,
    SMITH_MAKE_TICKS,
    SMITH_MAX_TICKS,
    type SmithingProduct,
    smithingProduct,
    HAMMER,
    barOnlyRefusal,
} from '../actions/smith';
import { drop } from '../actions/drop';
import { WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, type Op } from '../core/op';
import { AreaSchema, refuseArea, returnToAreaStep, WALK_TO_AREA_SILENT_TICKS } from '../lib/area';
import { failStreak } from '../lib/streak';
import { defineTask, stepBudgetTicks, type TaskContext } from '../lib/task';
import { countItems, exactName, findSkill } from '../lib/util';

const BARS = ['bronze', 'iron', 'steel', 'mithril', 'adamant', 'runite'] as const;
type Metal = (typeof BARS)[number];

interface SmeltRecipe {
    /** The ore the bar is named after, which the smelt consumes. */
    ore: string;
    /** Extra ore consumed per bar, if any. */
    extra?: { item: string; count: number };
    /** Smithing level to smelt. */
    level: number;
    /** Exact item name of the bar. */
    bar: string;
    /** The bar's button in the furnace's smelting menu (skill_smithing/interfaces/smelting.if). */
    menuLabel: string;
}

/** From server/content/scripts/skill_smithing/configs/smelting/smelting.struct. */
const SMELT: Record<Metal, SmeltRecipe> = {
    bronze: {
        ore: 'Copper ore',
        extra: { item: 'Tin ore', count: 1 },
        level: 1,
        bar: 'Bronze bar',
        menuLabel: 'Bronze',
    },
    iron: { ore: 'Iron ore', level: 15, bar: 'Iron bar', menuLabel: 'Iron' },
    steel: { ore: 'Iron ore', extra: { item: 'Coal', count: 2 }, level: 30, bar: 'Steel bar', menuLabel: 'Steel' },
    mithril: {
        ore: 'Mithril ore',
        extra: { item: 'Coal', count: 4 },
        level: 50,
        bar: 'Mithril bar',
        menuLabel: 'Mithril',
    },
    adamant: {
        ore: 'Adamantite ore',
        extra: { item: 'Coal', count: 6 },
        level: 70,
        bar: 'Adamantite bar',
        menuLabel: 'Adamant',
    },
    runite: { ore: 'Runite ore', extra: { item: 'Coal', count: 8 }, level: 85, bar: 'Runite bar', menuLabel: 'Rune' },
};

interface Product {
    bars: number;
    /** Smithing level per metal, in BARS order. */
    levels: readonly [number, number, number, number, number, number];
    /** The made item's exact name when it is not "<Metal> <product>". */
    item?: string;
}

/** Level that stands for "this metal cannot make it" in `levels`; those slots are refused by the BAR_ONLY check (`barOnlyRefusal`) before the level is compared. */
const NEVER = 99;

/**
 * Bars and levels per product, from server/content/scripts/skill_smithing/configs/smithing/smithing.dbrow
 * (levelrequired, bar_amount), keyed by the smith op's own product names: every product the op offers.
 */
export const PRODUCTS: Record<SmithingProduct, Product> = {
    dagger: { bars: 1, levels: [1, 15, 30, 50, 70, 85] },
    axe: { bars: 1, levels: [1, 16, 31, 51, 71, 86] },
    mace: { bars: 1, levels: [2, 17, 32, 52, 72, 87] },
    'med helm': { bars: 1, levels: [3, 18, 33, 53, 73, 88] },
    sword: { bars: 1, levels: [4, 19, 34, 54, 74, 89] },
    scimitar: { bars: 2, levels: [5, 20, 35, 55, 75, 90] },
    longsword: { bars: 2, levels: [6, 21, 36, 56, 76, 91] },
    'full helm': { bars: 2, levels: [7, 22, 37, 57, 77, 92] },
    'sq shield': { bars: 2, levels: [8, 23, 38, 58, 78, 93] },
    warhammer: { bars: 3, levels: [9, 24, 39, 59, 79, 94] },
    battleaxe: { bars: 3, levels: [10, 25, 40, 60, 80, 95] },
    chainbody: { bars: 3, levels: [11, 26, 41, 61, 81, 96] },
    kiteshield: { bars: 3, levels: [12, 27, 42, 62, 82, 97] },
    '2h sword': { bars: 3, levels: [14, 29, 44, 64, 84, 99] },
    platelegs: { bars: 3, levels: [16, 31, 46, 66, 86, 99] },
    plateskirt: { bars: 3, levels: [16, 31, 46, 66, 86, 99] },
    platebody: { bars: 5, levels: [18, 33, 48, 68, 88, 99] },
    // Steel only (BAR_ONLY): smithing.dbrow [nails], 1 bar -> 2 Nails at Smithing 34; the other metals' column 5 has no nails.
    nails: { bars: 1, levels: [NEVER, NEVER, 34, NEVER, NEVER, NEVER], item: 'Nails' },
};

const FURNACE = /furnace/i;
const ANVIL = /anvil/i;
export const FAIL_LIMIT = 4;
/** Within this many tiles of the furnace or anvil the client's own pathing reaches it; further, the task walks first. */
const STATION_REACH = 2;
/**
 * A station this close and `reachable` is interacted with directly: the client routes to the side the server
 * lets it use. A walkTo to within STATION_REACH can stop on the wrong side of a wall (the Al Kharid furnace
 * at (3272,3185) is open to the east only, and (3270,3184) is within 2 tiles of it from the west).
 */
const STATION_DIRECT_REACH = 8;
/** After a failed direct attempt the walk goes this close: next to the station, on the side the route reaches. */
const STATION_RETRY_REACH = 1;
/** Each smelt or smith action is a few ticks; a walk to the station can take longer. */
const STEP_TIMEOUT_MS = 90_000;
/** The longest smelt or smith op: what the walk to the station leaves of the step (its reserveTicks). */
export const OP_MAX_TICKS = Math.max(SMELT_MAX_TICKS, SMITH_MAX_TICKS);
/** The longest walk to a station: walkTo caps itself to the step's budget less OP_MAX_TICKS. */
export const STATION_WALK_TICKS = Math.min(WALK_MAX_TICKS, stepBudgetTicks(STEP_TIMEOUT_MS) - OP_MAX_TICKS);
/**
 * The longest op that changes nothing the watchdog sees, in ticks: closing a leftover interface or menu
 * (a close wait and a second try), opening one, the make wait, and closing it again. A smith's is the
 * longer.
 */
const OP_SILENT_TICKS =
    2 * (SMITH_CLOSE_TICKS + 1) +
    Math.max(SMITH_INTERFACE_TICKS + SMITH_MAKE_TICKS, SMELT_MENU_TICKS + SMELT_MAKE_TICKS);
/**
 * The longest attempt that changes nothing the watchdog sees: a walk to the station that never moves the
 * bot, then the op.
 */
export const ATTEMPT_SILENT_TICKS = STATION_WALK_TICKS + OP_SILENT_TICKS;
const streakOf = (name: string) => ({ name, limit: FAIL_LIMIT, worstTicks: ATTEMPT_SILENT_TICKS });
const DROP_FAILS = failStreak({ ...streakOf('dropFails'), what: 'drops of the products' });
const SMELT_FAILS = failStreak(streakOf('smeltFails'));
const SMITH_FAILS = failStreak(streakOf('smithFails'));
/** FAIL_LIMIT failed attempts in a row, and one more, so the task's own failure reason surfaces before the watchdog's. */
const SILENT = [DROP_FAILS, SMELT_FAILS, SMITH_FAILS, WALK_TO_AREA_SILENT_TICKS];

const Params = z.object({
    mode: z
        .enum(['smelt', 'smith'])
        .describe('`smelt` makes bars at a furnace; `smith` forges products from bars at an anvil.'),
    bar: z.enum(BARS).default('bronze').describe('The metal: `smelt` mode makes this bar; `smith` mode uses this bar.'),
    product: z
        .string()
        .default('dagger')
        .describe(
            `\`smith\` mode only: the product to forge, as the anvil names it (any case, spacing or alias: "Square-shield" is "sq shield"): ${Object.keys(PRODUCTS).join(', ')}.`,
        ),
    area: AreaSchema.optional().describe(
        'Centre it on the furnace or anvil: the bot stays near it and walks back when further than `radius`, and walks there when far away. Omit to work where it stands.',
    ),
    onDone: z
        .enum(['keep', 'drop'])
        .default('keep')
        .describe(
            '`smith` mode only: what to do with the forged products once the bars are used up. `keep` leaves them in the inventory; `drop` drops them (only the products: never bars, ore, runes, tools or coins), for a loop that trains Smithing without a bank.',
        ),
});

type SmithingParams = z.infer<typeof Params>;
/** Per-run state: where the last attempt at a station that skipped the walk failed from. */
interface SmithingMemory {
    /**
     * Where a failed attempt without a walk started; until one succeeds. If the bot has since moved (the
     * client's detour round a wall brought it close), the next attempt is direct again; from the same tile
     * nothing moved, and it walks next to the station first.
     */
    directFrom: { x: number; z: number } | null;
}
type Ctx = TaskContext<SmithingParams, SmithingMemory>;

const countOf = (state: BotWorldState, name: string) => countItems(state, exactName(name));

/** The exact name of the item `product` makes from `bar`: "Iron platebody", "Adamant 2h sword" (the game's own typo "Adamnt warhammer"). */
const productItem = (bar: Metal, product: SmithingProduct) =>
    exactName(
        PRODUCTS[product].item ??
            (bar === 'adamant' && product === 'warhammer' ? 'Adamnt warhammer' : `${SMELT[bar].menuLabel} ${product}`),
    );

/** Fewer bars than one `product` takes: nothing more can be forged. */
const outOfBars = (s: BotWorldState, bar: Metal, product: { bars: number }) =>
    countOf(s, SMELT[bar].bar) < product.bars;

const metalIndex = (bar: Metal) => BARS.indexOf(bar);

/** Whole bars the inventory's ores can still make. */
function smeltableBars(state: BotWorldState, bar: Metal): number {
    const r = SMELT[bar];
    const byOre = countOf(state, r.ore);
    if (!r.extra) return byOre;
    return Math.min(byOre, Math.floor(countOf(state, r.extra.item) / r.extra.count));
}

/** `name` as the smith op resolves it, with its bars and levels; undefined for a product the op does not offer. */
function lookupProduct(name: string): (Product & { name: SmithingProduct }) | undefined {
    const product = smithingProduct(name);
    return product && { name: product, ...PRODUCTS[product] };
}

const smithingLevel = (state: BotWorldState) => findSkill(state, 'Smithing')?.baseLevel ?? 0;

/**
 * As sdk.findNearbyLoc: the shortest-named match, a reachable one first; with `reachableOnly`, none when
 * only unreachable ones match.
 */
function findStation(ctx: Ctx, name: RegExp, filter: (l: NearbyLoc) => boolean, reachableOnly: boolean) {
    const match = shortestNameMatch(ctx.state().nearbyLocs.filter(filter), name);
    return reachableOnly && match?.reachable === false ? null : match;
}

const stayedAt = (ctx: Ctx, from: { x: number; z: number } | null) => {
    const p = ctx.state().player;
    return !!from && !!p && p.worldX === from.x && p.worldZ === from.z;
};

/** Whether the station is too far for the client's own pathing: not within reach, nor a direct-shortcut one. */
function needsWalk(ctx: Ctx, station: NearbyLoc): boolean {
    const distance = ctx.distanceTo(station.x, station.z);
    // A direct attempt that failed without the bot moving: walk to the station's side first.
    if (stayedAt(ctx, ctx.memory.directFrom)) return distance > STATION_RETRY_REACH;
    if (distance <= STATION_REACH) return false;
    return !(station.reachable === true && distance <= STATION_DIRECT_REACH);
}

/**
 * Walks within STATION_REACH of a furnace or anvil further away, leaving the step room for the op after
 * it; the walk's failure message, or null.
 */
function* walkToStation(ctx: Ctx, station: NearbyLoc): Op<string | null> {
    if (!needsWalk(ctx, station)) return null;
    const retrying = stayedAt(ctx, ctx.memory.directFrom);
    const w = yield* walkTo(ctx, station.x, station.z, retrying ? STATION_RETRY_REACH : STATION_REACH, {
        reserveTicks: OP_MAX_TICKS,
    });
    if (w.ok) return null;
    // A retry walk that failed leaves the bot where it was: the next attempt goes direct again, not into the same walk.
    if (retrying) ctx.memory.directFrom = null;
    return w.message;
}

export default defineTask({
    name: 'smithing',
    description:
        'Smelts ore into bars at a furnace (mode "smelt") or forges bars into products at an anvil (mode "smith"). ' +
        "Smelting goes one bar at a time through the furnace's Smelt menu, about 8 ticks a bar, until the ores run out; iron has a 50% failure chance. " +
        'Smithing forges `product` from `bar` until the bars run out. ' +
        `A reachable station within ${STATION_DIRECT_REACH} tiles is interacted with directly, and walked to first only after such an attempt failed.`,
    rules: [
        `Smelting needs these ores in the inventory and this base Smithing level: ${Object.values(SMELT)
            .map(
                r =>
                    `${r.bar} ${r.level} (${[r.ore, ...(r.extra ? [`${r.extra.count} ${r.extra.item}`] : [])].join(' + ')})`,
            )
            .join(', ')}.`,
        'Smithing needs the base Smithing level for the bar and product (checked against the engine configs), a hammer and enough bars for one product.',
        'Nails: steel bar only, 2 Nails a bar, stacked, Smithing 34.',
        '`onDone` "drop" applies to mode "smith" only, and is refused when the inventory already holds a copy of the product (the drop would clear it too): bank it first.',
    ],
    spots: [
        'Lumbridge furnace (3225,3256).',
        'Varrock west anvils (3188,3421).',
        'The Al Kharid furnace (3272,3185) works from its open east side.',
    ],
    params: Params,
    memory: (): SmithingMemory => ({ directFrom: null }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    silent: SILENT,

    preflight(ctx) {
        const s = ctx.state();
        const { mode, bar } = ctx.params;
        const level = smithingLevel(s);
        if (mode === 'smelt') {
            if (ctx.params.onDone === 'drop') return `onDone 'drop' only applies to mode 'smith'`;
            const r = SMELT[bar];
            if (level < r.level) return `${r.bar} needs smithing ${r.level}, bot has ${level}`;
            if (smeltableBars(s, bar) < 1) {
                const extra = r.extra ? ` and ${r.extra.count} ${r.extra.item}` : '';
                return `need at least 1 ${r.ore}${extra} in inventory to smelt a ${r.bar}`;
            }
        } else {
            const product = lookupProduct(ctx.params.product);
            if (!product) return `unknown product "${ctx.params.product}" (known: ${Object.keys(PRODUCTS).join(', ')})`;
            const barRefusal = barOnlyRefusal(product.name, SMELT[bar].bar);
            if (barRefusal) return barRefusal;
            const need = product.levels[metalIndex(bar)] ?? NEVER;
            if (level < need) return `${bar} ${ctx.params.product} needs smithing ${need}, bot has ${level}`;
            if (!s.inventory.some(i => HAMMER.test(i.name))) return 'no hammer in inventory';
            if (outOfBars(s, bar, product))
                return `${ctx.params.product} needs ${product.bars} ${SMELT[bar].bar}(s), bot has ${countOf(s, SMELT[bar].bar)}`;
            // The drop clears every copy of the product, so a copy held beforehand (an axe, a spare weapon) would go too.
            if (ctx.params.onDone === 'drop' && countItems(s, productItem(bar, product.name)) > 0)
                return `onDone 'drop' would also drop the ${SMELT[bar].menuLabel} ${product.name} already in the inventory: bank it first`;
        }
        return refuseArea(ctx.params.area);
    },

    steps: [
        {
            name: 'drop-products',
            when: ctx => {
                const { mode, bar, onDone } = ctx.params;
                const product = lookupProduct(ctx.params.product);
                if (mode !== 'smith' || onDone !== 'drop' || !product) return false;
                const s = ctx.state();
                return outOfBars(s, bar, product) && countItems(s, productItem(bar, product.name)) > 0;
            },
            *run(ctx) {
                // `when` only passes for a known product.
                const product = lookupProduct(ctx.params.product) as { name: SmithingProduct };
                const r = yield* drop(ctx, productItem(ctx.params.bar, product.name), 'all');
                if (r.ok) return DROP_FAILS.clear(ctx);
                yield* log(`drop failed: ${r.message}`, { reason: r.reason });
                return DROP_FAILS.miss(ctx, r.message);
            },
        },
        {
            name: 'finish',
            when: ctx => {
                const s = ctx.state();
                if (ctx.params.mode === 'smelt') return smeltableBars(s, ctx.params.bar) < 1;
                const product = lookupProduct(ctx.params.product);
                return !product || outOfBars(s, ctx.params.bar, product);
            },
            run: ctx =>
                ctx.params.mode === 'smelt'
                    ? { done: `out of ore for ${SMELT[ctx.params.bar].bar}s` }
                    : { done: `out of ${SMELT[ctx.params.bar].bar}s for ${ctx.params.product}` },
        },
        returnToAreaStep<SmithingParams>(params => params.area),
        {
            name: 'smelt',
            when: ctx => ctx.params.mode === 'smelt',
            *run(ctx) {
                const recipe = SMELT[ctx.params.bar];
                // A furnace can be paired with an option-less decoy loc; require the Smelt option.
                const furnace = findStation(ctx, FURNACE, l => l.options.some(o => SMELT_OPTION.test(o)), false);
                if (!furnace) {
                    return SMELT_FAILS.missWith(
                        ctx,
                        'no furnace with a Smelt option nearby (pass `area` at the furnace)',
                    );
                }
                const direct = !needsWalk(ctx, furnace);
                const from = ctx.state().player;
                const walkFailed = yield* walkToStation(ctx, furnace);
                // A failed walk counts as a failed smelt, as it did when bot.useItemOnLoc walked.
                const r: SmeltResult = walkFailed
                    ? { ok: false, reason: 'cant-reach', message: `Cannot reach ${furnace.name}: ${walkFailed}` }
                    : yield* smelt(ctx, furnace, recipe.menuLabel);
                if (!r.ok) {
                    if (direct && from) ctx.memory.directFrom = { x: from.worldX, z: from.worldZ };
                    yield* log(`smelt failed: ${r.message}`);
                    // A click the furnace never acted on is the legacy "used no ore" failure.
                    const what = r.reason === 'timeout' ? 'used no ore' : 'failed';
                    return SMELT_FAILS.missWith(ctx, `${FAIL_LIMIT} smelts in a row ${what} (last: ${r.message})`);
                }
                ctx.memory.directFrom = null;
                SMELT_FAILS.clear(ctx);
            },
        },
        {
            name: 'smith',
            when: ctx => ctx.params.mode === 'smith',
            *run(ctx) {
                const product = lookupProduct(ctx.params.product);
                if (!product) return { fail: `unknown product "${ctx.params.product}"` };
                const recipe = SMELT[ctx.params.bar];
                const anvil = findStation(ctx, ANVIL, () => true, true);
                if (!anvil) {
                    return SMITH_FAILS.missWith(ctx, 'no reachable anvil nearby (pass `area` at the anvil)');
                }
                const direct = !needsWalk(ctx, anvil);
                const from = ctx.state().player;
                const walkFailed = yield* walkToStation(ctx, anvil);
                if (walkFailed) {
                    yield* log(`walk to the anvil failed: ${walkFailed}`);
                    return SMITH_FAILS.missWith(ctx, `can't reach the anvil (${walkFailed})`);
                }
                const r = yield* smith(ctx, anvil, product.name, exactName(recipe.bar));
                if (!r.ok) {
                    if (direct && from) ctx.memory.directFrom = { x: from.worldX, z: from.worldZ };
                    yield* log(`smith failed: ${r.message}`, { reason: r.reason });
                    if (r.reason === 'no-hammer') return { fail: 'no hammer in inventory' };
                    return SMITH_FAILS.missWith(ctx, `${FAIL_LIMIT} smiths in a row failed (last: ${r.message})`);
                }
                ctx.memory.directFrom = null;
                SMITH_FAILS.clear(ctx);
            },
        },
    ],
});
