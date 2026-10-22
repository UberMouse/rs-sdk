// The engine's stat_random roll and what a crossing behind one costs: the resource pages state the chance
// (render/resources.ts), distance.ts prices a rolled crossing with it at the lowest level its requirement allows,
// and a walker can price one at a bot's own level.
import { parseRequirement } from './requirements';
import type { HpDamage } from './types';

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

/** The pages' statement of statRandomChance, for the stat named `skill`. */
export const statRandomRule = (skill: string): string =>
    `Low and high are the stat_random bounds: an attempt succeeds with chance (low + 1)/256 at ${skill} level 1, rising evenly to (high + 1)/256 at 99 (server/engine/src/engine/script/handlers/PlayerOps.ts).`;

/**
 * The lowest level of `stat` any of the alternative requirement sets lets through: each set's `skill:<stat>:<n>`,
 * or 1 for a set that asks none.
 */
export function lowestLevel(requires: readonly (readonly string[])[], stat: string): number {
    let lowest = Infinity;
    for (const set of requires) {
        let level = 1;
        for (const s of set) {
            const r = parseRequirement(s);
            if (r.kind === 'skill' && r.skill === stat) level = Math.max(level, r.level);
        }
        lowest = Math.min(lowest, level);
    }
    return lowest === Infinity ? 1 : lowest;
}

/**
 * The hitpoints a hit (HpDamage) takes from a player with `hp` current hitpoints: floor(hp x a / b) + c. The scripts
 * write it with the engine's integer division, which truncates (handlers/NumberOps.ts), the floor for the counts
 * here.
 */
export const damageAt = (d: HpDamage, hp: number): number => Math.floor((hp * d.a) / d.b) + d.c;

/**
 * The expected ticks of a crossing that takes `success` ticks when it succeeds, with chance `chance`: each failure
 * takes `fail` ticks and `back` more to get back to where it is tried from, and (1 - p)/p of them come before the
 * success on average. Infinity when it never succeeds.
 */
export function expectedTicks(success: number, chance: number, fail: number, back: number): number {
    if (chance <= 0) return Infinity;
    return success + ((1 - chance) / chance) * (fail + back);
}
