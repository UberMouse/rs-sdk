import { describe, expect, test } from 'bun:test';
import { WORLD_FORMAT, type Connector as Row, type World } from '../../../wiki/world/types';
import { collisionPaths } from '../../actions/paths';
import { NO_ACCOUNT } from '../../lib/account';
import {
    CONNECTORS,
    connectorTable,
    LEFT_OUT,
    MAX_HOPS,
    OVERRIDES,
    planConnectors,
    planeOf,
    type Connector,
    type Tile,
} from '../../lib/connectors';
import { nearestWay } from '../../lib/walk-graph';
import { WORLD } from '../../lib/world-index';

const at = (level: number, x: number, z: number): Tile => ({ level, x, z });
const show = (t: Tile) => `${t.level}:${t.x},${t.z}`;
/** A landing is the stand tile, or (behind a wall from the loc) a tile the stand tile is a walk from. */
const reaches = (from: Tile, to: Tile) =>
    (from.x === to.x && from.z === to.z) || collisionPaths.findPath(from, to, []).reachedDestination;
const names = (chain: readonly { name: string; direction: string }[] | null) =>
    chain?.map(c => `${c.direction} ${c.name}`);
/** A connector as `<direction> <name> loc <tile> stand <tile> to <tile>`. */
const row = (c: Connector) => `${c.direction} ${c.name} loc ${show(c.loc)} stand ${show(c.stand)} to ${show(c.to)}`;

describe('planeOf', () => {
    test('is the level, with underground (z >= 6400) apart', () => {
        expect(planeOf(0, 3222, 3222)).toBe('0');
        expect(planeOf(1, 3222, 3222)).toBe('1');
        expect(planeOf(0, 3222, 6400)).toBe('0u');
        expect(planeOf(0, 3222, 6399)).toBe('0');
    });

    test("the Dwarven Mine and the Wizards' Tower basement are different underground planes", () => {
        expect(planeOf(0, 2998, 9844)).toBe('0u-mine');
        expect(planeOf(0, 3058, 9776)).toBe('0u-mine');
        expect(planeOf(0, 3104, 9576)).toBe('0u-basement');
        expect(planeOf(0, 3104, 9577)).not.toBe(planeOf(0, 3058, 9776));
        // The Edgeville dungeon is its own area; underground elsewhere (the Varrock sewers) is neither.
        expect(planeOf(0, 3100, 9930)).toBe('0u-edgeville');
        expect(planeOf(0, 3237, 9858)).toBe('0u');
    });
});

