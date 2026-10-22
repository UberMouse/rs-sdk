import { describe, expect, test } from 'bun:test';
import type { MethodDef, ProcessStepDef } from '../methods';
import { ModelError, type Family } from '../model/family';
import type { GameData } from '../model/families/index';
import { legFinder } from '../model/legs';
import {
    fromWorldMethod,
    measuredProfile,
    MethodError,
    methodModel,
    methodModels,
    methodRate,
    resolveMethod,
    resolveMethods,
    toWorldMethod,
    type MethodContext,
    type MethodWay,
} from '../model/method';
import { profileAt } from '../model/profile';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { parseConfigs } from '../sources/configs';
import { parseDbrows } from '../sources/dbrows';
import { zoneKey, type Zones } from '../sources/zones';
import type { Feature, FeatureKind, Nearest, Rect, Site, Tile } from '../types';
import { at, Grid } from './grid';

// Small copies of the real rows (families.real.test.ts checks the real ones).
const DBROWS = `
[iron_rock_table]
table=mining_table
data=rock,ironrock1
data=ore_name,iron
data=rock_output,iron_ore
data=rock_level,15
data=rock_exp,350
data=rock_successchance,96,350
data=rock_respawnrate,20

[pickpocket_guard]
table=pickpocket
data=npc,guard1
data=level,40
data=experience,468
data=stun_ticks,8
data=stun_damage,2
data=success_chance,50,240
data=loot,coins,30,30,128

[cooking_generic_trout]
table=cooking_generic
data=uncooked,raw_trout
data=cooked,trout
data=burnt,burntfish2
data=levelrequired,15
data=experience,700
data=successchance,88,432

[cooking_generic_salmon]
table=cooking_generic
data=uncooked,raw_salmon
data=cooked,salmon
data=burnt,burntfish2
data=levelrequired,25
data=experience,900
data=successchance,68,392

[heal_7]
table=consume_table
data=consumable,trout
data=stat_heal,hitpoints,7,0
`;

const pickaxe = (name: string, level: number, rate: number) =>
    `[${name}]\nwearpos=righthand\nparam=levelrequire,${level}\nparam=mining_rate,${rate}\n`;
const OBJS = [
    pickaxe('rune_pickaxe', 41, 2),
    pickaxe('adamant_pickaxe', 31, 3),
    pickaxe('mithril_pickaxe', 21, 4),
    pickaxe('steel_pickaxe', 6, 5),
    pickaxe('iron_pickaxe', 1, 6),
    pickaxe('bronze_pickaxe', 1, 7),
    `
[iron_ore]
cost=17
[uncut_diamond]
[uncut_ruby]
[uncut_emerald]
[uncut_sapphire]
[raw_trout]
param=fishing_struct,fishing_struct_trout
[raw_salmon]
param=fishing_struct,fishing_struct_salmon
[trout]
[salmon]
[burntfish2]
[fly_fishing_rod]
[feather]
stackable=yes
[coins]
stackable=yes
`,
].join('');

const LOCS = `
[ironrock1]
category=mining_rock_fast
[fire]
category=cooking_fire
`;

const STRUCTS = `
[fishing_struct_trout]
param=productexp,500
param=success_low,32
param=success_high,192
[fishing_struct_salmon]
param=productexp,700
param=success_low,16
param=success_high,96
`;

const FRESHFISH = `[opnpc4,_freshfish]
@fish_trout_salmon;

[label,fish_trout_salmon]
if (stat(fishing) < 20) {
    return;
}
if (~check_fish_equipment(fly_fishing_rod) = false) {
    return;
}
if (%action_delay < map_clock) {
    %action_delay = calc(map_clock + 4);
} else if (%action_delay = map_clock) {
    if (stat(fishing) >= 30) {
        ~fish_roll(raw_trout, raw_salmon, fly_fishing_rod, feather);
    } else {
        ~fish_roll(raw_trout, null, fly_fishing_rod, feather);
    }
}
p_opnpc(4);
`;

const data: GameData = {
    dbrows: parseDbrows(DBROWS),
    objs: parseConfigs(OBJS),
    locs: parseConfigs(LOCS),
    structs: parseConfigs(STRUCTS),
    scripts: [['skill_fishing/scripts/fishing_spots/freshfish.rs2', FRESHFISH]],
};

