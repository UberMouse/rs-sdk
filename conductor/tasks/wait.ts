import { z } from 'zod/v4';
import { ticks } from '../core/op';
import { defineTask } from '../lib/task';
import { stuckWindowMs } from '../lib/watchdog';

/** The longest wait one run takes. */
export const MAX_WAIT_TICKS = 1500;
// One wait that changes nothing for its whole length: neither the watchdog nor the step budget may end it.
const WINDOW_MS = stuckWindowMs(MAX_WAIT_TICKS);

const Params = z.object({
    ticks: z.number().int().min(1).max(MAX_WAIT_TICKS).describe(`Game ticks to wait, 1 to ${MAX_WAIT_TICKS}.`),
    orFail: z
        .boolean()
        .default(false)
        .describe(
            "End failed rather than done when the ticks run out: for a wait the phase's `until` is meant to end.",
        ),
});

export default defineTask({
    name: 'wait',
    description:
        "A deliberate wait of `ticks` game ticks in a plan, ended early by the phase's `until` (an NPC arriving, a " +
        'respawn); done when the ticks run out, or failed with `orFail`. It sends nothing, and the shared guards ' +
        '(death, low HP, dialogs) still act at every tick of it.',
    params: Params,
    stuckAfterMs: WINDOW_MS,
    stepTimeoutMs: WINDOW_MS,
    waits: true,
    steps: [
        {
            name: 'wait',
            when: () => true,
            *run(ctx) {
                const { ticks: n, orFail } = ctx.params;
                yield* ticks(n);
                const reason = `waited ${n} ticks`;
                return orFail ? { fail: reason } : { done: reason };
            },
        },
    ],
});
