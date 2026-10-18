// From an ActionModel to items per tick: the player's own rate, and the cap the resource puts on it.
import type { ActionModel } from './family';

/**
 * Expected ticks per success (one item taken). A success needs 1/success attempts, each `ticksPerAttempt`, and
 * the (1 - success)/success failures among them each add `failTicks`.
 */
export function ticksPerItem(m: Pick<ActionModel, 'ticksPerAttempt' | 'success' | 'failTicks'>): number {
    const p = m.success;
    if (!(p > 0 && p <= 1)) throw new Error(`success ${p} is not in (0, 1]`);
    return (m.ticksPerAttempt + (1 - p) * (m.failTicks ?? 0)) / p;
}

/**
 * The most items per tick `features` features of a depleting resource give. Each yields n = 1/chance items before
 * it depletes, taking the player n * ticksPerItem ticks, then stays down `respawnTicks`; one player works one at a
 * time, so over that cycle the k features give at most k * n / (n * ticksPerItem + respawnTicks). Infinity when
 * the resource never depletes.
 */
export function resourceCap(m: ActionModel, features: number): number {
    if (!m.deplete || m.deplete.chance === 0) return Infinity;
    const n = 1 / m.deplete.chance;
    return (features * n) / (n * ticksPerItem(m) + m.deplete.respawnTicks);
}

/** Items per tick at `features` features: the player's rate, slowed to the resource cap where that binds. */
export function gatherRate(m: ActionModel, features: number): { itemsPerTick: number; binding: 'player' | 'resource' } {
    const player = 1 / ticksPerItem(m);
    const cap = resourceCap(m, features);
    return cap < player ? { itemsPerTick: cap, binding: 'resource' } : { itemsPerTick: player, binding: 'player' };
}
