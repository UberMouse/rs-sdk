// Ported from sdk/index.ts findPath @ ca34325e7, over sdk/pathfinding.ts @ d80066c78.
// The routes the walkTo op plans with. sdk.findPath reads the player from the SDK's state and the doors
// to avoid from the SDK session; here both are arguments, so the op passes its own state and the doors
// it has given up on, and a test passes a Pathfinder of its own instead of the collision data.
// sdk/pathfinding.ts imports that data (23 MB of JSON) statically, so it parses when this module is
// first imported; the collision index and door index build on the first query (about half a second).
// The import stays static: the Pathfinder is synchronous, and every live run imports pathfinding.ts
// through the BotSDK (sdk/index.ts) anyway.
import * as rsmod from '../../server/vendor/rsmod-pathfinder';
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
    /**
     * A single step of one tile from (x, z) by (dx, dz) is open: the engine's line-of-walk test between the
     * two tiles, so a wall or fence on their shared edge, a corner wall on a diagonal step, or a blocked
     * destination refuses it. `walkable` alone says nothing about the edge between two tiles.
     */
    canStep(level: number, x: number, z: number, dx: number, dz: number): boolean;
}

/**
 * Doors sdk/collision-data.json lacks, which the walk opens like the others. The data's door list misses
 * the whole class of shape-9 ground-layer doors (diagonal, not walls), so their tiles stay blocked. The
 * one known: the Wizards' Tower door into the stairs-and-ladder room (loc 1536 in maps/m48_49.jm2), without
 * which no route into the room (the basement ladder, Sedridor) exists. Here its tile is unblocked and the
 * door is known.
 * A stopgap patch of sdk/collision-data.json: delete this list once that file lists loc 1536 at (3107,3162).
 */
export const EXTRA_DOORS: readonly DoorInfo[] = [{ level: 0, x: 3107, z: 3162, shape: 9, angle: 3, blockrange: true }];
let extraDoorsMasked = false;
/** Unblocks the EXTRA_DOORS tiles, once, after the SDK's own door index has been built. */
function maskExtraDoors(): void {
    initPathfinding();
    if (extraDoorsMasked) return;
    extraDoorsMasked = true;
    for (const d of EXTRA_DOORS) rsmod.changeLoc(d.x, d.z, d.level, 1, 1, d.blockrange, false, false);
}
const sameDoor = (a: DoorInfo, b: DoorInfo) => a.level === b.level && a.x === b.x && a.z === b.z;
const isExtraDoor = (d: DoorInfo) => EXTRA_DOORS.some(e => sameDoor(e, d));
const extraDoorAt = (level: number, x: number, z: number) =>
    EXTRA_DOORS.find(d => d.level === level && d.x === x && d.z === z);

/** sdk.findPath's default waypoint cap. */
const MAX_WAYPOINTS = 500;
/**
 * A partial route ending further than this (Manhattan) from the destination is a destination on
 * another plane (underground areas share level 0 at z + 6400), not one just past a gate (10-20 tiles).
 */
const OTHER_PLANE_TILES = 100;

/** A waypoint's tile and its four neighbours, where the SDK looks for a door along a route. */
const CROSS_OFFSETS = [
    [0, 0],
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
] as const;

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
        maskExtraDoors();
        // A door the walk gave up on is walled again for this query; the SDK re-walls only its own kind.
        const shut = avoid.filter(isExtraDoor);
        for (const d of shut) rsmod.changeLoc(d.x, d.z, d.level, 1, 1, d.blockrange, false, true);
        let waypoints: Waypoint[];
        try {
            waypoints = findLongPath(
                from.level,
                from.x,
                from.z,
                to.x,
                to.z,
                MAX_WAYPOINTS,
                avoid.filter(d => !isExtraDoor(d)),
            );
        } finally {
            for (const d of shut) rsmod.changeLoc(d.x, d.z, d.level, 1, 1, d.blockrange, false, false);
        }
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
        maskExtraDoors();
        const found = findDoorsAlongPath([...waypoints]);
        for (const wp of waypoints)
            for (const [dx, dz] of CROSS_OFFSETS) {
                const d = extraDoorAt(wp.level, wp.x + dx, wp.z + dz);
                if (d && !found.some(f => sameDoor(f, d))) found.push(d);
            }
        return found;
    },
    doorAt: (level, x, z) => getDoorAt(level, x, z) ?? extraDoorAt(level, x, z),
    walkable: isTileWalkable,
    // The server's `lineofwalk` between the two tiles (hasLineOfWalk, as skill_firemaking's push_player uses it).
    canStep(level, x, z, dx, dz) {
        initPathfinding();
        return rsmod.hasLineOfWalk(level, x, z, x + dx, z + dz, 1, 1, 1, 1, 0);
    },
};
