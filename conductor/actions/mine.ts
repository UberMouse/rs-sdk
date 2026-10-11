// Not ported: sdk/actions.ts has no mining method; closest upstream is interactLoc @ 4c2069cc0.
// bot.* has no mining method, and bot.interactLoc wraps a walk and an animation wait that mining doesn't need.
// Takes the ore pattern from the caller, interacts by the loc's published Mine option, and leaves
// threats and dialogs (a level-up as the ore lands) to the guards.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, wait } from '../core/op';
import { countItems, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { interactLoc } from './interact';

/** How long to wait for ore or the rock vanishing (30 s). */
export const MINE_WAIT_TICKS = Math.ceil(30_000 / TICK_MS);
/** The option that mines a rock; a mined-out rock keeps it (plainrock1/2), so it never tells a live rock apart. */
export const MINE_OPTION = /^mine$/i;

export type MineResult =
    | { ok: true }
    | { ok: false; reason: 'rock-gone' | 'timeout' | 'send-failed' | 'no-option'; message: string };

/**
 * Mines `rock` and waits until `ore` is gained or the rock is gone. Success needs ore gained: a rock
 * that changes with none gained was mined out by another player, and ore already carried doesn't count.
 * Ore the caller sent to be dropped just before (`dropOres`) may still be in the inventory when this
 * starts: ore gained is a count above the lowest one seen since, so the drop landing is not a gain.
 * `no-option` and `send-failed` mean nothing reached the game: no Mine option, or the client refused
 * the send (not logged in, rock out of the loaded scene). A level or pickaxe the rock needs is not
 * checked here (the game only says so in chat and nothing changes, so it ends as `timeout`): tasks
 * refuse that in preflight.
 */
export function* mine(ctx: ActionContext, rock: NearbyLoc, ore: RegExp): Op<MineResult> {
    // Lowest count seen so far: a pending drop shrinks the count first, and the replacement ore is the gain.
    let low = countItems(ctx.state(), ore);
    const sent = yield* interactLoc(rock, MINE_OPTION);
    if (!sent.ok) return { ok: false, reason: sent.reason, message: sent.message };
    // Also tracks the lowest count; safe to call repeatedly on the same state.
    const gained = (s: BotWorldState) => {
        const held = countItems(s, ore);
        low = Math.min(low, held);
        return held > low;
    };
    const gone = (s: BotWorldState) => !s.nearbyLocs.some(l => l.x === rock.x && l.z === rock.z && l.id === rock.id);
    const waited = yield* wait(`mine rock (${rock.x},${rock.z})`, s => gained(s) || gone(s), MINE_WAIT_TICKS);
    if (gained(waited.state)) return { ok: true };
    if (waited.kind === 'timeout')
        return { ok: false, reason: 'timeout', message: 'timed out waiting for ore from rock' };
    return {
        ok: false,
        reason: 'rock-gone',
        message: `rock at (${rock.x},${rock.z}) was mined out by someone else`,
    };
}
