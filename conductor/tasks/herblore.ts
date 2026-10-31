import { z } from 'zod/v4';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { brewPotion, cleanHerb } from '../actions/herblore';
import { log } from '../core/op';
import { defineTask, type TaskContext } from '../lib/task';
import { countItemId, findSkill } from '../lib/util';

/** Consecutive failed uses of one kind before the task fails. */
const FAIL_LIMIT = 3;

/**
 * The herbs the Herblore scripts know (server/content/scripts/skill_herblore/configs/herbs.obj for the
 * clean level, configs/brewing/brew_potion.struct `unf_*` for the unfinished potion's; `default=3` in
 * both .param files, so Guam is 3 twice). Items are told apart by obj id (server/content/pack/obj.pack):
 * every grimy herb is named "Herb" and every unfinished potion "Unfinished potion" in this revision.
 */
interface Herb {
    key: string;
    /** Grimy herb (`unidentified_*`), the clean herb, and the unfinished potion made from it with a Vial of water. */
    grimy: number;
    clean: number;
    unf: number;
    cleanLevel: number;
    unfLevel: number;
}
export const HERBS: readonly Herb[] = [
    { key: 'guam', grimy: 199, clean: 249, unf: 91, cleanLevel: 3, unfLevel: 3 },
    { key: 'marrentill', grimy: 201, clean: 251, unf: 93, cleanLevel: 5, unfLevel: 5 },
    { key: 'tarromin', grimy: 203, clean: 253, unf: 95, cleanLevel: 11, unfLevel: 12 },
    { key: 'harralander', grimy: 205, clean: 255, unf: 97, cleanLevel: 20, unfLevel: 22 },
    { key: 'ranarr', grimy: 207, clean: 257, unf: 99, cleanLevel: 25, unfLevel: 30 },
    { key: 'toadflax', grimy: 3049, clean: 2998, unf: 3002, cleanLevel: 30, unfLevel: 34 },
    { key: 'irit', grimy: 209, clean: 259, unf: 101, cleanLevel: 40, unfLevel: 45 },
    { key: 'avantoe', grimy: 211, clean: 261, unf: 103, cleanLevel: 48, unfLevel: 50 },
    { key: 'kwuarm', grimy: 213, clean: 263, unf: 105, cleanLevel: 54, unfLevel: 55 },
    { key: 'snapdragon', grimy: 3051, clean: 3000, unf: 3004, cleanLevel: 59, unfLevel: 63 },
    { key: 'cadantine', grimy: 215, clean: 265, unf: 107, cleanLevel: 65, unfLevel: 66 },
    { key: 'lantadyme', grimy: 2485, clean: 2481, unf: 2483, cleanLevel: 67, unfLevel: 69 },
    { key: 'dwarf weed', grimy: 217, clean: 267, unf: 109, cleanLevel: 70, unfLevel: 72 },
    { key: 'torstol', grimy: 219, clean: 269, unf: 111, cleanLevel: 75, unfLevel: 78 },
];

const VIAL_OF_WATER = 227;

/** Secondary ingredients, by the item's name and obj id. */
export const SECONDARIES = {
    newt: { name: 'Eye of newt', id: 221 },
    eggs: { name: "Red spiders' eggs", id: 223 },
    limpwurt: { name: 'Limpwurt root', id: 225 },
    snape: { name: 'Snape grass', id: 231 },
    unicorn: { name: 'Unicorn horn dust', id: 235 },
    berries: { name: 'White berries', id: 239 },
    scale: { name: 'Dragon scale dust', id: 241 },
    wine: { name: 'Wine of Zamorak', id: 245 },
    jangerberries: { name: 'Jangerberries', id: 247 },
    legs: { name: "Toad's legs", id: 2152 },
    chocolate: { name: 'Chocolate dust', id: 1975 },
    fungi: { name: 'Mort myre fungi', id: 2970 },
    cactus: { name: 'Potato cactus', id: 3138 },
} as const;
type SecondaryKey = keyof typeof SECONDARIES;

