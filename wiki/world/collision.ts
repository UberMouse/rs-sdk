// The SiteCollision place.ts picks stand tiles with, over the collision data bundled with the SDK, and
// the land check sources/connectors.ts adds to it. Importing it parses that data (sdk/pathfinding.ts
// imports 23 MB of JSON), so place.ts and connectors.ts take the interface and only the build imports this.
import { collisionPaths } from '../../conductor/actions/paths';
import collisionData from '../../sdk/collision-data.json';
import { initPathfinding, isZoneAllocated } from '../../sdk/pathfinding';
import * as rsmod from '../../server/vendor/rsmod-pathfinder';
import type { ConnectorCollision } from './sources/connectors';

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
