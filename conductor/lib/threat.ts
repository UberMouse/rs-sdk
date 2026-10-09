// Long waits inside a step (chopping, mining, fishing) block the shared interrupts, which only
// run between steps. waitUnlessThreatened ends such a wait as soon as the bot is hurt or in
// combat so the low-HP interrupt can act on the next loop.
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';

/** Eat when HP drops below this fraction of max. */
export const LOW_HP_FRACTION = 0.5;

export function isLowHp(state: BotWorldState): boolean {
    const p = state.player;
    return !!p && p.maxHp > 0 && p.hp < p.maxHp * LOW_HP_FRACTION;
}

/** HP is low, or something is fighting the bot. */
export function isThreatened(state: BotWorldState): boolean {
    return isLowHp(state) || !!state.player?.combat.inCombat;
}

export type WaitOutcome =
    | { kind: 'met'; state: BotWorldState }
    | { kind: 'threatened'; state: BotWorldState }
    | { kind: 'timeout' };

/** Wait for `goal`, giving up early when the bot is threatened. `goal` wins when both hold. */
export async function waitUnlessThreatened(
    sdk: BotSDK,
    goal: (state: BotWorldState) => boolean,
    timeoutMs: number,
): Promise<WaitOutcome> {
    try {
        const state = await sdk.waitForCondition(s => goal(s) || isThreatened(s), timeoutMs);
        return goal(state) ? { kind: 'met', state } : { kind: 'threatened', state };
    } catch {
        return { kind: 'timeout' };
    }
}
