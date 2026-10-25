import { describe, expect, test } from 'bun:test';
import {
    applyAllow,
    nearMissAreas,
    rectGap,
    splitResources,
    standConnectivity,
    type CheckWorld,
    type Finding,
    type StandInput,
    type StandWorld,
} from '../checks';
import { locSizes } from '../place';
import { fillReach, reachGraph } from '../reach';
import { siteAt } from '../site-key';
import type { FeatureKind, Gate, Rect, Tile } from '../types';
import { at, Grid } from './grid';

const size = locSizes(new Map());

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

const KEY = 'item:dusty_key:held';
/** A shop at (3220-3224, 3220-3224), walled round but for a door in its west wall at z 3222. */
const shop = (): Grid => {
    const g = new Grid();
    for (let x = 3220; x <= 3224; x++) g.wall(at(0, x, 3220), 0, -1).wall(at(0, x, 3224), 0, 1);
    for (let z = 3220; z <= 3224; z++) {
        g.wall(at(0, 3224, z), 1, 0);
        if (z !== 3222) g.wall(at(0, 3220, z), -1, 0);
    }
    return g;
};
const door = (requires: string[][]): Gate => ({
    trigger: 'oploc1,door',
    kind: 'gate',
    loc: 'door',
    tile: at(0, 3220, 3222),
    shape: 0,
    angle: 0,
    requires,
    source: 't.rs2:1',
});
/** Two fishing spots on water south-west of the shop, which their spots can also move to (3214, 3210). */
const SPOTS = [at(0, 3205, 3210), at(0, 3208, 3210)];
const WATER = [...SPOTS, at(0, 3214, 3210)];
const spot = (tile: Tile): StandWorld['features'][number] => ({
    source: 'npc',
    config: 'spot',
    tile,
    subtype: 'net',
});
/** The spots' site: its stand and reach, and the nearest bank's way given as `bank` (undefined, none). */
const site = (stand: Tile, reach: string[][], bank: string[] | undefined): StandWorld['sites'][number] => ({
    id: 'fishing-spot:shore:0',
    kind: 'fishing-spot',
    features: [0, 1],
    bbox: { x1: 3205, z1: 3210, x2: 3208, z2: 3210, level: 0 },
    stand,
    reach,
    nearest: bank ? { bank: { site: 'bank:town:0', runTicks: 10, requires: bank } } : {},
    movement: { net: { tiles: WATER, centre: at(0, 3209, 3210), radius: 6 } },
});
const run = (
    grid: Grid,
    gates: Gate[],
    sites: StandWorld['sites'][number][],
    features: StandWorld['features'][number][] = SPOTS.map(spot),
    more: Partial<StandInput> = {},
): Finding[] => {
    grid.block(...WATER);
    const input = { world: { features: [], connectors: [], gates, transports: [] }, collision: grid, size };
    const graph = reachGraph(input);
    const reach = fillReach({ ...input, start: at(0, 3200, 3200) }, graph);
    return standConnectivity({ sites, features }, { graph, collision: grid, size, reach, ...more });
};
const IN_SHOP = at(0, 3222, 3222);
const SHORE = at(0, 3206, 3211);
/** The shop, and a pond round (3211, 3215) whose middle no walkable tile is beside. */
const pond = () => shop().block(...[3210, 3211, 3212].flatMap(x => [3214, 3215, 3216].map(z => at(0, x, z))));

/** The shop, and a line of trees blocking column 3216. */
const line = () => {
    const g = shop();
    for (let z = 3200; z < 3232; z++) g.block(at(0, 3216, z));
    return g;
};