describe('the table is a view of world.json', () => {
    test('it has every row of the curated table it replaced; the Edgeville pair lands as its scripts say', () => {
        // The hand-written table before it became a view. Its Edgeville rows had the ladder's stand and the
        // trapdoor's landing at (3097, 9868), copied from each other; trapdoors.rs2:11 moves the player's own tile
        // 6400 north and the trapdoor is reached from (3096, 3468) only, so both are (3096, 9868)
        // (wiki/world/test/connectors.real.test.ts had it as CONTRADICTED).
        const curated = [
            'up Lumbridge castle stairs loc 0:3204,3207 stand 0:3205,3209 to 1:3205,3209',
            'down Lumbridge castle stairs loc 1:3204,3207 stand 1:3205,3209 to 0:3205,3209',
            'up Lumbridge castle stairs loc 1:3204,3207 stand 1:3205,3209 to 2:3205,3209',
            'down Lumbridge castle stairs loc 2:3205,3208 stand 2:3205,3209 to 1:3205,3209',
            "up Wizards' Tower stairs loc 0:3103,3159 stand 0:3105,3160 to 1:3105,3160",
            "down Wizards' Tower stairs loc 1:3103,3159 stand 1:3105,3160 to 0:3105,3160",
            "up Wizards' Tower stairs loc 1:3103,3159 stand 1:3105,3160 to 2:3104,3161",
            "down Wizards' Tower stairs loc 2:3104,3160 stand 2:3104,3161 to 1:3105,3160",
            "up Wizards' Tower ladder loc 0:3103,9576 stand 0:3104,9576 to 0:3105,3162",
            "down Wizards' Tower ladder loc 0:3104,3162 stand 0:3105,3162 to 0:3104,9576",
            'up Falador mine stairs loc 0:3059,9776 stand 0:3058,9776 to 0:3062,3376',
            'down Falador mine stairs loc 0:3059,3376 stand 0:3062,3376 to 0:3058,9776',
            "up Taverley Sanfew's house stairs loc 0:2898,3428 stand 0:2897,3428 to 1:2898,3427",
            "down Taverley Sanfew's house stairs loc 1:2898,3428 stand 1:2898,3427 to 0:2897,3428",
            'up Taverley Dungeon ladder loc 0:2884,9797 stand 0:2885,9797 to 0:2885,3397',
            'down Taverley Dungeon ladder loc 0:2884,3397 stand 0:2885,3397 to 0:2885,9797',
            'up Edgeville Dungeon trapdoor loc 0:3096,9867 stand 0:3096,9868 to 0:3096,3468',
            'down Edgeville Dungeon trapdoor loc 0:3097,3468 stand 0:3096,3468 to 0:3096,9868',
            "up Seers' Village spinning house ladder loc 0:2715,3470 stand 0:2714,3470 to 1:2714,3470",
            "down Seers' Village spinning house ladder loc 1:2715,3470 stand 1:2714,3470 to 0:2714,3470",
        ];
        const table = CONNECTORS.map(row);
        expect(curated.filter(r => !table.includes(r))).toEqual([]);
    });

    test('every override names a loc of the table, in the direction it says', () => {
        for (const k of OVERRIDES.keys()) {
            const [tile, direction] = k.split(' ');
            const [level, x, z] = tile!.split(',').map(Number);
            const rows = CONNECTORS.filter(c => show(c.loc) === show(at(level!, x!, z!)));
            expect(rows.filter(c => !direction || c.direction === direction).length, k).toBeGreaterThan(0);
        }
    });

    test('leaves out the rows a walk cannot use, each with why', () => {
        const why = new Set(LEFT_OUT.map(l => l.why));
        expect([...why].sort()).toEqual([
            'into an underground area planeOf does not name',
            'not up or down',
            'op Cross, which climb does not send',
        ]);
        // The Varrock sewers manhole: into an underground area no plane names.
        expect(whyOf('manholeclosed', 3237, 3458)).toEqual(['into an underground area planeOf does not name']);
        // Castle Wars' outside stairs move the player along the ground.
        expect(whyOf('castlewars_outsidestairs_zamorak_linked', 2382, 3131)).toEqual([
            'not up or down',
            'not up or down',
        ]);
        // Every gangplank's Cross.
        const crossed = LEFT_OUT.filter(l => l.why.startsWith('op Cross'));
        expect(crossed.length).toBeGreaterThan(0);
        expect(crossed.map(c => c.row)).toContain('brimhavenshipplank_off (2683, 3269) L1 Cross');
    });
});

/** Why the table left out the rows of a loc config at (x, z). */
const whyOf = (config: string, x: number, z: number) =>
    LEFT_OUT.filter(l => l.row.startsWith(`${config} (${x}, ${z})`)).map(l => l.why);
/** A connector loc of a scripted world. */
const feature = (config: string, name: string, t: Tile) => ({
    source: 'loc' as const,
    id: 1,
    config,
    tile: t,
    kind: 'connector' as const,
    subtype: '',
    name,
});

