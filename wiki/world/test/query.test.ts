// The method query on a synthetic world: made-up families with round numbers (training.test.ts's), so each floor is
// worked by hand from cycle.ts in the comments, and every filter is shown letting a method through and keeping one out.
import { describe, expect, test } from 'bun:test';
import { ModelError, ProfileError, type Family } from '../model/family';
import type { Item } from '../model/items';
import { MethodError, tileStop, tileStopId, type MethodModel } from '../model/method';
import { profileAt, type Profile } from '../model/profile';
import type { Skill } from '../model/server';
import { methodHazard, methodQuery, type BestOptions } from '../query';
import { zoneKey } from '../sources/zones';
import { WORLD_FORMAT, type Site, type Tile, type World, type WorldMethod } from '../types';

const tile = (x: number, z: number): Tile => ({ level: 0, x, z });

const site = (id: string, x: number, hazard: Partial<Pick<Site, 'wildernessLevel' | 'multiway'>> = {}): Site => ({
    id,
    kind: id.slice(0, id.indexOf(':')) as Site['kind'],
    areaPath: [],
    centre: tile(x, 3200),
    bbox: { x1: x, z1: 3200, x2: x, z2: 3200, level: 0 },
    stand: tile(x, 3201),
    counts: {},
    features: [],
    f2p: false,
    multiway: false,
    wildernessLevel: 0,
    reach: [[]],
    ...hazard,
});

// Chopping: 4 ticks a log with the bronze axe, 2 with the rune axe (usable from Woodcutting 41 here), always a
// success, 10 XP (100 tenths) a log; needs Woodcutting 20 and an axe.
const woodcutting: Family = {
    id: 'woodcutting',
    skills: ['woodcutting'],
    kinds: ['tree'],
    model: (_site, _params, profile) => {
        if (profile.levels.woodcutting < 20) throw new ProfileError('Woodcutting 20');
        if (!profile.axe) throw new ProfileError('no axe');
        return {
            ticksPerAttempt: profile.axe === 'rune_axe' ? 2 : 4,
            success: 1,
            xpTenths: { woodcutting: 100 },
            products: [{ obj: 'logs', count: 1 }],
            consumes: [],
            tools: [profile.axe],
        };
    },
};

// Burning a log at the processor: 3 ticks, 40 XP (400 tenths), leaves ashes; needs Firemaking 30.
const firemaking: Family = {
    id: 'firemaking',
    skills: ['firemaking'],
    kinds: ['range'],
    model: (_site, _params, profile) => {
        if (profile.levels.firemaking < 30) throw new ProfileError('Firemaking 30');
        return {
            ticksPerAttempt: 3,
            success: 1,
            xpTenths: { firemaking: 400 },
            products: [{ obj: 'ashes', count: 1 }],
            consumes: [{ obj: 'logs', count: 1 }],
        };
    },
};

const ITEMS: Record<string, Item> = {
    logs: { stackable: false, cost: 10, wearable: false },
    ashes: { stackable: false, cost: 5, wearable: false },
    bronze_axe: { stackable: false, cost: 16, wearable: true },
    rune_axe: { stackable: false, cost: 12800, wearable: true },
};

const model: MethodModel = {
    families: new Map([
        ['woodcutting', woodcutting],
        ['firemaking', firemaking],
    ]),
    items: obj => {
        const item = ITEMS[obj];
        if (!item) throw new ModelError(`no obj ${obj}`);
        return item;
    },
    foods: new Map(),
    zones: { f2p: new Set(), multiway: new Set() },
    tools: {
        axe: [
            { obj: 'rune_axe', level: 41 },
            { obj: 'bronze_axe', level: 1 },
        ],
        pickaxe: [],
    },
};

const tree = site('tree:town:0', 3200);
const range = site('range:town:0', 3210);
const bank = site('bank:town:0', 3220);
const wildTree = site('tree:wild:0', 3300, { wildernessLevel: 5 });
const multiBank = site('bank:multi:0', 3230, { multiway: true });

/** A chopping method at `at`, Woodcutting 20. */
const chop = (id: string, at: Site, rest: Partial<WorldMethod>): WorldMethod => ({
    id,
    name: id,
    family: 'woodcutting',
    at: at.centre,
    params: {},
    sink: { mode: 'drop' },
    site: at.id,
    stand: at.stand!,
    skill: 'woodcutting',
    minLevel: 20,
    levels: { woodcutting: 20 },
    ways: [{ reach: [], legs: [] }],
    ...rest,
});

