import { describe, expect, test } from 'bun:test';
import {
    besideCluster,
    buildSites,
    locSizes,
    roamOf,
    spawnClusters,
    type LocReach,
    type Placed,
    type SiteCollision,
    type StepCollision,
} from '../place';
import type { Config } from '../sources/configs';
import { stepAt, type CourseDef } from '../sources/courses';
import type { NpcMovement } from '../sources/npc-movement';
import type { Zones } from '../sources/zones';
import { zoneKey } from '../sources/zones';
import type { Feature, FeatureKind, Site, Tile } from '../types';

const loc = (kind: FeatureKind, subtype: string, x: number, z: number, level = 0): Feature => ({
    source: 'loc',
    id: 1,
    config: `${kind}_${subtype}`,
    tile: { level, x, z },
    shape: 10,
    rotation: 0,
    kind,
    subtype,
    name: subtype,
});

const npc = (kind: FeatureKind, subtype: string, x: number, z: number, level = 0): Feature => ({
    source: 'npc',
    id: 2,
    config: subtype,
    tile: { level, x, z },
    kind,
    subtype,
    name: subtype,
});

const booth = (x: number, z: number): Feature => loc('bank', 'booth', x, z);
const banker = (x: number, z: number): Feature => npc('bank', 'banker', x, z);

/**
 * A stub of the collision data: every tile walkable except the blocked ones, and a loc reached from a
 * tile on its footprint or sharing an edge with it (the engine's rectangle rule with no walls about).
 */
function stubCollision(blocked: Tile[] = []): SiteCollision {
    const closed = new Set(blocked.map(t => `${t.level},${t.x},${t.z}`));
    return {
        walkable: (level, x, z) => !closed.has(`${level},${x},${z}`),
        reached: (from: Tile, l: LocReach) => {
            const [w, len] = l.rotation % 2 === 1 ? [l.length, l.width] : [l.width, l.length];
            const dx = from.x < l.x ? l.x - from.x : from.x > l.x + w - 1 ? from.x - (l.x + w - 1) : 0;
            const dz = from.z < l.z ? l.z - from.z : from.z > l.z + len - 1 ? from.z - (l.z + len - 1) : 0;
            return dx + dz <= 1;
        },
    };
}

const noZones: Zones = { f2p: new Set(), multiway: new Set() };
const oneArea = (): string[] => ['misthalin', 'lumbridge'];
const size = locSizes(new Map());
const quiet = { size, log: () => {} };
/** Booths and trees block their own tile, as their collision does. */
const blockedBy = (fs: Feature[]): Tile[] => fs.filter(f => f.source === 'loc').map(f => f.tile);

const build = (fs: Feature[], resolve: (t: Tile) => string[] = oneArea): Placed<Site>[] =>
    buildSites(fs, resolve, noZones, stubCollision(blockedBy(fs)), quiet);

/** The tiles a walk gets to round a bar at x 99 to 101: x 103 and up, and x 97 and down. */
const pastTheBar = (t: Tile): boolean => t.x >= 103 || t.x <= 97;

/** SiteOptions.approach for an npc config `barmaid` with that range, seen from the tiles `inSight` passes. */
const barmaidRange = (range: number | undefined, inSight: (from: Tile, to: Tile) => boolean = () => true) => ({
    range: (config: string) => (config === 'barmaid' ? range : undefined),
    inSight,
});

const splitAt101 = (t: Tile): string[] => (t.x < 101 ? ['varrock', 'west-bank'] : ['varrock', 'east-bank']);

/** Sites with their member features in place of indexes, comparable across input orders. */
const withMembers = (all: Feature[]) => build(all).map(s => ({ ...s, features: s.features.map(i => all[i]) }));

