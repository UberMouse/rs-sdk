// What an op reads to tell how the server answered: game messages and dialog pages that arrived
// after it acted. A cursor taken before the send separates them from what was already on screen.
import type { BotWorldState } from '../../sdk/types';

interface Observed {
    tick: number;
    /** The client's publication revision; newer than any cursor taken before it arrived. */
    observationId?: number;
}

const position = (m: Observed) => m.observationId ?? m.tick;

/** A cursor past every game message and dialog page `state` holds. */
export function messageCursor(state: BotWorldState): number {
    let max = 0;
    for (const m of [...state.gameMessages, ...state.recentDialogs]) max = Math.max(max, position(m));
    return max;
}

/** The first game message after `cursor` that matches `pattern`, or null. */
export function messageSince(state: BotWorldState, cursor: number, pattern: RegExp): string | null {
    return state.gameMessages.find(m => position(m) > cursor && pattern.test(m.text))?.text ?? null;
}

/** The game messages after `cursor`, oldest first, with the tick each arrived on. */
export function messagesSince(state: BotWorldState, cursor: number): { text: string; tick: number }[] {
    return state.gameMessages.filter(m => position(m) > cursor).map(m => ({ text: m.text, tick: m.tick }));
}

/** The first dialog page after `cursor` that `keep` accepts, as one line, or null. */
function pageSince(state: BotWorldState, cursor: number, keep: (lines: string[]) => boolean): string | null {
    const page = state.recentDialogs.find(d => position(d) > cursor && keep(d.text));
    return page ? page.text.join(' ') : null;
}

/** The first dialog page after `cursor` with a line matching `pattern` (any page without one), as one line, or null. */
export function dialogSince(state: BotWorldState, cursor: number, pattern?: RegExp): string | null {
    return pageSince(state, cursor, lines => !pattern || lines.some(line => pattern.test(line)));
}

/** A level-up page ("Congratulations, you just advanced a Woodcutting level."), colour tags allowed in front. */
export const LEVEL_UP_PAGE = /^(@[a-z0-9]+@)*\s*congratulations, you /i;

/**
 * The first dialog page after `cursor` that is not a level-up (a message box, an NPC line), as one line, or
 * null: a skill level gained during the wait says nothing about the interaction.
 */
export function dialogPageSince(state: BotWorldState, cursor: number): string | null {
    return pageSince(state, cursor, lines => !LEVEL_UP_PAGE.test(lines.join(' ')));
}

/** The server's refusal when a target cannot be walked to; ops read it with `messageSince`. */
export const CANT_REACH = /can't reach|cannot reach/i;