// The sites, on the open 32x32 grid: a step is half a tick, diagonals too, so a leg is ceil(Chebyshev / 2).
const features: Feature[] = [];
/** A site of `kind` with a feature (config, subtype) on each of `tiles`, its bbox theirs. */
function site(
    id: string,
    tiles: Tile[],
    config: string,
    subtype: string,
    stand: Tile,
    opts: { reach?: string[][]; nearest?: Nearest } = {},
): Site {
    const kind = id.slice(0, id.indexOf(':')) as FeatureKind;
    const first = features.length;
    for (const tile of tiles)
        features.push({ source: 'loc', id: features.length, config, tile, kind, subtype, name: config });
    const bbox: Rect = {
        x1: Math.min(...tiles.map(t => t.x)),
        z1: Math.min(...tiles.map(t => t.z)),
        x2: Math.max(...tiles.map(t => t.x)),
        z2: Math.max(...tiles.map(t => t.z)),
        level: 0,
    };
    return {
        id,
        kind,
        areaPath: [],
        centre: tiles[0]!,
        bbox,
        stand,
        counts: {},
        features: tiles.map((_, i) => first + i),
        f2p: false,
        multiway: false,
        wildernessLevel: 0,
        reach: opts.reach ?? [[]],
        ...(opts.nearest ? { nearest: opts.nearest } : {}),
    };
}

const nearA = (runTicks: number): Nearest => ({ bank: { site: 'bank:a:0', runTicks, requires: [] } });
const sites: Site[] = [
    site('bank:a:0', [at(0, 3220, 3220), at(0, 3221, 3221)], 'bankbooth', '', at(0, 3220, 3222)),
    site('bank:b:0', [at(0, 3210, 3200), at(0, 3211, 3201)], 'bankbooth', '', at(0, 3210, 3202)),
    site('bank:quest:0', [at(0, 3225, 3205)], 'bankbooth', '', at(0, 3225, 3206), { reach: [['quest:x']] }),
    site('rock:mine:0', [at(0, 3200, 3200), at(0, 3202, 3200)], 'ironrock1', 'iron', at(0, 3201, 3201), {
        nearest: nearA(11),
    }),
    site('rock:shut:0', [at(0, 3200, 3230)], 'ironrock1', 'iron', at(0, 3201, 3230), { reach: [] }),
    // Behind a Mining 30 gate, or a quest, Mining 25 and Agility 40.
    site('rock:gated:0', [at(0, 3200, 3240)], 'ironrock1', 'iron', at(0, 3201, 3240), {
        reach: [['skill:mining:30'], ['quest:x', 'skill:agility:40', 'skill:mining:25']],
    }),
    site('fishing-spot:river:0', [at(0, 3200, 3220)], 'freshfish_spot', 'freshfish', at(0, 3201, 3220), {
        nearest: {},
    }),
    site('fire:camp:0', [at(0, 3205, 3220)], 'fire', 'fire', at(0, 3205, 3221), { nearest: nearA(8) }),
    site('pickpocket:town:0', [at(0, 3215, 3210)], 'guard1', 'guard1', at(0, 3215, 3211), { nearest: nearA(6) }),
];

// One multiway zone, outside the Wilderness: the one holding (3210, 3220).
const zones: Zones = { f2p: new Set(), multiway: new Set([zoneKey(at(0, 3210, 3220))]) };
const ctx: MethodContext = {
    world: { sites, features },
    ...methodModel(data, zones),
};
const finder = legFinder(
    reachGraph({
        world: { features: [], connectors: [], gates: [], transports: [] },
        collision: new Grid(),
        size: locSizes(new Map()),
    }),
    [],
);

const mine: MethodDef = {
    id: 'iron-mine-bank',
    name: 'Iron, banked',
    family: 'mining',
    at: at(0, 3202, 3200),
    params: { rock: 'iron' },
    sink: { mode: 'bank' },
};
const lure: MethodDef = {
    id: 'lure-cook-bank',
    name: 'Lure, cooked, banked',
    family: 'fishing',
    at: at(0, 3200, 3220),
    params: { tool: 'fly_fishing_rod' },
    sink: {
        mode: 'process',
        steps: [{ family: 'cooking', at: at(0, 3205, 3220), params: [{ food: 'raw_trout' }, { food: 'raw_salmon' }] }],
        end: 'bank',
    },
};
const guards: MethodDef = {
    id: 'guard-pickpocket',
    name: 'Guards',
    family: 'pickpocket',
    at: at(0, 3215, 3210),
    params: { npc: 'guard1' },
    food: 'trout',
    sink: { mode: 'bank' },
};

const resolve = (def: MethodDef) => resolveMethod(def, ctx, finder);

/** Resolving `def` fails with a MethodError naming it and matching `re`. */
function fails(def: MethodDef, re: RegExp): void {
    expect(() => resolve(def)).toThrow(MethodError);
    expect(() => resolve(def)).toThrow(new RegExp(`^methods\\.ts ${def.id}: ${re.source}`));
}

