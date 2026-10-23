import { describe, expect, test } from 'bun:test';
import { ModelError, ProfileError, type Family } from '../model/family';
import { agility, lapOf } from '../model/families/agility';
import type { GameData } from '../model/families/common';
import type { Profile } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';
import { parseConfigs } from '../sources/configs';
import type { Crossing, Gate, Roll, Site, Tile, World } from '../types';
import { tileKey } from '../util';

// A three-step course in the shape of the real ones (sources/courses.ts): a rolled log whose xp a proc parameter
// gives (as ~agility_force_move does), a pipe that is a gate row with each stand's ticks (as the Wilderness pipe is),
// and a wall reached through a label, two more placements of whose config set no step (as the Barbarian walls).
const SCRIPT = `[oploc1,t_log]
~t_force(30, movecoord(coord, 0, 0, -3));
~update_t_varp(1);

[oploc1,t_pipe]
stat_advance(agility, 40);
~update_t_varp(2);

[oploc1,t_wall] @t_climb;

[label,t_climb]
stat_advance(agility, 20);
if (loc_coord = 0_1_1_20_0) {
    ~update_t_varp(3);
}

[proc,t_force](int $xp, coord $dest)
p_delay(0);
stat_advance(agility, $xp);

[proc,update_t_varp](int $completed)
if(calc(%t_course_progress + 1) >= $completed) {
    %t_course_progress = $completed;
}
if(%t_course_progress = 3) {
    stat_advance(agility, 100);
    %t_course_progress = 0;
}
`;

const data: GameData = {
    dbrows: [],
    objs: new Map(),
    locs: parseConfigs(''),
    structs: new Map(),
    npcs: new Map(),
    params: new Map(),
    constants: new Map(),
    scripts: [['skill_agility/scripts/t_course.rs2', SCRIPT]],
};
const family: Family = agility(data);

const t = (x: number, z: number): Tile => ({ level: 0, x, z });
// The tiles: each move's stand (s) and landing (l); the walls' locs at wa, wb (unstepped) and w3 (step 3).
const [s1a, s1b, l1a, l1b, fallen] = [t(110, 111), t(110, 109), t(110, 107), t(110, 106), t(105, 105)];
const [s2a, s2b, l2] = [t(110, 99), t(111, 100), t(110, 95)];
const [wa, sa, la] = [t(104, 90), t(103, 90), t(105, 90)];
const [wb, sb, lb] = [t(107, 90), t(106, 90), t(108, 90)];
const [w3, s3, l3] = [t(120, 90), t(119, 90), t(121, 90)];

/** stat_random(agility, 127, 255): (127 + 1)/256 = 1/2 at 1, 256/256 at 99. A fall: 3 ticks to `fallen`, floor(HP/10) + 1. */
const roll: Roll = {
    stat: 'agility',
    low: 127,
    high: 255,
    source: 'skill_agility/scripts/t_course.rs2:2',
    fail: { ticks: 3, to: fallen, damage: 10, hpDamage: { a: 10, b: 100, c: 1 } },
};
const crossing = (loc: string, at: Tile, from: Tile, landing: Tile, ticks: number, more: Partial<Crossing> = {}) =>
    ({
        via: 'scripted',
        act: { kind: 'loc-op', loc, op: 1 },
        at,
        from: [from],
        landings: [{ tile: landing, spread: 0 }],
        requires: [[]],
        ticks,
        source: 'skill_agility/scripts/t_course.rs2:1',
        ...more,
    }) satisfies Crossing;
const LOG = t(110, 110);
const PIPE = t(110, 100);
const pipe: Gate = {
    trigger: 'oploc1,t_pipe',
    kind: 'gate',
    loc: 't_pipe',
    tile: PIPE,
    shape: 10,
    angle: 0,
    requires: [['skill:agility:20']],
    to: l2,
    ticks: 6,
    standTicks: [
        { stand: s2a, ticks: 5 },
        { stand: s2b, ticks: 6 },
    ],
    source: 'skill_agility/scripts/t_course.rs2:5',
};