describe('buildSites: clustering', () => {
    test('two booths and a banker 2 tiles away are one bank site', () => {
        const sites = build([booth(100, 100), booth(101, 100), banker(100, 102)]);
        expect(sites).toHaveLength(1);
        expect(sites[0]!.id).toBe('bank:lumbridge:0');
        expect(sites[0]!.counts).toEqual({ banker: 1, booth: 2 });
        expect(sites[0]!.features).toEqual([0, 2, 1]);
        expect(sites[0]!.areaPath).toEqual(['misthalin', 'lumbridge']);
    });

    test('two trees 20 tiles apart are two sites, numbered by (x, z)', () => {
        const sites = build([loc('tree', 'oak', 140, 100), loc('tree', 'oak', 120, 100)]);
        expect(sites.map(s => [s.id, s.centre])).toEqual([
            ['tree:lumbridge:0', { level: 0, x: 120, z: 100 }],
            ['tree:lumbridge:1', { level: 0, x: 140, z: 100 }],
        ]);
    });

    test('a chain links trees the radius apart, in Chebyshev distance', () => {
        const sites = build([loc('tree', 'oak', 100, 100), loc('tree', 'yew', 108, 108), loc('tree', 'oak', 116, 100)]);
        expect(sites).toHaveLength(1);
        expect(sites[0]!.counts).toEqual({ oak: 2, yew: 1 });
        expect(sites[0]!.bbox).toEqual({ x1: 100, z1: 100, x2: 116, z2: 108, level: 0 });
    });

    test('trees in diagonal grid cells within the radius are one site', () => {
        // Radius 8: x 7 and 8 sit in different cells, and so do z 7 and 8.
        expect(build([loc('tree', 'oak', 7, 7), loc('tree', 'oak', 15, 15)])).toHaveLength(1);
        expect(build([loc('tree', 'oak', 7, 7), loc('tree', 'oak', 8, 9)])).toHaveLength(1);
    });

    test('trees exactly the radius apart are one site, one more apart are two', () => {
        expect(build([loc('tree', 'oak', 100, 100), loc('tree', 'oak', 108, 100)])).toHaveLength(1);
        expect(build([loc('tree', 'oak', 100, 100), loc('tree', 'oak', 109, 100)])).toHaveLength(2);
    });

    test('features in two leaf areas never share a site', () => {
        const sites = build([booth(100, 100), booth(101, 100)], splitAt101);
        expect(sites.map(s => [s.id, s.areaPath, s.features])).toEqual([
            ['bank:east-bank:0', ['varrock', 'east-bank'], [1]],
            ['bank:west-bank:0', ['varrock', 'west-bank'], [0]],
        ]);
    });

    test('a site never spans levels', () => {
        expect(build([loc('tree', 'oak', 100, 100, 0), loc('tree', 'oak', 100, 100, 1)])).toHaveLength(2);
    });

    test('a feature in no area is in an unnamed site', () =>
        expect(build([loc('tree', 'oak', 100, 100)], () => []).map(s => [s.id, s.areaPath])).toEqual([
            ['tree:unnamed:0', []],
        ]));

    test('every connector is its own site, even on one tile', () => {
        const sites = build([loc('connector', '', 100, 100), loc('connector', '', 100, 101)]);
        expect(sites.map(s => s.id)).toEqual(['connector:lumbridge:0', 'connector:lumbridge:1']);
    });

    test('ids are stable when input order changes', () => {
        const fs = [
            loc('tree', 'oak', 120, 100),
            booth(100, 100),
            loc('tree', 'oak', 140, 100),
            banker(100, 102),
            booth(101, 100),
            loc('tree', 'yew', 141, 101),
        ];
        expect(withMembers(fs.toReversed())).toEqual(withMembers(fs));
        expect(withMembers([fs[3]!, fs[0]!, fs[5]!, fs[1]!, fs[4]!, fs[2]!])).toEqual(withMembers(fs));
    });
});

