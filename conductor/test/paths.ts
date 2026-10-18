// Pathfinders for unit tests, in place of the SDK's collision data (actions/paths.ts): no 23 MB load,
// and routes a test chooses.
import { reachCollision } from '../../wiki/world/collision';
import { locSizes } from '../../wiki/world/place';
import { readConfigs } from '../../wiki/world/sources/configs';
import { Grid } from '../../wiki/world/test/grid';
import type { DoorInfo, Pathfinder, PathResult, Waypoint } from '../actions/paths';
import { CONNECTORS } from '../lib/connectors';
import { walkGraph, type WalkWorld } from '../lib/walk-graph';
import { WORLD } from '../lib/world-index';

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

let offMap: WalkWorld | undefined;
/**
 * A walk world (ActionContext.walkWorld) with nothing on the map a test's tiles are on: a walk plans no hop and is
 * walked on its plane, by the test's own routes, for a scripted world the world index's crossings would not match.
 */
export const noCrossings = (): WalkWorld =>
    (offMap ??= {
        graph: walkGraph({
            world: { features: [], connectors: [], gates: [], transports: [], crossings: [] },
            collision: new Grid(),
            size: locSizes(new Map()),
            opName: () => undefined,
        }),
        connectors: [],
        banks: [],
    });

let connectorsOnly: WalkWorld | undefined;
/**
 * The world index's walk world with its connectors and doors and none of its moves (crossing rows, gate jumps):
 * for a test of climbs whose scripted world has none of the stiles and shortcuts the index plans through on the way.
 */
export function onlyConnectors(): WalkWorld {
    if (connectorsOnly) return connectorsOnly;
    const configs = readConfigs('loc');
    return (connectorsOnly = {
        graph: walkGraph({
            world: { ...WORLD, crossings: [], gates: WORLD.gates.filter(g => !g.to && !g.landings && !g.opens) },
            collision: reachCollision,
            size: locSizes(configs),
            opName: (loc, op) => configs.get(loc)?.[`op${op}`]?.[0],
        }),
        connectors: CONNECTORS,
        banks: [],
    });
}
