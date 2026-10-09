import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { AreaSchema, refuseArea, returnToAreaStep } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { findSkill } from '../lib/util';

const BARS = ['bronze', 'iron', 'steel', 'mithril', 'adamant', 'runite'] as const;
type Metal = (typeof BARS)[number];

interface SmeltRecipe {
    /** The ore that goes on the furnace (the engine picks the bar from it). */
    ore: string;
    /** Extra ore consumed per bar, if any. */
    extra?: { item: string; count: number };
    /** Smithing level to smelt. */
    level: number;
    /** Exact item name of the bar. */
    bar: string;
}

/** From server/content/scripts/skill_smithing/configs/smelting/smelting.struct. */
const SMELT: Record<Metal, SmeltRecipe> = {
    bronze: { ore: 'Copper ore', extra: { item: 'Tin ore', count: 1 }, level: 1, bar: 'Bronze bar' },
    iron: { ore: 'Iron ore', level: 15, bar: 'Iron bar' },
    steel: { ore: 'Iron ore', extra: { item: 'Coal', count: 2 }, level: 30, bar: 'Steel bar' },
    mithril: { ore: 'Mithril ore', extra: { item: 'Coal', count: 4 }, level: 50, bar: 'Mithril bar' },
    adamant: { ore: 'Adamantite ore', extra: { item: 'Coal', count: 6 }, level: 70, bar: 'Adamantite bar' },
    runite: { ore: 'Runite ore', extra: { item: 'Coal', count: 8 }, level: 85, bar: 'Runite bar' },
};

interface Product {
    /** Name the SDK's smithAtAnvil understands. */
    sdkName: string;
    bars: number;
    /** Smithing level per metal, in BARS order. */
    levels: readonly [number, number, number, number, number, number];
}

/** From server/content/scripts/skill_smithing/configs/smithing/smithing.dbrow (levelrequired, bar_amount). */
const PRODUCTS: Record<string, Product> = {
    dagger: { sdkName: 'dagger', bars: 1, levels: [1, 15, 30, 50, 70, 85] },
    axe: { sdkName: 'axe', bars: 1, levels: [1, 16, 31, 51, 71, 86] },
    mace: { sdkName: 'mace', bars: 1, levels: [2, 17, 32, 52, 72, 87] },
    medhelm: { sdkName: 'med helm', bars: 1, levels: [3, 18, 33, 53, 73, 88] },
    sword: { sdkName: 'sword', bars: 1, levels: [4, 19, 34, 54, 74, 89] },
    scimitar: { sdkName: 'scimitar', bars: 2, levels: [5, 20, 35, 55, 75, 90] },
    longsword: { sdkName: 'longsword', bars: 2, levels: [6, 21, 36, 56, 76, 91] },
    fullhelm: { sdkName: 'full helm', bars: 2, levels: [7, 22, 37, 57, 77, 92] },
    sqshield: { sdkName: 'sq shield', bars: 2, levels: [8, 23, 38, 58, 78, 93] },
    warhammer: { sdkName: 'warhammer', bars: 3, levels: [9, 24, 39, 59, 79, 94] },
    battleaxe: { sdkName: 'battleaxe', bars: 3, levels: [10, 25, 40, 60, 80, 95] },
    chainbody: { sdkName: 'chainbody', bars: 3, levels: [11, 26, 41, 61, 81, 96] },
    kiteshield: { sdkName: 'kite shield', bars: 3, levels: [12, 27, 42, 62, 82, 97] },
    '2hsword': { sdkName: '2h sword', bars: 3, levels: [14, 29, 44, 64, 84, 99] },
    platelegs: { sdkName: 'platelegs', bars: 3, levels: [16, 31, 46, 66, 86, 99] },
    plateskirt: { sdkName: 'plateskirt', bars: 3, levels: [16, 31, 46, 66, 86, 99] },
    platebody: { sdkName: 'platebody', bars: 5, levels: [18, 33, 48, 68, 88, 99] },
};

/** "Med helm", "med-helm" and "medhelm" are one product; "square shield" is "sq shield". */
const productKey = (name: string) =>
    name
        .toLowerCase()
        .replace(/square/, 'sq')
        .replace(/two-?handed/, '2h')
        .replace(/[^a-z0-9]/g, '');

const HAMMER = /^hammer$/i;
const FAIL_LIMIT = 4;
/** Each smelt or smith action is a few ticks; a walk to the station can take longer. */
const STEP_TIMEOUT_MS = 90_000;

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

const lookupProduct = (name: string) => PRODUCTS[productKey(name)];

const smithingLevel = (state: BotWorldState) => findSkill(state, 'Smithing')?.baseLevel ?? 0;

