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

/** The first dialog page after `cursor` with a line matching `pattern`, as one line, or null. */
export function dialogSince(state: BotWorldState, cursor: number, pattern: RegExp): string | null {
    const page = state.recentDialogs.find(d => position(d) > cursor && d.text.some(line => pattern.test(line)));
    return page ? page.text.join(' ') : null;
}
