// The game's skill roll, `stat_random(stat, low, high)`, as an exact probability.

/**
 * The chance a `stat_random(stat, low, high)` roll succeeds at stat `level` (the current, boosted level).
 * server/engine/src/engine/script/handlers/PlayerOps.ts:591-599: with L the level capped at 99,
 * `value = floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1` and the roll succeeds when `value > floor(rand*256)`,
 * rand JavaRandom.nextDouble(). That is a 53-bit k/2^53, so floor(rand*256) is k's top 8 bits: exactly uniform
 * over 0..255, and the chance is value/256, clamped to [0, 1] (a cooking row's high of 512 passes 256 well
 * before 99). Each term is floored on its own, as the engine does, so the chance is not the straight line from
 * (low+1)/256 to (high+1)/256.
 */
export function statRandomChance(level: number, low: number, high: number): number {
    const l = Math.min(level, 99);
    const value = Math.floor((low * (99 - l)) / 98) + Math.floor((high * (l - 1)) / 98) + 1;
    return Math.min(Math.max(value, 0), 256) / 256;
}
