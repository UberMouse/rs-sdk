// Ported from sdk/actions.ts enchantItem @ 4c2069cc0
// Any item spell cast on an inventory item (Superheat Item, the alchemies, the enchants). Magic XP is the
// evidence of a landed cast: every item spell pays it before its other effects (skill_magic give_spell_xp).
// Every item spell ends in p_delay(n) (1 tick; 3 for High Level Alchemy) and a cast sent while the player
// is held is discarded with no message, so the op waits `holdTicks` after the XP before it returns.
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { type Op, send, ticks, wait } from '../core/op';
import { findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { messageCursor, messageSince } from './messages';

const CAST_ITEM_WAIT_MS = 5000;
/** How long a cast waits for its XP or the server's refusal, in ticks. */
export const CAST_ITEM_WAIT_TICKS = Math.ceil(CAST_ITEM_WAIT_MS / TICK_MS);

const NO_RUNES = /do not have enough|don't have enough/i;
const LOW_LEVEL = /magic level is not high enough/i;
/**
 * The other refusals an item spell gives: "You need to cast superheat item on ore.", "You need a smithing
 * level of at least 30 to smelt steel.", "Even this spell is not hot enough to heat this item.", "You
 * need to string the ... before enchanting it.", "You need a staff of fire ...", "can't cast this on...", the
 * enchants' "This spell can only be cast on Emerald Amulets and Rings." and the alchemies' "Coins are already
 * made of gold.", "Ugly parasites have feelings too!", "The magic of the monkeys defies alchemy.".
 */
const REFUSED =
    /^you need|not hot enough|can't|cannot|unable|isn't|aren't|can only be cast|already made of gold|feelings too|defies alchemy/i;

export type CastItemResult =
    | { ok: true; xpGained: number }
    | {
          ok: false;
          reason: 'no-runes' | 'level' | 'refused' | 'send-failed' | 'timeout';
          message: string;
      };

const magicXp = (s: BotWorldState) => findSkill(s, 'Magic')?.experience ?? 0;

/**
 * Casts the spell with component id `spell` on `item`, waits until Magic XP is gained, then `holdTicks`
 * more for the spell's own delay. `no-runes` and `level` are the server's refusals; `refused` is any other ("You need to cast superheat item on ore.",
 * a Smithing level too low for the bar); `timeout` is no XP and no message within the wait.
 */
export function* castOnItem(
    ctx: ActionContext,
    item: InventoryItem,
    spell: number,
    spellName: string,
    holdTicks = 0,
): Op<CastItemResult> {
    const before = ctx.state();
    const cursor = messageCursor(before);
    const xp0 = magicXp(before);
    const sent = yield* send({
        type: 'spellOnItem',
        slot: item.slot,
        spellComponent: spell,
        reason: `cast ${spellName} on ${item.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };

    const refusal = (s: BotWorldState) =>
        messageSince(s, cursor, NO_RUNES) ?? messageSince(s, cursor, LOW_LEVEL) ?? messageSince(s, cursor, REFUSED);
    const w = yield* wait(
        `cast ${spellName} on ${item.name}`,
        s => magicXp(s) > xp0 || !!refusal(s),
        CAST_ITEM_WAIT_TICKS,
    );
    const gained = magicXp(w.state) - xp0;
    if (gained > 0) {
        if (holdTicks > 0) yield* ticks(holdTicks);
        return { ok: true, xpGained: gained };
    }
    const no = messageSince(w.state, cursor, NO_RUNES);
    if (no) return { ok: false, reason: 'no-runes', message: no };
    const low = messageSince(w.state, cursor, LOW_LEVEL);
    if (low) return { ok: false, reason: 'level', message: low };
    const other = messageSince(w.state, cursor, REFUSED);
    if (other) return { ok: false, reason: 'refused', message: other };
    return { ok: false, reason: 'timeout', message: `Timeout waiting for ${spellName} on ${item.name}` };
}
