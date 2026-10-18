// The curated methods over the committed world.json and the real game data: each resolves to the sites its plan
// uses, and the floor at the levels a measured figure was taken at is at or above that figure. A seed measured
// above its floor is a model bug (cycle.ts, a family, distance.ts) to find, never a test to loosen.
import { describe, expect, test } from 'bun:test';
import { reachCollision } from '../collision';
import { wayFinder } from '../distance';
import { loadWorld } from '../load';
import { METHODS } from '../methods';
import { buildFamilies, readGameData } from '../model/families/index';
import { readFoods, readItems } from '../model/items';
import { measuredProfile, methodRate, resolveMethods, type MethodContext } from '../model/method';
import { readTools } from '../model/profile';
import type { Skill } from '../model/server';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { questFacts } from '../requirements';
import { readConfigs } from '../sources/configs';

const world = loadWorld();
const graph = reachGraph({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) });
const data = readGameData();
const ctx: MethodContext = {
    world,
    families: buildFamilies(data),
    items: readItems(data.objs),
    foods: readFoods(data.dbrows),
    tools: readTools(data.objs),
    quests: questFacts(world.quests),
};
const { methods, errors } = resolveMethods(METHODS, ctx, wayFinder(graph));
const method = (id: string) => {
    const m = methods.find(x => x.def.id === id);
    if (!m) throw new Error(`no method ${id}`);
    return m;
};

test('every record resolves', () => {
    expect(errors).toEqual([]);
    expect(methods.map(m => m.def.id)).toEqual(METHODS.map(d => d.id));
});

describe("each seed is at its plan's sites", () => {
    // [id, site, processor, bank]: the plans' coordinates (conductor/plans/*.ts) lie in these sites.
    const cases: [string, string, string | null, string][] = [
        ['iron-se-varrock-bank', 'rock:varrock-east-mine:0', null, 'bank:varrock-east-bank:0'],
        ['lure-lumbridge-cook-bank', 'fishing-spot:lumbridge:0', 'fire:lumbridge:2', 'bank:varrock-east-bank:0'],
        ['guard-falador-pickpocket', 'pickpocket:falador:4', null, 'bank:falador-east-bank:0'],
        ['knight-ardougne-pickpocket', 'pickpocket:east-ardougne:8', null, 'bank:ardougne-south-bank:0'],
        ['willow-draynor-bank', 'tree:draynor-willows:0', null, 'bank:draynor-bank:0'],
    ];
    for (const [id, site, processor, bank] of cases)
        test(id, () => {
            const m = method(id);
            expect(m.site.id).toBe(site);
            if (m.sink.mode === 'drop') throw new Error(`${id} drops`);
            expect(m.sink.bank.id).toBe(bank);
            expect(m.sink.mode === 'process-bank' ? m.sink.processor.id : null).toBe(processor);
            expect(m.ways[0]!.reach).toEqual([]);
            // A bank method's first leg is the site's nearest bank, which distance.ts computed the same way.
            if (m.sink.mode === 'bank') expect(m.ways[0]!.legs[0]!.runTicks).toBe(m.site.nearest!.bank!.runTicks);
        });

    test('iron-se-varrock-drop has no legs', () => {
        expect(method('iron-se-varrock-drop').ways).toEqual([{ reach: [], legs: [] }]);
    });
});

test("each skill's own level, the others at 99, and the whole method's", () => {
    // freshfish.rs2 fly fishing: `stat(fishing) < 20` returns, salmon from 30; cooking_generic trout 15, salmon 25.
    expect(method('lure-lumbridge-cook-bank')).toMatchObject({ minLevel: 25, levels: { fishing: 20, cooking: 25 } });
    // mine.dbrow iron rock_level 15.
    expect(method('iron-se-varrock-bank')).toMatchObject({ minLevel: 15, levels: { mining: 15 } });
});

describe('the game data the cycle reads', () => {
    test('food heals and item slots', () => {
        // consume_normal.dbrow: trout `stat_heal,hitpoints,7,0`, salmon 9, lobster 12.
        expect(ctx.foods.get('trout')).toBe(7);
        expect(ctx.foods.get('salmon')).toBe(9);
        expect(ctx.foods.get('lobster')).toBe(12);
        // Coins and feathers stack; coins have no cost line, so the engine's 1. A pickaxe is wielded, a rod carried.
        expect(ctx.items('coins')).toEqual({ stackable: true, cost: 1, wearable: false });
        expect(ctx.items('feather').stackable).toBe(true);
        expect(ctx.items('adamant_pickaxe').wearable).toBe(true);
        expect(ctx.items('fly_fishing_rod').wearable).toBe(false);
    });
});

describe('the floor at the measured levels is at or above every measured figure', () => {
    for (const def of METHODS)
        for (const [i, measured] of (def.measured ?? []).entries())
            test(`${def.id} #${i} (${measured.bot} ${measured.date})`, () => {
                const m = method(def.id);
                const floor = methodRate(m, measuredProfile(m, measured, ctx.tools), ctx);
                for (const [skill, xp] of Object.entries(measured.xpPerHour) as [Skill, number][]) {
                    const at = floor.xpPerHour[skill] ?? 0;
                    expect({ skill, floor: at, measured: xp, atOrAbove: at >= xp }).toMatchObject({ atOrAbove: true });
                }
            });
});
