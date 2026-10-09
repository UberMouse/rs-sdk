// Ported from sdk/actions.ts fletchLogs @ 4c2069cc0
// Unlike bot.fletchLogs it takes the logs as an exact-name pattern (upstream cuts the first item
// named like logs), needs an item named exactly Knife (upstream's /knife/i also matches throwing
// knives), and answers its own make menu as an explicit step: wait for the menu, click the product,
// wait for the XP. Other dialogs (a level-up, the "you need a Fletching level" box) are the dialog
// guard's, which leaves a skill make menu alone (isSkillMenu), so a level-up mid-fletch is cleared
// while the op still gets its menu. It has no branch for a make-X interface as upstream does: this
// game's fletching menus are dialogs (skill_multi), never an interface. A shop or bank hiding the
// inventory is the SDK's refusal of the send (`send-failed`), not a separate check.
import { resolveSkillDialogProduct, skillDialogProductLabels } from '../../sdk/action-quantity';
import type { BotWorldState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { isSkillMenu } from './dismiss';
import { dialogSince, messageCursor, messageSince } from './messages';

/** bot.fletchLogs's 5s wait for the make menu to open, in ticks. */
export const FLETCH_MENU_TICKS = Math.ceil(5000 / TICK_MS);
/** bot.fletchLogs's 30 one-tick attempts for the XP after the product is clicked. */
export const FLETCH_MAKE_TICKS = 30;

const KNIFE = /^knife$/i;
/** Upstream's game-message check, and this game's level box ("You need a Fletching level of at least 5 ..."). */
const TOO_LOW = /need a higher|level to|need a fletching level/i;

export type FletchResult =
    | { ok: true; xpGained: number; product: string }
    | {
          ok: false;
          reason: 'no-knife' | 'no-logs' | 'no-menu' | 'no-product' | 'level-too-low' | 'send-failed' | 'timeout';
          message: string;
      };

const xpOf = (s: BotWorldState) => findSkill(s, 'Fletching')?.experience ?? 0;
/** A product's label without the literal "\n\n\n\n" the client publishes before it. */
const label = (text: string) => text.replaceAll('\\n', '').trim();

/**
 * Uses a knife on the first inventory item matching `logs`, picks `product` in the make menu by its
 * label ("arrow shaft", "short bow", "oak long"; omitted, the first product), and waits for Fletching
 * XP. One call makes one batch: 15 shafts, or one bow.
 */
export function* fletch(ctx: ActionContext, logs: RegExp, product?: string): Op<FletchResult> {
    const s = ctx.state();
    const knife = s.inventory.find(i => KNIFE.test(i.name));
    if (!knife) return { ok: false, reason: 'no-knife', message: 'No knife in inventory' };
    const item = s.inventory.find(i => logs.test(i.name));
    if (!item) return { ok: false, reason: 'no-logs', message: 'No logs in inventory' };
    const xpBefore = xpOf(s);
    const cursor = messageCursor(s);
    const tooLow = (st: BotWorldState) => messageSince(st, cursor, TOO_LOW) ?? dialogSince(st, cursor, TOO_LOW);

    const used = yield* send({
        type: 'useItemOnItem',
        sourceSlot: knife.slot,
        targetSlot: item.slot,
        reason: `use ${knife.name} on ${item.name}`,
    });
    if (!used.success) return { ok: false, reason: 'send-failed', message: used.message };
    const menu = yield* wait('fletching menu', st => isSkillMenu(st.dialog), FLETCH_MENU_TICKS);
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
    const clicked = yield* send({ type: 'clickDialogOption', optionIndex: choice.index, reason: `fletch ${chosen}` });
    if (!clicked.success) return { ok: false, reason: 'send-failed', message: clicked.message };
    const made = yield* wait(`fletch ${chosen}`, st => xpOf(st) > xpBefore || !!tooLow(st), FLETCH_MAKE_TICKS);
    const xpGained = xpOf(made.state) - xpBefore;
    if (xpGained > 0) return { ok: true, xpGained, product: chosen };
    if (tooLow(made.state)) return { ok: false, reason: 'level-too-low', message: 'Fletching level too low' };
    return { ok: false, reason: 'timeout', message: 'Fletching timed out' };
}
