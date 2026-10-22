// The curated methods over the committed world.json and the real game data: each resolves to the sites its plan
// uses, and the floor at the levels a measured figure was taken at is at or above that figure. A seed measured
// above its floor is a model bug (cycle.ts, a family, distance.ts) to find, never a test to loosen.
import { describe, expect, test } from 'bun:test';
import { reachCollision } from '../collision';
import { loadWorld } from '../load';
import { METHODS } from '../methods';
import { readGameData } from '../model/families/index';
import { legFinder } from '../model/legs';
import {
    isTileStop,
    measuredProfile,
    methodModel,
    methodRate,
    resolveMethod,
    resolveMethods,
    tileStopId,
    type MethodContext,
} from '../model/method';
import { profileOf } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { questFacts } from '../requirements';
import { readConfigs } from '../sources/configs';

const world = loadWorld();
const graph = reachGraph({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) });
const data = readGameData();
const ctx: MethodContext = {
    world,
    ...methodModel(data),
    quests: questFacts(world.quests),
};
const legs = legFinder(graph, world.crossings);
const { methods, errors } = resolveMethods(METHODS, ctx, legs);
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
            expect(m.sink.bank?.id).toBe(bank);
            expect(
                m.sink.mode === 'process'
                    ? m.sink.steps.map(s => (s === 'here' ? s : isTileStop(s) ? tileStopId(s.tile) : s.id))
                    : null,
            ).toEqual(processor === null ? null : [processor]);
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

describe('earth runes from the essence mine (survey §1e)', () => {
    // Mining essence at each of the mine's rocks, crafted at the earth altar through its ruins, the runes kept: the way
    // in is Aubury's teleport, priced at its landings' mean (model/legs.ts), and the way out a portal back to him.
    const ALTAR = world.features[world.sites.find(s => s.id === 'rc-altar:earth-altar:0')!.features[0]!]!.tile;
    const levels = Object.fromEntries(SKILLS.map(s => [s, 55])) as Record<Skill, number>;
    const profile = { ...profileOf(levels, { tools: ctx.tools }), pickaxe: 'adamant_pickaxe' };
    for (const i of [0, 1, 2, 3])
        test(`rock:rune-essence-mine:${i}`, () => {
            const rock = world.sites.find(s => s.id === `rock:rune-essence-mine:${i}`)!;
            const m = resolveMethod(
                {
                    id: 'earth-runes',
                    name: 'earth runes',
                    family: 'mining',
                    at: world.features[rock.features[0]!]!.tile,
                    params: {},
                    sink: { mode: 'process', steps: [{ family: 'runecraft', at: ALTAR, params: {} }], end: 'keep' },
                },
                ctx,
                legs,
            );
            const [way] = m.ways;
            expect(way!.reach).toEqual(['item:earth_talisman:held', 'quest:runemysteries']);
            // To the altar out of the mine: by the portal back to Aubury, which only a way in by him takes.
            expect(way!.legs[0]!.requires).toContain('other:came from aubury');
            const rate = methodRate(m, profile, ctx);
            // 26 essence (the talisman and the runes take a slot each, the pickaxe is wielded), 4 ticks each with an
            // adamant pickaxe; one craft of 5 ticks.
            expect(rate.trip).toMatchObject({ successes: 26, gather: 104, process: 5 });
            // The best measured run (roadmap: 42.4k XP in 1,080 s).
            expect(rate.xpPerHour.runecraft).toBeGreaterThanOrEqual(153_000);
        }, 30_000);
});
