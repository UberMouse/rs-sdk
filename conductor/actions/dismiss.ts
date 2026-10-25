// Ported from sdk/actions.ts dismissBlockingUI @ 4c2069cc0
// Unlike bot.dismissBlockingUI it waits for each click or close to take effect (the dialog closes or
// shows another page, the modal closes) rather than for any state update, and says how it ended
// instead of returning nothing. It can be limited to dialogs or to modals, so the dialog and
// interface guards each clear only their own. Like upstream it never answers a dialog with more than
// one option: a choice belongs to whoever opened it (except clearStrayChoice, which declines or closes
// one nobody owns). A skill make menu it leaves alone without calling
// it a choice: the op that opened it answers it, and a level-up clicked away can reveal one. Nor does
// it close the anvil's smithing interface, which upstream would: the smith op owns that one.
import type { BotAction, BotWorldState, DialogState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import { COMBOLOCK_INTERFACES } from './combolock';
import type { ActionContext } from './context';

/**
 * Modals never closed here: closing declines a two-party screen or strands the player (it must be
 * completed). A copy of sdk/actions.ts NEVER_AUTO_CLOSE, which is not exported, so this closes exactly
 * what bot.dismissBlockingUI does. Ids from server/content/pack/interface.pack.
 */
export const NEVER_CLOSE_INTERFACES: ReadonlySet<number> = new Set([
    40000, // grand_exchange: a deliberate offer/draft session
    3323, // trademain: closing declines a player trade
    3443, // tradeconfirm: the second trade screen, same risk
    6412, // duel_confirm: same risk for duels
    6554, // macro_cube: anti-macro random event, must be solved
    3559, // player_kit: character design, must be accepted
]);

/**
 * The anvil's smithing interface (`smithing` in server/content/pack/interface.pack): the smith op
 * (actions/smith.ts) opens it on purpose by using a bar on an anvil, clicks a product in it, and closes
 * it itself on every path that leaves it open.
 */
export const SMITHING_INTERFACE = 994;

/**
 * Harold's dice table (`death_dice` in interface.pack): the Death Plateau gamble opens it after the bet, and the
 * talk task's `press` rolls in it and closes it itself.
 */
export const DEATH_DICE_INTERFACE = 6675;

/**
 * Main modals an op opens on purpose and owns until it ends, which no guard may close under it. Unlike
 * NEVER_CLOSE_INTERFACES, bot.dismissBlockingUI would close these: an op's wait inside one would have
 * it closed every tick by the interface guard. One left open when a run starts is closed then
 * (leftoverModal, lib/engine.ts). The combination locks (combolockdoor, tribal_door2: actions/combolock.ts) are
 * opened by a door interaction and worked by the combolock task's solve step, which runs under withModal so every
 * exit path closes the lock; one left from a killed run is a leftoverModal, closed at the next run's start. Harold's
 * dice table is opened by the conversation the talk task drives and rolled in by its `press`, which closes it.
 */
export const OP_OWNED_INTERFACES: ReadonlySet<number> = new Set([
    SMITHING_INTERFACE,
    DEATH_DICE_INTERFACE,
    ...COMBOLOCK_INTERFACES,
]);

/**
 * An open main modal bot.dismissBlockingUI would close: a book, scroll or other informational one, not a
 * shop, bank or Grand Exchange session nor one in NEVER_CLOSE_INTERFACES. An op's own interface
 * (OP_OWNED_INTERFACES) does not count either: the op that opened it closes it.
 */
export const closableInterface = (s: BotWorldState): boolean =>
    s.interface.isOpen &&
    !s.shop.isOpen &&
    !s.bank.isOpen &&
    !s.ge?.isOpen &&
    !NEVER_CLOSE_INTERFACES.has(s.interface.interfaceId) &&
    !OP_OWNED_INTERFACES.has(s.interface.interfaceId);

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

/** A dialog or button text without its colour tags and literal "\\n" line breaks. */
export const cleanText = (t: string): string => t.replace(COLOUR_TAG, '').replaceAll('\\n', '').trim();

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
    const buttons = d.options.map(o => cleanText(o.text));
    const quantity = buttons.filter(b => QUANTITY_BUTTON.test(b));
    return quantity.length >= MENU_MIN_QUANTITY_BUTTONS && quantity.some(b => X_BUTTON.test(b));
};