/** A finished potion: unfinished potion of `herb` plus `secondary` (brew_potion.struct: level and product id). */
interface Recipe {
    herb: string;
    secondary: SecondaryKey;
    level: number;
    potion: string;
    product: number;
}
// Recipes sharing an unfinished potion (ranarr, avantoe, harralander, irit, kwuarm, lantadyme) resolve in this table's order when no `pairs` is given.
export const RECIPES: readonly Recipe[] = [
    { herb: 'guam', secondary: 'newt', level: 3, potion: 'Attack potion', product: 121 },
    { herb: 'marrentill', secondary: 'unicorn', level: 5, potion: 'Antipoison', product: 175 },
    { herb: 'tarromin', secondary: 'limpwurt', level: 12, potion: 'Strength potion', product: 115 },
    { herb: 'harralander', secondary: 'eggs', level: 22, potion: 'Restore potion', product: 127 },
    { herb: 'harralander', secondary: 'chocolate', level: 26, potion: 'Energy potion', product: 3010 },
    { herb: 'ranarr', secondary: 'berries', level: 30, potion: 'Defence potion', product: 133 },
    { herb: 'toadflax', secondary: 'legs', level: 34, potion: 'Agility potion', product: 3034 },
    { herb: 'ranarr', secondary: 'snape', level: 38, potion: 'Prayer potion', product: 139 },
    { herb: 'irit', secondary: 'newt', level: 45, potion: 'Super attack', product: 145 },
    { herb: 'irit', secondary: 'unicorn', level: 48, potion: 'Super antipoison', product: 181 },
    { herb: 'avantoe', secondary: 'snape', level: 50, potion: 'Fishing potion', product: 151 },
    { herb: 'avantoe', secondary: 'fungi', level: 52, potion: 'Super energy', product: 3018 },
    { herb: 'kwuarm', secondary: 'limpwurt', level: 55, potion: 'Super strength', product: 157 },
    { herb: 'kwuarm', secondary: 'scale', level: 60, potion: 'Weapon poison', product: 187 },
    { herb: 'snapdragon', secondary: 'eggs', level: 63, potion: 'Super restore', product: 3026 },
    { herb: 'cadantine', secondary: 'berries', level: 66, potion: 'Super defence', product: 163 },
    { herb: 'lantadyme', secondary: 'scale', level: 69, potion: 'Antifire potion', product: 2454 },
    { herb: 'dwarf weed', secondary: 'wine', level: 72, potion: 'Ranging potion', product: 169 },
    { herb: 'torstol', secondary: 'jangerberries', level: 78, potion: 'Zamorak brew', product: 189 },
    { herb: 'lantadyme', secondary: 'cactus', level: 76, potion: 'Magic potion', product: 3042 },
];

