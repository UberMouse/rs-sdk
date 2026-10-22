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
import { profileOf, type Profile } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { methodQuery } from '../query';
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

/** Every skill at `level` but those `levels` names, profileOf's tools, then `opts`. */
const everyAt = (level: number, levels: Partial<Record<Skill, number>> = {}, opts: Partial<Profile> = {}): Profile => ({
    ...profileOf(
        { ...(Object.fromEntries(SKILLS.map(s => [s, level])) as Record<Skill, number>), ...levels },
        {
            tools: ctx.tools,
        },
    ),
    ...opts,
});

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

    // The phase 3b records: [id, site, process stops, bank, the first way's reach]. Plans' coordinates in these sites;
    // anvils and furnaces named by tile, as a nearest one may be quest-locked (Doric's).
    const b3: [string, string, string[] | null, string | null, string[]][] = [
        ['iron-khazard-superheat-platebody-drop', 'rock:kandarin:6', ['here', 'anvil:port-khazard:0'], null, []],
        [
            'superheat-iron-varrock-east-platebody',
            'bank:varrock-east-bank:0',
            ['here', 'anvil:varrock:3'],
            // A withdrawal banks at its own site.
            null,
            [],
        ],
        [
            'iron-se-varrock-superheat-platebody-bank',
            'rock:varrock-east-mine:0',
            ['here', 'anvil:varrock:3'],
            'bank:varrock-east-bank:0',
            [],
        ],
        [
            'iron-se-varrock-smelt-lumbridge-kiteshield',
            'rock:varrock-east-mine:0',
            ['furnace:lumbridge:0', 'anvil:varrock:0'],
            'bank:varrock-west-bank:0',
            [],
        ],
        // Out to Edgeville over the ridge gates, which take Agility 52 (wilderness_course.rs2:1-20).
        [
            'agility-wilderness-course',
            'agility-course:wilderness-agility-course:0',
            null,
            'bank:edgeville-bank:0',
            ['skill:agility:52'],
        ],
        ['agility-gnome-course', 'agility-course:gnome-agility-course:0', null, null, []],
        [
            'earth-runecraft-aubury-essence',
            'rock:rune-essence-mine:1',
            ['rc-altar:earth-altar:0'],
            null,
            ['item:earth_talisman:held', 'quest:runemysteries'],
        ],
        ['flax-seers-spin-bank', 'flax:flax:0', ['spinning-wheel:seers-village:0'], 'bank:seers-village-bank:0', []],
        // The Seers willows' site, though a sparse site's bbox (tree:kandarin:60) spans it: the record names a willow's tile.
        ['willow-seers-longbow-bank', 'tree:seers-village:1', ['here', 'here'], 'bank:seers-village-bank:0', []],
        ['trees-lumbridge-burn', 'tree:lumbridge-trees:0', ['tile:3230,3240,0'], null, []],
        ['willow-draynor-burn', 'tree:draynor-willows:0', ['tile:3088,3247,0'], null, []],
    ];
    for (const [id, site, steps, bank, reach] of b3)
        test(id, () => {
            const m = method(id);
            expect(m.site.id).toBe(site);
            expect(m.sink.mode === 'drop' ? null : (m.sink.bank?.id ?? null)).toBe(bank);
            expect(
                m.sink.mode === 'process'
                    ? m.sink.steps.map(s => (s === 'here' ? s : isTileStop(s) ? tileStopId(s.tile) : s.id))
                    : null,
            ).toEqual(steps);
            expect(m.ways[0]!.reach).toEqual(reach);
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
    // magic_spells.dbrow superheat levelrequired 43, smithing.struct iron levelrequired 15; smithing.dbrow iron
    // platebody 33, kiteshield 27.
    expect(method('iron-khazard-superheat-platebody-drop')).toMatchObject({
        minLevel: 43,
        levels: { mining: 15, magic: 43, smithing: 33 },
    });
    expect(method('iron-se-varrock-smelt-lumbridge-kiteshield')).toMatchObject({
        minLevel: 27,
        levels: { mining: 15, smithing: 27 },
    });
    // The Wilderness pipe models from Agility 49 (wilderness_course.rs2:48-77), but its gate lets in from 52
    // (wilderness_course.rs2:2); the Barbarian course models from 1, its pipe lets in from 35
    // (barbarian_course.rs2:126). runecraft.dbrow earth 9; spinning.struct flax 10; cut_logs.dbrow and bows.dbrow
    // willow longbow 40, woodcut willow 30.
    expect(method('agility-wilderness-course')).toMatchObject({ minLevel: 52, levels: { agility: 52 } });
    expect(method('agility-barbarian-course')).toMatchObject({ minLevel: 35, levels: { agility: 35 } });
    expect(method('earth-runecraft-aubury-essence')).toMatchObject({
        minLevel: 9,
        levels: { mining: 1, runecraft: 9 },
    });
    expect(method('flax-seers-spin-bank')).toMatchObject({ minLevel: 10, levels: { crafting: 10 } });
    expect(method('willow-seers-longbow-bank')).toMatchObject({
        minLevel: 40,
        levels: { woodcutting: 30, fletching: 40 },
    });
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

describe('floors against the cross-checks of records with no measured figure (survey §5)', () => {
    test('agility-gnome-course: at or above the lap-only ~254k (roadmap Agility row)', () => {
        // No roll on the course, so the floor is the same at every level.
        expect(methodRate(method('agility-gnome-course'), everyAt(1), ctx).xpPerHour.agility).toBeGreaterThanOrEqual(
            254_000,
        );
    });
    test("agility-barbarian-course: at or above w4's 404k at Agility 35, the lowest level its reach takes", () => {
        expect(
            methodRate(method('agility-barbarian-course'), everyAt(35), ctx).xpPerHour.agility,
        ).toBeGreaterThanOrEqual(404_000);
    });
    test("earth-runecraft-aubury-essence: at or above the roadmap's 153k at its runs' start (Mining 99, adamant)", () => {
        // The second run's start state: Runecraft 45, Mining 99, the adamant pickaxe.
        const profile = everyAt(99, { runecraft: 45 }, { pickaxe: 'adamant_pickaxe' });
        expect(
            methodRate(method('earth-runecraft-aubury-essence'), profile, ctx).xpPerHour.runecraft,
        ).toBeGreaterThanOrEqual(153_000);
    });
});

describe("the conductor's floor (stats.ts --methods): methodQuery over the whole world.json", () => {
    // stats.ts passes the whole world, crossings and gates with it, as an agility lap and the runecraft legs read them.
    const q = methodQuery(world, methodModel(data));
    const profile = everyAt(99, {}, { pickaxe: 'adamant_pickaxe' });
    for (const [id, skill] of [
        ['agility-wilderness-course', 'agility'],
        ['agility-gnome-course', 'agility'],
        ['earth-runecraft-aubury-essence', 'runecraft'],
    ] as const)
        test(id, () => {
            const own = methodRate(method(id), profile, ctx).xpPerHour[skill] ?? 0;
            expect(own).toBeGreaterThan(0);
            expect(q.methodRate(id, profile).xpPerHour[skill]).toBe(own);
        });
});
