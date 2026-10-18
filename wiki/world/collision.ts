// The SiteCollision place.ts picks stand tiles with, over the collision data bundled with the SDK, and
// the land check sources/connectors.ts adds to it. Importing it parses that data (sdk/pathfinding.ts
// imports 23 MB of JSON), so place.ts and connectors.ts take the interface and only the build imports this.
import { collisionPaths, EXTRA_DOORS, SLASH_WEBS } from '../../conductor/actions/paths';
import collisionData from '../../sdk/collision-data.json';
import { initPathfinding, isZoneAllocated } from '../../sdk/pathfinding';
import * as rsmod from '../../server/vendor/rsmod-pathfinder';
import type { ReachCollision } from './reach';
import type { ConnectorCollision } from './sources/connectors';
import type { TeleportCollision } from './sources/dbrow-teleports';

/** A zone's key: its level and its 8x8 tile block. */
const zoneKey = (level: number, x: number, z: number): number => (level * 1024 + (x >> 3)) * 2048 + (z >> 3);

/** The zones the collision data lists, as zoneKey; `[level, x, z]` with x and z the zone's first tile. */
const dataZones = new Set((collisionData.zones as [number, number, number][]).map(([l, x, z]) => zoneKey(l, x, z)));

export const siteCollision: ConnectorCollision = {
    // A tile in a zone with no collision data reads as walkable, but nothing is there to stand on.
    walkable: (level, x, z) => isZoneAllocated(level, x, z) && collisionPaths.walkable(level, x, z),
    // GameMap.reachedLoc (server/engine/src/engine/GameMap.ts:450) for a player of size 1, called as
    // Player.ts:1204 calls it: the loc's config width and length, its angle and shape, and its
    // forceapproach flags. The collision it tests comes from the rsmod instance pathfinding.ts fills.
    reached(from, loc) {
        initPathfinding();
        return rsmod.reached(
            loc.level,
            from.x,
            from.z,
            loc.x,
            loc.z,
            loc.width,
            loc.length,
            1,
            loc.rotation,
            loc.shape,
            loc.forceapproach,
        );
    },
    // initPathfinding also allocates every empty zone in x 2304-3392, z 2944-3584 on level 0 as open
    // (sdk/pathfinding.ts), so `walkable` holds there; only the data's own zones are land.
    land: (level, x, z) => dataZones.has(zoneKey(level, x, z)),
};

const ZONES = collisionData.zones as [number, number, number][];

/** Whether a tile is new to `done`, which then holds it: each tile is edited once. */
function once(done: Set<string>, level: number, x: number, z: number): boolean {
    const key = `${level} ${x} ${z}`;
    if (done.has(key)) return false;
    done.add(key);
    return true;
}

/**
 * The collision the reach fill walks (reach.ts): siteCollision's queries, the zones the data lists, and
 * `canStep` (collisionPaths', the engine's line of walk between two tiles); and the line tests a teleport's
 * findsquare ring reads (sources/dbrow-teleports.ts), on the same rsmod instance. An edit runs on the rsmod
 * instance sdk/pathfinding.ts fills and is undone after, so nothing else in the process sees it.
 */
export const reachCollision: ReachCollision & TeleportCollision = {
    ...siteCollision,
    zones: ZONES,
    canStep: collisionPaths.canStep,
    // As GameMap.ts isLineOfWalk and isLineOfSight call them.
    line(kind, level, x, z, tx, tz) {
        initPathfinding();
        return (kind === 'walk' ? rsmod.hasLineOfWalk : rsmod.hasLineOfSight)(level, x, z, tx, tz, 1, 1, 1, 1, 0);
    },
    edited(edits, f) {
        initPathfinding();
        const undo: (() => void)[] = [];
        const [closed, cleared] = [new Set<string>(), new Set<string>()];
        try {
            // The doors and webs the walker opens (conductor/actions/paths.ts EXTRA_DOORS, SLASH_WEBS), which
            // collisionPaths masks open only on its first route: open for the fill, as the walk sees them.
            for (const d of [...EXTRA_DOORS, ...SLASH_WEBS])
                if (!collisionPaths.walkable(d.level, d.x, d.z)) {
                    rsmod.changeLoc(d.x, d.z, d.level, 1, 1, d.blockrange, false, false);
                    undo.push(() => rsmod.changeLoc(d.x, d.z, d.level, 1, 1, d.blockrange, false, true));
                }
            // A gated door the bundle has open (sdk/pathfinding.ts masks every door it lists) is walled again
            // as the data placed it; one it left walled (a one-way door, a door the data's list lacks) stays so.
            for (const { tile } of edits.close) {
                const { level, x, z } = tile;
                const d = collisionPaths.doorAt(level, x, z);
                if (!d || !once(closed, level, x, z)) continue;
                if (d.shape === 9 || d.shape === 10) {
                    // A masked ground-layer door (EXTRA_DOORS): its whole tile.
                    if (!collisionPaths.walkable(level, x, z)) continue;
                    rsmod.changeLoc(x, z, level, 1, 1, d.blockrange, false, true);
                    undo.push(() => rsmod.changeLoc(x, z, level, 1, 1, d.blockrange, false, false));
                } else {
                    rsmod.changeWall(x, z, level, d.angle, d.shape, d.blockrange, false, true);
                    undo.push(() => rsmod.changeWall(x, z, level, d.angle, d.shape, d.blockrange, false, false));
                }
            }
            // An opened loc's tiles lose the loc flag (rsmod CollisionFlag.LOC), where they have it; a tile blocked
            // by anything else (water) stays blocked.
            for (const { tile, width, length } of edits.open)
                for (let x = tile.x; x < tile.x + width; x++)
                    for (let z = tile.z; z < tile.z + length; z++) {
                        if (
                            !rsmod.isFlagged(x, z, tile.level, rsmod.CollisionFlag.LOC) ||
                            !once(cleared, tile.level, x, z)
                        )
                            continue;
                        rsmod.changeLoc(x, z, tile.level, 1, 1, false, false, false);
                        undo.push(() => rsmod.changeLoc(x, z, tile.level, 1, 1, false, false, true));
                    }
            return f();
        } finally {
            for (const u of undo.toReversed()) u();
        }
    },
};