describe('resolving a record', () => {
    test('a bank method: its site, the nearest bank, both legs, and the lowest level it models at', () => {
        // Stand (3201, 3201) to the bank's (3220, 3222): 21 steps, 11 run ticks, and the same back. Iron needs 15.
        const m = resolve(mine);
        expect(m.site.id).toBe('rock:mine:0');
        expect(m.sink).toMatchObject({ mode: 'bank', bank: { id: 'bank:a:0' } });
        expect(m.ways).toEqual([
            {
                reach: [],
                legs: [
                    { from: 'rock:mine:0', to: 'bank:a:0', runTicks: 11, requires: [] },
                    { from: 'bank:a:0', to: 'rock:mine:0', runTicks: 11, requires: [] },
                ],
            },
        ]);
        expect([m.skill, m.minLevel]).toEqual(['mining', 15]);
        expect(m.levels).toEqual({ mining: 15 });
    });

    test('an explicit bank tile banks there, not at the nearest', () => {
        // (3201, 3201) to bank b's stand (3210, 3202): 9 steps, 5 run ticks.
        const m = resolve({ ...mine, sink: { mode: 'bank', bank: at(0, 3211, 3201) } });
        expect(m.sink).toMatchObject({ bank: { id: 'bank:b:0' } });
        expect(m.ways[0]!.legs.map(l => l.runTicks)).toEqual([5, 5]);
    });

    test("a process method: site -> the step's site -> its nearest bank -> site", () => {
        // Spot stand (3201, 3220) -> fire (3205, 3221): 4 steps, 2 ticks; -> bank (3220, 3222): 15, 8; -> spot: 19, 10.
        // Cooking salmon needs 25, the highest level a part asks for.
        const m = resolve(lure);
        expect(m.sink).toMatchObject({ mode: 'process', steps: [{ id: 'fire:camp:0' }], bank: { id: 'bank:a:0' } });
        expect(m.ways[0]!.legs.map(l => [l.from, l.to, l.runTicks])).toEqual([
            ['fishing-spot:river:0', 'fire:camp:0', 2],
            ['fire:camp:0', 'bank:a:0', 8],
            ['bank:a:0', 'fishing-spot:river:0', 10],
        ]);
        expect([m.skill, m.minLevel]).toEqual(['fishing', 25]);
        // Each skill's own level, the other at 99: fly fishing starts at 20 (trout; freshfish's `stat(fishing) < 20`),
        // and with Fishing 99 the salmon come, which cooking takes from 25 (cooking_generic_salmon levelrequired).
        expect(m.levels).toEqual({ fishing: 20, cooking: 25 });
        // Its floor: the cooking step's XP comes with the fishing.
        const rate = methodRate(m, profileAt('fishing', 40, { tools: ctx.tools }), ctx);
        expect(Object.keys(rate.xpPerHour).sort()).toEqual(['cooking', 'fishing']);
        expect(rate.trip.travel).toBe(20);
    });

    test('a method that eats: the food from the consume table, restocked at the bank', () => {
        const m = resolve(guards);
        expect(m.minLevel).toBe(40);
        const rate = methodRate(m, profileAt('thieving', 60, { tools: ctx.tools }), ctx);
        expect(rate.suppliesPerHour.map(x => x.obj)).toEqual(['trout']);
        expect(rate.trip.travel).toBe(12);
    });

    test("a site behind a skill gate: the levels are raised to the lowest any way's reach lets in", () => {
        // Iron models from Mining 15, but no way gets there under 25 (the quest way); every skill at once needs the
        // Mining 30 way (the quest way's Agility 40 is higher).
        const m = resolve({ ...mine, id: 'gated-drop', at: at(0, 3200, 3240), sink: { mode: 'drop' } });
        expect(m.ways.map(w => w.reach)).toEqual([
            ['skill:mining:30'],
            ['quest:x', 'skill:agility:40', 'skill:mining:25'],
        ]);
        expect(m.levels).toEqual({ mining: 25 });
        expect(m.minLevel).toBe(30);
    });

    test("a sink behind a requirement: the method asks it, joined with the site's", () => {
        const m = resolve({ ...mine, sink: { mode: 'bank', bank: at(0, 3225, 3205) } });
        expect(m.ways.map(w => w.reach)).toEqual([['quest:x']]);
    });
});

