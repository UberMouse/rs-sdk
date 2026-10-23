// The low-HP line the low-HP guard (lib/interrupts.ts) eats below, and the engine eats back above as
// a run ends.
import type { BotWorldState } from '../../sdk/types';

/** Eat when HP drops below this fraction of max. */
export const LOW_HP_FRACTION = 0.5;

/** Extra fraction of max HP the eat line rises by for each attacker beyond the first. */
export const LOW_HP_PER_EXTRA_ATTACKER = 0.15;
/** The eat line never rises above this fraction of max HP, however many attack. */
export const LOW_HP_MAX_FRACTION = 0.8;

/**
 * The fraction of max HP the guard eats below: one half against a single attacker (a normal grind, no
 * over-eating), rising with each further one on the bot because several mid-level monsters took 40 of 49 HP
 * in a few ticks (Ice Dungeon): 0.65 for two, 0.8 for three or more.
 */
export function lowHpFraction(attackerCount = 0): number {
    const extra = Math.max(0, attackerCount - 1) * LOW_HP_PER_EXTRA_ATTACKER;
    return Math.min(LOW_HP_MAX_FRACTION, LOW_HP_FRACTION + extra);
}

/** HP is under the eat line for `attackerCount` NPCs on the bot (0 or 1: the plain half). */
export function isLowHp(state: BotWorldState, attackerCount = 0): boolean {
    const p = state.player;
    return !!p && p.maxHp > 0 && p.hp < p.maxHp * lowHpFraction(attackerCount);
}
