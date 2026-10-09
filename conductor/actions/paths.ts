// Ported from sdk/index.ts findPath @ ca34325e7, over sdk/pathfinding.ts @ d80066c78.
// The routes the walkTo op plans with. sdk.findPath reads the player from the SDK's state and the doors
// to avoid from the SDK session; here both are arguments, so the op passes its own state and the doors
// it has given up on, and a test passes a Pathfinder of its own instead of the collision data.
// sdk/pathfinding.ts imports that data (23 MB of JSON) statically, so it parses when this module is
// first imported; the collision index and door index build on the first query (about half a second).
// The import stays static: the Pathfinder is synchronous, and every live run imports pathfinding.ts
// through the BotSDK (sdk/index.ts) anyway.
import {
    type DoorInfo,
    findDoorsAlongPath,
    findLongPath,
    getDoorAt,
    initPathfinding,
    isTileWalkable,
    isZoneAllocated,
} from '../../sdk/pathfinding';

export type { DoorInfo };
export type Waypoint = { x: number; z: number; level: number };

/** As sdk.findPath answers: `reachedDestination` false is a partial route that stops short. */
export interface PathResult {
    success: boolean;
    waypoints: Waypoint[];
    reachedDestination?: boolean;
    error?: string;
}

export interface Pathfinder {
    /** A route from `from` to `to` on `from.level`, routing around the doors in `avoid`. */
    findPath(from: Waypoint, to: { x: number; z: number }, avoid: readonly DoorInfo[]): PathResult;
    /** The doors a route crosses or steps beside, in route order. */
    doorsAlong(waypoints: readonly Waypoint[]): DoorInfo[];
    /** The door the collision data knows at that tile. */
    doorAt(level: number, x: number, z: number): DoorInfo | undefined;
    /** No wall or loc blocks the tile. */
    walkable(level: number, x: number, z: number): boolean;
}

/** sdk.findPath's default waypoint cap. */
const MAX_WAYPOINTS = 500;
/**
 * A partial route ending further than this (Manhattan) from the destination is a destination on
 * another plane (underground areas share level 0 at z + 6400), not one just past a gate (10-20 tiles).
 */
const OTHER_PLANE_TILES = 100;

/** Routes over the collision data bundled with the SDK, indexed on the first query. */
export const collisionPaths: Pathfinder = {
    findPath(from, to, avoid) {
        // Only the source zone must be known; the destination's may be past a gate not yet opened.
        if (!isZoneAllocated(from.level, from.x, from.z))
            return {
                success: false,
                waypoints: [],
                error: 'Source zone not allocated (no collision data for current position)',
            };
        const waypoints = findLongPath(from.level, from.x, from.z, to.x, to.z, MAX_WAYPOINTS, avoid);
        if (waypoints.length === 0 && !isZoneAllocated(from.level, to.x, to.z))
            return {
                success: true,
                waypoints: [],
                reachedDestination: false,
                error: 'Destination zone not allocated - try walking toward it',
            };
        const last = waypoints.at(-1);
        const reachedDestination = last !== undefined && last.x === to.x && last.z === to.z;
        if (!reachedDestination && last) {
            const remaining = Math.abs(last.x - to.x) + Math.abs(last.z - to.z);
            if (remaining > OTHER_PLANE_TILES)
                return {
                    success: false,
                    waypoints: [],
                    error: `Destination (${to.x}, ${to.z}) is unreachable — path ends ${remaining} tiles away at (${last.x}, ${last.z}). The target may be underground or on a different plane that requires a ladder/stairs to access.`,
                };
        }
        return { success: true, waypoints, reachedDestination };
    },
    doorsAlong: waypoints => {
        // The door index fills on load, which findDoorsAlongPath alone does not trigger.
        initPathfinding();
        return findDoorsAlongPath([...waypoints]);
    },
    doorAt: getDoorAt,
    walkable: isTileWalkable,
};
