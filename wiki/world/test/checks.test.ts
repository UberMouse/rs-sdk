import { describe, expect, test } from 'bun:test';
import { applyAllow, nearMissAreas, rectGap, splitResources, type CheckWorld, type Finding } from '../checks';
import { siteAt } from '../site-key';
import type { FeatureKind, Rect } from '../types';

const COVERED = new Set<FeatureKind>(['shop', 'tree', 'rock', 'anvil']);

/** Each area's path, root first, as Site.areaPath. */
const PATHS: Record<string, string[]> = {
    kingdom: ['kingdom'],
    town: ['kingdom', 'town'],
    'town-bank': ['kingdom', 'town', 'town-bank'],
    port: ['kingdom', 'port'],
};

/**
 * A world of one kingdom holding a town (with a bank) and a port beside it, and the sites given as
 * `[kind, leaf area, [x, z, config][], level?]`: each site's features are its own, its bbox their tiles'.
 */
function world(
    sites: readonly [FeatureKind, string, readonly (readonly [number, number, string])[], number?][],
    port: Rect = { x1: 30, z1: 10, x2: 40, z2: 20 },
): CheckWorld {
    const features: CheckWorld['features'][number][] = [];
    const counts = new Map<string, number>();
    return {
        areas: [
            { id: 'kingdom', rects: [{ x1: 0, z1: 0, x2: 100, z2: 100 }] },
            { id: 'town', parent: 'kingdom', rects: [{ x1: 0, z1: 0, x2: 20, z2: 20 }] },
            { id: 'town-bank', parent: 'town', rects: [{ x1: 0, z1: 0, x2: 2, z2: 2 }] },
            { id: 'port', parent: 'kingdom', rects: [port] },
        ],
        features,
        sites: sites.map(([kind, leaf, members, level = 0]) => {
            const n = counts.get(`${kind}:${leaf}`) ?? 0;
            counts.set(`${kind}:${leaf}`, n + 1);
            const first = features.length;
            for (const [x, z, config] of members) features.push({ tile: { level, x, z }, config });
            const xs = members.map(([x]) => x);
            const zs = members.map(([, z]) => z);
            return {
                id: `${kind}:${leaf}:${n}`,
                kind,
                areaPath: PATHS[leaf]!,
                features: members.map((_, i) => first + i),
                bbox: { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs), level },
            };
        }),
    };
}

const ids = (fs: readonly Finding[]): string[][] => fs.map(f => f.ids);

describe('rectGap', () => {
    test('is the Chebyshev gap between the rects, 0 where they overlap or share an edge tile', () => {
        const r: Rect = { x1: 10, z1: 10, x2: 20, z2: 20, level: 0 };
        expect(rectGap(r, { x1: 22, z1: 15, x2: 25, z2: 15, level: 0 })).toBe(2);
        expect(rectGap(r, { x1: 21, z1: 21, x2: 21, z2: 24, level: 0 })).toBe(1);
        expect(rectGap(r, { x1: 20, z1: 5, x2: 30, z2: 10, level: 0 })).toBe(0);
        expect(rectGap(r, { x1: 0, z1: 0, x2: 3, z2: 3, level: 0 })).toBe(7);
    });

    test('a rect with no level meets every level; two levels never meet', () => {
        const r: Rect = { x1: 10, z1: 10, x2: 20, z2: 20 };
        expect(rectGap(r, { x1: 22, z1: 15, x2: 22, z2: 15, level: 3 })).toBe(2);
        expect(rectGap({ ...r, level: 1 }, { x1: 22, z1: 15, x2: 22, z2: 15, level: 0 })).toBe(Infinity);
    });
});

