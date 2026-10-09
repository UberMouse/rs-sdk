// The low-HP line the low-HP guard (lib/interrupts.ts) eats below, and the engine eats back above as
// a run ends.
import type { BotWorldState } from '../../sdk/types';

/** Eat when HP drops below this fraction of max. */
export const LOW_HP_FRACTION = 0.5;

export function isLowHp(state: BotWorldState): boolean {
    const p = state.player;
    return !!p && p.maxHp > 0 && p.hp < p.maxHp * LOW_HP_FRACTION;
}
