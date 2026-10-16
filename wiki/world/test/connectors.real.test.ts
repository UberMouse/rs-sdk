// Facts about the real connectors (sources/connectors.ts), checked against one in-memory build of the
// game data, and the curated table the conductor walks by, row by row.
import { describe, expect, test } from 'bun:test';
import { CONNECTORS } from '../../../conductor/lib/connectors';
import { AREAS } from '../areas';
import { buildWorld } from '../build';
import { siteCollision } from '../collision';
import type { Connector, Tile } from '../types';

// Built when the file loads, where no timeout applies (as world.real.test.ts does).
const { world, report } = buildWorld({ generatedFrom: 'test', areas: AREAS, collision: siteCollision });

const same = (a: Tile, b: Tile): boolean => a.level === b.level && a.x === b.x && a.z === b.z;
const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const show = (t: Tile): string => `(${t.x}, ${t.z})${t.level ? ` L${t.level}` : ''}`;
const rowsAt = (t: Tile): Connector[] => world.connectors.filter(c => same(c.loc, t));
/** A row as `op<n> <direction> <landing> from <stand>`, with ` relative` for a jump from the player's tile. */
const line = (c: Connector): string =>
    `op${c.op} ${c.direction} ${show(c.landing)} from ${c.stand ? show(c.stand) : '-'}${c.relative ? ' relative' : ''}`;
const onLand = (t: Tile): boolean => siteCollision.land(t.level, t.x, t.z) && siteCollision.walkable(t.level, t.x, t.z);

describe('conductor/lib/connectors.ts is reproduced: loc tile and landing exact, stand within 1 tile', () => {
    for (const [i, row] of CONNECTORS.entries())
        test(`${i}: ${row.direction} ${row.name} at ${show(row.loc)}`, () => {
            const derived = rowsAt(row.loc).filter(c => c.direction === row.direction);
            expect(derived.map(c => show(c.landing))).toContain(show(row.to));
            const stands = derived.filter(c => same(c.landing, row.to)).map(c => c.stand);
            expect(stands.some(s => s !== null && s.level === row.stand.level && cheb(s, row.stand) <= 1)).toBe(true);
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

describe('every row', () => {
    test('is a connector feature at its loc tile, with a stand on land beside it and its script line', () => {
        for (const c of world.connectors) {
            const f = world.features[c.feature]!;
            expect([f.kind, show(f.tile)]).toEqual(['connector', show(c.loc)]);
            expect(c.stand === null || (onLand(c.stand) && c.stand.level === c.loc.level)).toBe(true);
            expect(c.source).toMatch(/^[\w+/]+\.rs2:\d+$/);
        }
    });

    test('lands on walkable land, but the two climbs the scripts send to level 4', () => {
        // laddermiddle (2492, 9864) on level 3 runs ladders.rs2's Climb-up (movecoord(coord(), 0, 1, 0)) like
        // any other: there is no level 4.
        expect(world.connectors.filter(c => !onLand(c.landing)).map(c => `${show(c.loc)} ${line(c)}`)).toEqual([
            '(2492, 9864) L3 op1 up (2491, 9864) L4 from (2491, 9864) L3 relative',
            '(2492, 9864) L3 op2 up (2491, 9864) L4 from (2491, 9864) L3 relative',
        ]);
        expect(report.connectors.offLand).toHaveLength(2);
    });

    test('a mainland-fill zone (open for the pathfinder) is not land', () => {
        expect(siteCollision.walkable(0, 2304, 2944)).toBe(true);
        expect(siteCollision.land(0, 2304, 2944)).toBe(false);
    });
});

describe('the build report', () => {
    test('has a way back for every curated connector', () => {
        const curated = report.connectors.oneWay.filter(l => CONNECTORS.some(r => l.includes(` ${show(r.loc)} op`)));
        expect(curated).toEqual([]);
    });

    test("lists a connector whose way back is no connector as one-way, with its script: Lumbridge castle cellar's ladder", () => {
        // The way down is the kitchen trapdoor (loc 1568 at (3209, 3216)), general_use/scripts/trapdoors.rs2.
        expect(report.connectors.oneWay).toContain(
            'ladder_from_cellar (3209, 9616) op1 Climb-up -> (3208, 3216) (ladders+stairs/scripts/ladders.rs2:94)',
        );
        for (const l of report.connectors.oneWay) expect(l).toMatch(/\(ladders\+stairs\/scripts\/\w+\.rs2:\d+\)$/);
    });

    test('names the construct and script line that stopped each underived op', () => {
        const { underived } = report.connectors;
        for (const reason of Object.keys(underived))
            expect(reason).toMatch(/\(ladders\+stairs\/scripts\/\w+\.rs2:\d+\)/);
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
        expect(random.length + noCase.length).toBe(Object.keys(underived).length);
    });
});
