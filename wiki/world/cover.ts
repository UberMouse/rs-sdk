// The plan `area` that covers a set of tiles. A plan's area is a centre and a radius, and a task works a target
// whose straight-line distance from the centre is at most the radius (conductor/lib/area.ts inArea, util.ts
// distance), so the radius is the farthest tile's straight-line distance, rounded up, plus a margin.
import type { Rect, Tile } from './types';

/** Tiles of margin beyond the farthest tile a target can stand on: a plan's area overshoots, never undershoots. */
export const COVER_MARGIN = 3;

/** A plan `area` as a centre tile and a radius. */
export interface Cover {
    centre: Tile;
    radius: number;
}

/** The centre of the box `tiles` span, and a radius that reaches each of them with COVER_MARGIN to spare. */
export function coverOf(tiles: readonly Tile[]): Cover {
    const xs = tiles.map(t => t.x);
    const zs = tiles.map(t => t.z);
    const centre = {
        level: tiles[0]!.level,
        x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
        z: Math.round((Math.min(...zs) + Math.max(...zs)) / 2),
    };
    const far = Math.max(...tiles.map(t => Math.hypot(t.x - centre.x, t.z - centre.z)));
    return { centre, radius: Math.ceil(far) + COVER_MARGIN };
}

/**
 * The cover of every tile of `box`, on its level (`level` for a box of no one level): its corners are its farthest
 * tiles from any centre inside it.
 */
export function boxCover(box: Rect, level: number): Cover {
    if (box.level !== undefined) level = box.level;
    return coverOf([
        { level, x: box.x1, z: box.z1 },
        { level, x: box.x1, z: box.z2 },
        { level, x: box.x2, z: box.z1 },
        { level, x: box.x2, z: box.z2 },
    ]);
}
