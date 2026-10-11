// Ported from sdk/actions.ts talkTo and navigateDialog @ 3b2be2bc2
// `startTalk` is talkTo's send and wait for the dialog, without upstream's walk to the NPC (a task walks
// first itself), its dismissBlockingUI (the task owns the dialog) or its idle-walk clock: it waits a
// tick budget for the dialog, the server's "I can't reach that!" or the NPC leaving view, and takes
// any option (Talk-to, or another such as Trade) rather than only talk-to.
// `converse` is navigateDialog on a conversation instead of a fixed list of clicks. Upstream clicks
// the n-th choice against whatever dialog is open one tick later, skips a missing option with a warning
// and never tells where the conversation ended. Here a "click here to continue" page (no choice) is
// clicked through on its own, the next choice is matched against the page that offers it (by its text,
// colour tags stripped), a missing option or one nobody expected fails with the options shown, and the
// conversation is done only when the dialog has closed after the last choice. The dialog guard leaves a
// choice alone but clicks the continue pages, so a task running this op sets `allow: ['dialog']`: the op
// is the dialog it opened on purpose and answers every page itself.
import type { BotWorldState, DialogState, NearbyNpc } from '../../sdk/types';
import { log, type Op, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** The option that starts a conversation. */
export const TALK_OPTION = /^talk-?to$/i;
/** bot.talkTo's 30 s safety net, shortened: the client walks the last tiles, so a dialog opens well inside this. */
export const TALK_OPEN_TICKS = Math.ceil(12_000 / TICK_MS);
/** Ticks one click gets to show another page or close the dialog (dismiss's 2 s). */
const PAGE_WAIT_TICKS = Math.ceil(2000 / TICK_MS);
/**
 * Ticks a closed dialog gets to open again before the conversation counts as over. A script's pause
 * between two pages (an item given, a message box) can close the dialog for a tick or two.
 */
export const REOPEN_GRACE_TICKS = 4;
/** Ticks a dialog that publishes no option yet gets to show one before a bare click on option 0 (as dismiss). */
export const OPTION_APPEAR_TICKS = 2;
/** Clicks that sit on one unchanged page before the conversation counts as stuck. */
export const PAGE_STALL_LIMIT = 3;
/** Clicks one conversation may take; the longest quest conversation here is about 40 pages. */
export const MAX_CLICKS = 120;
/** The worst case of one click and its wait, in ticks. */
const CLICK_TICKS = 1 + PAGE_WAIT_TICKS;
/** The worst case of a whole conversation, in ticks, for a step that reserves it. */
export const CONVERSE_MAX_TICKS = MAX_CLICKS * CLICK_TICKS;

export type StartTalkResult =
    | { ok: true }
    | { ok: false; reason: 'no-option' | 'send-failed' | 'cant-reach' | 'target-gone' | 'timeout'; message: string };

export type ConverseResult =
    | { ok: true; answered: number }
    | {
          ok: false;
          reason: 'missing-option' | 'unexpected-choice' | 'closed-early' | 'send-failed' | 'stuck';
          message: string;
      };

/** How far a conversation has got, kept by the caller so a cut-off step resumes the same dialog. */
export interface TalkProgress {
    /** Choices answered so far. */
    answered: number;
}

const COLOUR_TAG = /@[a-z0-9]+@/gi;
const cleanText = (t: string) => t.replace(COLOUR_TAG, '').replaceAll('\\n', '').trim();
const optionTexts = (d: DialogState) => d.options.map(o => `"${cleanText(o.text)}"`).join(' | ') || '(none)';
const pageOf = (d: DialogState): string =>
    JSON.stringify([d.text ?? '', d.options.map(o => o.text), (d.allComponents ?? []).map(c => c.text)]);

/**
 * Sends `option` (default Talk-to) on `npc` and waits for its dialog. The bot should be near the NPC (walk
 * first); the client's pathing covers the last tiles. `ok` once a dialog is open, whatever page it shows.
 */
export function* startTalk(ctx: ActionContext, npc: NearbyNpc, option: RegExp = TALK_OPTION): Op<StartTalkResult> {
    const match = npc.optionsWithIndex.find(o => option.test(o.text));
    if (!match) return { ok: false, reason: 'no-option', message: `no ${option} option on ${npc.name}` };
    const cursor = messageCursor(ctx.state());
    const sent = yield* send({
        type: 'interactNpc',
        npcIndex: npc.index,
        optionIndex: match.opIndex,
        reason: `${match.text} ${npc.name}`,
    });
    if (!sent.success)
        return {
            ok: false,
            reason: sent.reason === 'cant_reach' ? 'cant-reach' : 'send-failed',
            message: sent.message,
        };
    const visible = (s: BotWorldState) => s.nearbyNpcs.some(n => n.index === npc.index);
    const w = yield* wait(
        `talk to ${npc.name}`,
        s => s.dialog.isOpen || !!messageSince(s, cursor, CANT_REACH) || !visible(s),
        TALK_OPEN_TICKS,
    );
    if (w.state.dialog.isOpen) return { ok: true };
    if (messageSince(w.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `Cannot reach ${npc.name}` };
    if (!visible(w.state)) return { ok: false, reason: 'target-gone', message: `${npc.name} left view` };
    return {
        ok: false,
        reason: 'timeout',
        message: `${npc.name} opened no dialog within ${TALK_OPEN_TICKS} ticks`,
    };
}

/**
 * Answers the open conversation: continue pages are clicked through, each choice is answered with the
 * next of `choices` that matches one of its options (tested on the text without colour tags). `ok` when
 * the dialog has closed (and stayed closed REOPEN_GRACE_TICKS) after every choice was answered.
 * `missing-option` is a choice with no option matching the next pattern, `unexpected-choice` one
 * offered after the last was answered; both name the options. `closed-early` is the dialog closing with
 * choices left; `stuck` a page that did not move PAGE_STALL_LIMIT clicks in a row (or MAX_CLICKS in all).
 * `progress.answered` is the count of choices answered, updated at each click so a cancelled call can
 * be resumed on the dialog still open.
 */
export function* converse(ctx: ActionContext, choices: readonly RegExp[], progress: TalkProgress): Op<ConverseResult> {
    let s = ctx.state();
    let stalls = 0;
    let clicks = 0;
    while (true) {
        if (!s.dialog.isOpen) {
            const w = yield* wait('dialog open again', st => st.dialog.isOpen, REOPEN_GRACE_TICKS);
            if (w.kind === 'timeout') {
                if (progress.answered >= choices.length) return { ok: true, answered: progress.answered };
                return {
                    ok: false,
                    reason: 'closed-early',
                    message: `the dialog closed after ${progress.answered} of ${choices.length} choices (next: ${choices[progress.answered]})`,
                };
            }
            s = w.state;
            continue;
        }
        if (clicks === MAX_CLICKS)
            return { ok: false, reason: 'stuck', message: `conversation still open after ${MAX_CLICKS} clicks` };

        const d = s.dialog;
        let index: number;
        if (d.options.length > 1) {
            const expected = choices[progress.answered];
            if (!expected)
                return {
                    ok: false,
                    reason: 'unexpected-choice',
                    message: `a choice came after all ${choices.length} were answered: ${optionTexts(d)}`,
                };
            const option = d.options.find(o => expected.test(cleanText(o.text)));
            if (!option)
                return {
                    ok: false,
                    reason: 'missing-option',
                    message: `no option matching ${expected} (choice ${progress.answered + 1} of ${choices.length}); the dialog offers ${optionTexts(d)}`,
                };
            index = option.index;
            yield* log(`dialog: choosing "${cleanText(option.text)}"`);
        } else {
            if (d.options.length === 0) {
                // Transitional: wait briefly for the page's option, then click 0 as dismiss does.
                const w = yield* wait(
                    'dialog option',
                    st => !st.dialog.isOpen || st.dialog.options.length > 0,
                    OPTION_APPEAR_TICKS,
                );
                if (w.kind === 'met') {
                    s = w.state;
                    continue;
                }
            }
            index = d.options[0]?.index ?? 0;
        }
        const chose = d.options.length > 1;
        const page = pageOf(d);
        const sent = yield* send({
            type: 'clickDialogOption',
            optionIndex: index,
            reason: chose ? 'dialog choice' : 'continue dialog',
        });
        if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
        clicks++;
        // Counted at once, before any wait: a cancel from here on finds the choice already made.
        if (chose) progress.answered++;
        const w = yield* wait(
            'dialog moved on',
            st => !st.dialog.isOpen || pageOf(st.dialog) !== page,
            PAGE_WAIT_TICKS,
        );
        if (w.kind === 'timeout') {
            // The same words twice in a row are a page of its own; only repeated stalls are stuck.
            if (chose || ++stalls >= PAGE_STALL_LIMIT)
                return {
                    ok: false,
                    reason: 'stuck',
                    message: `the dialog did not move on: ${optionTexts(w.state.dialog)}`,
                };
        } else stalls = 0;
        s = w.state;
    }
}
