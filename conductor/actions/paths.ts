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
 * ones known: the Wizards' Tower door into the stairs-and-ladder room (loc 1536 in maps/m48_49.jm2), without
 * which no route into the room (the basement ladder, Sedridor) exists, and the two Rogues' Castle doors into
 * its stair room (loc 1530 in maps/m51_61.jm2:4790, :4913), without which no route up the castle exists; then
 * every other closed diagonal door the plain door script opens (category door_closed, doors/scripts/doors.rs2:1),
 * by map square. Here their tiles are unblocked and the doors are known. wiki/world/test/collision.real.test.ts
 * checks that every placed one is listed.
 * A stopgap patch of sdk/collision-data.json: delete this list once that file lists these doors.
 */
export const EXTRA_DOORS: readonly DoorInfo[] = [
    { level: 0, x: 3107, z: 3162, shape: 9, angle: 3, blockrange: true },
    { level: 0, x: 3279, z: 3939, shape: 9, angle: 2, blockrange: true },
    { level: 0, x: 3282, z: 3934, shape: 9, angle: 0, blockrange: true },
    // m39_50, m41_51 (East Ardougne), m41_53 (Hemenster), m41_73 and m43_73 (the Fisher Realm's castles).
    { level: 0, x: 2505, z: 3256, shape: 9, angle: 3, blockrange: true },
    { level: 0, x: 2650, z: 3297, shape: 9, angle: 0, blockrange: true },
    { level: 0, x: 2669, z: 3316, shape: 9, angle: 1, blockrange: true },
    { level: 0, x: 2639, z: 3415, shape: 9, angle: 2, blockrange: true },
    { level: 0, x: 2638, z: 4688, shape: 9, angle: 2, blockrange: true },
    { level: 1, x: 2638, z: 4688, shape: 9, angle: 0, blockrange: true },
    { level: 1, x: 2766, z: 4688, shape: 9, angle: 0, blockrange: true },
    // m47_52 (Falador), m48_51 (Draynor), m48_53 (Barbarian Village), m49_53 and m50_52 (Varrock), m54_51 (Morytania).
    { level: 0, x: 3046, z: 3348, shape: 9, angle: 2, blockrange: true },
    { level: 0, x: 3092, z: 3274, shape: 9, angle: 2, blockrange: true },
    { level: 0, x: 3077, z: 3415, shape: 9, angle: 1, blockrange: true },
    { level: 0, x: 3160, z: 3440, shape: 9, angle: 1, blockrange: true },
    { level: 0, x: 3206, z: 3385, shape: 9, angle: 2, blockrange: true },
    { level: 0, x: 3484, z: 3290, shape: 9, angle: 3, blockrange: true },
];
/**
 * Every closed slashable web (loc 733 `bigweb_slashable`, from server/content/maps/*.jm2; the `webwall` loc 1810
 * is placed on no map). A web fills its tile (ground-layer collision, blockwalk) until slashed, when it becomes
 * `bigweb_slashed` (no collision) for 100 ticks, so the walk treats it like a closed door: the route may run
 * through its tile and the walk slashes it open on the way (walk.ts). Masked like EXTRA_DOORS.
 */
