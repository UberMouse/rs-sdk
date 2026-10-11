import { describe, expect, test } from 'bun:test';
import { collisionPaths, EXTRA_DOORS } from '../../actions/paths';

// The real collision data (a half-second to index).
describe('collisionPaths: doors the data lacks', () => {
    const door = EXTRA_DOORS[0]!;

    test("a route into the Wizards' Tower stairs room exists and passes its door", () => {
        const from = { x: 3107, z: 3164, level: 0 };
        const r = collisionPaths.findPath(from, { x: 3105, z: 3162 }, []);
        expect(r.success).toBe(true);
        expect(r.reachedDestination).toBe(true);
        expect(collisionPaths.doorsAlong(r.waypoints)).toContainEqual(door);
    });

    test('the door is known by its tile', () => {
        expect(collisionPaths.doorAt(0, door.x, door.z)).toEqual(door);
    });

    test('a door the walk gave up on shuts the room again for that query only', () => {
        const from = { x: 3107, z: 3164, level: 0 };
        const shut = collisionPaths.findPath(from, { x: 3105, z: 3162 }, [door]);
        expect(shut.reachedDestination).toBeFalsy();
        const open = collisionPaths.findPath(from, { x: 3105, z: 3162 }, []);
        expect(open.reachedDestination).toBe(true);
    });
});
