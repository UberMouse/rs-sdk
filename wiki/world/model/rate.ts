// From an ActionModel to items per tick: the player's own rate, and the cap the resource puts on it.
import type { ActionModel } from './family';

/** Throws naming the field and value unless `ok`: a bad model must fail loudly, not turn into a NaN rate. */
function check(ok: boolean, field: string, value: number, want: string): void {
    if (!ok) throw new Error(`${field} ${value} is not ${want}`);
}

/** Rejects a model whose numbers would give a NaN, negative or silently wrong rate. */
function validate(m: Pick<ActionModel, 'ticksPerAttempt' | 'success' | 'failTicks' | 'successTicks'>): void {
    check(
        Number.isFinite(m.ticksPerAttempt) && m.ticksPerAttempt > 0,
        'ticksPerAttempt',
        m.ticksPerAttempt,
        'finite and > 0',
    );
    check(m.success > 0 && m.success <= 1, 'success', m.success, 'in (0, 1]');
    const f = m.failTicks ?? 0;
    check(Number.isFinite(f) && f >= 0, 'failTicks', f, 'finite and >= 0');
    const s = m.successTicks ?? 0;
    check(Number.isFinite(s) && s >= 0, 'successTicks', s, 'finite and >= 0');
}

/** Rejects a `deplete` whose chance is outside (0, 1] or whose respawn is negative or not finite. */
function validateDeplete(d: NonNullable<ActionModel['deplete']>): void {
    check(d.chance > 0 && d.chance <= 1, 'deplete.chance', d.chance, 'in (0, 1]');
    check(
        Number.isFinite(d.respawnTicks) && d.respawnTicks >= 0,
        'deplete.respawnTicks',
        d.respawnTicks,
        'finite and >= 0',
    );
}

/**
 * Expected ticks per success (one item taken). A success needs 1/success attempts, each `ticksPerAttempt`, the
 * (1 - success)/success failures among them each add `failTicks`, and the success itself adds `successTicks`.
 */
export function ticksPerItem(
    m: Pick<ActionModel, 'ticksPerAttempt' | 'success' | 'failTicks' | 'successTicks'>,
): number {
    validate(m);
    const p = m.success;
    return (m.ticksPerAttempt + (1 - p) * (m.failTicks ?? 0)) / p + (m.successTicks ?? 0);
}

/**
 * The most items per tick `features` features of a depleting resource give. Each yields n = 1/chance items before
 * it depletes, taking the player n * ticksPerItem ticks, then stays down `respawnTicks`; one player works one at a
 * time, so over that cycle the k features give at most k * n / (n * ticksPerItem + respawnTicks). Infinity when
 * the resource never depletes (`deplete` absent); a `deplete.chance` outside (0, 1] throws.
 */
export function resourceCap(m: ActionModel, features: number): number {
    if (!m.deplete) return Infinity;
    validateDeplete(m.deplete);
    const n = 1 / m.deplete.chance;
    return (features * n) / (n * ticksPerItem(m) + m.deplete.respawnTicks);
}

/** Items per tick at `features` features: the player's rate, slowed to the resource cap where that binds. */
export function gatherRate(m: ActionModel, features: number): { itemsPerTick: number; binding: 'player' | 'resource' } {
    const player = 1 / ticksPerItem(m);
    const cap = resourceCap(m, features);
    return cap < player ? { itemsPerTick: cap, binding: 'resource' } : { itemsPerTick: player, binding: 'player' };
}