const slashWeb = (level: number, x: number, z: number, angle: number): DoorInfo => ({
    level,
    x,
    z,
    shape: 10,
    angle,
    blockrange: true,
});
export const SLASH_WEBS: readonly DoorInfo[] = [
    slashWeb(0, 2565, 3124, 2),
    slashWeb(0, 2569, 3118, 1),
    slashWeb(0, 2570, 3118, 1),
    slashWeb(0, 2574, 3124, 0),
    slashWeb(0, 2654, 9766, 3),
    slashWeb(0, 3030, 3852, 2),
    slashWeb(0, 3083, 3833, 2),
    slashWeb(0, 3093, 3957, 0),
    slashWeb(0, 3095, 3957, 0),
    slashWeb(0, 3115, 3859, 1),
    slashWeb(0, 3147, 3727, 1),
    slashWeb(0, 3158, 3951, 1),
    slashWeb(0, 3163, 3736, 0),
    slashWeb(0, 3183, 3733, 1),
    // Varrock Sewers, the way to the moss giants.
    slashWeb(0, 3210, 9898, 1),
];
/** The doors the data lacks and the webs, masked open in the collision index and known as doors. */
const MASKED: readonly DoorInfo[] = [...EXTRA_DOORS, ...SLASH_WEBS];
let maskedOpenDone = false;
/** Unblocks the MASKED tiles (EXTRA_DOORS and SLASH_WEBS), once, after the SDK's own door index has been built. */
function maskDoorsAndWebs(): void {
    initPathfinding();
    if (maskedOpenDone) return;
    maskedOpenDone = true;
    for (const d of MASKED) rsmod.changeLoc(d.x, d.z, d.level, 1, 1, d.blockrange, false, false);
}
const sameDoor = (a: DoorInfo, b: DoorInfo) => a.level === b.level && a.x === b.x && a.z === b.z;
const isMasked = (d: DoorInfo) => MASKED.some(e => sameDoor(e, d));
const maskedAt = (level: number, x: number, z: number) => MASKED.find(d => d.level === level && d.x === x && d.z === z);

/** A door of the SDK's index or one of MASKED stands on the tile. */
const doorKnownAt = (level: number, x: number, z: number): boolean =>
    maskedAt(level, x, z) !== undefined || getDoorAt(level, x, z) !== undefined;

/**
 * The route with a waypoint on each door's tile (any door of the SDK's index, a web, a diagonal door) and on the
 * tile before it. A route's waypoints are only where it turns, so a door in the middle of a straight run has none
 * near it, and the walk (which opens a door when a waypoint is beside it) would send one long leg through the
 * closed door: the client finds no route to a destination behind it and does not move. The first segment runs
 * from `from`, the bot's own tile. Example: the Varrock square alley's double door at (3212..3213, 3470).
 */
export function withDoorStops(waypoints: Waypoint[], from?: Waypoint): Waypoint[] {
    const out: Waypoint[] = [];
    for (const [i, b] of waypoints.entries()) {
        const a = i === 0 ? from : waypoints[i - 1];
        if (a && a.level === b.level) {
            const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
            const at = (k: number): Waypoint => ({
                level: a.level,
                x: a.x + Math.round(((b.x - a.x) * k) / n),
                z: a.z + Math.round(((b.z - a.z) * k) / n),
            });
            for (let k = 1; k <= n; k++) {
                const t = at(k);
                if (!doorKnownAt(t.level, t.x, t.z)) continue;
                // Before it, then on it; the segment's own ends are waypoints already.
                const prev = at(k - 1);
                const last = out.at(-1);
                if (k > 1 && !(last && last.x === prev.x && last.z === prev.z)) out.push(prev);
                if (k < n) out.push(t);
            }
        }
        out.push(b);
    }
    return out;
}

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
        maskDoorsAndWebs();
        // A door the walk gave up on is walled again for this query; the SDK re-walls only its own kind.
        const shut = avoid.filter(isMasked);
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
                avoid.filter(d => !isMasked(d)),
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
        return { success: true, waypoints: withDoorStops(waypoints, from), reachedDestination };
    },
    doorsAlong: waypoints => {
        // The door index fills on load, which findDoorsAlongPath alone does not trigger.
        maskDoorsAndWebs();
        const found = findDoorsAlongPath([...waypoints]);
        for (const wp of waypoints)
            for (const [dx, dz] of CROSS_OFFSETS) {
                const d = maskedAt(wp.level, wp.x + dx, wp.z + dz);
                if (d && !found.some(f => sameDoor(f, d))) found.push(d);
            }
        return found;
    },
    doorAt: (level, x, z) => getDoorAt(level, x, z) ?? maskedAt(level, x, z),
    walkable: isTileWalkable,
    // The server's `lineofwalk` between the two tiles (hasLineOfWalk, as skill_firemaking's push_player uses it).
    canStep(level, x, z, dx, dz) {
        initPathfinding();
        return rsmod.hasLineOfWalk(level, x, z, x + dx, z + dz, 1, 1, 1, 1, 0);
    },
};
