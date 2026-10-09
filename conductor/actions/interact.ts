// Ported from sdk/actions.ts interactLoc @ 4c2069cc0
// Only the option lookup and the send. bot.interactLoc also walks to a loc over 2 tiles away and then
// waits for any animation, dialog or interface; here the client's own pathing takes the bot to the
// loc, a task walks first itself when it must, and each caller waits for the effect it needs (logs,
// ore) instead.
import type { NearbyLoc } from '../../sdk/types';
import { type Op, send } from '../core/op';

export type InteractResult = { ok: true } | { ok: false; reason: 'no-option' | 'send-failed'; message: string };

/**
 * Sends `option` on `loc`: an option index, or a pattern for one of the loc's option texts. `ok` only
 * means the client sent it, not that the server acted (it may answer "I can't reach that!"): the
 * caller waits for the effect.
 */
export function* interactLoc(loc: NearbyLoc, option: number | RegExp): Op<InteractResult> {
    let optionIndex: number;
    let label: string;
    if (typeof option === 'number') {
        // An index is sent even when the loc doesn't publish it, as bot.interactLoc does.
        optionIndex = option;
        label = loc.optionsWithIndex.find(o => o.opIndex === option)?.text ?? `op ${option}`;
    } else {
        const match = loc.optionsWithIndex.find(o => option.test(o.text));
        if (!match) return { ok: false, reason: 'no-option', message: `no ${option} option on ${loc.name}` };
        optionIndex = match.opIndex;
        label = match.text;
    }
    const sent = yield* send({
        type: 'interactLoc',
        x: loc.x,
        z: loc.z,
        locId: loc.id,
        optionIndex,
        reason: `${label} ${loc.name}`,
    });
    return sent.success ? { ok: true } : { ok: false, reason: 'send-failed', message: sent.message };
}
