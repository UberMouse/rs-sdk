// The Wilderness, on the surface and in the Edgeville dungeon, which no task enters: PvP, and death drops
// items. The guard that ends a run there (lib/interrupts.ts), the area and shop refusals and the walk
// op's route check share these boxes.

/**
 * Wilderness boxes (plane 0), from wilderness_zones.dbrow: x 2944..3391; z 3520..6399 on the surface, and
 * z >= 9920 underground (the Edgeville dungeon, drawn at z + 6400). The rest of the underground map is not
 * the Wilderness: the Dwarven Mine under Falador is at z 9776..9860.
 */
const WILDERNESS_MIN_X = 2944;
const WILDERNESS_MAX_X = 3391;

/** The Wilderness z bands [lo, hi], inclusive: the surface, then the Edgeville dungeon. */
const Z_BANDS = [
    [3520, 6399],
    [9920, Infinity],
] as const;

/** The z is in a Wilderness band, on the surface or underground. */
const isWildernessZ = (z: number) => Z_BANDS.some(([lo, hi]) => z >= lo && z <= hi);

/** The z range [lo, hi] reaches a Wilderness z. */
const zReaches = (lo: number, hi: number) => Z_BANDS.some(([bLo, bHi]) => hi >= bLo && lo <= bHi);

/** In the Wilderness, on the surface or underground. */
export const isInWilderness = (level: number, worldX: number, worldZ: number): boolean =>
    level === 0 && worldX >= WILDERNESS_MIN_X && worldX <= WILDERNESS_MAX_X && isWildernessZ(worldZ);

/** True when the square of `radius` around (x, z) on plane 0 overlaps the Wilderness. */
export const squareReachesWilderness = (x: number, z: number, radius: number): boolean =>
    x + radius >= WILDERNESS_MIN_X && x - radius <= WILDERNESS_MAX_X && zReaches(z - radius, z + radius);

/** Food a Wilderness trip starts with unless `minFood` says otherwise: skeletons and wolves hit on the way. */
export const WILDERNESS_MIN_FOOD = 3;

/**
 * Why a Wilderness run may not start with `food` items held, or null. It needs `minFood` food (at least 1: with
 * none the low-hp guard has nothing to eat). `what` names the run in the message ("a Wilderness trip").
 */
export function wildernessFoodRefusal(food: number, minFood: number, what: string): string | null {
    const needed = Math.max(1, minFood);
    return food < needed ? `${what} needs ${needed} food (minFood), bot has ${food}` : null;
}
