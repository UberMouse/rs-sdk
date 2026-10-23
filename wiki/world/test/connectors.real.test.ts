// Facts about the real connectors (sources/connectors.ts), checked against one in-memory build of the
// game data. conductor/lib/connectors.ts is a view of these rows; its curated names and hazards (OVERRIDES) are on
// connectors whose way back the build report must find.
import { describe, expect, test } from 'bun:test';
import { OVERRIDES } from '../../../conductor/lib/connectors';
import { AREAS } from '../areas';
import { buildWorld } from '../build';
import { reachCollision, siteCollision } from '../collision';
import type { Connector, Tile } from '../types';

// Built when the file loads, where no timeout applies (as world.real.test.ts does).
const { world, report } = buildWorld({ generatedFrom: 'test', areas: AREAS, collision: reachCollision });

const same = (a: Tile, b: Tile): boolean => a.level === b.level && a.x === b.x && a.z === b.z;
const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const show = (t: Tile): string => `(${t.x}, ${t.z})${t.level ? ` L${t.level}` : ''}`;
const rowsAt = (t: Tile): Connector[] => world.connectors.filter(c => same(c.loc, t));
/** A row as `op<n> <direction> <landing> from <stand>`, with ` relative` for a jump from the player's tile. */
const line = (c: Connector): string =>
    `op${c.op} ${c.direction} ${show(c.landing)} from ${c.stand ? show(c.stand) : '-'}${c.relative ? ' relative' : ''}`;
const onLand = (t: Tile): boolean => siteCollision.land(t.level, t.x, t.z) && siteCollision.walkable(t.level, t.x, t.z);

describe('the Edgeville Dungeon trapdoor', () => {
    test("lands where its script moves the player's own tile (the curated table had (3097, 9868))", () => {
        // trapdoors.rs2:11 moves the player's own tile 6400 north and the trapdoor is reached from (3096, 3468) only.
        expect(rowsAt({ level: 0, x: 3097, z: 3468 }).map(line)).toEqual([
            'op1 down (3096, 9868) from (3096, 3468) relative',
        ]);
    });
});

describe('the three script forms on real data', () => {
    test("an explicit table: Taverley, Sanfew's house stairs (stairs.rs2 `0_45_53_18_36`, `1_45_53_18_36`)", () => {
        expect(rowsAt({ level: 0, x: 2898, z: 3428 }).map(line)).toEqual(['op1 up (2898, 3427) L1 from (2897, 3428)']);
        expect(rowsAt({ level: 1, x: 2898, z: 3428 }).map(line)).toEqual([
            'op1 down (2897, 3428) from (2898, 3427) L1',
        ]);
    });

    test("a label called with coords: Lumbridge castle's middle floor, Climb asking up or down (@stair_options)", () => {
        expect(rowsAt({ level: 1, x: 3204, z: 3207 }).map(c => `${c.opName} ${line(c)}`)).toEqual([
            'Climb op1 down (3205, 3209) from (3205, 3209) L1',
            'Climb op1 up (3205, 3209) L2 from (3205, 3209) L1',
            'Climb-up op2 up (3205, 3209) L2 from (3205, 3209) L1',
            'Climb-down op3 down (3205, 3209) from (3205, 3209) L1',
        ]);
    });

    test("a jump from the player: the Taverley Dungeon ladders shift the player, each landing on the other ladder's stand", () => {
        // ladder_cellar_inside_down has forceapproach=east (its config in _unpack/225/all.loc), so it is
        // used from (2885, 3397) only, and ladders.rs2 moves that tile 6400 north: (2885, 9797).
        expect(rowsAt({ level: 0, x: 2884, z: 3397 }).map(line)).toEqual([
            'op1 down (2885, 9797) from (2885, 3397) relative',
        ]);
        expect(rowsAt({ level: 0, x: 2884, z: 9797 }).map(line)).toEqual([
            'op1 up (2885, 3397) from (2885, 9797) relative',
        ]);
    });

    test('a jump from the loc by its angle: Tree Gnome Stronghold wooden stairs at angle 0 (stairs.rs2 switch_int)', () => {
        expect(rowsAt({ level: 0, x: 2376, z: 3489 }).map(line)).toEqual(['op1 up (2378, 3489) L1 from (2377, 3488)']);
    });

    test('one loc picked out by `if (loc_coord = ...)`: the Zanaris entrance-room ladder (ladders.rs2:90)', () => {
        const [c, ...rest] = rowsAt({ level: 0, x: 3222, z: 9588 });
        expect(rest).toEqual([]);
        expect(line(c!)).toBe('op1 up (3201, 3169) from (3221, 9588)');
        expect(c!.source).toBe('ladders+stairs/scripts/ladders.rs2:91');
    });

    test("a quest's label: the Dwarf Cannon guard tower ladder climbs once the quest allows it", () => {
        expect(rowsAt({ level: 0, x: 2570, z: 3441 }).map(line)).toEqual([
            'op1 up (2569, 3441) L1 from (2569, 3441) relative',
        ]);
    });
});