describe('connectorTable on a scripted world', () => {
    const tile = at;
    const r = (f: number, loc: Tile, opName: string, direction: Row['direction'], landing: Tile, extra = {}): Row => ({
        feature: f,
        loc,
        op: 1,
        opName,
        direction,
        landing,
        stand: tile(loc.level, loc.x + 1, loc.z),
        source: 'ladders+stairs/scripts/stairs.rs2:1',
        ...extra,
    });
    const scripted: World = {
        format: WORLD_FORMAT,
        generatedFrom: 'test',
        areas: [{ id: 'town', name: 'Town', rects: [] }],
        features: [
            feature('spiralstairsmiddle', 'Staircase', tile(1, 100, 100)),
            feature('manholeclosed', 'Manhole', tile(0, 200, 200)),
            feature('trapdoor', 'Trapdoor', tile(0, 300, 300)),
            feature('ladder', 'Ladder', tile(0, 400, 9000)),
        ],
        sites: [
            {
                id: 'connector:town:0',
                kind: 'connector',
                areaPath: ['town'],
                centre: tile(1, 100, 100),
                bbox: { x1: 100, z1: 100, x2: 100, z2: 100 },
                stand: null,
                counts: {},
                features: [0],
                f2p: true,
                multiway: false,
                wildernessLevel: 0,
                reach: [[]],
            },
        ],
        npcSpawns: [],
        connectors: [
            r(0, tile(1, 100, 100), 'Climb', 'up', tile(2, 101, 100)),
            r(0, tile(1, 100, 100), 'Climb-up', 'up', tile(2, 101, 100)),
            r(0, tile(1, 100, 100), 'Climb-down', 'down', tile(0, 101, 100)),
            r(1, tile(0, 200, 200), 'Open', 'down', tile(0, 201, 6600), { thenOp: { op: 1, opName: 'Climb down' } }),
            r(2, tile(0, 300, 300), 'Open', 'down', tile(0, 3096, 9868), { thenOp: { op: 1, opName: 'Climb-down' } }),
            r(3, tile(0, 400, 9000), 'Climb-up', 'up', tile(0, 401, 2600)),
        ],
        quests: [],
        loadoutRules: {},
        transports: [],
        gates: [],
    };

    test('one row per loc, direction and landing, named by the loc and its place', () => {
        const { connectors } = connectorTable(scripted, new Map());
        expect(connectors.map(c => `${c.direction} ${c.name} ${show(c.to)}`)).toEqual([
            'up Staircase, Town 2:101,100',
            'down Staircase, Town 0:101,100',
            'down Trapdoor 0:3096,9868',
        ]);
    });

    test('an override by tile names both directions, one by tile and direction only that one', () => {
        const overrides = new Map([
            ['1,100,100', { name: 'Town stairs' }],
            ['1,100,100 up', { hazard: 'a demon upstairs' }],
        ]);
        const { connectors } = connectorTable(scripted, overrides);
        expect(connectors.slice(0, 2)).toEqual([
            expect.objectContaining({ name: 'Town stairs', direction: 'up', hazard: 'a demon upstairs' }),
            expect.not.objectContaining({ hazard: expect.anything() }),
        ]);
        expect(connectors[1]!.name).toBe('Town stairs');
    });

    test('leaves out what climb cannot do or a walk cannot follow, saying why', () => {
        expect(connectorTable(scripted, new Map()).left).toEqual([
            {
                row: 'manholeclosed (200, 200) L0 Open',
                why: 'into an underground area planeOf does not name',
            },
            { row: 'ladder (400, 9000) L0 Climb-up', why: 'into an underground area planeOf does not name' },
        ]);
        // A manhole into a named area: climb opens only trapdoors.
        const named = {
            ...scripted,
            connectors: [
                r(1, tile(0, 200, 200), 'Open', 'down', tile(0, 3096, 9868), {
                    thenOp: { op: 1, opName: 'Climb-down' },
                }),
            ],
        };
        expect(connectorTable(named, new Map()).left.map(l => l.why)).toEqual([
            'opened by Open, and climb opens only a trapdoor',
        ]);
    });
});

