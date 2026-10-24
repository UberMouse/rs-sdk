// Not ported: sdk/actions.ts has no such method; the closest upstream is useItemOnLoc @ 4c2069cc0, which
// waits for an inventory change or an animation only. Telling a move the game made (a teleport, a swim
// wash-up, a pass through a door, a gangplank, a whistle, a bell) from the bot's own walk is shared by
// `interact` and `use`, so a use that teleports the player counts as having taken effect.
import type { BotWorldState } from '../../sdk/types';

/** Running covers two tiles a tick: a player further off than that per elapsed tick was moved by the game. */
export const MAX_STEP_TILES = 2;

/** The effect text of a move the game made. */
export const MOVED_PREFIX = 'the player moved to ';

/**
 * Watches the player across the ticks of a wait for a move the game made, which a walk toward the target never
 * is: it covers at most MAX_STEP_TILES a tick and stays on its floor. Measured per state seen and from the state
 * before the send, so a stretch of ticks a guard handled in between (a message box clicked away) does not hide
 * it. `anyMove` (the bot stands on the target, or there is nothing to walk to) makes any change of tile count.
 * Sticky: once seen, it stays seen. Call it with each state of the wait; it returns the effect text or null.
 */
export function movementWatch(before: BotWorldState, anyMove = false): (s: BotWorldState) => string | null {
    const start = before.player;
    let prev = start;
    let prevTick = before.tick;
    let seen: string | null = null;
    return s => {
        const now = s.player;
        if (!seen && prev && now) {
            const jump = Math.max(Math.abs(now.worldX - prev.worldX), Math.abs(now.worldZ - prev.worldZ));
            // A state the client skipped (or a guard's handler) covers more ticks of walking.
            const reach = MAX_STEP_TILES * Math.max(1, s.tick - prevTick);
            const away = !!start && (now.worldX !== start.worldX || now.worldZ !== start.worldZ);
            const farFromStart =
                !!start &&
                Math.max(Math.abs(now.worldX - start.worldX), Math.abs(now.worldZ - start.worldZ)) >
                    MAX_STEP_TILES * Math.max(1, s.tick - before.tick);
            if (
                now.level !== prev.level ||
                (!!start && now.level !== start.level) ||
                jump > reach ||
                farFromStart ||
                (anyMove && away)
            )
                seen = `${MOVED_PREFIX}(${now.worldX},${now.worldZ})`;
        }
        prev = now ?? prev;
        prevTick = s.tick;
        return seen;
    };
}
