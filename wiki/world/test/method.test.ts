import { describe, expect, test } from 'bun:test';
import { wayFinder } from '../distance';
import type { MethodDef } from '../methods';
import { buildFamilies, type GameData } from '../model/families/index';
import { readFoods, readItems } from '../model/items';
import {
    fromWorldMethod,
    measuredProfile,
    MethodError,
    methodRate,
    resolveMethod,
    resolveMethods,
    toWorldMethod,
    type MethodContext,
} from '../model/method';
import { profileAt, readTools } from '../model/profile';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { parseConfigs } from '../sources/configs';
import { parseDbrows } from '../sources/dbrows';
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
    site('fishing-spot:river:0', [at(0, 3200, 3220)], 'freshfish_spot', 'freshfish', at(0, 3201, 3220), {
        nearest: {},
    }),
    site('fire:camp:0', [at(0, 3205, 3220)], 'fire', 'fire', at(0, 3205, 3221), { nearest: nearA(8) }),
    site('pickpocket:town:0', [at(0, 3215, 3210)], 'guard1', 'guard1', at(0, 3215, 3211), { nearest: nearA(6) }),
];

const ctx: MethodContext = {
    world: { sites, features },
    families: buildFamilies(data),
    items: readItems(data.objs),
    foods: readFoods(data.dbrows),
    tools: readTools(data.objs),
};
const finder = wayFinder(
    reachGraph({
        world: { features: [], connectors: [], gates: [], transports: [] },
        collision: new Grid(),
        size: locSizes(new Map()),
    }),
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
        mode: 'process-bank',
        process: { family: 'cooking', at: at(0, 3205, 3220), params: [{ food: 'raw_trout' }, { food: 'raw_salmon' }] },
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

    test("a process-bank method: site -> processor -> the processor's nearest bank -> site", () => {
        // Spot stand (3201, 3220) -> fire (3205, 3221): 4 steps, 2 ticks; -> bank (3220, 3222): 15, 8; -> spot: 19, 10.
        // Cooking salmon needs 25, the highest level a part asks for.
        const m = resolve(lure);
        expect(m.sink).toMatchObject({
            mode: 'process-bank',
            processor: { id: 'fire:camp:0' },
            bank: { id: 'bank:a:0' },
        });
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
        expect(toWorldMethod(resolve(lure))).toMatchObject({ bank: 'bank:a:0', processor: 'fire:camp:0' });
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
                sink: { mode: 'process-bank', process: { family: 'cooking', at: at(0, 3201, 3201), params: {} } },
            },
            /no range\/fire site holds/,
        );
    });

    test('no sink to fall back on: a spot with no nearest range', () => {
        fails(
            { ...lure, sink: { mode: 'process-bank', process: { family: 'cooking', params: { food: 'raw_trout' } } } },
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
        const walled = wayFinder(
            reachGraph({
                world: { features: [], connectors: [], gates: [], transports: [] },
                collision: new Grid().room(3218, 3220, 3222, 3224),
                size: locSizes(new Map()),
            }),
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
        fails(
            {
                ...mine,
                sink: {
                    mode: 'process-bank',
                    process: { family: 'cooking', at: at(0, 3205, 3220), params: { food: 'raw_trout' } },
                },
            },
            /a process step takes raw_trout, which the gather does not give at 99/,
        );
        fails({ ...mine, id: 'Iron_Bank' }, /the id is not kebab-case/);
        fails({ ...mine, family: 'smelting' }, /no family smelting/);
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