describe('world.json and measured figures', () => {
    test('a resolved method goes to world.json as the record and its sites, and comes back the same', () => {
        for (const def of [mine, lure, guards]) {
            const m = resolve(def);
            const wm = toWorldMethod(m);
            expect(wm).toMatchObject({ ...def, site: m.site.id, stand: m.site.stand, levels: m.levels });
            expect(fromWorldMethod(JSON.parse(JSON.stringify(wm)), { sites })).toEqual(m);
        }
        expect(toWorldMethod(resolve(lure))).toMatchObject({ bank: 'bank:a:0', processors: ['fire:camp:0'] });
        expect(toWorldMethod(resolve({ ...mine, sink: { mode: 'drop' } }))).not.toHaveProperty('bank');
    });

    test("a measured figure's profile: its levels, other skills at the method's skill's, its tool", () => {
        const m = resolve(mine);
        const measured = { xpPerHour: {}, level: { mining: 60 }, bot: 'b', date: '2026-01-01', hours: 1, from: 'x' };
        const p = measuredProfile(m, { ...measured, tool: 'iron_pickaxe' }, ctx.tools);
        expect([p.levels.mining, p.levels.cooking, p.pickaxe]).toEqual([60, 60, 'iron_pickaxe']);
        // No tool named: the best usable at 60 (rune from 41 in these rows).
        expect(measuredProfile(m, measured, ctx.tools).pickaxe).toBe('rune_pickaxe');
        expect(() => measuredProfile(m, { ...measured, level: { cooking: 60 } }, ctx.tools)).toThrow(
            /^methods\.ts iron-mine-bank: a measured figure \(b 2026-01-01\) has no mining level/,
        );
        expect(() => measuredProfile(m, { ...measured, tool: 'harpoon' }, ctx.tools)).toThrow(
            /measured tool harpoon is no axe or pickaxe/,
        );
    });

    test("a measured skill below the method's skill stays at its measured level; unnamed ones take the skill's", () => {
        const m = resolve(lure);
        const measured = {
            xpPerHour: {},
            level: { fishing: 67, cooking: 40 },
            bot: 'b',
            date: '2026-01-01',
            hours: 1,
            from: 'x',
        };
        const p = measuredProfile(m, measured, ctx.tools);
        expect([p.levels.fishing, p.levels.cooking, p.levels.mining]).toEqual([67, 40, 67]);
    });
});