describe('standConnectivity', () => {
    test('finds the Catherby case: a stand in a shop behind a locked door, its spots outside on the shore and free', () =>
        expect(run(shop(), [door([[KEY]])], [site(IN_SHOP, [[KEY]], [KEY])]).map(f => f.detail)).toEqual([
            `fishing-spot:shore:0 stand (3222, 3222): 0 of 2 members usable from the stand; its nearest bank bank:town:0 needs [${KEY}], more than any member's way in`,
        ]));

    test('a stand on the shore beside the spots passes', () =>
        expect(run(shop(), [door([[KEY]])], [site(SHORE, [[]], [])])).toEqual([]));

    test('a crossing that needs nothing joins the walk, so the shop stand sees the spots through an open door', () =>
        expect(run(shop(), [door([[]])], [site(IN_SHOP, [[]], [])])).toEqual([]));

    test('a spot is used from beside any tile it can move to', () => {
        // The spots can move to a pool inside the locked shop, (3222, 3221), beside the stand there.
        const pool = at(0, 3222, 3221);
        const inShop = {
            ...site(IN_SHOP, [[KEY]], []),
            movement: { net: { tiles: [...SPOTS, pool], centre: at(0, 3213, 3215), radius: 12 } },
        };
        expect(run(shop().block(pool), [door([[KEY]])], [inShop])).toEqual([]);
    });

    test("bounds the walk round every use tile: a spot's pool past the bbox grown by twice the radius", () => {
        // Two cage spots move only to a pool at (3229, 3229), 21 tiles past the bbox and 23 from the shore stand,
        // so beyond both grown by twice the radius: a walk to beside the pool is what uses them, 3 of 3.
        const pool = at(0, 3229, 3229);
        const cage = { ...spot(pool), subtype: 'cage' };
        const far = {
            ...site(SHORE, [[]], []),
            features: [0, 2, 3],
            movement: {
                net: { tiles: WATER, centre: at(0, 3209, 3210), radius: 6 },
                cage: { tiles: [pool], centre: pool, radius: 0 },
            },
        };
        expect(run(new Grid().block(pool), [], [far], [...SPOTS.map(spot), cage, cage])).toEqual([]);
    });

    test('names a kind that banks with no nearest bank', () =>
        expect(run(shop(), [], [site(SHORE, [[]], undefined)]).map(f => f.detail)).toEqual([
            'fishing-spot:shore:0 stand (3206, 3211): no bank from the stand',
        ]));

    test("a bank way asking no more than a member's own way in passes: coins summed, use gates joined", () => {
        // The shore asks 30 coins at the door; the bank way's 20 coins is within them, a key is not.
        const grid = new Grid().wallColumn(3204, 3200, 3231, [3215]);
        const toll = { ...door([['coins:30']]), tile: at(0, 3204, 3215) };
        const way = (bank: string[]) => run(grid, [toll], [site(SHORE, [['coins:30']], bank)]);
        expect(way(['coins:20'])).toEqual([]);
        expect(way([KEY]).map(f => f.detail)).toEqual([
            `fishing-spot:shore:0 stand (3206, 3211): its nearest bank bank:town:0 needs [${KEY}], more than any member's way in`,
        ]);
        // A use gate the site's features ask is part of each member's way in, as it is of the site's reach.
        expect(run(grid, [toll], [site(SHORE, [['coins:30', KEY]], [KEY])], undefined, { use: () => [[KEY]] })).toEqual(
            [],
        );
    });

    test('counts only members some walk gets beside, and skips a site with none', () => {
        // Two spots of a subtype that does not move, mid-pond (3211, 3215), used from nowhere: with one net spot,
        // 1 of 3 is usable, and of the members counted 1 of 1. A site of them alone has no bank, and is not named.
        const bait = { ...spot(at(0, 3211, 3215)), subtype: 'bait' };
        const features = [...SPOTS.map(spot), bait, bait];
        const near = { ...site(SHORE, [[]], []), features: [0, 2, 3] };
        expect(run(pond(), [], [near], features)).toEqual([]);
        const alone = { ...site(SHORE, [[]], undefined), features: [2, 3] };
        expect(run(pond(), [], [alone], features)).toEqual([]);
    });

    test("walks as far as an npc's roam: a snail penned in, its pen's door 27 tiles from its spawn", () => {
        // The pen (3216-3220, 3202-3230) opens by a door in its north wall; the stand is south of it, outside. The
        // tiles round its other sides are blocked, so none outside is beside the snail through the wall.
        const SPAWN = at(0, 3218, 3203);
        const pen = { ...door([[]]), tile: at(0, 3218, 3230), angle: 1 };
        const snail = (wander: number, gates: Gate[]) =>
            run(
                new Grid()
                    .room(3216, 3202, 3220, 3230)
                    .block(
                        ...[3215, 3221].flatMap(x => [...Array(30).keys()].map(dz => at(0, x, 3201 + dz))),
                        ...[3216, 3217, 3218, 3219, 3220].map(x => at(0, x, 3201)),
                    ),
                gates,
                [
                    {
                        id: 'npc:pen:0',
                        kind: 'npc',
                        features: [0],
                        bbox: { ...SPAWN, x1: 3218, z1: 3203, x2: 3218, z2: 3203 },
                        stand: at(0, 3218, 3200),
                        reach: [[]],
                        nearest: { bank: { site: 'bank:town:0', runTicks: 10, requires: [] } },
                        wander,
                        roam: { level: 0, x1: 3218 - wander, z1: 3203 - wander, x2: 3218 + wander, z2: 3203 + wander },
                    },
                ],
                [{ source: 'npc', config: 'snail', tile: SPAWN, subtype: '' }],
            ).map(f => f.detail);
        // Wandering 20, the walk's bound reaches the door; not wandering, it is 12 tiles round the spawn.
        expect(snail(20, [pen])).toEqual([]);
        expect(snail(0, [pen])).toEqual(['npc:pen:0 stand (3218, 3200): 0 of 1 members usable from the stand']);
        // Behind a locked door it is found; wandering past MAX_WANDER it is not walked, and found as that.
        const locked = [{ ...pen, requires: [[KEY]] }];
        expect(snail(20, locked)).toEqual(['npc:pen:0 stand (3218, 3200): 0 of 1 members usable from the stand']);
        expect(snail(70, locked)).toEqual(['npc:pen:0 stand (3218, 3200): wanders 70 > MAX_WANDER 64, not walked']);
    });

    test("an opened loc's tile asking something stops the walk, on the stand too", () => {
        // A line of trees down column 3216, the one at z 3211 cut through by what `requires` asks.
        const TREE = at(0, 3216, 3211);
        const tree = (requires: string[][]): Gate => ({
            ...door(requires),
            trigger: 'oploc1,tree',
            loc: 'tree',
            tile: TREE,
            shape: 10,
            opens: true,
        });
        const east = (requires: string[][], stand: Tile) =>
            run(line(), [tree(requires)], [site(stand, requires, [])]).map(f => f.detail);
        const EAST = at(0, 3218, 3211);
        expect(east([[]], EAST)).toEqual([]);
        expect(east([[KEY]], EAST)).toEqual([
            'fishing-spot:shore:0 stand (3218, 3211): 0 of 2 members usable from the stand',
        ]);
        expect(east([[KEY]], TREE)).toEqual([
            'fishing-spot:shore:0 stand (3216, 3211): 0 of 2 members usable from the stand',
        ]);
    });

    test('half the members usable passes and less than half is found, the walk stopping at half or not', () => {
        // Two spots in the locked shop, beside the stand there, that do not move; the net spots are outside.
        const inShop = [at(0, 3221, 3221), at(0, 3223, 3223)].map(t => ({ ...spot(t), subtype: 'bait' }));
        const features = [...SPOTS.map(spot), ...inShop];
        const of = (members: number[]) =>
            run(shop(), [door([[KEY]])], [{ ...site(IN_SHOP, [[KEY]], []), features: members }], features).map(
                f => f.detail,
            );
        expect(of([0, 1, 2, 3])).toEqual([]);
        expect(of([0, 2, 3])).toEqual([]);
        expect(of([0, 1, 2])).toEqual([
            'fishing-spot:shore:0 stand (3222, 3222): 1 of 3 members usable from the stand',
        ]);
    });
});
