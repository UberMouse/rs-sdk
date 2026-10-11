// Ported from sdk/actions.ts fletchLogs @ 4c2069cc0
// Unlike bot.fletchLogs it takes the logs as an exact-name pattern (upstream cuts the first item
// named like logs), needs an item named exactly Knife (upstream's /knife/i also matches throwing
// knives), and answers its own make menu as an explicit step: wait for the menu, click the product,
// wait for the XP. Other dialogs (a level-up, the "you need a Fletching level" box) are the dialog
// guard's, which leaves a skill make menu alone (isSkillMenu), so a level-up mid-fletch is cleared
// while the op still gets its menu. It has no branch for a make-X interface as upstream does: this
// game's fletching menus are dialogs (skill_multi), never an interface. A shop or bank hiding the
// inventory is the SDK's refusal of the send (`send-failed`), not a separate check. The op owns its
// menu: an open chat-modal menu freezes the player's queues and timers (HP regen needs canAccess)
// until some packet closes it, so the op closes it on every path that leaves it open, and a stale
// one before it starts.
// Unlike upstream it can also click the Make 5 / Make 10 button in the product's button group, and
// then waits on observed Fletching XP until the batch is cut or stalls (FLETCH_STALL_TICKS without XP).
import { resolveSkillDialogProduct, skillDialogProductLabels } from '../../sdk/action-quantity';
import type { ActionResult, BotWorldState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItems, findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { isSkillMenu } from './dismiss';
import { dialogSince, messageCursor, messageSince } from './messages';

/** bot.fletchLogs's 5s wait for the make menu to open, in ticks. */
export const FLETCH_MENU_TICKS = Math.ceil(5000 / TICK_MS);
/** Ticks a closeModal gets to take the make menu away. */
export const FLETCH_CLOSE_TICKS = 5;
/** bot.fletchLogs's 30 one-tick attempts for the XP after the product is clicked. */
export const FLETCH_MAKE_TICKS = 30;
/**
 * Ticks a running batch may go without Fletching XP before it counts as ended early. The server cuts
 * one log every 2 ticks (`process_fletch_logs` sets `%action_delay` to map_clock + 2); a level-up
 * dialog or an interruption stops the queue, and this is how long the op waits to be sure of it.
 */
export const FLETCH_STALL_TICKS = 6;
/** Logs per click the make menu offers: its Make 1 (the product's own button), Make 5 and Make 10. */
export type FletchBatch = 1 | 5 | 10;

const KNIFE = /^knife$/i;
/** Upstream's game-message check, and this game's level box ("You need a Fletching level of at least 5 ..."). */
const TOO_LOW = /need a higher|level to|need a fletching level/i;
/**
 * Fletching is members-only. The server's refusal (^mes_members_fletching in skill_fletching/scripts:
 * "You need to be on a members' world to gain experience in Fletching.") and the client's own ("To use
 * this item please login to a members' server.") both name the members world or server.
 */
const MEMBERS = /members'? (world|server)/i;

export type FletchResult =
    | { ok: true; xpGained: number; product: string }
    | {
          ok: false;
          reason:
              | 'no-knife'
              | 'no-logs'
              | 'members'
              | 'no-menu'
              | 'no-product'
              | 'level-too-low'
              | 'send-failed'
              | 'timeout';
          message: string;
      };

const levelOf = (s: BotWorldState) => findSkill(s, 'Fletching')?.baseLevel ?? 0;
const xpOf = (s: BotWorldState) => findSkill(s, 'Fletching')?.experience ?? 0;
/** A product's label without the literal "\n\n\n\n" the client publishes before it. */
const label = (text: string) => text.replaceAll('\\n', '').trim();

const BATCH_BUTTON: Record<5 | 10, RegExp> = { 5: /^make 5$/i, 10: /^make 10$/i };

/** Closes the open modal and waits (bounded) for the make menu to go; the caller checks whether it did. */
function* closeMenu(): Op<ActionResult> {
    const sent = yield* send({ type: 'closeModal', reason: 'close make menu' });
    if (sent.success) yield* wait('make menu closed', st => !isSkillMenu(st.dialog), FLETCH_CLOSE_TICKS);
    return sent;
}

/**
 * Uses a knife on the first inventory item matching `logs`, picks `product` in the make menu by its
 * label ("arrow shaft", "short bow", "oak long"; omitted, the first product), and waits for Fletching
 * XP. One call makes one batch: `batch` logs' worth (default 1: 15 shafts, or one bow). A batch of 5 or
 * 10 clicks the menu's "Make 5" / "Make 10" button in the product's group and waits, on Fletching XP,
 * until that many logs (or all there are) are cut, or no XP comes for FLETCH_STALL_TICKS (a level-up
 * or interruption ended it early; the XP so far is still `ok`). `xpGained` is the whole batch's.
 * `members` is the free-world refusal.
 */
export function* fletch(ctx: ActionContext, logs: RegExp, product?: string, batch: FletchBatch = 1): Op<FletchResult> {
    const s = ctx.state();
    const knife = s.inventory.find(i => KNIFE.test(i.name));
    if (!knife) return { ok: false, reason: 'no-knife', message: 'No knife in inventory' };
    const item = s.inventory.find(i => logs.test(i.name));
    if (!item) return { ok: false, reason: 'no-logs', message: 'No logs in inventory' };
    const xpBefore = xpOf(s);
    const logsBefore = countItems(s, logs);
    const levelBefore = levelOf(s);
    const cursor = messageCursor(s);
    const tooLow = (st: BotWorldState) => messageSince(st, cursor, TOO_LOW) ?? dialogSince(st, cursor, TOO_LOW);
    const members = (st: BotWorldState) => messageSince(st, cursor, MEMBERS);

    // A menu already open would satisfy the wait below on the send tick, and the click would answer
    // whatever it is for: take it away first.
    if (isSkillMenu(s.dialog)) {
        const closed = yield* closeMenu();
        if (!closed.success) return { ok: false, reason: 'send-failed', message: closed.message };
        if (isSkillMenu(ctx.state().dialog))
            return { ok: false, reason: 'timeout', message: 'A make menu was already open and would not close' };
    }

    let sentKnife = false;
    let clicked = false;
    try {
        const used = yield* send({
            type: 'useItemOnItem',
            sourceSlot: knife.slot,
            targetSlot: item.slot,
            reason: `use ${knife.name} on ${item.name}`,
        });
        if (!used.success) return { ok: false, reason: 'send-failed', message: used.message };
        sentKnife = true;
        const menu = yield* wait('fletching menu', st => isSkillMenu(st.dialog) || !!members(st), FLETCH_MENU_TICKS);
        const refused = members(menu.state);
        if (refused) return { ok: false, reason: 'members', message: refused };
        if (menu.kind === 'timeout') return { ok: false, reason: 'no-menu', message: 'Fletching dialog did not open' };

        const options = menu.state.dialog.options;
        const choice = resolveSkillDialogProduct(options, product);
        if (!choice) {
            const available = skillDialogProductLabels(options)
                .map(l => `"${label(l)}"`)
                .join(', ');
            return {
                ok: false,
                reason: 'no-product',
                message: `No fletching product matched "${product}". Available: ${available}`,
            };
        }
        const chosen = label(choice.text);
        // The product's own button is Make 1; its Make 5 / Make 10 sit in the three buttons before it.
        const at = options.indexOf(choice);
        const quantity =
            batch === 1
                ? undefined
                : options.slice(Math.max(0, at - 3), at).find(o => BATCH_BUTTON[batch].test(label(o.text)));
        if (batch !== 1 && !quantity)
            return { ok: false, reason: 'no-product', message: `No "Make ${batch}" button for "${chosen}"` };
        const click = yield* send({
            type: 'clickDialogOption',
            optionIndex: (quantity ?? choice).index,
            reason: batch === 1 ? `fletch ${chosen}` : `fletch ${chosen} x${batch}`,
        });
        if (!click.success) return { ok: false, reason: 'send-failed', message: click.message };
        clicked = true;
        const made = yield* wait(`fletch ${chosen}`, st => xpOf(st) > xpBefore || !!tooLow(st), FLETCH_MAKE_TICKS);
        if (xpOf(made.state) > xpBefore) {
            // The batch keeps cutting after the first XP: wait until its logs are gone or it stalls.
            const target = Math.min(batch, logsBefore);
            let state = made.state;
            // A level-up opens a dialog that stops the queue: the batch is over, don't wait out the stall.
            while (logsBefore - countItems(state, logs) < target && levelOf(state) === levelBefore) {
                const seen = xpOf(state);
                const next = yield* wait('fletch batch progress', st => xpOf(st) > seen, FLETCH_STALL_TICKS);
                state = next.state;
                if (next.kind !== 'met') break;
            }
            return { ok: true, xpGained: xpOf(state) - xpBefore, product: chosen };
        }
        if (tooLow(made.state)) return { ok: false, reason: 'level-too-low', message: 'Fletching level too low' };
        return { ok: false, reason: 'timeout', message: 'Fletching timed out' };
    } finally {
        // The menu is the op's from the knife until the click answers it: leaving through no-product, a
        // refused click or a cancel must not leave it open. Under a cancel this runs in the
        // interpreter's bounded cleanup.
        if (sentKnife && !clicked && isSkillMenu(ctx.state().dialog)) yield* closeMenu();
    }
}
