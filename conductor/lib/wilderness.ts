// The surface Wilderness, which no task goes into: PvP, and death drops items. The guard that ends a run
// there (lib/interrupts.ts), the area and shop refusals, and the walk op's route check share this box.

/** Surface Wilderness box (plane 0), from wilderness_zones.dbrow: x 2944..3391, z >= 3520. */
const WILDERNESS_MIN_X = 2944;
const WILDERNESS_MAX_X = 3391;
const WILDERNESS_MIN_Z = 3520;

/** On the surface in the Wilderness. */
export const isInWilderness = (level: number, worldX: number, worldZ: number): boolean =>
    level === 0 && worldX >= WILDERNESS_MIN_X && worldX <= WILDERNESS_MAX_X && worldZ >= WILDERNESS_MIN_Z;

/** True when the square of `radius` around (x, z) on the surface overlaps the Wilderness. */
export const squareReachesWilderness = (x: number, z: number, radius: number): boolean =>
    x + radius >= WILDERNESS_MIN_X && x - radius <= WILDERNESS_MAX_X && z + radius >= WILDERNESS_MIN_Z;