describe('planConnectors: the climbs of the shortest way over the world graph', () => {
    test('is empty on the destination plane and null where nothing leads', () => {
        expect(planConnectors(at(0, 3222, 3222), at(0, 3300, 3300))).toEqual([]);
        expect(planConnectors(at(0, 3222, 3222), at(3, 3205, 3209))).toBeNull();
        // A tile on no floor.
        expect(planConnectors(at(1, 3500, 3500), at(0, 3222, 3222))).toBeNull();
    });

    test('Lumbridge castle: the south-west staircase to its floors and back, the north one to the north end', () => {
        expect(names(planConnectors(at(0, 3222, 3222), at(1, 3207, 3212)))).toEqual(['up Lumbridge castle stairs']);
        expect(names(planConnectors(at(0, 3222, 3222), at(2, 3207, 3212)))).toEqual([
            'up Lumbridge castle stairs',
            'up Lumbridge castle stairs',
        ]);
        expect(names(planConnectors(at(2, 3205, 3209), at(0, 3222, 3222)))).toEqual([
            'down Lumbridge castle stairs',
            'down Lumbridge castle stairs',
        ]);
        expect(names(planConnectors(at(1, 3205, 3209), at(0, 3222, 3222)))).toEqual(['down Lumbridge castle stairs']);
        // The castle's north tower has stairs of its own (the curated table had only the south-west ones).
        const north = planConnectors(at(0, 3222, 3222), at(1, 3205, 3228));
        expect(north?.map(c => `${c.direction} ${show(c.loc)}`)).toEqual(['up 0:3204,3229']);
    });

    test("Duke Horacio's room (Rune Mysteries) is up the north stairs: fewer run ticks than the south-west ones", () => {
        const duke = at(1, 3211, 3221);
        expect(planConnectors(at(0, 3222, 3222), duke)?.map(c => `${c.direction} ${show(c.loc)}`)).toEqual([
            'up 0:3204,3229',
        ]);
        const beside = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dz => at(1, duke.x + dx, duke.z + dz)));
        const ticks = (table: readonly Connector[]) =>
            nearestWay(at(0, 3222, 3222), beside, { account: NO_ACCOUNT, connectors: table, maxHops: MAX_HOPS })
                ?.runTicks;
        const southWestOnly = CONNECTORS.filter(c => !(c.loc.x === 3204 && c.loc.z === 3229));
        expect(ticks(CONNECTORS)).toBeLessThan(ticks(southWestOnly)!);
    });

    test('it climbs only rows of its table: without the north stairs the north end is up the south-west ones', () => {
        const table = CONNECTORS.filter(c => !(c.loc.x === 3204 && c.loc.z === 3229));
        expect(names(planConnectors(at(0, 3222, 3222), at(1, 3205, 3228), table))).toEqual([
            'up Lumbridge castle stairs',
        ]);
    });

    test('the Dwarven Mine: the Falador stairs from beside their house, the Ice Mountain trapdoor from Lumbridge', () => {
        const down = planConnectors(at(0, 3062, 3380), at(0, 3058, 9780));
        expect(names(down)).toEqual(['down Falador mine stairs']);
        expect(down?.[0]?.stand).toEqual(at(0, 3062, 3376));
        expect(names(planConnectors(at(0, 3050, 9780), at(0, 3062, 3380)))).toEqual(['up Falador mine stairs']);
        // Nurmof (2998, 9844) is nearer the mine's north entrance: its trapdoor beside Ice Mountain.
        const nurmof = planConnectors(at(0, 3222, 3222), at(0, 2998, 9844));
        expect(nurmof?.map(c => `${c.direction} ${show(c.loc)}`)).toEqual(['down 0:3019,3450']);
    });

    test("the Wizards' Tower basement by its ladder, from the tower's ground floor or from the first floor", () => {
        expect(names(planConnectors(at(0, 3110, 3165), at(0, 3104, 9577)))).toEqual(["down Wizards' Tower ladder"]);
        expect(names(planConnectors(at(1, 3105, 3160), at(0, 3104, 9577)))).toEqual([
            "down Wizards' Tower stairs",
            "down Wizards' Tower ladder",
        ]);
    });

    test("the basement's way to Falador is the tower ladder, never the mine stairs", () => {
        const out = planConnectors(at(0, 3104, 9577), at(0, 3060, 3380));
        expect(names(out)).toEqual(["up Wizards' Tower ladder"]);
        expect(out?.[0]?.stand).toEqual(at(0, 3104, 9576));
    });

    test('between the two underground areas the chain goes up to the surface and down again', () => {
        expect(names(planConnectors(at(0, 3058, 9780), at(0, 3104, 9577)))).toEqual([
            'up Falador mine stairs',
            "down Wizards' Tower ladder",
        ]);
        expect(names(planConnectors(at(0, 3104, 9577), at(0, 2998, 9844)))).toEqual([
            "up Wizards' Tower ladder",
            'down Falador mine stairs',
        ]);
    });

    test("Taverley: Sanfew's first floor is the herb-house stairs, and the dungeon its own area by the ladder", () => {
        const up = planConnectors(at(0, 2924, 3485), at(1, 2897, 3426));
        expect(names(up)).toEqual(["up Taverley Sanfew's house stairs"]);
        expect(up?.[0]?.stand).toEqual(at(0, 2897, 3428));
        expect(names(planConnectors(at(1, 2897, 3426), at(0, 2924, 3485)))).toEqual([
            "down Taverley Sanfew's house stairs",
        ]);
        expect(names(planConnectors(at(0, 2924, 3485), at(0, 2890, 9830)))).toEqual(['down Taverley Dungeon ladder']);
        expect(names(planConnectors(at(0, 2890, 9830), at(0, 2924, 3485)))).toEqual(['up Taverley Dungeon ladder']);
        // Not the Dwarven Mine: the dungeon is a separate area. The mine's north-west pocket (x 2962..2975,
        // z 9806..9819) sits inside the dungeon's x range but is the mine.
        expect(planeOf(0, 2970, 9812)).toBe(planeOf(0, 2998, 9844));
        expect(planeOf(0, 2960, 9780)).toBe(planeOf(0, 2890, 9830));
        expect(planeOf(0, 2850, 9700)).toBe(planeOf(0, 2890, 9830));
        expect(planeOf(0, 2890, 9830)).not.toBe(planeOf(0, 2998, 9844));
        expect(planConnectors(at(0, 2890, 9830), at(0, 2998, 9844))?.map(c => c.name)).toEqual([
            'Taverley Dungeon ladder',
            'Trapdoor, Dwarven Mine entrance',
        ]);
    });

    test('the Edgeville Dungeon is the trapdoor down from Edgeville, and its ladder the way out', () => {
        const down = planConnectors(at(0, 3094, 3490), at(0, 3108, 9835));
        expect(names(down)).toEqual(['down Edgeville Dungeon trapdoor']);
        expect(down?.[0]?.loc).toEqual(at(0, 3097, 3468));
        // Inside the house, west of the trapdoor.
        expect(down?.[0]?.stand).toEqual(at(0, 3096, 3468));
        expect(down?.[0]?.to).toEqual(at(0, 3096, 9868));
        const up = planConnectors(at(0, 3108, 9835), at(0, 3094, 3490));
        expect(names(up)).toEqual(['up Edgeville Dungeon trapdoor']);
        expect(up?.[0]?.stand).toEqual(at(0, 3096, 9868));
        expect(up?.[0]?.to).toEqual(at(0, 3096, 3468));
        // From the Dwarven Mine: out by its north ladder, then down the trapdoor.
        expect(planConnectors(at(0, 3058, 9780), at(0, 3108, 9835))?.map(c => `${c.direction} ${show(c.loc)}`)).toEqual(
            ['up 0:3019,9850', 'down 0:3097,3468'],
        );
        // The ladder's landing reaches the hill giants in the real collision data.
        const walk = collisionPaths.findPath({ level: 0, x: 3097, z: 9868 }, { x: 3108, z: 9835 }, []);
        expect(walk.success && walk.reachedDestination).toBe(true);
    });

    test("the dungeon's ladder into the brass-key house is never a way out (edgeville_dungeon.rs2:6)", () => {
        // The house's door opens only to the key used on it, from inside too, and a walk uses no item on a door:
        // the ladder up would leave the bot shut in, key or not.
        const varrock = at(0, 3185, 3436);
        expect(names(planConnectors(at(0, 3108, 9835), varrock))).toEqual(['up Edgeville Dungeon trapdoor']);
        const key = { levels: {}, coins: 0, met: new Set(['item:edgevilledungeonkey:held']) };
        expect(names(planConnectors(at(0, 3108, 9835), varrock, CONNECTORS, key))).toEqual([
            'up Edgeville Dungeon trapdoor',
        ]);
    });

    test('an underground area no table row leads to is no-connector (null), not an empty chain', () => {
        expect(planConnectors(at(0, 3058, 9780), at(0, 3237, 9858))).toBeNull();
    });

    test('the mine stairs and the tower top floor carry a hazard note, in both directions', () => {
        for (const c of CONNECTORS.filter(k => k.name === 'Falador mine stairs'))
            expect(c.hazard, c.direction).toMatch(/scorpion/);
        const top = CONNECTORS.filter(k => k.loc.level === 2 || k.to.level === 2).filter(k => k.name.startsWith('Wiz'));
        expect(top.length).toBe(2);
        for (const c of top) expect(c.hazard).toMatch(/lesser demon/);
        expect(CONNECTORS.find(k => k.name === 'Lumbridge castle stairs')?.hazard).toBeUndefined();
    });
});