describe('a record that does not resolve stops the build, naming it and why', () => {
    test('its tile is in no site of its kind, or its sink tile in no bank', () => {
        fails({ ...mine, at: at(0, 3230, 3230) }, /no rock site holds \(3230, 3230, 0\)/);
        // A bank's tile is no rock site's.
        fails({ ...mine, at: at(0, 3220, 3220) }, /no rock site holds/);
        fails({ ...mine, sink: { mode: 'bank', bank: at(0, 3201, 3201) } }, /no bank site holds \(3201, 3201, 0\)/);
        fails(
            {
                ...lure,
                sink: {
                    mode: 'process',
                    steps: [{ family: 'cooking', at: at(0, 3201, 3201), params: {} }],
                    end: 'bank',
                },
            },
            /no range\/fire site holds/,
        );
    });

    test("overlapping sites: a target's own tile names its site, another tile in both bboxes neither", () => {
        // A sparse rock site whose bbox spans rock:mine:0's.
        const wide = site(
            'rock:wide:0',
            [at(0, 3190, 3190), at(0, 3210, 3210)],
            'ironrock1',
            'iron',
            at(0, 3191, 3190),
        );
        const both = { ...ctx, world: { sites: [...sites, wide], features } };
        const dropped: MethodDef = { ...mine, sink: { mode: 'drop' } };
        expect(resolveMethod(dropped, both, finder).site.id).toBe('rock:mine:0');
        expect(resolveMethod({ ...dropped, at: at(0, 3190, 3190) }, both, finder).site.id).toBe('rock:wide:0');
        expect(() => resolveMethod({ ...dropped, at: at(0, 3201, 3200) }, both, finder)).toThrow(
            /\(3201, 3200, 0\) lies in several rock sites: rock:mine:0, rock:wide:0/,
        );
    });

    test('no sink to fall back on: a spot with no nearest range', () => {
        fails(
            {
                ...lure,
                sink: { mode: 'process', steps: [{ family: 'cooking', params: { food: 'raw_trout' } }], end: 'bank' },
            },
            /site fishing-spot:river:0 has no nearest range \(phase 3 searches only the first of range\/fire\): give its tile/,
        );
    });

    test("a bad model number is the record's failure too, named like the rest", () => {
        // rate.ts rejects a ticksPerAttempt of 0 with a plain Error; the build must still say which record.
        const real = ctx.families.get('mining')!;
        const bad = {
            ...real,
            model: (...a: Parameters<typeof real.model>) => ({ ...real.model(...a), ticksPerAttempt: 0 }),
        };
        const broken = { ...ctx, families: new Map([...ctx.families, ['mining', bad]]) };
        expect(() => resolveMethod(mine, broken, finder)).toThrow(MethodError);
        expect(() => resolveMethod(mine, broken, finder)).toThrow(
            /^methods\.ts iron-mine-bank: ticksPerAttempt 0 is not finite and > 0/,
        );
        expect(resolveMethods([mine], broken, finder).errors).toEqual([
            'methods.ts iron-mine-bank: ticksPerAttempt 0 is not finite and > 0',
        ]);
    });

    test('an out-of-range way names the method', () => {
        const m = resolve(mine);
        expect(() => methodRate(m, profileAt('mining', 40, { tools: ctx.tools }), ctx, 3)).toThrow(
            /^methods\.ts iron-mine-bank: no way 3 \(1 ways\)/,
        );
    });

    test('no walk reaches it, or no requirement set walks a leg', () => {
        fails({ ...mine, at: at(0, 3200, 3230) }, /site rock:shut:0 has no stand a walk reaches/);
        // A bank walled in, though its reach says otherwise: no leg gets there.
        const walled = legFinder(
            reachGraph({
                world: { features: [], connectors: [], gates: [], transports: [] },
                collision: new Grid().room(3218, 3220, 3222, 3224),
                size: locSizes(new Map()),
            }),
            [],
        );
        expect(() => resolveMethod(mine, ctx, walled)).toThrow(
            /methods\.ts iron-mine-bank: no requirement set gets to every site and walks each leg/,
        );
    });

    test('no level models it, a process step takes what the gather never gives, a bad id or family', () => {
        fails(
            { ...guards, food: undefined },
            /no level models it \(at 99: the action costs 2 hitpoints a fail: name a food\)/,
        );
        fails(
            { ...guards, food: 'iron_ore' },
            /no level models it \(at 99: iron_ore is not a food with a fixed heal\)/,
        );
        // A stun that hits for 0 (stun_damage 0) costs no hitpoints, so the food it names is refused.
        const harmless: MethodContext = {
            ...ctx,
            ...methodModel({ ...data, dbrows: parseDbrows(DBROWS.replace('stun_damage,2', 'stun_damage,0')) }, zones),
        };
        expect(() => resolveMethod(guards, harmless, finder)).toThrow(
            /methods\.ts guard-pickpocket: no level models it \(at 99: food trout is named but the action costs no hitpoints\)/,
        );
        fails(
            {
                ...mine,
                sink: {
                    mode: 'process',
                    steps: [{ family: 'cooking', at: at(0, 3205, 3220), params: { food: 'raw_trout' } }],
                    end: 'bank',
                },
            },
            /a process step takes raw_trout, which neither the gather nor an earlier step gives at 99/,
        );
        fails({ ...mine, id: 'Iron_Bank' }, /the id is not kebab-case/);
        fails({ ...mine, family: 'no-such-family' }, /no family no-such-family/);
    });

    test('resolveMethods collects every failure, and two records with one id fail both', () => {
        const r = resolveMethods([mine, mine, { ...lure, at: at(0, 3230, 3230) }, guards], ctx, finder);
        expect(r.methods.map(m => m.def.id)).toEqual(['guard-pickpocket']);
        expect(r.errors).toEqual([
            'methods.ts iron-mine-bank: the id is used by more than one record',
            'methods.ts iron-mine-bank: the id is used by more than one record',
            'methods.ts lure-cook-bank: no fishing-spot site holds (3230, 3230, 0)',
        ]);
    });
});

/** The lure method burning its catch in the steps given, then `end`. */
const burnLure = (steps: ProcessStepDef[], end: 'bank' | 'keep' = 'keep', bank?: Tile): MethodDef => ({
    ...lure,
    id: 'lure-burn',
    sink: { mode: 'process', steps, end, ...(bank ? { bank } : {}) },
});

