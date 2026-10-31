// Not ported: sdk/actions.ts has no herblore method; closest upstream is useItemOnItem @ df3d8888a.
// Two ops, each one use with one effect, both of which the server does in the tick it handles the
// click (skill_herblore/scripts/herblore.rs2 `identify_herb` and `brew_potion`: no delay, no make menu,
// no Make-X). `cleanHerb` clicks the grimy herb's first option (Clean/Identify) and waits for that herb
// to leave the inventory. `brewPotion` uses one item on another and waits for the product to arrive.
// Unlike useItemOnItem, whose wait ends on any inventory change, they wait for the item they expect
// (the clean herb, the potion), and read the game's refusals: a Herblore level too low (a message,
// or the message box `mesbox` opens), a members-world refusal, and "Nothing interesting happens."
// for a pair that makes nothing. The items are told apart by obj id: every grimy herb is called "Herb"
// and every unfinished potion "Unfinished potion" in the server's obj configs.
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItemId, findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { dialogSince, messageCursor, messageSince } from './messages';

/** The most one use takes to show: the server answers in the tick it handles the click, so this is only a ceiling (5 s). */
export const HERB_WAIT_TICKS = Math.ceil(5000 / TICK_MS);

const CLEAN_OPTION = /^(clean|identify)$/i;
/** identify.rs2: "You cannot identify this herb." / "You need a higher Herblore level." */
const CLEAN_TOO_LOW = /cannot identify this herb|need a higher herblore level/i;
/** brew_potion.rs2: "You need a Herblore level of at least N to make this potion." */
const BREW_TOO_LOW = /need (a )?herblore level|need level \d+ herblore/i;
const MEMBERS = /members'? (world|server)/i;
const NOTHING = /nothing interesting happens/i;
const NOT_SURE = /not sure what|shouldn't mix/i;

export type CleanResult =
    | { ok: true; xpGained: number }
    | {
          ok: false;
          reason: 'no-option' | 'level-too-low' | 'members' | 'send-failed' | 'timeout';
          message: string;
      };

export type BrewResult =
    | { ok: true; xpGained: number }
    | {
          ok: false;
          reason: 'level-too-low' | 'members' | 'nothing-happened' | 'send-failed' | 'timeout';
          message: string;
      };

const xpOf = (s: BotWorldState) => findSkill(s, 'Herblore')?.experience ?? 0;

/** The text the game said after `cursor` that matches `pattern`, as a game message or a dialog page. */
const saidSince = (s: BotWorldState, cursor: number, pattern: RegExp) =>
    messageSince(s, cursor, pattern) ?? dialogSince(s, cursor, pattern);

/**
 * Cleans the grimy herb `herb` (its first Clean / Identify option) and waits until one of its kind has left the
 * inventory. `level-too-low` is the game's own refusal; the herb is still there then.
 */
export function* cleanHerb(ctx: ActionContext, herb: InventoryItem): Op<CleanResult> {
    const option = herb.optionsWithIndex.find(o => CLEAN_OPTION.test(o.text));
    if (!option) return { ok: false, reason: 'no-option', message: `No Clean option on ${herb.name}` };
    const before = ctx.state();
    const held = countItemId(before, herb.id);
    const xpBefore = xpOf(before);
    const cursor = messageCursor(before);
    const sent = yield* send({
        type: 'useInventoryItem',
        slot: herb.slot,
        optionIndex: option.opIndex,
        reason: `${option.text} ${herb.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(
        `clean ${herb.name}`,
        s => countItemId(s, herb.id) < held || !!saidSince(s, cursor, CLEAN_TOO_LOW) || !!saidSince(s, cursor, MEMBERS),
        HERB_WAIT_TICKS,
    );
    if (countItemId(w.state, herb.id) < held) return { ok: true, xpGained: xpOf(w.state) - xpBefore };
    const tooLow = saidSince(w.state, cursor, CLEAN_TOO_LOW);
    if (tooLow) return { ok: false, reason: 'level-too-low', message: tooLow };
    const members = saidSince(w.state, cursor, MEMBERS);
    if (members) return { ok: false, reason: 'members', message: members };
    return { ok: false, reason: 'timeout', message: `Timed out cleaning ${herb.name}` };
}

/**
 * Uses `item` on `target` (a herb on a vial of water, a secondary on an unfinished potion) and waits until the
 * potion `productId` is one more than it was. `xpGained` is 0 for an unfinished potion, which pays none.
 */
export function* brewPotion(
    ctx: ActionContext,
    item: InventoryItem,
    target: InventoryItem,
    productId: number,
): Op<BrewResult> {
    const before = ctx.state();
    const made = countItemId(before, productId);
    const xpBefore = xpOf(before);
    const cursor = messageCursor(before);
    const refusal = (s: BotWorldState) =>
        saidSince(s, cursor, BREW_TOO_LOW) ??
        saidSince(s, cursor, MEMBERS) ??
        messageSince(s, cursor, NOTHING) ??
        saidSince(s, cursor, NOT_SURE);
    const sent = yield* send({
        type: 'useItemOnItem',
        sourceSlot: item.slot,
        targetSlot: target.slot,
        reason: `use ${item.name} on ${target.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(
        `brew ${item.name} + ${target.name}`,
        s => countItemId(s, productId) > made || !!refusal(s),
        HERB_WAIT_TICKS,
    );
    if (countItemId(w.state, productId) > made) return { ok: true, xpGained: xpOf(w.state) - xpBefore };
    const said = refusal(w.state);
    if (said) {
        const reason = BREW_TOO_LOW.test(said) ? 'level-too-low' : MEMBERS.test(said) ? 'members' : 'nothing-happened';
        return { ok: false, reason, message: said };
    }
    return { ok: false, reason: 'timeout', message: `Timed out using ${item.name} on ${target.name}` };
}