describe('trapdoors and manholes (general_use/scripts/trapdoors.rs2, manholes.rs2)', () => {
    // Per config: op, op name, the swapped-in loc's op that moves the player, and the line of that move.
    const EXPECTED: Record<string, [number, string, Connector['thenOp'], string]> = {
        trapdoor: [1, 'Open', { op: 1, opName: 'Climb-down' }, 'general_use/scripts/trapdoors.rs2:11'],
        trapdoor_open: [1, 'Climb-down', undefined, 'general_use/scripts/trapdoors.rs2:11'],
        // manholeopen's op1 is named `Climb down` in its config.
        manholeclosed: [1, 'Open', { op: 1, opName: 'Climb down' }, 'general_use/scripts/manholes.rs2:10'],
    };

    test("every placed one has a row or an underived op: Open is followed to the open loc's climb", () => {
        const configs = new Set(['trapdoor', 'trapdoor_open', 'manholeclosed', 'manholeopen', 'loc_883']);
        const placed = world.features.flatMap((f, i) => (configs.has(f.config) ? [{ f, i }] : []));
        expect(placed.map(({ f }) => f.config).sort()).toEqual([
            'manholeclosed',
            'manholeclosed',
            ...Array<string>(9).fill('trapdoor'),
            'trapdoor_open',
        ]);
        const underived = Object.values(report.connectors.underived).flat();
        for (const { f, i } of placed) {
            expect(f.kind).toBe('connector');
            const rows = world.connectors.filter(c => c.feature === i);
            expect(
                rows.length + underived.filter(l => l.startsWith(`${f.config} ${show(f.tile)} op`)).length,
            ).toBeGreaterThan(0);
            for (const c of rows) expect([c.op, c.opName, c.thenOp, c.source]).toEqual(EXPECTED[f.config]!);
        }
    });

    test('the Varrock Sewers manhole: Open, then Climb down, lands its stand + 6400; the sewer ladder comes back', () => {
        const [c, ...rest] = rowsAt({ level: 0, x: 3237, z: 3458 });
        expect(rest).toEqual([]);
        expect([c!.opName, c!.thenOp, c!.direction, c!.relative]).toEqual([
            'Open',
            { op: 1, opName: 'Climb down' },
            'down',
            true,
        ]);
        expect(c!.stand !== null && cheb(c!.stand, { level: 0, x: 3237, z: 3459 }) <= 1).toBe(true);
        expect(c!.landing).toEqual({ ...c!.stand!, z: c!.stand!.z + 6400 });
        expect(rowsAt({ level: 0, x: 3237, z: 9858 }).map(line)).toEqual([
            'op1 up (3236, 3458) from (3236, 9858) relative',
        ]);
        for (const l of report.connectors.oneWay) expect(l).not.toMatch(/ \((3237, 3458|3237, 9858)\) op/);
    });
});

describe('every row', () => {
    test('is a connector feature at its loc tile, with a stand on land beside it and its script line', () => {
        for (const c of world.connectors) {
            const f = world.features[c.feature]!;
            expect([f.kind, show(f.tile)]).toEqual(['connector', show(c.loc)]);
            expect(c.stand === null || (onLand(c.stand) && c.stand.level === c.loc.level)).toBe(true);
            expect(c.source).toMatch(/^[\w+/]+\.rs2:\d+$/);
        }
    });

    test('lands on walkable land, but the two climbs the scripts send to level 4 and one upstairs trapdoor', () => {
        // laddermiddle (2492, 9864) on level 3 runs ladders.rs2's Climb-up (movecoord(coord(), 0, 1, 0)) like
        // any other: there is no level 4. The trapdoor at (3278, 3434) on level 2 runs trapdoors.rs2's
        // Climb-down (movecoord(coord(), 0, 0, 6400)) like any other: 6400 north on level 2 is no land.
        expect(world.connectors.filter(c => !onLand(c.landing)).map(c => `${show(c.loc)} ${line(c)}`)).toEqual([
            '(2492, 9864) L3 op1 up (2491, 9864) L4 from (2491, 9864) L3 relative',
            '(2492, 9864) L3 op2 up (2491, 9864) L4 from (2491, 9864) L3 relative',
            '(3278, 3434) L2 op1 down (3277, 9834) L2 from (3277, 3434) L2 relative',
        ]);
        expect(report.connectors.offLand).toHaveLength(3);
    });

    test('a mainland-fill zone (open for the pathfinder) is not land', () => {
        expect(siteCollision.walkable(0, 2304, 2944)).toBe(true);
        expect(siteCollision.land(0, 2304, 2944)).toBe(false);
    });
});

