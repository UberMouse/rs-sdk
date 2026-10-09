import { z } from 'zod/v4';
import { shortestNameMatch } from '../../sdk/action-quantity';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import {
    SMELT_MAKE_TICKS,
    SMELT_MENU_TICKS,
    SMELT_OPTION,
    smelt,
    type SmeltResult,
    smith,
    SMITH_CLOSE_TICKS,
    SMITH_INTERFACE_TICKS,
    SMITH_MAKE_TICKS,
    type SmithingProduct,
    smithingProduct,
    HAMMER,
} from '../actions/smith';
import { call, log, type Op } from '../core/op';
import { AreaSchema, refuseArea, returnToAreaStep } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { exactName, findSkill, TICK_MS } from '../lib/util';

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
}

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
};

const FURNACE = /furnace/i;
const ANVIL = /anvil/i;
const FAIL_LIMIT = 4;
/** Within this many tiles of the furnace or anvil the client's own pathing reaches it; further, the task walks first. */
const STATION_REACH = 2;
/** Each smelt or smith action is a few ticks; a walk to the station can take longer. */
const STEP_TIMEOUT_MS = 90_000;
/**
 * The longest attempt that changes nothing the watchdog sees, in ticks: closing a leftover interface or
 * menu (a close wait and a second try), opening one, the make wait, and closing it again. A smith's is
 * the longer.
 */
const ATTEMPT_TICKS =
    2 * (SMITH_CLOSE_TICKS + 1) +
    Math.max(SMITH_INTERFACE_TICKS + SMITH_MAKE_TICKS, SMELT_MENU_TICKS + SMELT_MAKE_TICKS);
/** FAIL_LIMIT failed attempts in a row, and one more, so the task's own failure reason surfaces before the watchdog's. */
const STUCK_AFTER_MS = (FAIL_LIMIT + 1) * ATTEMPT_TICKS * TICK_MS;

const Params = z.object({
    mode: z.enum(['smelt', 'smith']),
    /** Metal: smelt mode makes this bar; smith mode uses this bar. */
    bar: z.enum(BARS).default('bronze'),
    /** Smith mode only: product to forge, e.g. "dagger", "axe", "med helm", "platebody". */
    product: z.string().default('dagger'),
    /** Stay near the furnace / anvil; walk back when further than `radius`. */
    area: AreaSchema.optional(),
});

type SmithingParams = z.infer<typeof Params>;
type Ctx = TaskContext<SmithingParams>;

const countOf = (state: BotWorldState, name: string) =>
    state.inventory.filter(i => i.name.toLowerCase() === name.toLowerCase()).reduce((n, i) => n + i.count, 0);

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

/** Stopgap until a walk op exists: bot.walkTo within STATION_REACH of a furnace or anvil further away. */
function* walkToStation(ctx: Ctx, station: NearbyLoc): Op<string | null> {
    if (ctx.distanceTo(station.x, station.z) <= STATION_REACH) return null;
    const w = yield* call('bot.walkTo', () => ctx.bot.walkTo(station.x, station.z, STATION_REACH));
    return w.success ? null : w.message;
}