const leg = (from: Site, to: Site, runTicks: number) => ({ from: from.id, to: to.id, runTicks, requires: [] });

// Dropped; behind Agility 10. A trip is 28 logs (the axe wielded), then dropTicks(28) = ceil(30 / 5) = 6 ticks.
// Bronze: 28 x 4 + 6 = 118 ticks, 28 x 9000 / 118 = 2135.59 logs/h x 10 XP x 25 = 533,898. Rune: 56 + 6 = 62 ticks,
// 4064.52 logs/h, 1,016,129.
const drop = chop('tree-drop', tree, { ways: [{ reach: ['skill:agility:10'], legs: [] }] });
// The same at a tree in Wilderness level 5, needing nothing: the same floor, so it ties with tree-drop.
const wild = chop('wild-drop', wildTree, {});
// Banked at a multiway bank over a quest shortcut (legs 5 + 5) or the long way (20 + 20); banking adds no ticks
// (cycle.ts BANK_TICKS). Rune: 56 + 10 = 66 ticks, 28 x 9000 / 66 = 3818.18 logs/h, 954,545; the long way 56 + 40 =
// 96 ticks, 2625 logs/h, 656,250.
const banked = chop('tree-bank', tree, {
    sink: { mode: 'bank' },
    bank: multiBank.id,
    ways: [
        { reach: ['quest:shortcut'], legs: [leg(tree, multiBank, 5), leg(multiBank, tree, 5)] },
        { reach: [], legs: [leg(tree, multiBank, 20), leg(multiBank, tree, 20)] },
    ],
});
// Chopped, burnt at the range, banked: legs 10 + 5 + 15 = 30. Rune: 56 + 28 x 3 + 30 = 170 ticks, 28 x 9000 / 170 =
// 1482.35 logs/h: Woodcutting x 10 x 25 = 370,588, Firemaking x 40 x 25 = 1,482,353. Bronze: 112 + 84 + 30 = 226
// ticks, 1115.04 logs/h: 278,761 and 1,115,044.
const burn = chop('tree-burn-bank', tree, {
    sink: { mode: 'process', steps: [{ family: 'firemaking', at: range.centre, params: {} }], end: 'bank' },
    bank: bank.id,
    processors: [range.id],
    minLevel: 30,
    levels: { woodcutting: 20, firemaking: 30 },
    measured: [
        {
            xpPerHour: { woodcutting: 185_000, firemaking: 700_000 },
            level: { woodcutting: 35, firemaking: 40 },
            tool: 'bronze_axe',
            bot: 'w1',
            date: '2026-10-01',
            hours: 0.5,
            from: 'stats.ts w1',
        },
    ],
    ways: [{ reach: [], legs: [leg(tree, range, 10), leg(range, bank, 5), leg(bank, tree, 15)] }],
});

const world: Pick<World, 'format' | 'sites' | 'features' | 'methods'> = {
    format: WORLD_FORMAT,
    sites: [bank, multiBank, range, tree, wildTree],
    features: [],
    methods: [burn, banked, wild, drop],
};
const query = methodQuery(world, model);

/** A `met` that accepts no token. */
const none = () => false;
/** Every skill at `level` (profileAt), with the best axe usable there. */
const at = (skill: Skill, level: number): Profile => profileAt(skill, level, { tools: model.tools });
/** The ranking as [id, way, XP/hr rounded]. */
const rank = (skill: Skill, profile: Profile, opts?: BestOptions) =>
    query.bestMethods(skill, profile, opts).map(r => [r.method.def.id, r.way, Math.round(r.xpPerHour)]);

