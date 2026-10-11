// The SiteCollision place.ts picks stand tiles with, over the collision data bundled with the SDK.
// Importing it parses that data (sdk/pathfinding.ts imports 23 MB of JSON), so place.ts takes the
// interface and only the build imports this.
import { collisionPaths } from '../../conductor/actions/paths';
import { initPathfinding } from '../../sdk/pathfinding';
import * as rsmod from '../../server/vendor/rsmod-pathfinder';
import type { SiteCollision } from './place';

export const siteCollision: SiteCollision = {
    walkable: collisionPaths.walkable,
    // GameMap.reachedLoc (server/engine/src/engine/GameMap.ts:450) for a player of size 1, called as
    // Player.ts:1204 calls it: the loc's config width and length, its angle and shape, and its
    // forceapproach flags. The flags are read from the rsmod instance pathfinding.ts filled.
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
};