describe('buildSites: stand tiles', () => {
    test('a booth row stands on the side opposite the bankers', () => {
        const row = [booth(100, 100), booth(101, 100), booth(102, 100)];
        const sites = build([...row, banker(100, 101), banker(101, 101), banker(102, 101)]);
        expect(sites[0]!.stand).toEqual({ level: 0, x: 101, z: 99 });
    });

    test('one banker behind the middle of a long row still puts the stand in front of the row', () => {
        // The tile past the row's end is further from the banker than any tile in front of the row,
        // so "furthest from the nearest banker" alone would stand there, at the side of the row.
        const row = [100, 101, 102, 103, 104].map(x => booth(x, 100));
        const sites = build([...row, banker(102, 101)]);
        expect(sites[0]!.stand).toEqual({ level: 0, x: 102, z: 99 });
    });

    test('a bank side that is walled off is not a stand', () => {
        const fs = [booth(100, 100), banker(100, 101)];
        const collision = stubCollision([...blockedBy(fs), { level: 0, x: 100, z: 99 }]);
        const sites = buildSites(fs, oneArea, noZones, collision, quiet);
        // East and west of the booth tie on side; the nearer the centre (100, 101) wins, then lower x.
        expect(sites[0]!.stand).toEqual({ level: 0, x: 99, z: 100 });
    });

    test('a tile a walk gets to beats every other preference: the far end of the counter, walled in, is no stand', () => {
        // The bankers stand well south of the counter's middle, so its north end (100, 103) faces furthest away
        // from them; with that end walled off from the walk (as Ardougne South bank's is, inside the bankers'
        // side), the stand is the tile in front of the counter nearest the centre (100, 100).
        const fs = [booth(100, 100), booth(100, 101), booth(100, 102), banker(101, 97), banker(101, 98)];
        const collision = stubCollision(blockedBy(fs));
        expect(build(fs)[0]!.stand).toEqual({ level: 0, x: 100, z: 103 });
        const [site] = buildSites(fs, oneArea, noZones, collision, {
            ...quiet,
            walked: t => t.x !== 100 || t.z !== 103,
        });
        expect(site!.stand).toEqual({ level: 0, x: 99, z: 100 });
        // With no tile walked to, the preferences stand as they were.
        const none = buildSites(fs, oneArea, noZones, collision, { ...quiet, walked: () => false });
        expect(none[0]!.stand).toEqual({ level: 0, x: 100, z: 103 });
    });

    test('an npc-only site prefers a walkable tile a walk gets to over a nearer one it does not', () => {
        const fs = [npc('shop', 'shopkeeper', 100, 100)];
        const blocked = stubCollision([{ level: 0, x: 100, z: 100 }]);
        // Without the walk, (99, 100) wins: as near the centre as (100, 99), and its x is lower.
        expect(buildSites(fs, oneArea, noZones, blocked, quiet)[0]!.stand).toEqual({ level: 0, x: 99, z: 100 });
        const [site] = buildSites(fs, oneArea, noZones, blocked, { ...quiet, walked: t => t.z < 100 });
        expect(site!.stand).toEqual({ level: 0, x: 100, z: 99 });
    });

    test('an npc used by approach ops from further off stands on a walked tile within its range in sight of it', () => {
        // A barmaid at (100, 100) behind a bar: the bar's tiles (99 and 101, 99..101) block, the tiles beside it are
        // walled off from the walk, and the walk gets only to x >= 103 and x <= 97.
        const fs = [npc('shop', 'barmaid', 100, 100)];
        const bar = [99, 101].flatMap(x => [99, 100, 101].map(z => ({ level: 0, x, z })));
        const collision = stubCollision(bar);
        const walked = pastTheBar;
        // Without the rule, no walked tile is in the grown box: the stand is the nearest one, the barmaid's own.
        expect(buildSites(fs, oneArea, noZones, collision, { ...quiet, walked })[0]!.stand).toEqual({
            level: 0,
            x: 100,
            z: 100,
        });
        const standWith = (approach: ReturnType<typeof barmaidRange>) =>
            buildSites(fs, oneArea, noZones, collision, { ...quiet, walked, approach })[0]!.stand;
        // Range 3: the walked tiles 3 off, nearest the centre and then by x: the west one.
        expect(standWith(barmaidRange(3))).toEqual({ level: 0, x: 97, z: 100 });
        // Out of sight from the west, the east one.
        expect(standWith(barmaidRange(3, from => from.x > 100))).toEqual({ level: 0, x: 103, z: 100 });
        // Range 2 reaches no walked tile: as without the rule.
        expect(standWith(barmaidRange(2))).toEqual({ level: 0, x: 100, z: 100 });
    });

    test('a loc site stands on the reachable tile nearest the centre', () => {
        const sites = build([loc('tree', 'oak', 100, 100), loc('tree', 'oak', 104, 100)]);
        expect(sites[0]!.centre).toEqual({ level: 0, x: 102, z: 100 });
        expect(sites[0]!.stand).toEqual({ level: 0, x: 101, z: 100 });
    });

    test('a multi-tile loc is reached from around its rotated footprint', () => {
        const range = { ...loc('range', '', 100, 100), config: 'big_range', rotation: 1 };
        const sized = locSizes(new Map([['big_range', { width: ['3'], length: ['1'] }]]));
        // Rotated a quarter turn the 3x1 range covers (100, 100..102). Every tile around it but the one
        // past its north end is walled, and that tile touches only the rotated footprint.
        const walled = [99, 100, 101].flatMap(x => [100, 101, 102].map(z => ({ level: 0, x, z })));
        const collision = stubCollision([...walled, { level: 0, x: 100, z: 99 }]);
        const [site] = buildSites([range], oneArea, noZones, collision, { size: sized, log: () => {} });
        expect(site!.stand).toEqual({ level: 0, x: 100, z: 103 });
    });

    test('an npc-only site stands on the walkable tile nearest the centre within its bbox grown by a tile', () => {
        const fs = [npc('pickpocket', 'man', 100, 100), npc('pickpocket', 'man', 102, 100)];
        const collision = stubCollision([{ level: 0, x: 101, z: 100 }]);
        const [site] = buildSites(fs, oneArea, noZones, collision, quiet);
        expect(site!.stand).toEqual({ level: 0, x: 100, z: 100 });
    });

    test('an npc-only site with water all through its bbox stands on the shore one tile outside it', () => {
        const fs = [npc('fishing-spot', 'net', 100, 100), npc('fishing-spot', 'net', 102, 100)];
        const water = [99, 100, 101, 102, 103].map(x => ({ level: 0, x, z: 100 }));
        const shore = [99, 100, 101, 102, 103].flatMap(x => [99, 101].map(z => ({ level: 0, x, z })));
        const open = { level: 0, x: 101, z: 101 };
        const collision = stubCollision([...water, ...shore.filter(t => t.x !== open.x || t.z !== open.z)]);
        const [site] = buildSites(fs, oneArea, noZones, collision, quiet);
        expect(site!.stand).toEqual(open);
    });

    test('no reachable tile is a null stand, logged', () => {
        const lines: string[] = [];
        const f = loc('tree', 'oak', 100, 100);
        const all = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dz => ({ level: 0, x: 100 + dx, z: 100 + dz })));
        const [site] = buildSites([f], oneArea, noZones, stubCollision(all), { size, log: l => lines.push(l) });
        expect(site!.stand).toBeNull();
        expect(lines).toEqual(['place: site tree:lumbridge:0 has no stand tile']);
    });
});

