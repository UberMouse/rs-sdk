import { describe, expect, test } from 'bun:test';
import { parseMapSquare } from '../sources/maps';

const square = `==== MAP ====
1 5 6: h16 o5 f2
1 7 7: h16
==== LOC ====
1 5 6: 2213 10 1
1 7 7: 2213 10
0 1 2: 1276 10 3
0 5 6: 9999 10 0
==== NPC ====
1 5 6: 494
0 3 4: 1036
`;

describe('parseMapSquare', () => {
    const { locs, npcs } = parseMapSquare(54, 54, square);

    test('world coordinates from the square and local tile', () => {
        expect(locs).toContainEqual({ id: 1276, shape: 10, rotation: 3, tile: { level: 0, x: 3457, z: 3458 } });
        expect(npcs).toContainEqual({ id: 1036, tile: { level: 0, x: 3459, z: 3460 } });
    });

    test('a loc on a bridged column drops one level; one on an unbridged column does not', () => {
        expect(locs).toContainEqual({ id: 2213, shape: 10, rotation: 1, tile: { level: 0, x: 3461, z: 3462 } });
        expect(locs).toContainEqual({ id: 2213, shape: 10, rotation: 0, tile: { level: 1, x: 3463, z: 3463 } });
    });

    test('a level-0 loc on a bridged column is dropped (GameMap.loadLocations skips level < 0)', () => {
        expect(locs.find(l => l.id === 9999)).toBeUndefined();
        expect(locs).toHaveLength(3);
    });

    test('npc spawns keep their level on a bridged column (GameMap.loadNpcs)', () => {
        expect(npcs).toContainEqual({ id: 494, tile: { level: 1, x: 3461, z: 3462 } });
    });
});