export default defineTask({
    name: 'smithing',
    description:
        'Smithing in two modes. mode "smelt": at a furnace, smelt `bar` one at a time through its Smelt menu (bronze needs copper + tin 1:1; iron; ' +
        'steel/mithril/adamant/runite also need coal) until the ores run out. mode "smith": at an anvil with a hammer, ' +
        'forge `product` (dagger, axe, mace, med helm, sword, scimitar, longsword, full helm, sq shield, warhammer, battleaxe, ' +
        'chainbody, kiteshield, 2h sword, platelegs, plateskirt, platebody) from `bar` until the bars run out. ' +
        'Needs the Smithing level for the bar/product (checked against the engine configs) and, to smith, a hammer. ' +
        'Smelting takes about 8 ticks a bar; iron has a 50% failure chance. ' +
        '`area` centres on the furnace/anvil; it walks there when far away. Known spots: Lumbridge furnace (3225,3256), ' +
        'Varrock west anvils (3188,3421). Avoid the Al Kharid furnace (toll gate).',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const s = ctx.state();
        const { mode, bar } = ctx.params;
        const level = smithingLevel(s);
        if (mode === 'smelt') {
            const r = SMELT[bar];
            if (level < r.level) return `${r.bar} needs smithing ${r.level}, bot has ${level}`;
            if (smeltableBars(s, bar) < 1) {
                const extra = r.extra ? ` and ${r.extra.count} ${r.extra.item}` : '';
                return `need at least 1 ${r.ore}${extra} in inventory to smelt a ${r.bar}`;
            }
        } else {
            const product = lookupProduct(ctx.params.product);
            if (!product) return `unknown product "${ctx.params.product}" (known: ${Object.keys(PRODUCTS).join(', ')})`;
            const need = product.levels[metalIndex(bar)] ?? 99;
            if (level < need) return `${bar} ${ctx.params.product} needs smithing ${need}, bot has ${level}`;
            if (!s.inventory.some(i => HAMMER.test(i.name))) return 'no hammer in inventory';
            const have = countOf(s, SMELT[bar].bar);
            if (have < product.bars)
                return `${ctx.params.product} needs ${product.bars} ${SMELT[bar].bar}(s), bot has ${have}`;
        }
        return refuseArea(ctx.params.area);
    },

    steps: [
        {
            name: 'finish',
            when: ctx => {
                const s = ctx.state();
                if (ctx.params.mode === 'smelt') return smeltableBars(s, ctx.params.bar) < 1;
                const product = lookupProduct(ctx.params.product);
                return !product || countOf(s, SMELT[ctx.params.bar].bar) < product.bars;
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
                const fails = ctx.streak('smeltFails');
                // A furnace can be paired with an option-less decoy loc; require the Smelt option.
                const furnace = findStation(ctx, FURNACE, l => l.options.some(o => SMELT_OPTION.test(o)), false);
                if (!furnace) {
                    return fails.add() >= FAIL_LIMIT
                        ? { fail: 'no furnace with a Smelt option nearby (pass `area` at the furnace)' }
                        : undefined;
                }
                const walkFailed = yield* walkToStation(ctx, furnace);
                // A failed walk counts as a failed smelt, as it did when bot.useItemOnLoc walked.
                const r: SmeltResult = walkFailed
                    ? { ok: false, reason: 'cant-reach', message: `Cannot reach ${furnace.name}: ${walkFailed}` }
                    : yield* smelt(ctx, furnace, recipe.menuLabel);
                if (!r.ok) {
                    yield* log(`smelt failed: ${r.message}`);
                    if (fails.add() < FAIL_LIMIT) return;
                    // A click the furnace never acted on is the legacy "used no ore" failure.
                    const what = r.reason === 'timeout' ? 'used no ore' : 'failed';
                    return { fail: `${FAIL_LIMIT} smelts in a row ${what} (last: ${r.message})` };
                }
                fails.reset();
            },
        },
        {
            name: 'smith',
            when: ctx => ctx.params.mode === 'smith',
            *run(ctx) {
                const product = lookupProduct(ctx.params.product);
                if (!product) return { fail: `unknown product "${ctx.params.product}"` };
                const recipe = SMELT[ctx.params.bar];
                const fails = ctx.streak('smithFails');
                const anvil = findStation(ctx, ANVIL, () => true, true);
                if (!anvil) {
                    return fails.add() >= FAIL_LIMIT
                        ? { fail: 'no reachable anvil nearby (pass `area` at the anvil)' }
                        : undefined;
                }
                const walkFailed = yield* walkToStation(ctx, anvil);
                if (walkFailed) {
                    return fails.add() >= FAIL_LIMIT ? { fail: `can't reach the anvil (${walkFailed})` } : undefined;
                }
                const r = yield* smith(ctx, anvil, product.name, exactName(recipe.bar));
                if (!r.ok) {
                    yield* log(`smith failed: ${r.message}`, { reason: r.reason });
                    if (r.reason === 'no-hammer') return { fail: 'no hammer in inventory' };
                    return fails.add() >= FAIL_LIMIT
                        ? { fail: `${FAIL_LIMIT} smiths in a row failed (last: ${r.message})` }
                        : undefined;
                }
                fails.reset();
            },
        },
    ],
});