describe('buildSites: access flags', () => {
    test('f2p and multiway when any member tile is in a listed zone; the deepest Wilderness level', () => {
        const zones: Zones = {
            f2p: new Set([zoneKey({ level: 0, x: 3100, z: 3600 })]),
            multiway: new Set([zoneKey({ level: 0, x: 3108, z: 3600 })]),
        };
        const fs = [loc('tree', 'oak', 3100, 3600), loc('tree', 'oak', 3108, 3600), loc('tree', 'oak', 3108, 3608)];
        const [site] = buildSites(fs, oneArea, zones, stubCollision(blockedBy(fs)), quiet);
        expect(site!.f2p).toBe(true);
        expect(site!.multiway).toBe(true);
        // z 3600 is 80 tiles north of the Wilderness edge (3520): level 11; z 3608 is level 12.
        expect(site!.wildernessLevel).toBe(12);
    });

    test('outside every zone list and the Wilderness', () => {
        const [site] = build([loc('tree', 'oak', 100, 100)]);
        expect([site!.f2p, site!.multiway, site!.wildernessLevel]).toEqual([false, false, 0]);
    });
});

const spawn = (config: string, x: number, z: number, level = 0) => ({ config, tile: { level, x, z } });
/** Scripted configs' movement: a man wanders 2, a knight 15 and respawns fast, a statue stays, an imp teleports. */
const MOVEMENT: Record<string, NpcMovement> = {
    man: { wander: 2, respawnTicks: 100 },
    knight: { wander: 15, respawnTicks: 25 },
    statue: { wander: 0, respawnTicks: 100 },
    imp: { wander: 5, respawnTicks: 30, moves: { how: 'teleports', source: 'imp.rs2:21' } },
    guard: { wander: 0, patrol: { x1: 95, z1: 98, x2: 110, z2: 100, level: 0 }, respawnTicks: 100 },
};
const movement = (config: string): NpcMovement => MOVEMENT[config] ?? { wander: 0, respawnTicks: 100 };
const clusters = (ss: ReturnType<typeof spawn>[], resolve: (t: Tile) => string[] = oneArea, zones = noZones) =>
    spawnClusters(ss, resolve, zones, movement);