describe('bestMethods', () => {
    test('ranks by floor XP/hr of the skill, highest first; a tie by id', () => {
        // Woodcutting 50: the rune axe. tree-drop and wild-drop tie at 1,016,129: by id.
        expect(rank('woodcutting', at('woodcutting', 50))).toEqual([
            ['tree-drop', 0, 1_016_129],
            ['wild-drop', 0, 1_016_129],
            ['tree-bank', 0, 954_545],
            ['tree-burn-bank', 0, 370_588],
        ]);
        // The order of world.json's methods does not change it.
        const reversed = methodQuery({ ...world, methods: world.methods.toReversed() }, model);
        expect(reversed.bestMethods('woodcutting', at('woodcutting', 50))).toEqual(
            query.bestMethods('woodcutting', at('woodcutting', 50)),
        );
    });

    test('only methods that train the skill, on their process skill too', () => {
        // Firemaking 50 (Woodcutting 50 too, the rune axe): 1,482,353.
        expect(rank('firemaking', at('firemaking', 50))).toEqual([['tree-burn-bank', 0, 1_482_353]]);
        expect(rank('thieving', at('thieving', 99))).toEqual([]);
    });

    test('reach: the shortest way whose every token `met` accepts; none, and the method is out', () => {
        // tree-drop needs Agility 10; tree-bank's short way the quest, so the long way's 656,250.
        expect(rank('woodcutting', at('woodcutting', 50), { met: none })).toEqual([
            ['wild-drop', 0, 1_016_129],
            ['tree-bank', 1, 656_250],
            ['tree-burn-bank', 0, 370_588],
        ]);
        const met = new Set(['skill:agility:10', 'quest:shortcut']);
        expect(rank('woodcutting', at('woodcutting', 50), { met: t => met.has(t) })).toEqual(
            rank('woodcutting', at('woodcutting', 50)),
        );
    });

    test('met omitted: every token met, each method over its shortest way', () => {
        const all = query.bestMethods('woodcutting', at('woodcutting', 50));
        expect(all.map(r => [r.method.def.id, r.method.ways[r.way]!.reach])).toEqual([
            ['tree-drop', ['skill:agility:10']],
            ['wild-drop', []],
            ['tree-bank', ['quest:shortcut']],
            ['tree-burn-bank', []],
        ]);
    });

    test('levels: a method a family refuses at the profile is out', () => {
        // Woodcutting 25 and Firemaking 25: the bronze axe (533,898; the long-way bank 414,474: 112 + 40 = 152 ticks,
        // 1657.89 logs/h); burning needs Firemaking 30.
        expect(rank('woodcutting', at('woodcutting', 25), { met: none })).toEqual([
            ['wild-drop', 0, 533_898],
            ['tree-bank', 1, 414_474],
        ]);
        expect(rank('woodcutting', at('woodcutting', 19))).toEqual([]);
        // Firemaking 30 lets it in: bronze, 278,761.
        const both = { ...at('woodcutting', 25), levels: { ...at('woodcutting', 25).levels, firemaking: 30 } };
        expect(rank('woodcutting', both, { met: none })).toContainEqual(['tree-burn-bank', 0, 278_761]);
    });

    test('tools: no axe, no chopping method', () => {
        expect(rank('woodcutting', { ...at('woodcutting', 50), axe: null })).toEqual([]);
    });

    test('hazards: the deepest Wilderness level and any multiway site of the method, its sink sites included', () => {
        const ids = (opts: BestOptions) => rank('woodcutting', at('woodcutting', 50), opts).map(r => r[0]);
        expect(ids({ maxWilderness: 4 })).toEqual(['tree-drop', 'tree-bank', 'tree-burn-bank']);
        expect(ids({ maxWilderness: 5 })).toEqual(['tree-drop', 'wild-drop', 'tree-bank', 'tree-burn-bank']);
        // tree-bank's tree is single-way; its bank is not.
        expect(ids({ multiway: false })).toEqual(['tree-drop', 'wild-drop', 'tree-burn-bank']);
        expect(ids({ multiway: true })).toEqual(['tree-drop', 'wild-drop', 'tree-bank', 'tree-burn-bank']);
        const r = query.bestMethods('woodcutting', at('woodcutting', 50));
        expect(r.map(x => [x.method.def.id, x.hazard])).toEqual([
            ['tree-drop', { wildernessLevel: 0, multiway: false }],
            ['wild-drop', { wildernessLevel: 5, multiway: false }],
            ['tree-bank', { wildernessLevel: 0, multiway: true }],
            ['tree-burn-bank', { wildernessLevel: 0, multiway: false }],
        ]);
    });

    test('each result has its whole floor and its measured figures for the skill, each beside its own floor', () => {
        const [r] = query.bestMethods('firemaking', at('firemaking', 50));
        expect(r!.rates).toEqual(query.methodRate('tree-burn-bank', at('firemaking', 50)));
        // Measured at Woodcutting 35, Firemaking 40, the bronze axe: the floor there is 278,761 Woodcutting and
        // 1,115,044 Firemaking (above).
        expect(r!.measured.map(x => [x.xpPerHour, Math.round(x.floor), x.measured.bot])).toEqual([
            [700_000, 1_115_044, 'w1'],
        ]);
        const [wc] = query.bestMethods('woodcutting', at('woodcutting', 50), { maxWilderness: 0, multiway: false });
        expect(wc!.measured).toEqual([]);
        const burnt = query
            .bestMethods('woodcutting', at('woodcutting', 50))
            .find(x => x.method.def.id === 'tree-burn-bank')!;
        expect(burnt.measured.map(x => [x.xpPerHour, Math.round(x.floor)])).toEqual([[185_000, 278_761]]);
    });

    test("a measured figure's floor is over the way the result rates, not the shortest", () => {
        // tree-bank measured at Woodcutting 35 with the bronze axe. Its short way (legs 5 + 5): 112 + 10 = 122 ticks,
        // 28 x 9000 / 122 = 2065.57 logs/h, 516,393. The long way (20 + 20): 152 ticks, 414,474 (above).
        const measured = { ...burn.measured![0]!, xpPerHour: { woodcutting: 400_000 }, level: { woodcutting: 35 } };
        const q = methodQuery({ ...world, methods: [{ ...banked, measured: [measured] }] }, model);
        const floor = (opts: BestOptions) =>
            q
                .bestMethods('woodcutting', at('woodcutting', 50), opts)
                .map(r => [r.way, Math.round(r.measured[0]!.floor)]);
        expect(floor({})).toEqual([[0, 516_393]]);
        // A `met` without the quest forces the long way: its floor there.
        expect(floor({ met: none })).toEqual([[1, 414_474]]);
    });

    test('an error that is not a family refusing the profile stops the query, naming the method', () => {
        const zero: Family = { ...woodcutting, model: (...a) => ({ ...woodcutting.model(...a), ticksPerAttempt: 0 }) };
        const broken = methodQuery(world, { ...model, families: new Map([...model.families, ['woodcutting', zero]]) });
        expect(() => broken.bestMethods('woodcutting', at('woodcutting', 50))).toThrow(MethodError);
        expect(() => broken.bestMethods('woodcutting', at('woodcutting', 50))).toThrow(
            /^methods\.ts tree-burn-bank: ticksPerAttempt 0 is not finite and > 0/,
        );
    });

    test("the cycle refusing a profile drops the method there, like a family's refusal", () => {
        // Chopping gives sticks below Woodcutting 30 and logs from 30; logs are carved 'here' into stackable runes,
        // kept. Below 30 nothing is carved and the sticks would fill the inventory for good: cycle.ts's ProfileError.
        const picking: Family = {
            ...woodcutting,
            model: (...a) => {
                const m = woodcutting.model(...a);
                return a[2].levels.woodcutting < 30 ? { ...m, products: [{ obj: 'sticks', count: 1 }] } : m;
            },
        };
        const carving: Family = {
            ...firemaking,
            model: (...a) => ({ ...firemaking.model(...a), products: [{ obj: 'runes', count: 1 }] }),
        };
        const extra: Record<string, Item> = {
            sticks: { stackable: false, cost: 1, wearable: false },
            runes: { stackable: true, cost: 1, wearable: false },
        };
        const carvedModel: MethodModel = {
            ...model,
            families: new Map([...model.families, ['woodcutting', picking], ['firemaking', carving]]),
            items: obj => extra[obj] ?? model.items(obj),
        };
        const carve = chop('tree-carve-keep', tree, {
            sink: { mode: 'process', steps: [{ family: 'firemaking', at: 'here', params: {} }], end: 'keep' },
            processors: ['here'],
            levels: { woodcutting: 20, firemaking: 30 },
        });
        const q = methodQuery({ ...world, methods: [carve, drop] }, carvedModel);
        // Woodcutting 25 with Firemaking 30, so the carving family itself refuses nothing.
        const low = { ...at('woodcutting', 25), levels: { ...at('woodcutting', 25).levels, firemaking: 30 } };
        expect(() => q.methodRate('tree-carve-keep', low)).toThrow(/kept products fill the inventory: sticks$/);
        expect(q.bestMethods('woodcutting', low).map(r => r.method.def.id)).toEqual(['tree-drop']);
        expect(q.bestMethods('woodcutting', at('woodcutting', 50)).map(r => r.method.def.id)).toEqual([
            'tree-drop',
            'tree-carve-keep',
        ]);
    });

    test('a ModelError that is not a ProfileError (a data fault) stops the query too, naming the method', () => {
        // tree-drop names logs as its food, which `foods` has no heal for: model/method.ts's rate refuses it.
        const fed = methodQuery({ ...world, methods: [burn, banked, wild, { ...drop, food: 'logs' }] }, model);
        expect(() => fed.bestMethods('woodcutting', at('woodcutting', 50))).toThrow(MethodError);
        expect(() => fed.bestMethods('woodcutting', at('woodcutting', 50))).toThrow(
            /^methods\.ts tree-drop: logs is not a food with a fixed heal$/,
        );
        // A family's own ModelError (not a refusal of the profile) the same.
        const unknown: Family = {
            ...woodcutting,
            model: () => {
                throw new ModelError('site tree:town:0 has no tree yew');
            },
        };
        const bad = methodQuery(world, { ...model, families: new Map([...model.families, ['woodcutting', unknown]]) });
        expect(() => bad.bestMethods('woodcutting', at('woodcutting', 50))).toThrow(
            /^methods\.ts tree-burn-bank: site tree:town:0 has no tree yew$/,
        );
    });
});

