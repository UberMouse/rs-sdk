// Ported from sdk/actions.ts burnLogs @ 4c2069cc0
// Unlike bot.burnLogs it takes the logs as an exact-name pattern from the caller, and leaves dialogs
// to the dialog guard: lighting opens none of its own, and upstream's clicks while it waits only
// cleared a level-up. A refused tile ("You can't light a fire here.") is its own reason carrying the
// game's message, where upstream says only "possibly bad location", and so is too low a level, which
// upstream waits out to its timeout.
import type { BotWorldState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { messageCursor, messageSince } from './messages';

/** bot.burnLogs's 30s wait for the fire, in ticks: a light retries until it catches. */
export const BURN_WAIT_TICKS = Math.ceil(30_000 / TICK_MS);

const TINDERBOX = /^tinderbox$/i;
/** bot.burnLogs's refusals. Only the first is in this game's firemaking scripts ("You can't light a fire here."). */
const REFUSED = /can't light a fire|you need to move|can't do that here/i;
const TOO_LOW = /need a firemaking level/i;

export type BurnResult =
    | { ok: true; xpGained: number }
    | {
          ok: false;
          reason: 'no-tinderbox' | 'no-logs' | 'cant-light-here' | 'level-too-low' | 'send-failed' | 'timeout';
          message: string;
      };

const xpOf = (s: BotWorldState) => findSkill(s, 'Firemaking')?.experience ?? 0;

/**
 * Lights the first inventory item matching `logs` with a tinderbox and waits for Firemaking XP. The
 * server drops the logs on the bot's tile to light them, and once the fire catches steps the bot off
 * it onto a free neighbour. `cant-light-here` means the tile refused a fire (one already burns or
 * stands there, or the spot forbids it): step to another tile and retry.
 */
export function* burn(ctx: ActionContext, logs: RegExp): Op<BurnResult> {
    const s = ctx.state();
    const tinderbox = s.inventory.find(i => TINDERBOX.test(i.name));
    if (!tinderbox) return { ok: false, reason: 'no-tinderbox', message: 'No tinderbox in inventory' };
    const item = s.inventory.find(i => logs.test(i.name));
    if (!item) return { ok: false, reason: 'no-logs', message: 'No logs in inventory' };
    const xpBefore = xpOf(s);
    const cursor = messageCursor(s);

    const sent = yield* send({
        type: 'useItemOnItem',
        sourceSlot: tinderbox.slot,
        targetSlot: item.slot,
        reason: `light ${item.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(
        `light ${item.name}`,
        st => xpOf(st) > xpBefore || !!messageSince(st, cursor, REFUSED) || !!messageSince(st, cursor, TOO_LOW),
        BURN_WAIT_TICKS,
    );
    const xpGained = xpOf(w.state) - xpBefore;
    if (xpGained > 0) return { ok: true, xpGained };
    const refused = messageSince(w.state, cursor, REFUSED);
    if (refused) return { ok: false, reason: 'cant-light-here', message: refused };
    const tooLow = messageSince(w.state, cursor, TOO_LOW);
    if (tooLow) return { ok: false, reason: 'level-too-low', message: tooLow };
    return { ok: false, reason: 'timeout', message: 'Timed out waiting for fire' };
}