describe('spawnClusters', () => {
    test('spawns of a config within 6 tiles, chained, are one cluster with their mean, box and count', () => {
        // 100 -> 106 -> 112: each pair 6 apart, the ends 12 apart, as single linkage joins them.
        expect(clusters([spawn('man', 100, 100), spawn('man', 106, 101), spawn('man', 112, 100)])).toEqual([
            {
                config: 'man',
                areaPath: ['misthalin', 'lumbridge'],
                centre: { level: 0, x: 106, z: 100 },
                bbox: { x1: 100, z1: 100, x2: 112, z2: 101, level: 0 },
                count: 3,
                f2p: false,
                wander: 2,
                respawnTicks: 100,
                roam: { x1: 98, z1: 98, x2: 114, z2: 103, level: 0 },
            },
        ]);
    });

    test('7 tiles apart, on another level, of another config or in another area are apart', () => {
        const out = clusters(
            [
                spawn('man', 100, 100),
                spawn('man', 93, 100),
                spawn('man', 100, 100, 1),
                spawn('woman', 100, 100),
                spawn('man', 101, 100),
            ],
            splitAt101,
        );
        expect(
            out.map(c => `${c.config} ${c.areaPath.at(-1)} ${c.centre.x},${c.centre.z} L${c.centre.level} ${c.count}`),
        ).toEqual([
            'man west-bank 93,100 L0 1',
            'man west-bank 100,100 L0 1',
            'man west-bank 100,100 L1 1',
            'man east-bank 101,100 L0 1',
            'woman west-bank 100,100 L0 1',
        ]);
    });

    test('two spawns on one tile count twice; the order of the input does not matter', () => {
        const ss = [spawn('cow', 3, 3), spawn('cow', 3, 3), spawn('chicken', 50, 50), spawn('cow', 20, 3)];
        const out = clusters(ss);
        expect(out.map(c => [c.config, c.count])).toEqual([
            ['chicken', 1],
            ['cow', 2],
            ['cow', 1],
        ]);
        expect(clusters(ss.toReversed())).toEqual(out);
    });

    test('a cluster is F2P when one of its spawns is in a free zone', () => {
        const zones: Zones = { f2p: new Set([zoneKey({ level: 0, x: 3104, z: 3600 })]), multiway: new Set() };
        const out = clusters(
            [spawn('man', 3100, 3600), spawn('man', 3104, 3600), spawn('man', 3200, 3600)],
            oneArea,
            zones,
        );
        expect(out.map(c => c.f2p)).toEqual([true, false]);
    });
});

describe('locSizes', () => {
    test('width, length and forceapproach from the loc config; 1x1 and open by default', () => {
        const sized = locSizes(
            new Map<string, Config>([
                ['table', { width: ['2'], length: ['3'], forceapproach: ['north'] }],
                ['plain', {}],
            ]),
        );
        expect(sized({ ...loc('range', '', 0, 0), config: 'table' })).toEqual({
            width: 2,
            length: 3,
            forceapproach: 0b1110,
        });
        expect(sized({ ...loc('range', '', 0, 0), config: 'plain' })).toEqual({
            width: 1,
            length: 1,
            forceapproach: 0,
        });
    });
});