const site: Site = {
    id: 'agility-course:test:0',
    kind: 'agility-course',
    areaPath: [],
    centre: PIPE,
    bbox: { x1: 100, z1: 90, x2: 120, z2: 111 },
    stand: s1a,
    counts: {},
    features: [0, 1, 2],
    f2p: false,
    multiway: false,
    wildernessLevel: 0,
    reach: [[]],
    course: {
        varp: 't_course_progress',
        lapBonus: 100,
        source: 'skill_agility/scripts/t_course.rs2:26',
        obstacles: [
            { step: 1, feature: 0, loc: 't_log', tile: LOG, source: 'skill_agility/scripts/t_course.rs2:3' },
            { step: 2, feature: 1, loc: 't_pipe', tile: PIPE, source: 'skill_agility/scripts/t_course.rs2:6' },
            { step: 3, feature: 2, loc: 't_wall', tile: w3, source: 'skill_agility/scripts/t_course.rs2:13' },
        ],
    },
};
const world: Pick<World, 'features' | 'crossings' | 'gates'> = {
    features: [],
    crossings: [
        // The log both ways: the far side's stand is cheaper (4) but no walk leaves its landing.
        crossing('t_log', LOG, s1a, l1a, 5, { roll }),
        crossing('t_log', LOG, s1b, l1b, 4, { roll }),
        crossing('t_wall', wa, sa, la, 3),
        crossing('t_wall', wb, sb, lb, 3),
        crossing('t_wall', w3, s3, l3, 3),
        // A wall of the config outside the site: not in the way.
        crossing('t_wall', t(300, 300), t(299, 300), t(301, 300), 3),
    ],
    gates: [pipe],
};

/** Run ticks between tile pairs; any pair not listed has no walk. */
const WALKS: [Tile, Tile, number][] = [
    [l1a, s2a, 2],
    [l1a, s2b, 3],
    // The walls are cheaper B then A, the second order of their tile order.
    [l2, sa, 4],
    [l2, sb, 1],
    [la, sb, 5],
    [lb, sa, 1],
    [la, s3, 1],
    [lb, s3, 4],
    [l3, s1a, 3],
    [l3, s1b, 2],
    [fallen, s1a, 2],
    [fallen, s1b, 2],
];
const priced = (pairs: { from: Tile; to: Tile }[], table = WALKS): (number | null)[] =>
    pairs.map(p => table.find(([a, b]) => tileKey(a) === tileKey(p.from) && tileKey(b) === tileKey(p.to))?.[2] ?? null);
const walks = priced(family.walks!(site, undefined, world));

const profile = (level: number): Profile => ({
    levels: Object.fromEntries(SKILLS.map(s => [s, level])) as Record<Skill, number>,
    axe: null,
    pickaxe: null,
    glory: false,
    worn: [],
});

function thrown(f: () => unknown): Error {
    try {
        f();
    } catch (e) {
        return e as Error;
    }
    throw new Error('it modelled it');
}

/** Runs `f`, expecting a ModelError that is not a ProfileError (a site, row, walk or param fault) matching `re`. */
function fault(f: () => unknown, re: RegExp): void {
    const e = thrown(f);
    expect(e).toBeInstanceOf(ModelError);
    expect(e).not.toBeInstanceOf(ProfileError);
    expect(e.message).toMatch(re);
}

/** The family over SCRIPT with `edit` applied (line for line: the lap proc stays on line 26) and `more` after it. */
const edited = (edit: (script: string) => string, more = '', locs = data.locs): Family =>
    agility({ ...data, locs, scripts: [['skill_agility/scripts/t_course.rs2', edit(SCRIPT) + more]] });
const xp = (f: Family) => f.model(site, undefined, profile(20), world, walks).xpTenths;