describe('methodRate', () => {
    test("one method's floor over its shortest way", () => {
        const r = query.methodRate('tree-bank', at('woodcutting', 50));
        expect(Math.round(r.xpPerHour.woodcutting!)).toBe(954_545);
        expect(r.trip.travel).toBe(10);
    });

    test('an unknown id, or a profile the model refuses, throws naming it', () => {
        expect(() => query.methodRate('nope', at('woodcutting', 50))).toThrow(
            /^No method nope in world\.json \(it has tree-burn-bank, tree-bank, wild-drop, tree-drop\)$/,
        );
        expect(() => query.methodRate('tree-drop', { ...at('woodcutting', 50), axe: null })).toThrow(MethodError);
        expect(() => query.methodRate('tree-drop', { ...at('woodcutting', 50), axe: null })).toThrow(
            /^methods\.ts tree-drop: no axe$/,
        );
    });
});

describe('methodHazard', () => {
    test('a drop method: its site alone', () => {
        expect(methodHazard({ site: wildTree, sink: { mode: 'drop' } })).toEqual({
            wildernessLevel: 5,
            multiway: false,
        });
    });

    // A multiway zone outside the Wilderness, as most of multiway.csv's are (Castle Wars, Karamja).
    const multi = tile(3240, 3200);
    const zones = { f2p: new Set<string>(), multiway: new Set([zoneKey(multi)]) };
    /** A method at the tree that stops at `t`. */
    const hazardAt = (t: Tile) => methodHazard({ site: tree, sink: { mode: 'process', steps: [tileStop(t, zones)] } });

    test("a bare tile stop counts: its zone's multiway, and its Wilderness level", () => {
        expect(hazardAt(multi)).toEqual({ wildernessLevel: 0, multiway: true });
        // z 3600 is in the Wilderness's first box (z 3520 up): floor((3600 - 3520) / 8) + 1 = 11 (sources/zones.ts).
        expect(hazardAt(tile(3210, 3600))).toEqual({ wildernessLevel: 11, multiway: false });
    });

    test("a world.json tile stop is rebuilt with its hazard from the model's zones", () => {
        const tiled: WorldMethod = {
            ...burn,
            id: 'tree-burn-tile',
            sink: { mode: 'process', steps: [{ family: 'firemaking', at: multi, params: {} }], end: 'bank' },
            processors: [tileStopId(multi)],
        };
        const q = methodQuery({ ...world, methods: [tiled] }, { ...model, zones });
        expect(q.bestMethods('woodcutting', at('woodcutting', 50)).map(r => r.hazard)).toEqual([
            { wildernessLevel: 0, multiway: true },
        ]);
        expect(q.bestMethods('woodcutting', at('woodcutting', 50), { multiway: false })).toEqual([]);
    });
});