describe('process steps, withdrawals and walks', () => {
    // A process family that marks a fish (params.from, default trout) as a salmon wherever it is, and remembers the
    // sites it was modelled at.
    const markedAt: string[] = [];
    const marking: Family = {
        id: 'marking',
        skills: ['crafting'],
        kinds: ['fire'],
        model(s, params) {
            markedAt.push(s.id);
            const from = (params as { from?: string }).from ?? 'trout';
            return {
                ticksPerAttempt: 2,
                success: 1,
                xpTenths: { crafting: 100 },
                products: [{ obj: 'salmon', count: 1 }],
                consumes: [{ obj: from, count: 1 }],
            };
        },
    };
    const marked: MethodContext = { ...ctx, families: new Map([...ctx.families, ['marking', marking]]) };
    const cookTrout: ProcessStepDef = { family: 'cooking', at: at(0, 3205, 3220), params: { food: 'raw_trout' } };
    const withdraw: MethodDef = {
        id: 'withdraw-cook',
        name: 'Raw trout from the bank, cooked',
        family: 'withdraw',
        at: at(0, 3220, 3220),
        params: { obj: 'raw_trout' },
        sink: { mode: 'process', steps: [cookTrout], end: 'bank' },
    };

    test("a withdrawal starts and ends at its bank, and trains its steps' skills", () => {
        // Bank a's stand (3220, 3222) -> the fire's (3205, 3221): 15 steps, 8 run ticks, and back. Trout cook from 15.
        const m = resolve(withdraw);
        expect(m.site.id).toBe('bank:a:0');
        expect(m.sink).toEqual({ mode: 'process', steps: [expect.objectContaining({ id: 'fire:camp:0' })] });
        expect(m.ways[0]!.legs.map(l => [l.from, l.to, l.runTicks])).toEqual([
            ['bank:a:0', 'fire:camp:0', 8],
            ['fire:camp:0', 'bank:a:0', 8],
        ]);
        expect([m.skill, m.minLevel, m.levels]).toEqual(['cooking', 15, { cooking: 15 }]);
        // No tool: 28 raw trout a trip, no gathering ticks, the raw trout a supply.
        const rate = methodRate(m, profileAt('cooking', 40, { tools: ctx.tools }), ctx);
        expect(rate.trip).toMatchObject({ successes: 28, gather: 0, travel: 16 });
        expect(rate.suppliesPerHour.map(x => x.obj)).toEqual(['raw_trout']);
        const wm = toWorldMethod(m);
        expect(wm).not.toHaveProperty('bank');
        expect(wm.processors).toEqual(['fire:camp:0']);
        expect(fromWorldMethod(JSON.parse(JSON.stringify(wm)), { sites })).toEqual(m);
    });

    test("a step 'here' is no stop: modelled at the previous step's site, or the gather's", () => {
        markedAt.length = 0;
        const def: MethodDef = {
            ...withdraw,
            id: 'withdraw-cook-mark',
            sink: { mode: 'process', steps: [cookTrout, { family: 'marking', at: 'here', params: {} }], end: 'drop' },
        };
        const m = resolveMethod(def, marked, finder);
        expect(m.sink).toEqual({ mode: 'process', steps: [expect.objectContaining({ id: 'fire:camp:0' }), 'here'] });
        // A withdrawal walks back to its bank even when it drops.
        expect(m.ways[0]!.legs.map(l => l.runTicks)).toEqual([8, 8]);
        expect(new Set(markedAt)).toEqual(new Set(['fire:camp:0']));
        expect(toWorldMethod(m).processors).toEqual(['fire:camp:0', 'here']);
        // A gather that drops walks back from its last stop to the site, not to a bank: spot -> fire -> spot.
        const lureDrop: MethodDef = {
            ...lure,
            id: 'lure-cook-drop',
            sink: {
                mode: 'process',
                steps: [cookTrout],
                end: 'drop',
            },
        };
        expect(resolveMethod(lureDrop, marked, finder).ways[0]!.legs.map(l => [l.from, l.to, l.runTicks])).toEqual([
            ['fishing-spot:river:0', 'fire:camp:0', 2],
            ['fire:camp:0', 'fishing-spot:river:0', 2],
        ]);
        // Raw trout marked where they are caught, then dropped: no stop, no leg.
        markedAt.length = 0;
        const here = resolveMethod(
            {
                ...lure,
                id: 'lure-here',
                sink: {
                    mode: 'process',
                    steps: [{ family: 'marking', at: 'here', params: { from: 'raw_trout' } }],
                    end: 'drop',
                },
            },
            marked,
            finder,
        );
        expect(here.ways).toEqual([{ reach: [], legs: [] }]);
        expect(new Set(markedAt)).toEqual(new Set(['fishing-spot:river:0']));
        // A non-stackable supply (a cooked trout a mark) used 'here' is used as each fish comes (cycle.ts): at Fishing
        // 20, only trout, the rod and feathers leave 26 slots, one for the fish being caught: 25 a trip. At the fire it
        // is carried all trip beside the raw trout: 26 / 2 = 13.
        const supplied: Family = {
            ...marking,
            model: (...a) => {
                const base = marking.model(...a);
                return { ...base, consumes: [...base.consumes, { obj: 'trout', count: 1 }] };
            },
        };
        const sup: MethodContext = { ...ctx, families: new Map([...ctx.families, ['marking', supplied]]) };
        const fish20 = profileAt('fishing', 20, { tools: ctx.tools });
        const markAt = (stop: ProcessStepDef['at']) =>
            methodRate(
                resolveMethod(
                    {
                        ...lure,
                        id: 'lure-mark',
                        sink: {
                            mode: 'process',
                            steps: [{ family: 'marking', at: stop, params: { from: 'raw_trout' } }],
                            end: 'drop',
                        },
                    },
                    sup,
                    finder,
                ),
                fish20,
                sup,
            ).trip.successes;
        expect(markAt('here')).toBe(25);
        expect(markAt(at(0, 3205, 3220))).toBe(13);
    });

    test("a gather family's walks are priced under each way's set and passed to its model", () => {
        // Stand (3201, 3201) to (3211, 3201): 10 steps, 5 run ticks; a pair to a tile off the map no walk joins,
        // kept as null for the family to pass over.
        const real = ctx.families.get('mining')!;
        const got: ((number | null)[] | undefined)[] = [];
        const walking: Family = {
            ...real,
            walks: () => [
                { from: at(0, 3201, 3201), to: at(0, 3211, 3201) },
                { from: at(0, 3201, 3201), to: at(0, 9000, 9000) },
            ],
            model: (s, p, profile, world, walks) => {
                got.push(walks);
                return real.model(s, p, profile, world);
            },
        };
        const walked = { ...ctx, families: new Map([...ctx.families, ['mining', walking]]) };
        const m = resolveMethod(mine, walked, finder);
        expect(m.ways[0]!.walks).toEqual([5, null]);
        got.length = 0;
        methodRate(m, profileAt('mining', 40, { tools: ctx.tools }), walked);
        expect(got).toEqual([[5, null]]);
        // A family without walks leaves the way without them.
        expect(resolve(mine).ways[0]).not.toHaveProperty('walks');
        // A process step's family with walks would have them ignored: refused, 'here' or not.
        const pacing: Family = { ...marking, walks: () => [{ from: at(0, 3201, 3201), to: at(0, 3211, 3201) }] };
        const paced: MethodContext = { ...ctx, families: new Map([...ctx.families, ['marking', pacing]]) };
        const steps: ProcessStepDef[] = [
            { family: 'marking', at: 'here', params: {} },
            { family: 'marking', params: {} },
        ];
        for (const step of steps) {
            const def: MethodDef = { ...lure, id: 'lure-paced', sink: { mode: 'process', steps: [step], end: 'drop' } };
            expect(() => resolveMethod(def, paced, finder)).toThrow(
                /^methods\.ts lure-paced: the process step family marking has walks: not modelled$/,
            );
        }
    });

    test('by default the first way whose walks the gather models over: a later one when the first fails', () => {
        // A family that closes nothing over a walk it lacks: the first way's walks have none, the second's do.
        const real = ctx.families.get('mining')!;
        const picky: Family = {
            ...real,
            walks: () => [{ from: at(0, 3201, 3201), to: at(0, 3211, 3201) }],
            model: (s, p, profile, world, walks) => {
                if (walks?.[0] == null) throw new ModelError('no walk closes it');
                return real.model(s, p, profile, world);
            },
        };
        const picking = { ...ctx, families: new Map([...ctx.families, ['mining', picky]]) };
        const one = resolveMethod(mine, picking, finder);
        const good = one.ways[0]!;
        const bad: MethodWay = {
            ...good,
            legs: good.legs.map(l => ({ ...l, runTicks: l.runTicks + 1 })),
            walks: [null],
        };
        const two = { ...one, ways: [bad, good] };
        const p40 = profileAt('mining', 40, { tools: ctx.tools });
        expect(methodModels(two, p40, picking).way).toBe(good);
        expect(methodRate(two, p40, picking)).toEqual(methodRate(one, p40, picking));
        // Asked for the first way, or with no way that models, it fails with the first's error.
        expect(() => methodRate(two, p40, picking, 0)).toThrow(/^no walk closes it$/);
        expect(() => methodRate({ ...two, ways: [bad, bad] }, p40, picking)).toThrow(/^no walk closes it$/);
    });

    test('a step of a family with no site kinds stops at its tile, priced like any tile', () => {
        // A family with no kinds that burns a raw fish wherever it stands, leaving nothing.
        const burning: Family = {
            ...marking,
            id: 'burning',
            kinds: [],
            model: (...a) => ({ ...marking.model(...a), products: [] }),
        };
        // One model per fish the rod catches (trout, and salmon from Fishing 30).
        const fish = [{ from: 'raw_trout' }, { from: 'raw_salmon' }];
        const burnt: MethodContext = { ...ctx, families: new Map([...ctx.families, ['burning', burning]]) };
        const tile = at(0, 3210, 3220);
        markedAt.length = 0;
        const m = resolveMethod(burnLure([{ family: 'burning', at: tile, params: fish }]), burnt, finder);
        // Its hazard is the tile's: in the multiway zone, outside the Wilderness.
        expect(m.sink).toEqual({ mode: 'process', steps: [{ tile, wildernessLevel: 0, multiway: true }] });
        // The spot's stand (3201, 3220) to the tile: 9 steps, 5 run ticks, and back; no requirement of its own.
        expect(m.ways).toEqual([
            {
                reach: [],
                legs: [
                    { from: 'fishing-spot:river:0', to: 'tile:3210,3220,0', runTicks: 5, requires: [] },
                    { from: 'tile:3210,3220,0', to: 'fishing-spot:river:0', runTicks: 5, requires: [] },
                ],
            },
        ]);
        // It reads no site: it is handed the gather's.
        expect(new Set(markedAt)).toEqual(new Set(['fishing-spot:river:0']));
        const wm = toWorldMethod(m);
        expect(wm.processors).toEqual(['tile:3210,3220,0']);
        expect(fromWorldMethod(JSON.parse(JSON.stringify(wm)), { sites }, zones)).toEqual(m);
        expect(() => fromWorldMethod({ ...wm, processors: ['tile:3211,3220,0'] }, { sites }, zones)).toThrow(
            /process step tile:3211,3220,0 is not the record's tile; world.json is stale/,
        );
        // A bank after it names its tile: tile -> bank a's stand (3220, 3222), 10 steps, 5 run ticks.
        const banked = resolveMethod(
            burnLure([{ family: 'burning', at: tile, params: fish }], 'bank', at(0, 3220, 3220)),
            burnt,
            finder,
        );
        expect(banked.ways[0]!.legs.map(l => [l.from, l.to, l.runTicks])).toEqual([
            ['fishing-spot:river:0', 'tile:3210,3220,0', 5],
            ['tile:3210,3220,0', 'bank:a:0', 5],
            ['bank:a:0', 'fishing-spot:river:0', 10],
        ]);
        const refused = (def: MethodDef, re: RegExp) =>
            expect(() => resolveMethod(def, burnt, finder)).toThrow(
                new RegExp(`^methods\\.ts lure-burn: ${re.source}`),
            );
        refused(
            burnLure([{ family: 'burning', params: fish }]),
            /the process step family burning has no site kinds: give/,
        );
        // No nearest is known from a bare tile: a later step or the bank names its own.
        refused(
            burnLure([
                { family: 'burning', at: tile, params: fish },
                { family: 'cooking', params: { food: 'raw_trout' } },
            ]),
            /nothing is nearest a bare tile step: give the range\/fire tile/,
        );
        refused(
            burnLure([{ family: 'burning', at: tile, params: fish }], 'bank'),
            /nothing is nearest a bare tile step: give the bank tile/,
        );
        // A tile no walk gets to drops every way: the error names the leg.
        refused(
            burnLure([{ family: 'burning', at: at(0, 3210, 3240), params: fish }]),
            /no requirement set gets to every site and walks each leg \(no walk from fishing-spot:river:0 to tile:3210,3240,0\)$/,
        );
    });

    test('a record the new shapes cannot resolve fails naming why', () => {
        fails({ ...withdraw, sink: { mode: 'bank' } }, /a withdraw method needs a process sink/);
        fails({ ...withdraw, params: {} }, /a withdraw method needs params \{ obj \}/);
        fails({ ...withdraw, at: at(0, 3202, 3200) }, /no bank site holds/);
        fails(
            { ...withdraw, sink: { mode: 'process', steps: [cookTrout], end: 'bank', bank: at(0, 3220, 3220) } },
            /a withdraw method banks where it withdraws: give no sink bank/,
        );
        fails(
            { ...lure, sink: { mode: 'process', steps: [cookTrout], end: 'drop', bank: at(0, 3220, 3220) } },
            /a sink bank is never visited when the sink ends in drop/,
        );
        fails({ ...lure, sink: { mode: 'process', steps: [], end: 'bank' } }, /a process sink needs a step/);
    });

    test("a measured figure's worn objs reach its profile; a column's profile wears none unless asked", () => {
        const m = resolve(withdraw);
        const measured = { xpPerHour: {}, level: { cooking: 60 }, bot: 'b', date: '2026-01-01', hours: 1, from: 'x' };
        expect(measuredProfile(m, { ...measured, worn: ['fly_fishing_rod'] }, ctx.tools).worn).toEqual([
            'fly_fishing_rod',
        ]);
        expect(measuredProfile(m, measured, ctx.tools).worn).toEqual([]);
        expect(profileAt('cooking', 60, { tools: ctx.tools }).worn).toEqual([]);
        expect(profileAt('cooking', 60, { tools: ctx.tools, worn: ['feather'] }).worn).toEqual(['feather']);
    });
});