describe('the build report', () => {
    test('has a way back for every curated connector', () => {
        // Glarial's tomb ladder is curated for its name but genuinely one-way: the tomb is entered by using Glarial's
        // pebble on the tombstone (oplocu glarials_tombstone_waterfall_quest, quest_waterfall.rs2:103), an item-on-loc
        // move that is no connector row.
        const ONE_WAY_BY_DESIGN = new Set(['0,2556,9844']);
        const locs = [...OVERRIDES.keys()]
            .filter(k => !ONE_WAY_BY_DESIGN.has(k.split(' ')[0]!))
            .map(k => {
                const [level, x, z] = k.split(' ')[0]!.split(',').map(Number);
                return show({ level: level!, x: x!, z: z! });
            });
        const curated = report.connectors.oneWay.filter(l => locs.some(loc => l.includes(` ${loc} op`)));
        expect(curated).toEqual([]);
    });

    test("pairs Lumbridge castle cellar's ladder with the kitchen trapdoor, its way down", () => {
        // ladder_from_cellar (3209, 9616) climbs to (3208, 3216), beside the trapdoor (loc 1568 at (3209, 3216));
        // the trapdoor's Open, then its open loc's Climb-down, moves that tile 6400 north (trapdoors.rs2:11).
        expect(rowsAt({ level: 0, x: 3209, z: 9616 }).map(line)).toEqual([
            'op1 up (3208, 3216) from (3208, 9616) relative',
        ]);
        const down = rowsAt({ level: 0, x: 3209, z: 3216 });
        expect(down.map(c => `${c.opName} then ${c.thenOp?.opName} ${line(c)}`)).toEqual([
            'Open then Climb-down op1 down (3208, 9616) from (3208, 3216) relative',
        ]);
        expect(down[0]!.source).toBe('general_use/scripts/trapdoors.rs2:11');
        for (const l of report.connectors.oneWay) expect(l).not.toMatch(/ \((3209, 9616|3209, 3216)\) op/);
    });

    test('lists a connector whose way back is no connector as one-way, with its script line', () => {
        // The trapdoors upstairs drop the player 6400 north on their own level, where no ladder comes back.
        expect(report.connectors.oneWay).toContain(
            'trapdoor (3206, 3371) L2 op1 Open -> (3205, 9771) L2 (general_use/scripts/trapdoors.rs2:11)',
        );
        for (const l of report.connectors.oneWay)
            expect(l).toMatch(
                /\((ladders\+stairs\/scripts\/\w+|general_use\/scripts\/(trapdoors|manholes))\.rs2:\d+\)$/,
            );
    });

    test('names the construct and script line that stopped each underived op', () => {
        const { underived } = report.connectors;
        for (const reason of Object.keys(underived))
            expect(reason).toMatch(
                /\((ladders\+stairs\/scripts\/\w+|general_use\/scripts\/(trapdoors|manholes))\.rs2:\d+\)/,
            );
        // Two board-game staircases jump to a random tile; seven locs sit on tiles their switch has no case for.
        const random = Object.entries(underived).filter(([r]) => r.includes('$randomX is not known offline'));
        const noCase = Object.entries(underived).filter(([r]) => r.includes('has no case for it'));
        expect(random.flatMap(([, locs]) => locs).sort()).toEqual([
            'board_game_stairs_grey_all (2899, 3566) op1',
            'board_game_stairs_grey_base2 (2205, 4935) L1 op1',
        ]);
        expect(noCase.flatMap(([, locs]) => locs).sort()).toEqual([
            'spiralstairs (3202, 3472) L2 op1',
            'spiralstairsmiddle (3092, 3104) L1 op1',
            'spiralstairsmiddle (3092, 3104) L1 op2',
            'spiralstairsmiddle (3092, 3104) L1 op3',
            'spiralstairstop (3093, 3105) L2 op1',
            'spiralstairstop (3203, 3472) L3 op1',
            'stairstop (3060, 9776) L1 op1',
        ]);
        // A placed open trapdoor's Close swaps it back, and the closed one's own op only opens it.
        const close = Object.entries(underived).filter(([r]) => r.includes('turns it into trapdoor,'));
        expect(close).toEqual([
            [
                '`loc_change(trapdoor, 500)` (general_use/scripts/trapdoors.rs2:17) turns it into trapdoor, none of whose ops moves the player',
                ['trapdoor_open (3019, 3450) op2'],
            ],
        ]);
        expect(random.length + noCase.length + close.length).toBe(Object.keys(underived).length);
    });
});
