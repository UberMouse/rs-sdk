import { describe, expect, test } from 'bun:test';
import { buildSites, locSizes, type LocReach, type SiteCollision } from '../place';
import type { Config } from '../sources/configs';
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

const build = (fs: Feature[], resolve: (t: Tile) => string[] = oneArea): Site[] =>
    buildSites(fs, resolve, noZones, stubCollision(blockedBy(fs)), quiet);

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