describe('agility: one lap of a course', () => {
    test('the lap: the cheapest round, each fall priced, the walls in their cheaper order', () => {
        // Agility and Hitpoints 20. The log's roll: floor(127 * 79/98) + floor(255 * 19/98) + 1 = 102 + 49 + 1 =
        // 152, p = 152/256, (1 - p)/p = 104/152 = 13/19 falls a success, each 3 ticks + the walk back from (105,
        // 105) to its stand 2 + the click 1 = 6. The log from (110, 111): 5 + 1 click + 13/19 x 6 = 6 + 78/19 (the
        // far stand's 4 lands where no walk leaves). The pipe from (110, 99): walk 2 + 5 + 1 = 8 (from (111, 100):
        // 3 + 6 + 1 = 10). The walls B then A: walk 1 + 3 + 1, walk 1 + 3 + 1, walk 1 + the last wall 3 + 1 = 15
        // (A then B: 4 + 4 + 5 + 4 + 4 + 4 = 25). Back to the log: 3. Lap: 6 + 78/19 + 8 + 15 + 3 = 32 + 78/19.
        const m = family.model(site, undefined, profile(20), world, walks);
        expect(m.ticksPerAttempt).toBeCloseTo(32 + 78 / 19, 12);
        expect(m.success).toBe(1);
        // The log 30 (~t_force's $xp), the pipe 40, three walls 20 each (@t_climb), the lap bonus 100; the varp
        // proc's literal 100 is not an obstacle's.
        expect(m.xpTenths).toEqual({ agility: 30 + 40 + 3 * 20 + 100 });
        // A fall at 20 HP: floor(20 x 10/100) + 1 = 3, 13/19 of them a lap.
        expect(m.damage).toBeCloseTo((3 * 13) / 19, 12);
        expect(m.products).toEqual([]);
        expect(m.consumes).toEqual([]);
    });

    test('at 99 the roll always succeeds: no falls, damage 0 (the course can hurt, not at this level)', () => {
        // floor(255 * 98/98) + 1 = 256: p = 1. 6 + 8 + 15 + 3 = 32.
        const m = family.model(site, undefined, profile(99), world, walks);
        expect(m.ticksPerAttempt).toBe(32);
        expect(m.damage).toBe(0);
    });

    test('the pairs: each landing to each stand of the next placement in every round, and a fall back to its stand', () => {
        const pairs = family.walks!(site, undefined, world).map(p => `${tileKey(p.from)} -> ${tileKey(p.to)}`);
        expect(new Set(pairs).size).toBe(pairs.length);
        // Log (2 landings) -> pipe (2 stands) 4; pipe -> A or B 2; A -> B, B -> A, A -> W, B -> W 4; W -> log 2; the
        // fall back to each log stand 2.
        expect(pairs).toHaveLength(4 + 2 + 4 + 2 + 2);
        expect(pairs).toContain(`${tileKey(fallen)} -> ${tileKey(s1a)}`);
    });

    test('the lap: the walls of a stepped config in the site that set no step go before its step', () => {
        const steps = lapOf(site, world);
        expect(steps.map(s => s.before.map(b => b.map(m => tileKey(m.stand))))).toEqual([
            [],
            [],
            [[tileKey(sa)], [tileKey(sb)]],
        ]);
        // The gate row's moves are its stands, each with its own ticks.
        expect(steps[1]!.moves.map(m => [tileKey(m.stand), m.ticks])).toEqual([
            [tileKey(s2a), 5],
            [tileKey(s2b), 6],
        ]);
    });

    test("a level under a move's requirement is the profile's: a ProfileError", () => {
        const e = thrown(() => family.model(site, undefined, profile(19), world, walks));
        expect(e).toBeInstanceOf(ProfileError);
        expect(e.message).toBe('step 2 of agility-course:test:0: oploc1,t_pipe needs skill:agility:20');
    });

    test('a lap no walks close, a missing row or walk, and another site fail as ModelErrors', () => {
        const none = walks.map(() => null);
        fault(() => family.model(site, undefined, profile(20), world, none), /no walk back from oploc1,t_log's fall/);
        // Every fall walks back, but no wall walks to the last one.
        const open = priced(
            family.walks!(site, undefined, world),
            WALKS.filter(([a, b]) => tileKey(b) !== tileKey(s3) || tileKey(a) === tileKey(fallen)),
        );
        fault(
            () => family.model(site, undefined, profile(20), world, open),
            /^no lap of agility-course:test:0 closes over the walks between its obstacles$/,
        );
        fault(() => family.model(site, undefined, profile(20), world), /needs its 14 walks priced/);
        fault(
            () => family.model(site, undefined, profile(20), { features: [] }, walks),
            /needs the world's crossing and gate rows/,
        );
        fault(
            () => family.model({ ...site, kind: 'tree' }, undefined, profile(20), world, walks),
            /is a tree site, not an agility-course site/,
        );
        fault(() => family.model(site, { course: 'x' }, profile(20), world, walks), /agility has no param course/);
        const { standTicks: _, ...unticked } = pipe;
        fault(
            () => family.model(site, undefined, profile(20), { ...world, gates: [unticked] }, walks),
            /the gate row of t_pipe has no success ticks by stand/,
        );
    });

    test('an obstacle whose script gives xp two ways is not read', () => {
        const twice = agility({
            ...data,
            scripts: [
                [
                    'skill_agility/scripts/t_course.rs2',
                    SCRIPT.replace(
                        'stat_advance(agility, 40);',
                        'stat_advance(agility, 40); stat_advance(agility, 5);',
                    ),
                ],
            ],
        });
        const e = thrown(() => twice.model(site, undefined, profile(20), world, walks));
        expect(e).toBeInstanceOf(ModelError);
        expect(e.message).toBe('oploc1,t_pipe gives agility xp 2 ways: which runs is not read');
    });
    test('procs that call each other in a cycle are a ModelError, not a proc read as giving no xp', () => {
        // t_a calls t_b first, t_b calls t_a back, and only t_c (called by t_a after) has the stat_advance.
        const cyclic = edited(
            x => x.replace('stat_advance(agility, 40);', '~t_a;'),
            '\n[proc,t_a]\n~t_b;\n~t_c;\n[proc,t_b]\n~t_a;\n[proc,t_c]\nstat_advance(agility, 40);\n',
        );
        fault(() => xp(cyclic), /^oploc1,t_pipe: procs call each other in a cycle \(~t_a -> ~t_b -> ~t_a\)$/);
    });
    test("a called proc's literal stat_advance counts; the loc's own trigger wins over its category's", () => {
        const viaProc = edited(
            x => x.replace('stat_advance(agility, 40);', '~t_pipe_xp;'),
            '\n[proc,t_pipe_xp]\nstat_advance(agility, 40);\n',
        );
        expect(xp(viaProc)).toEqual({ agility: 30 + 40 + 3 * 20 + 100 });
        // ScriptProvider.getByTrigger looks up t_pipe's own [oploc1,t_pipe] before its category's.
        const category = edited(
            x => x,
            '\n[oploc1,_t_cat]\nstat_advance(agility, 7);\n',
            parseConfigs('[t_pipe]\ncategory=t_cat\n'),
        );
        expect(xp(category)).toEqual({ agility: 30 + 40 + 3 * 20 + 100 });
    });

    test('xp a stat_advance gives that is not read, or a call whose arguments are not, is a ModelError', () => {
        const calc = edited(x => x.replace('stat_advance(agility, $xp);', 'stat_advance(agility, calc($xp * 2));'));
        fault(
            () => xp(calc),
            /^oploc1,t_log: stat_advance\(agility, calc\(\$xp \* 2\)\) in ~t_force gives xp not read$/,
        );
        const short = edited(x => x.replace('~t_force(30, movecoord(coord, 0, 0, -3));', '~t_force(30);'));
        fault(() => xp(short), /^oploc1,t_log: ~t_force is called with 1 arguments in \[oploc1,t_log\]$/);
        // Course.source names the lap proc by its bonus's line: a line with none is not it.
        fault(
            () =>
                family.model(
                    { ...site, course: { ...site.course!, source: 'skill_agility/scripts/t_course.rs2:25' } },
                    undefined,
                    profile(20),
                    world,
                    walks,
                ),
            /^no proc has the lap bonus's stat_advance at skill_agility\/scripts\/t_course.rs2:25$/,
        );
    });

    test('more than five placements in the way of one step, one with only a gate row, or one with no move fail', () => {
        const walls = [1, 2, 3, 4, 5, 6].map(i =>
            crossing('t_wall', t(100 + 2 * i, 92), t(99 + 2 * i, 92), t(101 + 2 * i, 92), 3),
        );
        fault(
            () => lapOf(site, { ...world, crossings: [...world.crossings, ...walls] }),
            /^step 3 of agility-course:test:0 has 8 placements that set no step: more than 5 orders them past reading$/,
        );
        const gated: Gate = { ...pipe, trigger: 'oploc1,t_wall', loc: 't_wall', tile: t(115, 92), source: 'x.rs2:1' };
        fault(
            () => lapOf(site, { ...world, gates: [...world.gates, gated] }),
            /^t_wall at \(115, 92, 0\) in agility-course:test:0 sets no step and has a gate row: not modelled$/,
        );
        const stranded = crossing('t_wall', t(115, 92), t(114, 92), t(116, 92), 3, { from: [] });
        fault(
            () =>
                family.model(
                    site,
                    undefined,
                    profile(20),
                    { ...world, crossings: [...world.crossings, stranded] },
                    walks,
                ),
            /^step 3 of agility-course:test:0 has a placement with no move$/,
        );
    });
});
