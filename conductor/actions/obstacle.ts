// Not ported: sdk/actions.ts has no agility method (closest: interactLoc @ 4c2069cc0). interactLoc waits for an
// animation/dialog/interface; an obstacle moves the bot by script and pays Agility XP at the end, so this waits for
// that XP plus a position change. Refusals and falls are read from game messages and end the wait at once.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, ticks, wait } from '../core/op';
import { findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { interactLoc } from './interact';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** The ticks an obstacle gets from the send to the XP: the walk to it and its scripted movement (16 s). */
export const OBSTACLE_WAIT_TICKS = Math.ceil(16_000 / TICK_MS);
/** Ticks after the XP for the script's last move (the pipe pays before its final step) to land. */
export const OBSTACLE_SETTLE_TICKS = 1;
/** The server turning the interaction down because of where the bot stands or who else is on the obstacle. */
export const OBSTACLE_REFUSED = /can not do that from here|can't enter .* from this side|being used/i;
/** An obstacle failed: the bot slips, falls, and is moved off the course. */
export const OBSTACLE_FELL = /\b(slip|slipped|fall|fell|tumble)\b/i;

export type ObstacleResult =
    | { ok: true; xp: number }
    | {
          ok: false;
          reason: 'no-option' | 'send-failed' | 'refused' | 'fell' | 'no-xp' | 'timeout';
          message: string;
      };

const agilityXp = (s: BotWorldState) => findSkill(s, 'Agility')?.experience ?? 0;
const spot = (s: BotWorldState) => (s.player ? `${s.player.level}:${s.player.worldX},${s.player.worldZ}` : '');

/**
 * Sends `option` on the obstacle `loc` and waits until Agility XP has been gained and the bot has moved
 * (the obstacle's script paid out and carried it across). `refused` is the server saying no from this
 * side; `fell` a failed obstacle (the XP, if any, did not come with a crossing); `no-xp` means the bot
 * moved but nothing was paid in time (displaced, or a slow script); `timeout` means nothing observable happened.
 * `no-option` and `send-failed` mean nothing reached the game. The level an obstacle needs is not
 * checked (the game only says so in chat): tasks refuse that in preflight.
 */
export function* obstacle(ctx: ActionContext, loc: NearbyLoc, option: RegExp): Op<ObstacleResult> {
    const before = ctx.state();
    const xpBefore = agilityXp(before);
    const startedAt = spot(before);
    const cursor = messageCursor(before);

    const sent = yield* interactLoc(loc, option);
    if (!sent.ok) return { ok: false, reason: sent.reason, message: sent.message };

    const crossed = (s: BotWorldState) => agilityXp(s) > xpBefore && spot(s) !== startedAt;
    const refused = (s: BotWorldState) =>
        messageSince(s, cursor, OBSTACLE_REFUSED) ?? messageSince(s, cursor, CANT_REACH);
    const fell = (s: BotWorldState) => messageSince(s, cursor, OBSTACLE_FELL);
    const w = yield* wait(
        `cross ${loc.name} (${loc.x},${loc.z})`,
        s => crossed(s) || !!refused(s) || !!fell(s),
        OBSTACLE_WAIT_TICKS,
    );
    if (crossed(w.state)) {
        const settled = yield* ticks(OBSTACLE_SETTLE_TICKS);
        return { ok: true, xp: agilityXp(settled) - xpBefore };
    }
    const no = refused(w.state);
    if (no) return { ok: false, reason: 'refused', message: `${loc.name} at (${loc.x},${loc.z}): ${no}` };
    const slip = fell(w.state);
    if (slip) return { ok: false, reason: 'fell', message: `${loc.name} at (${loc.x},${loc.z}): ${slip}` };
    if (spot(w.state) !== startedAt)
        return {
            ok: false,
            reason: 'no-xp',
            message: `no Agility XP within ${OBSTACLE_WAIT_TICKS} ticks; bot moved from ${startedAt} to ${spot(w.state)}`,
        };
    return { ok: false, reason: 'timeout', message: `timed out crossing ${loc.name} at (${loc.x},${loc.z})` };
}