describe('nearMissAreas', () => {
    test("finds a site 1-3 tiles outside another leaf area's rect, not 4 tiles out or inside it", () => {
        const w = world([
            ['shop', 'kingdom', [[28, 15, 'a']]], // 2 tiles west of the port
            ['shop', 'kingdom', [[43, 15, 'b']]], // 3 east
            ['shop', 'kingdom', [[44, 15, 'c']]], // 4 east
            ['shop', 'port', [[35, 15, 'd']]], // inside
        ]);
        const found = nearMissAreas(w, COVERED);
        expect(ids(found)).toEqual([['shop:kingdom:0'], ['shop:kingdom:1']]);
        expect(found[0]).toEqual({
            ids: ['shop:kingdom:0'],
            keys: [siteAt('shop', 28, 15)],
            detail: 'shop:kingdom:0 (x 28-28, z 15-15) in kingdom, 2 tiles outside port (x 30-40, z 10-20)',
        });
    });

    test('a bbox reaching into the rect is not outside it', () =>
        expect(
            nearMissAreas(
                world([
                    [
                        'rock',
                        'kingdom',
                        [
                            [27, 15, 'r'],
                            [31, 15, 'r'],
                        ],
                    ],
                ]),
                COVERED,
            ),
        ).toEqual([]));

    test("looks at leaf areas only, and not the site's own", () => {
        const w = world([
            ['shop', 'kingdom', [[22, 15, 'a']]], // 2 tiles off the town's edge: the parent of its bank
            ['shop', 'town-bank', [[4, 1, 'b']]], // 2 off the bank's, its own
            ['shop', 'town', [[4, 1, 'c']]], // 2 off the bank's
        ]);
        expect(nearMissAreas(w, COVERED).map(f => f.detail)).toEqual([
            'shop:town:0 (x 4-4, z 1-1) in town, 2 tiles outside town-bank (x 0-2, z 0-2)',
        ]);
    });

    test('skips trees and kinds not covered, and rects on another level', () => {
        const w = world([
            ['tree', 'kingdom', [[28, 15, 't']]],
            ['connector', 'kingdom', [[28, 16, 'c']]],
        ]);
        expect(nearMissAreas(w, COVERED)).toEqual([]);
        const upstairs = world([['shop', 'kingdom', [[28, 15, 'a']]]], { x1: 30, z1: 10, x2: 40, z2: 20, level: 1 });
        expect(nearMissAreas(upstairs, COVERED)).toEqual([]);
    });
});

describe('splitResources', () => {
    test('finds a same-config pair across an area edge within the kind radius, not beyond it', () => {
        const w = world([
            ['rock', 'kingdom', [[24, 15, 'coal']]], // 6 tiles west of the port's rock
            ['rock', 'port', [[30, 15, 'coal']]],
            ['rock', 'kingdom', [[46, 15, 'coal']]], // 9 tiles east: past the rock radius, 8
        ]);
        expect(splitResources(w, COVERED)).toEqual([
            {
                ids: ['rock:kingdom:0', 'rock:port:0'],
                keys: [siteAt('rock', 24, 15), siteAt('rock', 30, 15)],
                detail: 'rock:kingdom:0 and rock:port:0, 6 tiles apart, both hold coal',
            },
        ]);
    });

    test('takes the gap between the nearest features, by the radius of their kind', () => {
        const w = world([
            [
                'anvil',
                'kingdom',
                [
                    [10, 40, 'anvil'],
                    [26, 40, 'anvil'],
                ],
            ],
            ['anvil', 'port', [[30, 40, 'anvil']]], // 4 from the east anvil: the anvil radius
            [
                'anvil',
                'kingdom',
                [
                    [10, 60, 'anvil'],
                    [26, 66, 'anvil'],
                ],
            ],
            ['anvil', 'port', [[30, 60, 'anvil']]], // 4 from that bbox's east edge, but 6 from its nearest anvil
            ['shop', 'kingdom', [[10, 50, 'gerrant']]],
            ['shop', 'port', [[17, 50, 'gerrant']]], // 7: past the shop radius, 6
        ]);
        expect(ids(splitResources(w, COVERED))).toEqual([['anvil:kingdom:0', 'anvil:port:0']]);
    });

    test('a pair of different configs, of different kinds or in one area is not split', () => {
        const w = world([
            ['rock', 'kingdom', [[28, 15, 'coal']]],
            ['rock', 'port', [[30, 15, 'iron']]],
            ['shop', 'port', [[31, 15, 'coal']]],
            ['rock', 'port', [[50, 50, 'tin']]],
            ['rock', 'port', [[55, 50, 'tin']]],
        ]);
        expect(splitResources(w, COVERED)).toEqual([]);
    });

    test('skips trees', () =>
        expect(
            splitResources(
                world([
                    ['tree', 'kingdom', [[28, 15, 'oak']]],
                    ['tree', 'port', [[30, 15, 'oak']]],
                ]),
                COVERED,
            ),
        ).toEqual([]));
});

