// Not ported: sdk/actions.ts has no fishing method; closest upstream is interactNpc @ 4c2069cc0.
// bot.* has no fishing method, and bot.interactNpc wraps a walk and an animation wait that fishing
// doesn't need. Fishing spots are NPCs: the op sends the method's option on the spot (the client's own
// pathing takes the bot to the shore) and waits for a fish. The server keeps fishing after a catch
// until the spot moves, the inventory fills or something interrupts, so `resume` waits for the next
// catch without sending again (a resend restarts the cast). Level, tool and bait are not checked here
// (the game only says so in a dialog and nothing changes, so it ends as `timeout`): tasks refuse that
// in preflight and before each fish. Threats and dialogs are the guards' job.
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItems, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** A fresh send: the walk to the shore, the cast and the first rolls, 45 s in ticks. */
export const FISH_WAIT_TICKS = Math.ceil(45_000 / TICK_MS);
/** Waiting for the next catch of a fishing already under way (24 s), before the caller casts again. */
export const FISH_RESUME_WAIT_TICKS = Math.ceil(24_000 / TICK_MS);

export type FishResult =
    | { ok: true }
    | {
          ok: false;
          reason: 'spot-moved' | 'cant-reach' | 'timeout' | 'send-failed' | 'no-option';
          message: string;
      };

/** How many items matching any of `patterns` the inventory holds. */
export const countAny = (state: BotWorldState, patterns: readonly RegExp[]): number =>
    patterns.reduce((n, p) => n + countItems(state, p), 0);

/** An NPC's tile (its tile coordinates when published, else its position). */
export const tileOf = (n: { x: number; z: number; tileX?: number; tileZ?: number }) => ({
    x: n.tileX ?? n.x,
    z: n.tileZ ?? n.z,
});

/**
 * Fishes at `spot` with `option` and waits until one of `catches` is gained or the spot is no longer
 * there: fishing spots teleport to another tile every few minutes, and the interaction ends with it
 * (`spot-moved`, also when it left view). Success needs a fish gained; fish already carried don't
 * count. `resume` sends nothing and just waits (for `FISH_RESUME_WAIT_TICKS`) for the next fish.
 * `no-option` and `send-failed` mean nothing reached the game.
 */
export function* fish(
    ctx: ActionContext,
    spot: NearbyNpc,
    option: RegExp,
    catches: readonly RegExp[],
    opts: { resume?: boolean } = {},
): Op<FishResult> {
    const held = (s: BotWorldState) => countAny(s, catches);
    const before = held(ctx.state());
    const cursor = messageCursor(ctx.state());
    if (!opts.resume) {
        const match = spot.optionsWithIndex.find(o => option.test(o.text));
        if (!match) return { ok: false, reason: 'no-option', message: `no ${option} option on ${spot.name}` };
        const sent = yield* send({
            type: 'interactNpc',
            npcIndex: spot.index,
            optionIndex: match.opIndex,
            reason: `${match.text} ${spot.name}`,
        });
        if (!sent.success)
            return {
                ok: false,
                reason: sent.reason === 'cant_reach' ? 'cant-reach' : 'send-failed',
                message: sent.message,
            };
    }
    const home = tileOf(spot);
    const here = (s: BotWorldState) => {
        const n = s.nearbyNpcs.find(x => x.index === spot.index);
        if (!n) return false;
        const t = tileOf(n);
        return t.x === home.x && t.z === home.z;
    };
    const gained = (s: BotWorldState) => held(s) > before;
    const waited = yield* wait(
        `fish at spot (${home.x},${home.z})`,
        s => gained(s) || !here(s) || !!messageSince(s, cursor, CANT_REACH),
        opts.resume ? FISH_RESUME_WAIT_TICKS : FISH_WAIT_TICKS,
    );
    if (gained(waited.state)) return { ok: true };
    if (messageSince(waited.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `cannot reach fishing spot (${home.x},${home.z})` };
    if (waited.kind === 'timeout')
        return { ok: false, reason: 'timeout', message: `timed out waiting for a fish at (${home.x},${home.z})` };
    return { ok: false, reason: 'spot-moved', message: `fishing spot (${home.x},${home.z}) moved away` };
}