// A three-step course (sources/courses.ts): two logs are step 1, a rope on level 1 step 2, a wall the last.
const lap: CourseDef = {
    course: 'test',
    varp: 'test_course_progress',
    lastStep: 3,
    lapBonus: 420,
    source: 'c.rs2:28',
    steps: [
        { target: 'log', category: false, op: '1', step: 1, source: 'c.rs2:3' },
        { target: 'rope', category: false, op: '1', step: 2, source: 'c.rs2:9' },
        { target: 'wall', category: false, op: '1', step: 3, source: 'c.rs2:17' },
    ],
};
const obstacle = (config: string, x: number, z: number, level = 0): Feature => ({
    ...loc('agility-course', 'test', x, z, level),
    config,
});
const courseFeatures = [
    obstacle('log', 100, 110),
    obstacle('log', 100, 90),
    obstacle('rope', 96, 100, 1),
    obstacle('wall', 101, 92),
    // A rope 39 tiles off: no lap on its own.
    obstacle('rope', 140, 100),
];
const courses = { defs: [lap], step: (f: Feature) => stepAt(lap, f.config, undefined, f.tile) };
// The course's area holds x >= 100, so its rope at x 96 is outside it.
const courseArea = (t: Tile): string[] => (t.x >= 100 && t.x < 120 ? ['region', 'course'] : ['region']);

describe('buildSites: agility courses', () => {
    test('one site per lap across levels: area of its first obstacle, stand by the first nearest the last', () => {
        const lines: string[] = [];
        const sites = buildSites(courseFeatures, courseArea, noZones, stubCollision(blockedBy(courseFeatures)), {
            size,
            log: l => lines.push(l),
            courses,
        });
        expect(sites).toHaveLength(1);
        const [site] = sites;
        expect(site!.id).toBe('agility-course:course:0');
        expect(site!.areaPath).toEqual(['region', 'course']);
        // The mean of its level-0 tiles (100, 110), (100, 90), (101, 92): (100.3, 97.3).
        expect(site!.centre).toEqual({ level: 0, x: 100, z: 97 });
        // The rope is on level 1, so the box is on no one level.
        expect(site!.bbox).toEqual({ x1: 96, z1: 90, x2: 101, z2: 110 });
        // The log tiles' sides nearest the wall (101, 92): (100, 91) at 1 + 1 beats (101, 90) at 0 + 4.
        expect(site!.stand).toEqual({ level: 0, x: 100, z: 91 });
        expect(site!.counts).toEqual({ test: 4 });
        expect(site!.course).toEqual({
            varp: 'test_course_progress',
            lapBonus: 420,
            source: 'c.rs2:28',
            obstacles: [
                { step: 1, feature: 1, loc: 'log', tile: { level: 0, x: 100, z: 90 }, source: 'c.rs2:3' },
                { step: 1, feature: 0, loc: 'log', tile: { level: 0, x: 100, z: 110 }, source: 'c.rs2:3' },
                { step: 2, feature: 2, loc: 'rope', tile: { level: 1, x: 96, z: 100 }, source: 'c.rs2:9' },
                { step: 3, feature: 3, loc: 'wall', tile: { level: 0, x: 101, z: 92 }, source: 'c.rs2:17' },
            ],
        });
        expect(lines).toEqual(['place: agility-course test placements rope (140, 100) lack step 1, 3: no site']);
    });

    test('a course left with no site throws', () => {
        const rope = [obstacle('rope', 96, 100, 1)];
        expect(() =>
            buildSites(rope, courseArea, noZones, stubCollision(blockedBy(rope)), { ...quiet, courses }),
        ).toThrow('buildSites: no placement of course test holds every step 1 to 3');
    });

    test('a course feature with no course, or no step, throws', () => {
        const collision = stubCollision(blockedBy(courseFeatures));
        expect(() => buildSites(courseFeatures, courseArea, noZones, collision, quiet)).toThrow(
            'buildSites: no course test for its agility-course features',
        );
        const stray = [...courseFeatures, obstacle('net', 102, 100)];
        expect(() => buildSites(stray, courseArea, noZones, collision, { ...quiet, courses })).toThrow(
            'buildSites: net is an agility-course feature with no step',
        );
    });
});

const spot = (config: string, x: number, z: number): Feature => ({
    ...npc('fishing-spot', 'rarefish', x, z),
    config,
});
const shore = (f: Feature): string | undefined =>
    f.config.startsWith('a') ? 'a' : f.config.startsWith('b') ? 'b' : undefined;
const freeOffOrigin = (t: Tile): boolean => t.x !== 0;
const shoreSites = (fs: Feature[]): Placed<Site>[] =>
    buildSites(fs, oneArea, noZones, stubCollision(), { ...quiet, shore });