/** "Guam leaf", "Guam potion (unf)", "grimy guam", "Marentill", "Dwarf weed" -> the key of the herb, or undefined. */
export function herbKey(name: string): string | undefined {
    const bare = name
        .toLowerCase()
        .replace(/\(unf\)|unfinished|potion|grimy|clean|\bleaf\b|\bweed\b|[^a-z ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const key = bare === 'marentill' ? 'marrentill' : bare === 'dwarf' ? 'dwarf weed' : bare;
    return HERBS.find(h => h.key === key)?.key;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const secondaryKey = (name: string): SecondaryKey | undefined =>
    (Object.keys(SECONDARIES) as SecondaryKey[]).find(k => norm(SECONDARIES[k].name) === norm(name));

const Params = z
    .object({
        /**
         * `clean`: grimy herbs the level allows. `unfinished`: clean herbs on Vials of water. `finish`: unfinished
         * potions plus a secondary. `all`: those three in that order on what the pack holds.
         */
        mode: z.enum(['clean', 'unfinished', 'finish', 'all']).default('all'),
        /** Herbs to work ("Guam leaf", "irit"); default every herb. In `all` with `pairs`, default the pairs' herbs. */
        herbs: z.array(z.string().trim().min(1)).optional(),
        /** Potions to finish: the unfinished potion ("Guam potion (unf)" or "guam") and the secondary ("Eye of newt"). Default every recipe the pack can make. */
        pairs: z.array(z.object({ unf: z.string().trim().min(1), secondary: z.string().trim().min(1) })).optional(),
    })
    .refine(p => p.pairs === undefined || p.mode === 'finish' || p.mode === 'all', {
        message: '`pairs` belongs to mode "finish" or "all"',
        path: ['pairs'],
    });

type HerbloreParams = z.infer<typeof Params>;
interface HerbloreMemory {
    /** What the run has made, for the done reason and the diagnostics. */
    cleaned: number;
    unfinished: number;
    finished: number;
}
type Ctx = TaskContext<HerbloreParams, HerbloreMemory>;

/** The herb keys and recipes the params allow, or the reason they name something unknown. */
function resolve(params: HerbloreParams): { herbs: Set<string>; recipes: Recipe[] } | string {
    let herbs: Set<string> | null = null;
    if (params.herbs) {
        herbs = new Set();
        for (const name of params.herbs) {
            const key = herbKey(name);
            if (!key) return `unknown herb "${name}" (known: ${HERBS.map(h => h.key).join(', ')})`;
            herbs.add(key);
        }
    }
    let recipes = [...RECIPES];
    if (params.pairs) {
        recipes = [];
        for (const { unf, secondary } of params.pairs) {
            const key = herbKey(unf);
            const sec = secondaryKey(secondary);
            const recipe = RECIPES.find(r => r.herb === key && r.secondary === sec);
            if (!recipe) {
                const known = RECIPES.map(r => `${r.herb} + ${SECONDARIES[r.secondary].name}`).join('; ');
                return `no potion from unf "${unf}" + "${secondary}" (known: ${known})`;
            }
            recipes.push(recipe);
        }
        herbs ??= new Set(recipes.map(r => r.herb));
    }
    return { herbs: herbs ?? new Set(HERBS.map(h => h.key)), recipes };
}

const wants = (p: HerbloreParams, mode: 'clean' | 'unfinished' | 'finish') => p.mode === mode || p.mode === 'all';
const levelOf = (s: BotWorldState) => findSkill(s, 'Herblore')?.baseLevel ?? 0;
const first = (s: BotWorldState, id: number): InventoryItem | undefined => s.inventory.find(i => i.id === id);
const scope = (ctx: Ctx) => {
    const r = resolve(ctx.params);
    // Preflight refuses a bad name before any step runs; the empty scope only keeps `when` total.
    return typeof r === 'string' ? { herbs: new Set<string>(), recipes: [] } : r;
};
const herbOf = (key: string) => HERBS.find(h => h.key === key)!;

/** One grimy herb to clean: the herbs the params allow and the level reaches. */
function cleanTarget(ctx: Ctx, s = ctx.state()): { item: InventoryItem; herb: Herb } | undefined {
    if (!wants(ctx.params, 'clean')) return undefined;
    const { herbs } = scope(ctx);
    const level = levelOf(s);
    for (const item of s.inventory) {
        const herb = HERBS.find(h => h.grimy === item.id);
        if (herb && herbs.has(herb.key) && herb.cleanLevel <= level) return { item, herb };
    }
    return undefined;
}

/** A clean herb and a Vial of water to put together. */
function unfinishedTarget(
    ctx: Ctx,
    s = ctx.state(),
): { herbItem: InventoryItem; vial: InventoryItem; herb: Herb } | undefined {
    if (!wants(ctx.params, 'unfinished')) return undefined;
    const vial = first(s, VIAL_OF_WATER);
    if (!vial) return undefined;
    const { herbs } = scope(ctx);
    const level = levelOf(s);
    for (const item of s.inventory) {
        const herb = HERBS.find(h => h.clean === item.id);
        if (herb && herbs.has(herb.key) && herb.unfLevel <= level) return { herbItem: item, vial, herb };
    }
    return undefined;
}

/** An unfinished potion and the secondary that finishes it. */
function finishTarget(
    ctx: Ctx,
    s = ctx.state(),
): { unfItem: InventoryItem; secItem: InventoryItem; recipe: Recipe } | undefined {
    if (!wants(ctx.params, 'finish')) return undefined;
    const { herbs, recipes } = scope(ctx);
    const level = levelOf(s);
    for (const recipe of recipes) {
        if (recipe.level > level || !herbs.has(recipe.herb)) continue;
        const unfItem = first(s, herbOf(recipe.herb).unf);
        const secItem = first(s, SECONDARIES[recipe.secondary].id);
        if (unfItem && secItem) return { unfItem, secItem, recipe };
    }
    return undefined;
}

/** What the pack still holds that the run did not use, for the done reason. */
function leftovers(s: BotWorldState): string {
    const grimy = HERBS.reduce((n, h) => n + countItemId(s, h.grimy), 0);
    const clean = HERBS.reduce((n, h) => n + countItemId(s, h.clean), 0);
    const unf = HERBS.reduce((n, h) => n + countItemId(s, h.unf), 0);
    const parts = [
        grimy && `${grimy} grimy herbs`,
        clean && `${clean} clean herbs`,
        unf && `${unf} unfinished potions`,
    ].filter(Boolean);
    return parts.length ? `; left: ${parts.join(', ')}` : '';
}

export default defineTask({
    name: 'herblore',
    description:
        'Train Herblore on herbs and secondaries the pack already holds; a plan around it banks and withdraws. ' +
        '`mode` "clean" cleans every grimy herb the level allows (62 XP for guam up to 375 for torstol, no delay), "unfinished" puts clean herbs on Vials of water (0 XP), ' +
        '"finish" adds a secondary to an unfinished potion (the XP), "all" (default) does the three in that order. ' +
        '`herbs` limits the herbs ("irit"); `pairs` names the potions to finish, e.g. [{"unf":"Guam potion (unf)","secondary":"Eye of newt"}] ' +
        '(attack potion, 625 XP); without it every known recipe the pack and level allow is made (guam + eye of newt, irit + eye of newt = super attack 2500 XP, ' +
        'harralander + chocolate dust = energy 1687 XP, ...); recipes that share an unfinished potion resolve in table order (ranarr: defence before prayer, avantoe: fishing before super energy, harralander: restore before energy), so set `pairs` when the pack holds competing secondaries. One use per tick, no make menu. Ends `done` when no allowed action is left in the pack ' +
        '(fails to start if there is none). Works anywhere; needs members. Herbs: chaos druids (Edgeville Dungeon is Wilderness; Taverley Dungeon), ' +
        "eye of newt 3 gp at Jatix in Taverley, vials of water 2 gp at Aemad's in East Ardougne, chocolate dust at Funch's.",
    params: Params,
    memory: (): HerbloreMemory => ({ cleaned: 0, unfinished: 0, finished: 0 }),
    diagnostics: ctx => ({ diagnostics: { ...ctx.memory } }),

    preflight(ctx) {
        const s = ctx.state();
        const r = resolve(ctx.params);
        if (typeof r === 'string') return r;
        if (!findSkill(s, 'Herblore')) return 'no Herblore skill in state';
        if (!cleanTarget(ctx, s) && !unfinishedTarget(ctx, s) && !finishTarget(ctx, s))
            return `nothing to do in the pack for mode "${ctx.params.mode}" at Herblore ${levelOf(s)}`;
        return null;
    },

    steps: [
        {
            name: 'clean',
            when: ctx => cleanTarget(ctx) !== undefined,
            *run(ctx) {
                const t = cleanTarget(ctx);
                if (!t) return;
                const fails = ctx.streak('cleanFails');
                const r = yield* cleanHerb(ctx, t.item);
                if (r.ok) {
                    fails.reset();
                    ctx.memory.cleaned += 1;
                    return;
                }
                yield* log(`clean ${t.herb.key} failed: ${r.message}`);
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} cleans in a row failed (${r.reason}: ${r.message})` };
            },
        },
        {
            name: 'unfinished',
            when: ctx => unfinishedTarget(ctx) !== undefined,
            *run(ctx) {
                const t = unfinishedTarget(ctx);
                if (!t) return;
                const fails = ctx.streak('unfinishedFails');
                const r = yield* brewPotion(ctx, t.herbItem, t.vial, t.herb.unf);
                if (r.ok) {
                    fails.reset();
                    ctx.memory.unfinished += 1;
                    return;
                }
                yield* log(`unfinished ${t.herb.key} failed: ${r.message}`);
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} unfinished potions in a row failed (${r.reason}: ${r.message})` };
            },
        },
        {
            name: 'finish',
            when: ctx => finishTarget(ctx) !== undefined,
            *run(ctx) {
                const t = finishTarget(ctx);
                if (!t) return;
                const fails = ctx.streak('finishFails');
                const r = yield* brewPotion(ctx, t.secItem, t.unfItem, t.recipe.product);
                if (r.ok) {
                    fails.reset();
                    ctx.memory.finished += 1;
                    return;
                }
                yield* log(`${t.recipe.potion} failed: ${r.message}`);
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} ${t.recipe.potion}s in a row failed (${r.reason}: ${r.message})` };
            },
        },
        {
            name: 'finished',
            when: () => true,
            run(ctx) {
                const m = ctx.memory;
                return {
                    done: `nothing left to do: cleaned ${m.cleaned}, unfinished ${m.unfinished}, finished ${m.finished}${leftovers(ctx.state())}`,
                };
            },
        },
    ],
});