/**
 * What a run finds open before its first step, which nothing in the run opened, named for a log line: a
 * main modal (an op's own interface, a book, a bank or shop) left by a run that was killed or whose close
 * failed, or a skill make menu. Not a two-party or must-complete screen (NEVER_CLOSE_INTERFACES, the
 * Grand Exchange). Null when nothing is.
 */
export const leftoverModal = (s: BotWorldState): string | null => {
    if (s.interface.isOpen && !s.ge?.isOpen && !NEVER_CLOSE_INTERFACES.has(s.interface.interfaceId)) {
        if (s.bank.isOpen) return 'bank';
        if (s.shop.isOpen) return 'shop';
        return `interface ${s.interface.interfaceId}`;
    }
    return isSkillMenu(s.dialog) ? 'skill menu' : null;
};

/**
 * A multi-option dialog (an NPC choice) open that is not a skill menu. At run start nothing owns it: an
 * earlier run opened it (the Al Kharid toll guard's "Yes, ok." choice) and was cut off.
 */
export const strayChoice = (s: BotWorldState): boolean =>
    s.dialog.isOpen && s.dialog.options.length > 1 && !isSkillMenu(s.dialog);

/**
 * The options a stray choice may be answered with: plain refusals only. Never one that buys, pays, accepts
 * or asks ("Yes, ok.", "Who does my money go to?"); with none of these the dialog is closed instead.
 */
export const DECLINE_CHOICE = /^(no\b|nope\b|never ?mind\b|cancel\b|goodbye\b|bye\b|not now\b|maybe later\b|leave\b)/i;
/** Ticks the decline click or close of a stray choice waits for the choice to go. */
export const STRAY_CHOICE_WAIT_TICKS = 5;

/**
 * Gets rid of a stray choice dialog: clicks its decline option (DECLINE_CHOICE) when it has one, else (or if
 * that leaves the choice open) closes the dialog. The "continue" pages the decline then shows are the dialog
 * guard's. `ok` once no choice is open.
 */
export function* clearStrayChoice(ctx: ActionContext): Op<DismissResult> {
    const s = ctx.state();
    if (!strayChoice(s)) return { ok: true, actions: 0 };
    const decline = s.dialog.options.find(o => DECLINE_CHOICE.test(cleanText(o.text)));
    /** One click or close of the choice, then the wait for it to go: `done` if it did or the send failed, else the state it ended on. */
    function* attempt(
        action: BotAction,
        label: string,
    ): Op<{ kind: 'done'; result: DismissResult } | { kind: 'open'; state: BotWorldState }> {
        const sent = yield* send(action);
        if (!sent.success) return { kind: 'done', result: { ok: false, reason: 'send-failed', message: sent.message } };
        const w = yield* wait(label, st => !strayChoice(st), STRAY_CHOICE_WAIT_TICKS);
        return w.kind === 'met' ? { kind: 'done', result: { ok: true, actions: 1 } } : { kind: 'open', state: w.state };
    }
    let actions = 0;
    if (decline) {
        const r = yield* attempt(
            { type: 'clickDialogOption', optionIndex: decline.index, reason: 'decline stray choice' },
            'stray choice declined',
        );
        if (r.kind === 'done' && (r.result.ok || r.result.reason === 'send-failed')) return r.result;
        actions++;
    }
    const r = yield* attempt({ type: 'closeModal', reason: 'close stray choice' }, 'stray choice closed');
    if (r.kind === 'done') return r.result.ok ? { ok: true, actions: actions + 1 } : r.result;
    return { ok: false, reason: 'stuck', message: `a choice is still open: ${optionTexts(r.state.dialog)}` };
}

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