describe('shores', () => {
    test('spots sharing a shore are one site however far apart, others stay apart', () => {
        const fs = [spot('a1', 0, 0), spot('a2', 40, 0), spot('b1', 100, 0), spot('c1', 200, 0)];
        expect(shoreSites(fs).map(s => s.features.length)).toEqual([2, 1, 1]);
    });

    test('clusters holding a shore each are joined into one site', () => {
        const fs = [spot('a1', 0, 0), spot('b1', 4, 0), spot('a2', 50, 0), spot('b2', 54, 0), spot('x1', 100, 0)];
        expect(shoreSites(fs).map(s => [...s.features].sort())).toEqual([[0, 1, 2, 3], [4]]);
    });

    test('the stand is a tile reached with no requirement when one exists', () => {
        const out = buildSites([spot('a1', 0, 0)], oneArea, noZones, stubCollision(), {
            ...quiet,
            shore,
            free: freeOffOrigin,
        });
        expect(out[0]!.stand!.x).not.toBe(0);
    });

    test("a pool spawned at one end of its enum stands on the shore beside the enum's middle", () => {
        // The enum runs along water at z 0 from x 0 to 40, land only to the north; both spawns sit at its west end.
        const water = Array.from({ length: 41 }, (_, x) => ({ level: 0, x, z: 0 }));
        const south = Array.from({ length: 43 }, (_, x) => ({ level: 0, x: x - 1, z: -1 }));
        const collision = stubCollision([...water, ...south]);
        const fs = [spot('a1', 0, 0), spot('a2', 1, 0)];
        const opts = { ...quiet, shore };
        const [fixed] = buildSites(fs, oneArea, noZones, collision, opts);
        expect(fixed!.stand).toEqual({ level: 0, x: 1, z: 1 });
        const [pool] = buildSites(fs, oneArea, noZones, collision, { ...opts, moves: () => water });
        expect(pool!.stand).toEqual({ level: 0, x: 20, z: 1 });
    });
});

/** Collision with one wall, between x `west` and `west + 1`, and the entity test from a tile sharing an edge. */
function wallEastOf(west: number): StepCollision {
    const across = (a: number, b: number): boolean => Math.min(a, b) === west && Math.max(a, b) === west + 1;
    return {
        walkable: () => true,
        land: () => true,
        reached: (from, n) => Math.abs(from.x - n.x) + Math.abs(from.z - n.z) === 1 && !across(from.x, n.x),
        canStep: (_l, x, _z, dx) => !across(x, x + dx),
    };
}

/** Within 3 tiles of (100, 100): the land Bob walks on. */
const inBox = (x: number, z: number): boolean => Math.abs(x - 100) <= 3 && Math.abs(z - 100) <= 3;
const box1 = (x: number, z: number) => ({ x1: x, z1: z, x2: x, z2: z, level: 0 });

