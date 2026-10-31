import { describe, expect, test } from 'bun:test';
import { collisionPaths } from '../../actions/paths';

// The real collision data, Varrock lumber yard: a NPC on (3307, 3507), straight north of the bot.
const FROM = { x: 3307, z: 3506, level: 0 };
const TO = { x: 3309, z: 3509 };
const CRATE = { x: 3307, z: 3507 };

/** Every tile a route's legs pass, stepping diagonally first as the engine's walk does. */
function tilesOf(from: { x: number; z: number }, wps: { x: number; z: number }[]) {
    const out: string[] = [];
    let at = from;
    for (const wp of wps) {
        while (at.x !== wp.x || at.z !== wp.z) {
            at = { x: at.x + Math.sign(wp.x - at.x), z: at.z + Math.sign(wp.z - at.z) };
            out.push(`${at.x},${at.z}`);
        }
    }
    return out;
}

describe('collisionPaths.findPath: occupied tiles', () => {
    test('a route avoids an occupied tile, and the tile is open again afterwards', () => {
        const plain = collisionPaths.findPath(FROM, TO, []);
        expect(plain.reachedDestination).toBe(true);
        expect(tilesOf(FROM, plain.waypoints)).toContain('3307,3507');
        const round = collisionPaths.findPath(FROM, TO, [], [CRATE]);
        expect(round.reachedDestination).toBe(true);
        expect(tilesOf(FROM, round.waypoints)).not.toContain('3307,3507');
        expect(collisionPaths.walkable(0, CRATE.x, CRATE.z)).toBe(true);
    });

    test('the start and destination tiles are never walled', () => {
        const r = collisionPaths.findPath(FROM, TO, [], [FROM, TO]);
        expect(r.reachedDestination).toBe(true);
    });
});

describe('collisionPaths.findPath: the map is left as found', () => {
    test('a wall tile and a tile in an unallocated zone are not changed by an occupied query', () => {
        const wall = { x: 3305, z: 3493 };
        const far = { x: 3000, z: 2000 };
        const before = [wall, far].map(t => collisionPaths.walkable(0, t.x, t.z));
        collisionPaths.findPath(FROM, TO, [], [wall, far, CRATE, CRATE]);
        expect([wall, far].map(t => collisionPaths.walkable(0, t.x, t.z))).toEqual(before);
        expect(collisionPaths.walkable(0, CRATE.x, CRATE.z)).toBe(true);
    });
});