describe('applyAllow', () => {
    const w = world([
        ['rock', 'kingdom', [[24, 15, 'coal']]],
        ['rock', 'port', [[30, 15, 'coal']]],
        ['shop', 'kingdom', [[28, 15, 'a']]],
        ['shop', 'kingdom', [[43, 15, 'b']]],
    ]);
    const near = nearMissAreas(w, COVERED);
    const why = { reason: 'rect not fitted', source: 'maps/m0_0.jm2:1' };

    test('leaves out the findings an entry names, and lists the rest', () =>
        expect(applyAllow(near, [{ keys: [siteAt('shop', 28, 15)], ...why }], w)).toEqual({
            left: [
                'shop (43, 15, 0): shop:kingdom:1 (x 43-43, z 15-15) in kingdom, 3 tiles outside port (x 30-40, z 10-20)',
            ],
            allowed: 1,
            invalid: [],
            stale: [],
        }));

    test('a pair matches its finding in either order', () =>
        expect(
            applyAllow(
                splitResources(w, COVERED),
                [{ keys: [siteAt('rock', 30, 15), siteAt('rock', 24, 15)], ...why }],
                w,
            ),
        ).toEqual({ left: [], allowed: 1, invalid: [], stale: [] }));

    test('an entry no finding matches is stale, and one whose key names no site invalid', () =>
        expect(
            applyAllow(
                near,
                [
                    { keys: [siteAt('shop', 28, 15)], ...why },
                    { keys: [siteAt('shop', 43, 15)], ...why },
                    // The port's rock: a site, but not a near miss.
                    { keys: [siteAt('rock', 30, 15)], ...why },
                    // No shop stands there; a rock does on the tile, and the split pair is not this check's.
                    { keys: [siteAt('shop', 24, 15)], ...why },
                    { keys: [siteAt('rock', 24, 15), siteAt('rock', 31, 15)], ...why },
                ],
                w,
            ),
        ).toEqual({
            left: [],
            allowed: 2,
            invalid: [
                'shop (24, 15, 0) (maps/m0_0.jm2:1): shop (24, 15, 0): no site holds it',
                'rock (24, 15, 0) and rock (31, 15, 0) (maps/m0_0.jm2:1): rock (31, 15, 0): no site holds it',
            ],
            stale: ['rock (30, 15, 0) (maps/m0_0.jm2:1)'],
        }));

    test('an entry matching a finding an earlier entry matches is stale, as its duplicate', () =>
        expect(
            applyAllow(
                near,
                [
                    { keys: [siteAt('shop', 28, 15)], ...why },
                    { keys: [siteAt('shop', 28, 15)], reason: 'again', source: 'maps/m0_0.jm2:2' },
                    { keys: [siteAt('shop', 43, 15)], ...why },
                ],
                w,
            ),
        ).toEqual({
            left: [],
            allowed: 2,
            invalid: [],
            stale: ['shop (28, 15, 0) (maps/m0_0.jm2:2): a duplicate of shop (28, 15, 0) (maps/m0_0.jm2:1)'],
        }));
});
