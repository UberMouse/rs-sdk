// Ported from sdk/actions.ts interactLoc @ 4c2069cc0 (the same pattern as chop and mine).
// bot.* has no pick method and bot.interactLoc wraps a walk and an animation wait that picking doesn't
// need. Takes the pickable loc and the exact item it gives from the caller, sends its published Pick
// option and waits for the item to arrive. The engine's pickables (server/content/scripts/general_use/
// scripts/pickables.rs2) give one item per click with p_delay(0), and some remove the loc afterwards
// (flax: 3 in 16), so the loc vanishing without a gain ends the wait as well. A dialog (a level-up) and
// a full inventory ("You can't carry any more flax.") are the dialog guard's and the caller's, not the op's.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, wait } from '../core/op';
import { countItems, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { interactLoc } from './interact';

/** Ticks to wait for the item or the loc vanishing (10 s: the walk up to the loc plus the pick). */
export const PICK_WAIT_TICKS = Math.ceil(10_000 / TICK_MS);
/** The option that picks a loc ("Pick"). */
export const PICK_OPTION = /^pick/i;

export type PickResult =
    | { ok: true }
    | { ok: false; reason: 'gone' | 'timeout' | 'send-failed' | 'no-option'; message: string };

/**
 * Picks `loc` and waits until one more `item` is held or the loc is gone. Success needs the item gained:
 * a loc that vanishes with none gained was picked by another player (or the pick never ran).
 * `no-option` and `send-failed` mean nothing reached the game.
 */
export function* pick(ctx: ActionContext, loc: NearbyLoc, item: RegExp): Op<PickResult> {
    const before = countItems(ctx.state(), item);
    const sent = yield* interactLoc(loc, PICK_OPTION);
    if (!sent.ok) return { ok: false, reason: sent.reason, message: sent.message };
    const gained = (s: BotWorldState) => countItems(s, item) > before;
    const gone = (s: BotWorldState) => !s.nearbyLocs.some(l => l.x === loc.x && l.z === loc.z && l.id === loc.id);
    const waited = yield* wait(`pick ${loc.name} (${loc.x},${loc.z})`, s => gained(s) || gone(s), PICK_WAIT_TICKS);
    if (gained(waited.state)) return { ok: true };
    if (waited.kind === 'timeout')
        return { ok: false, reason: 'timeout', message: `timed out waiting for ${loc.name} to be picked` };
    return { ok: false, reason: 'gone', message: `${loc.name} at (${loc.x},${loc.z}) was gone before it was picked` };
}
