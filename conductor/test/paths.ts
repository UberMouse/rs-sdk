// Pathfinders for unit tests, in place of the SDK's collision data (actions/paths.ts): no 23 MB load,
// and routes a test chooses.
import type { DoorInfo, Pathfinder, PathResult, Waypoint } from '../actions/paths';

export type Router = (from: Waypoint, to: { x: number; z: number }, avoid: readonly DoorInfo[]) => PathResult;

export interface FakePaths extends Pathfinder {
    /** Every findPath call, in order. */
    readonly queries: { from: Waypoint; to: { x: number; z: number }; avoid: DoorInfo[] }[];
}

/** A door the collision data would know, on level 0 by default. */
export const door = (x: number, z: number, level = 0): DoorInfo => ({
    level,
    x,
    z,
    shape: 0,
    angle: 0,
    blockrange: false,
});

/**
 * Routes from `router`, with `doors` as the doors it knows: one on a waypoint's tile or a cardinal
 * neighbour is along the route, as sdk/pathfinding.ts finds them. Every tile is walkable unless
 * `blocked` says otherwise.
 */
export function fakePaths(
    router: Router,
    doors: DoorInfo[] = [],
    blocked: (x: number, z: number) => boolean = () => false,
    /** True when a one-tile step from (x, z) by (dx, dz) is cut by a wall on the edge. */
    cutEdge: (x: number, z: number, dx: number, dz: number) => boolean = () => false,
): FakePaths {
    const queries: FakePaths['queries'] = [];
    const at = (level: number, x: number, z: number) => doors.find(d => d.level === level && d.x === x && d.z === z);
    return {
        queries,
        findPath(from, to, avoid) {
            queries.push({ from, to, avoid: [...avoid] });
            return router(from, to, avoid);
        },
        doorsAlong(waypoints) {
            const found: DoorInfo[] = [];
            for (const wp of waypoints)
                for (const [dx, dz] of [
                    [0, 0],
                    [0, 1],
                    [0, -1],
                    [1, 0],
                    [-1, 0],
                ] as const) {
                    const d = at(wp.level, wp.x + dx, wp.z + dz);
                    if (d && !found.includes(d)) found.push(d);
                }
            return found;
        },
        doorAt: at,
        walkable: (_level, x, z) => !blocked(x, z),
        canStep: (_level, x, z, dx, dz) => !blocked(x + dx, z + dz) && !cutEdge(x, z, dx, dz),
    };
}

/** Open ground: one straight leg to the destination. */
export const straightPaths = (): FakePaths =>
    fakePaths((from, to) => ({ success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] }));