async function smelt(ctx: Ctx): Promise<void | { fail: string }> {
    const recipe = SMELT[ctx.params.bar];
    const fails = ctx.counter('smeltFails');
    const before = ctx.state();
    const barsBefore = countOf(before, recipe.bar);
    const oreBefore = countOf(before, recipe.ore);
    // A furnace can be paired with an option-less decoy loc; require the Smelt option.
    const furnace = ctx.sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i });
    if (!furnace) {
        const n = fails.add();
        return n >= FAIL_LIMIT
            ? { fail: 'no furnace with a Smelt option nearby (pass `area` at the furnace)' }
            : undefined;
    }
    const r = await ctx.bot.useItemOnLoc(recipe.ore, furnace);
    if (!r.success) {
        ctx.log(`smelt failed: ${r.message}`);
        return fails.add() >= FAIL_LIMIT
            ? { fail: `${FAIL_LIMIT} smelts in a row failed (last: ${r.message})` }
            : undefined;
    }
    // The ore is consumed by the attempt itself (iron fails 50% of the time without a bar).
    try {
        await ctx.sdk.waitForCondition(s => countOf(s, recipe.ore) < oreBefore, 6_000);
    } catch {
        return fails.add() >= FAIL_LIMIT
            ? { fail: `${FAIL_LIMIT} smelts in a row used no ore (last: ${r.message})` }
            : undefined;
    }
    fails.reset();
    ctx.log('smelt', { bars: countOf(ctx.state(), recipe.bar) - barsBefore });
}

async function smith(ctx: Ctx): Promise<void | { fail: string }> {
    const product = lookupProduct(ctx.params.product);
    if (!product) return { fail: `unknown product "${ctx.params.product}"` };
    const recipe = SMELT[ctx.params.bar];
    const fails = ctx.counter('smithFails');
    const anvil = ctx.sdk.findNearbyLoc(/anvil/i, { reachable: true });
    if (!anvil) {
        return fails.add() >= FAIL_LIMIT ? { fail: 'no reachable anvil nearby (pass `area` at the anvil)' } : undefined;
    }
    // smithAtAnvil does not walk, so stand next to the anvil first.
    if (ctx.distanceTo(anvil.x, anvil.z) > 2) {
        const w = await ctx.bot.walkTo(anvil.x, anvil.z, 2);
        if (!w.success) {
            return fails.add() >= FAIL_LIMIT ? { fail: `can't reach the anvil (${w.message})` } : undefined;
        }
    }
    const barPattern = new RegExp(`^${recipe.bar}$`, 'i');
    const r = await ctx.bot.smithAtAnvil(product.sdkName, { barPattern });
    if (!r.success) {
        ctx.log(`smith failed: ${r.message}`, { reason: r.reason });
        if (r.reason === 'no_hammer') return { fail: 'no hammer in inventory' };
        return fails.add() >= FAIL_LIMIT
            ? { fail: `${FAIL_LIMIT} smiths in a row failed (last: ${r.message})` }
            : undefined;
    }
    fails.reset();
}

export default defineTask({
    name: 'smithing',
    description:
        'Smithing in two modes. mode "smelt": use ores on a furnace to make `bar` (bronze needs copper + tin 1:1; iron; ' +
        'steel/mithril/adamant/runite also need coal) until the ores run out. mode "smith": at an anvil with a hammer, ' +
        'forge `product` (dagger, axe, mace, med helm, sword, scimitar, longsword, full helm, sq shield, warhammer, battleaxe, ' +
        'chainbody, kiteshield, 2h sword, platelegs, plateskirt, platebody) from `bar` until the bars run out. ' +
        'Needs the Smithing level for the bar/product (checked against the engine configs) and, to smith, a hammer. ' +
        'Smelts one bar per action (~4 ticks). Iron has a 50% failure chance and an iron-ore smelt with 2+ coal at level 30+ makes steel. ' +
        '`area` centres on the furnace/anvil; it walks there when far away. Known spots: Lumbridge furnace (3225,3256), ' +
        'Varrock west anvils (3188,3421). Avoid the Al Kharid furnace (toll gate).',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,

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
            if (bar === 'iron' && level >= 30 && countOf(s, 'Coal') >= 2)
                return 'iron ore with 2+ coal at smithing 30+ smelts steel, not iron: drop the coal or use bar "steel"';
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
            run: async ctx =>
                ctx.params.mode === 'smelt'
                    ? { done: `out of ore for ${SMELT[ctx.params.bar].bar}s` }
                    : { done: `out of ${SMELT[ctx.params.bar].bar}s for ${ctx.params.product}` },
        },
        returnToAreaStep<SmithingParams>(params => params.area),
        {
            name: 'smelt',
            when: ctx => ctx.params.mode === 'smelt',
            run: smelt,
        },
        {
            name: 'smith',
            when: ctx => ctx.params.mode === 'smith',
            run: smith,
        },
    ],
});
