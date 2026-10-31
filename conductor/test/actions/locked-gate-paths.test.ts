import { describe, expect, test } from 'bun:test';
import { initPathfinding } from '../../../sdk/pathfinding';
import { collisionPaths } from '../../actions/paths';

// McGrubor's Wood south gate (2649..2650, 3469) is locked from both sides (areas/area_seers/scripts/mcgrubors_wood.rs2:1-8),
// so sdk/pathfinding.ts ONE_WAY_DOORS keeps its wall and no route crosses it. The wood is entered by the Loose Railing
// (2662,3500), a crossing the walker makes, not by this gate.
const at = (x: number, z: number) => ({ x, z, level: 0 });
const through = (waypoints: readonly { x: number; z: number }[]) =>
    waypoints.some(w => (w.x === 2649 || w.x === 2650) && w.z === 3469);

describe("McGrubor's Wood south gate", () => {
    test('the gate tiles are not known as doors', () => {
        initPathfinding();
        for (const x of [2649, 2650]) expect(collisionPaths.doorAt(0, x, 3469), `x ${x}`).toBeUndefined();
    });

    test('no route from the south side to the vines passes the gate', () => {
        const r = collisionPaths.findPath(at(2650, 3465), { x: 2630, z: 3495 }, []);
        expect(r.reachedDestination).not.toBe(true);
        expect(through(r.waypoints)).toBe(false);
    });

    test('no route from inside the wood out passes the gate', () => {
        const r = collisionPaths.findPath(at(2630, 3495), { x: 2650, z: 3465 }, []);
        expect(r.reachedDestination).not.toBe(true);
        expect(through(r.waypoints)).toBe(false);
        const toGate = collisionPaths.findPath(at(2650, 3472), { x: 2650, z: 3466 }, []);
        expect(toGate.reachedDestination).not.toBe(true);
    });
});