describe('roam', () => {
    const box = { x1: 100, z1: 100, x2: 104, z2: 101, level: 0 };

    test('a cluster wanders as its config does, its roam the bbox grown by it; at 0 the roam is the bbox', () => {
        const [knight] = clusters([spawn('knight', 100, 100)]);
        expect(knight).toMatchObject({ wander: 15, respawnTicks: 25, roam: { x1: 85, z1: 85, x2: 115, z2: 115 } });
        expect(knight!.bbox).toEqual({ x1: 100, z1: 100, x2: 100, z2: 100, level: 0 });
        const [statue] = clusters([spawn('statue', 100, 100), spawn('statue', 103, 101)]);
        expect(statue!.roam).toEqual(statue!.bbox);
        expect(statue!.moves).toBeUndefined();
    });

    test('of several configs: the largest wander, the fastest respawn, and a move when one has it', () => {
        expect(roamOf(['man', 'imp', 'knight'], box, movement)).toEqual({
            wander: 15,
            respawnTicks: 25,
            roam: { x1: 85, z1: 85, x2: 119, z2: 116, level: 0 },
            moves: { how: 'teleports', source: 'imp.rs2:21' },
        });
    });

    test("a patrol wanders as far as its coords' box reaches past the bbox", () => {
        // The box reaches 5 tiles west (95) and 6 east (110) of x 100-104; z 98-100 reaches 2 south of 100-101.
        expect(roamOf(['guard'], box, movement).wander).toBe(6);
    });

    test('a site of npcs gets the roam of its configs; one with a loc, or built without movement, has none', () => {
        const npcs = [npc('pickpocket', 'man', 100, 100), npc('pickpocket', 'knight', 102, 100)];
        const [site] = buildSites(npcs, oneArea, noZones, stubCollision(), { ...quiet, movement });
        expect(site).toMatchObject({ wander: 15, respawnTicks: 25, roam: { x1: 85, z1: 85, x2: 117, z2: 115 } });
        const bank = [booth(100, 100), banker(100, 101)];
        const [withLoc] = buildSites(bank, oneArea, noZones, stubCollision(blockedBy(bank)), { ...quiet, movement });
        expect(withLoc!.roam).toBeUndefined();
        expect(buildSites(npcs, oneArea, noZones, stubCollision(), quiet)[0]!.roam).toBeUndefined();
    });

    test('besideCluster takes the roam, and leaves out the ring tiles across a wall at its edge', () => {
        // A man at (100, 100) wanders 2: roam x 98-102. A wall runs between x 102 and 103.
        const [man] = clusters([spawn('man', 100, 100)]);
        const beside = besideCluster(man!, wallEastOf(102));
        const has = (x: number, z: number) => beside.some(t => t.x === x && t.z === z);
        // Roam tiles two past the spawn, and the ring past the open west side.
        expect(has(102, 102)).toBe(true);
        expect(has(97, 100)).toBe(true);
        expect([97, 100, 103].map(z => has(103, z))).toEqual([false, false, false]);
        // The 5x5 roam, and its ring but the 7 tiles of the east column.
        expect(beside).toHaveLength(5 * 5 + 7 * 7 - 5 * 5 - 7);
    });

    test('besideCluster leaves out the roam tiles across a wall the npc cannot walk through, and the ring past them', () => {
        // The wall runs between x 101 and 102, inside the roam: x 102 is neither walked to nor beside.
        const [man] = clusters([spawn('man', 100, 100)]);
        const beside = besideCluster(man!, wallEastOf(101));
        expect(beside.some(t => t.x >= 102)).toBe(false);
        // Roam x 98-101 (4x5), the west column (7) and the north and south rows over x 98-101 (2x4).
        expect(beside).toHaveLength(4 * 5 + 7 + 2 * 4);
        expect(beside).toEqual([...beside].sort((a, b) => a.x - b.x || a.z - b.z));
    });

    test('besideCluster shuts the doors the collision has open: no npc walks through one, no player is beside past one', () => {
        // The man's roam is x 98-102; a door at x 101-102, z 100 is open in the collision until walled.
        let shut = false;
        const doorway: StepCollision = {
            ...wallEastOf(101),
            canStep: (_l, x, z, dx, dz) =>
                !(Math.min(x, x + dx) === 101 && Math.max(x, x + dx) === 102) || (!shut && z === 100 && dz === 0),
            walled: f => {
                shut = true;
                try {
                    return f();
                } finally {
                    shut = false;
                }
            },
        };
        const [man] = clusters([spawn('man', 100, 100)]);
        expect(besideCluster(man!, doorway).some(t => t.x >= 102)).toBe(false);
        // Left open, the npc walks through it.
        const { walled: _, ...open } = doorway;
        expect(besideCluster(man!, open).some(t => t.x === 102)).toBe(true);
    });

    test('besideCluster costs the land a walk gets to, not a roam the size of the map', () => {
        // Bob the cat wanders 30000 (quest_death.npc); here the collision data's land is the 7x7 round his spawn.
        const islet: StepCollision = {
            walkable: () => true,
            land: (_l, x, z) => inBox(x, z),
            reached: () => false,
            canStep: () => true,
        };
        const bob = roamOf(['bob'], box1(100, 100), () => ({ wander: 30000, respawnTicks: 100 }));
        expect(bob.roam.x2).toBe(30100);
        const beside = besideCluster({ ...bob, bbox: box1(100, 100), centre: { level: 0, x: 100, z: 100 } }, islet);
        // The 7x7 of land, and the ring round it, which steps onto it.
        expect(beside).toHaveLength(9 * 9);
    });
});
