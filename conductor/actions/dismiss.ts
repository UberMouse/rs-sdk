// Ported from sdk/actions.ts dismissBlockingUI @ 4c2069cc0
// Unlike bot.dismissBlockingUI it waits for each click or close to take effect (the dialog closes or
// shows another page, the modal closes) rather than for any state update, and says how it ended
// instead of returning nothing. It can be limited to dialogs or to modals, so the dialog and
// interface guards each clear only their own. Like upstream it never answers a dialog with more than
// one option: a choice belongs to whoever opened it. A skill make menu it leaves alone without calling
// it a choice: the op that opened it answers it, and a level-up clicked away can reveal one.
import type { BotWorldState, DialogState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';

/**
 * Modals never closed here: closing declines a two-party screen or strands the player (it must be
 * completed). A copy of sdk/actions.ts NEVER_AUTO_CLOSE, which is not exported, so this closes exactly
 * what bot.dismissBlockingUI does. Ids from server/content/pack/interface.pack.
 */
export const NEVER_CLOSE_INTERFACES: ReadonlySet<number> = new Set([
    10984, // grand_exchange: a deliberate offer/draft session
    3323, // trademain: closing declines a player trade
    3443, // tradeconfirm: the second trade screen, same risk
    6412, // duel_confirm: same risk for duels
    6554, // macro_cube: anti-macro random event, must be solved
    3559, // player_kit: character design, must be accepted
]);

/**
 * An open main modal bot.dismissBlockingUI would close: a book, scroll or other informational one, not a
 * shop, bank or Grand Exchange session nor one in NEVER_CLOSE_INTERFACES.
 */
export const closableInterface = (s: BotWorldState): boolean =>
    s.interface.isOpen &&
    !s.shop.isOpen &&
    !s.bank.isOpen &&
    !s.ge?.isOpen &&
    !NEVER_CLOSE_INTERFACES.has(s.interface.interfaceId);

/**
 * A skill menu's quantity button: "<verb> X" or "<verb> <n>" once colour tags are stripped. The
 * skill_multi menus label them "Make X", "Make 10", "Make 5 @lre@Leather bodies"; the furnace's are
 * "Smelt X @lre@Bronze", "Smelt 10 @lre@Bronze" (server/content: interface_chat/interfaces/skill_multi*.if,
 * skill_smithing/interfaces/smelting.if). A dialog's published state carries no interface id, so the
 * labels are all there is to go by.
 */
const QUANTITY_BUTTON = /^[a-z]+\s+(x|\d+)\b/i;
const X_BUTTON = /^[a-z]+\s+x\b/i;
const COLOUR_TAG = /@[a-z0-9]+@/gi;

/** Fewest quantity buttons that make a menu: a Make X/10/5 trio. No NPC choice offers three "<verb> X/<n>" lines. */
const MENU_MIN_QUANTITY_BUTTONS = 3;

/**
 * A skill's make or smelt menu (knife on logs, ore on a furnace): a chat modal with a row of quantity
 * buttons per product, which only an op that opened one on purpose answers, so the dialog guard and
 * `dismiss` leave it alone. Needs a "<verb> X" button and at least MENU_MIN_QUANTITY_BUTTONS in all,
 * so a level-up (one option) or an NPC choice cannot match.
 */
export const isSkillMenu = (d: DialogState): boolean => {
    if (!d.isOpen) return false;
    const buttons = d.options.map(o => o.text.replace(COLOUR_TAG, '').replaceAll('\\n', '').trim());
    const quantity = buttons.filter(b => QUANTITY_BUTTON.test(b));
    return quantity.length >= MENU_MIN_QUANTITY_BUTTONS && quantity.some(b => X_BUTTON.test(b));
};

/** Clicks or closes per call, as bot.dismissBlockingUI's maxAttempts. */
export const DISMISS_MAX_ACTIONS = 10;
/** bot.dismissBlockingUI's 2s wait after each click or close, in ticks. */
export const DISMISS_WAIT_TICKS = Math.ceil(2000 / TICK_MS);

export type DismissResult =
    | { ok: true; actions: number }
    | { ok: false; reason: 'choice' | 'stuck' | 'send-failed'; message: string };

/** What a dialog shows, to tell that a click moved it to another page. */
const pageOf = (d: DialogState): string =>
    JSON.stringify([d.text ?? '', d.options.map(o => o.text), (d.allComponents ?? []).map(c => c.text)]);

const optionTexts = (d: DialogState) => d.options.map(o => o.text).join(' | ');

/**
 * Clicks through "click here to continue" dialogs and closes informational modals (`closableInterface`)
 * until neither is open (a skill make menu does not count), at most DISMISS_MAX_ACTIONS times.
 * `dialogs: false` or `modals: false` leaves that kind alone. `ok` once nothing it handles is open;
 * `choice` when a dialog with several options is open (left unanswered, nothing sent); `stuck` when a
 * click or close showed no effect within DISMISS_WAIT_TICKS, or the cap ran out.
 */
export function* dismiss(ctx: ActionContext, which: { dialogs?: boolean; modals?: boolean } = {}): Op<DismissResult> {
    const dialogs = which.dialogs ?? true;
    const modals = which.modals ?? true;
    let s = ctx.state();
    for (let actions = 0; ; actions++) {
        const dialog = dialogs && s.dialog.isOpen && !isSkillMenu(s.dialog);
        const modal = !dialog && modals && closableInterface(s);
        if (!dialog && !modal) return { ok: true, actions };
        if (dialog && s.dialog.options.length > 1)
            return { ok: false, reason: 'choice', message: `a choice is open: ${optionTexts(s.dialog)}` };
        if (actions === DISMISS_MAX_ACTIONS)
            return {
                ok: false,
                reason: 'stuck',
                message: `still blocked after ${DISMISS_MAX_ACTIONS} clicks or closes`,
            };

        if (dialog) {
            const page = pageOf(s.dialog);
            // "Click here to continue" carries a server-assigned index (often 1, not 0); a bare 0 is only
            // for a page that publishes no option mid-transition, as upstream.
            const option = s.dialog.options[0]?.index ?? 0;
            const sent = yield* send({ type: 'clickDialogOption', optionIndex: option, reason: 'continue dialog' });
            if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
            const w = yield* wait(
                'dialog moved on',
                st => !st.dialog.isOpen || pageOf(st.dialog) !== page,
                DISMISS_WAIT_TICKS,
            );
            if (w.kind === 'timeout')
                return {
                    ok: false,
                    reason: 'stuck',
                    message: `dialog still on the same page: ${optionTexts(w.state.dialog)}`,
                };
            s = w.state;
        } else {
            const id = s.interface.interfaceId;
            const sent = yield* send({ type: 'closeModal', reason: `close interface ${id}` });
            if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
            const w = yield* wait(
                `interface ${id} closed`,
                st => !closableInterface(st) || st.interface.interfaceId !== id,
                DISMISS_WAIT_TICKS,
            );
            if (w.kind === 'timeout') return { ok: false, reason: 'stuck', message: `interface ${id} still open` };
            s = w.state;
        }
    }
}
