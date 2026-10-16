// Not ported: sdk/actions.ts has no spinning method; closest upstream is fletchLogs @ 4c2069cc0 (the make
// menu). The spinning wheel's Spin option (oploc2 in skill_crafting/scripts/spinning/spinning.rs2) opens a
// skill_multi2 menu, Wool and Flax with four buttons each (Make X, Make 10, Make 5 and the product's own
// Make 1). Like `fletch` the op owns that menu: it closes a stale one first, opens it, clicks the
// material's group, and closes it on every path that leaves it open (a bailout, a refused click, a cancel).
// Unlike fletch it asks for a quantity: "Make X" and then the count dialog (the client waits for it, as it
// does for a bank's Withdraw-X), so one call spins a whole inventory of flax in the engine's queue
// (3 ticks to the first, 2 per item after). It then waits on Crafting XP until `amount` are spun or the
// queue stalls (a level-up dialog or an interruption ends it early; the XP so far is still `ok`).
// Flax is a members-only material (spinning.rs2 ^mes_members_feature).
import { resolveSkillDialogProduct, skillDialogProductLabels } from '../../sdk/action-quantity';
import type { ActionResult, BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItems, findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { isSkillMenu } from './dismiss';
import { interactLoc } from './interact';
import { CANT_REACH, dialogSince, messageCursor, messageSince } from './messages';

/** Ticks to wait for the menu: fletch's 5 s doubled, as the wait includes the walk up to the wheel. */
export const SPIN_MENU_TICKS = Math.ceil(10_000 / TICK_MS);
/** Ticks a closeModal gets to take the menu away. */
export const SPIN_CLOSE_TICKS = 5;
/** The first item's wait after the click: the 3-tick queue and the count dialog, with room for lag. */
export const SPIN_START_TICKS = 12;
/** Ticks a running batch may go without Crafting XP before it counts as ended early (the queue spins every 2 ticks). */
export const SPIN_STALL_TICKS = 6;
/** The option that opens the menu. */
export const SPIN_OPTION = /^spin/i;

/** What a wheel spins, by the menu's label: the material and the exact names of what goes in and comes out. */
export const SPINNABLES = {
    flax: { level: 10, input: /^flax$/i, output: 'Bow string' },
    wool: { level: 1, input: /^wool$/i, output: 'Ball of wool' },
} as const;
export type Spinnable = keyof typeof SPINNABLES;

/** Game messages the wheel answers with (spinning.rs2): too low a Crafting level, a free world, not a Fremennik. */
const TOO_LOW = /need (a )?(level|crafting level)/i;
const MEMBERS = /members/i;
const NOT_ALLOWED = /only fremenniks/i;
/** The skill menu's Make X button. */
const MAKE_X = /^make\s+x$/i;

export type SpinResult =
    | { ok: true; spun: number; xpGained: number }
    | {
          ok: false;
          reason:
              | 'no-material'
              | 'cant-reach'
              | 'not-allowed'
              | 'members'
              | 'no-menu'
              | 'no-product'
              | 'level-too-low'
              | 'send-failed'
              | 'timeout';
          message: string;
      };

const xpOf = (s: BotWorldState) => findSkill(s, 'Crafting')?.experience ?? 0;
const label = (text: string) => text.replaceAll('\\n', '').trim();

/** Closes the open modal and waits (bounded) for the menu to go; the caller checks whether it did. */
function* closeMenu(): Op<ActionResult> {
    const sent = yield* send({ type: 'closeModal', reason: 'close spinning menu' });
    if (sent.success) yield* wait('spinning menu closed', st => !isSkillMenu(st.dialog), SPIN_CLOSE_TICKS);
    return sent;
}

/**
 * Takes the wheel's Spin option, picks `material` in the menu, asks for `amount` (default: every one held;
 * at most what is held) and waits until that many are spun or the queue stalls. `spun` counts what left
 * the inventory.
 */
export function* spin(ctx: ActionContext, wheel: NearbyLoc, material: Spinnable, amount?: number): Op<SpinResult> {
    const { input } = SPINNABLES[material];
    const s = ctx.state();
    const held = countItems(s, input);
    if (held === 0) return { ok: false, reason: 'no-material', message: `No ${material} in inventory` };
    const want = Math.min(amount ?? held, held);
    const xpBefore = xpOf(s);
    const cursor = messageCursor(s);
    const said = (st: BotWorldState, pattern: RegExp) =>
        messageSince(st, cursor, pattern) ?? dialogSince(st, cursor, pattern);

    // A menu already open would satisfy the wait below on the send tick, and the click would answer
    // whatever it is for: take it away first.
    if (isSkillMenu(s.dialog)) {
        const closed = yield* closeMenu();
        if (!closed.success) return { ok: false, reason: 'send-failed', message: closed.message };
        if (isSkillMenu(ctx.state().dialog))
            return { ok: false, reason: 'timeout', message: 'A make menu was already open and would not close' };
    }

    let opened = false;
    let clicked = false;
    try {
        const sent = yield* interactLoc(wheel, SPIN_OPTION);
        if (!sent.ok)
            return {
                ok: false,
                reason: sent.reason === 'no-option' ? 'no-menu' : 'send-failed',
                message: sent.message,
            };
        opened = true;
        const menu = yield* wait(
            'spinning menu',
            st =>
                isSkillMenu(st.dialog) ||
                !!messageSince(st, cursor, CANT_REACH) ||
                !!said(st, NOT_ALLOWED) ||
                !!said(st, MEMBERS),
            SPIN_MENU_TICKS,
        );
        if (!isSkillMenu(menu.state.dialog)) {
            if (messageSince(menu.state, cursor, CANT_REACH))
                return { ok: false, reason: 'cant-reach', message: `Cannot reach ${wheel.name}` };
            const denied = said(menu.state, NOT_ALLOWED);
            if (denied) return { ok: false, reason: 'not-allowed', message: denied };
            const members = said(menu.state, MEMBERS);
            if (members) return { ok: false, reason: 'members', message: members };
            return { ok: false, reason: 'no-menu', message: 'Spinning menu did not open' };
        }
        const options = menu.state.dialog.options;
        const choice = resolveSkillDialogProduct(options, material);
        if (!choice) {
            const available = skillDialogProductLabels(options)
                .map(l => `"${label(l)}"`)
                .join(', ');
            return {
                ok: false,
                reason: 'no-product',
                message: `No spinning product matched "${material}". Available: ${available}`,
            };
        }
        // The material's own button is Make 1; its Make X sits among the three buttons before it.
        const at = options.indexOf(choice);
        const makeX = options.slice(Math.max(0, at - 3), at).find(o => MAKE_X.test(label(o.text)));
        const button = want > 1 ? makeX : choice;
        if (!button)
            return { ok: false, reason: 'no-product', message: `No "Make X" button for "${label(choice.text)}"` };
        const click = yield* send({
            type: 'clickDialogOption',
            optionIndex: button.index,
            reason: `spin ${material}${want > 1 ? ' (Make X)' : ''}`,
        });
        if (!click.success) return { ok: false, reason: 'send-failed', message: click.message };
        clicked = true;
        if (want > 1) {
            const count = yield* send({ type: 'submitCountDialog', value: want, reason: `spin ${want} ${material}` });
            if (!count.success) return { ok: false, reason: 'send-failed', message: count.message };
        }
        const first = yield* wait(
            `spin ${material}`,
            st => xpOf(st) > xpBefore || !!said(st, TOO_LOW) || !!said(st, MEMBERS),
            SPIN_START_TICKS,
        );
        if (xpOf(first.state) <= xpBefore) {
            const tooLow = said(first.state, TOO_LOW);
            if (tooLow) return { ok: false, reason: 'level-too-low', message: tooLow };
            // spinning.rs2 opens the menu first and refuses flax on a free world only after the click.
            const members = said(first.state, MEMBERS);
            if (members) return { ok: false, reason: 'members', message: members };
            return { ok: false, reason: 'timeout', message: 'Spinning timed out' };
        }
        // The queue keeps spinning after the first XP: wait until the batch is spun or it stalls.
        let state = first.state;
        const levelBefore = findSkill(s, 'Crafting')?.baseLevel ?? 0;
        // A level-up opens a dialog that stops the queue: the batch is over, don't wait out the stall.
        while (
            held - countItems(state, input) < want &&
            (findSkill(state, 'Crafting')?.baseLevel ?? 0) === levelBefore
        ) {
            const seen = xpOf(state);
            const next = yield* wait('spin progress', st => xpOf(st) > seen, SPIN_STALL_TICKS);
            state = next.state;
            if (next.kind !== 'met') break;
        }
        return { ok: true, spun: held - countItems(state, input), xpGained: xpOf(state) - xpBefore };
    } finally {
        // The menu is the op's from the Spin click until its button answers it. Under a cancel this runs
        // in the interpreter's bounded cleanup.
        if (opened && !clicked && isSkillMenu(ctx.state().dialog)) yield* closeMenu();
    }
}