/**
 * Rows with no way back near their landing: one-way in the scripts, or back by a row the table leaves out (the
 * Mining Guild's ladders come back down by its gated ladder, a gate jump). As `<direction> <loc>`.
 */
const ONE_WAY = [
    'up 1:2370,3133',
    'up 1:2429,3074',
    'down 1:2544,3111',
    'down 1:2631,3322',
    'up 1:2668,3428',
    'down 1:2784,3286',
    'up 0:2848,3235',
    'down 1:2928,4711',
    'down 1:2937,3240',
    'down 2:2940,3240',
    'up 1:2962,3394',
    'up 1:2969,3394',
    'down 1:3013,3244',
    'up 0:3018,9739',
    'up 0:3019,9738',
    'up 0:3019,9740',
    'up 0:3020,9739',
    'down 1:3046,3483',
    'up 0:3049,3208',
    'down 1:3057,3483',
    'down 1:3187,3414',
];

describe('the table against the collision data', () => {
    test('every stand tile and landing is walkable, on the plane of its loc or landing', () => {
        for (const c of CONNECTORS) {
            const label = `${c.name} ${c.direction} (${c.loc.x}, ${c.loc.z})`;
            expect(planeOf(c.stand.level, c.stand.x, c.stand.z), label).toBe(planeOf(c.loc.level, c.loc.x, c.loc.z));
            expect(collisionPaths.walkable(c.stand.level, c.stand.x, c.stand.z), `${label}: stand`).toBe(true);
            expect(collisionPaths.walkable(c.to.level, c.to.x, c.to.z), `${label}: landing`).toBe(true);
        }
    });

    test("every connector but the listed one-way ones has a way back, landing on the other side's stand tile or a walk from it", () => {
        const noWayBack = CONNECTORS.filter(
            c =>
                !CONNECTORS.some(
                    k =>
                        k.direction !== c.direction &&
                        k.loc.level === c.to.level &&
                        planeOf(k.loc.level, k.loc.x, k.loc.z) === planeOf(c.to.level, c.to.x, c.to.z) &&
                        Math.max(Math.abs(k.loc.x - c.to.x), Math.abs(k.loc.z - c.to.z)) <= 30 &&
                        reaches(c.to, k.stand) &&
                        reaches(k.to, c.stand),
                ),
        );
        expect(noWayBack.map(c => `${c.direction} ${show(c.loc)}`)).toEqual(ONE_WAY);
    });

    test("the landing of each connector reaches the next one's stand tile, in the real collision data", () => {
        // The mine: from the landing under Falador to Nurmof's shop (2998, 9844).
        const r = collisionPaths.findPath({ level: 0, x: 3058, z: 9776 }, { x: 2998, z: 9844 }, []);
        expect(r.success && r.reachedDestination).toBe(true);
        // The Taverley Dungeon: from the ladder's landing to the cauldron room.
        const dungeon = collisionPaths.findPath({ level: 0, x: 2885, z: 9797 }, { x: 2890, z: 9830 }, []);
        expect(dungeon.success && dungeon.reachedDestination).toBe(true);
        // Lumbridge castle's first floor from the landing to the north end.
        const up = collisionPaths.findPath({ level: 1, x: 3205, z: 3209 }, { x: 3205, z: 3228 }, []);
        expect(up.success && up.reachedDestination).toBe(true);
    });

    test('the table and the world it is read from are the same file', () => {
        expect(CONNECTORS.length + LEFT_OUT.length).toBeLessThanOrEqual(WORLD.connectors.length);
    });
});

describe("Seers' Village spinning house", () => {
    test('the wheel on the first floor is one ladder up from the bank, and the way back is the ladder down', () => {
        const up = planConnectors(at(0, 2727, 3493), at(1, 2712, 3471));
        expect(names(up)).toEqual(["up Seers' Village spinning house ladder"]);
        expect(up?.[0]?.stand).toEqual(at(0, 2714, 3470));
        expect(up?.[0]?.to).toEqual(at(1, 2714, 3470));
        expect(names(planConnectors(at(1, 2712, 3471), at(0, 2727, 3493)))).toEqual([
            "down Seers' Village spinning house ladder",
        ]);
    });

    test('the landing reaches the wheel, and the ground stand reaches the bank, in the collision data', () => {
        expect(collisionPaths.findPath(at(1, 2714, 3470), at(1, 2712, 3471), []).reachedDestination).toBe(true);
        expect(collisionPaths.findPath(at(0, 2714, 3470), at(0, 2727, 3493), []).reachedDestination).toBe(true);
    });
});
