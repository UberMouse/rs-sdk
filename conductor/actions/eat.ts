// Ported from sdk/actions.ts eatFood @ 4c2069cc0
// Unlike bot.eatFood it takes the food from the caller (the low-HP guard picks it with findFood)
// instead of a name, reads HP from the player (the client derives it from the Hitpoints skill, so the
// two agree), and counts the food by stack size rather than by slots.
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItemId, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';

/** bot.eatFood's 5s wait for HP or the food count to change, in ticks: the most an eat takes in all. */
export const EAT_WAIT_TICKS = Math.ceil(5000 / TICK_MS);
/**
 * The server ignores an eat sent within 2 ticks of the last one (consume.rs2: `%eat_delay >= map_clock` returns
 * with no message). A caller under fire waits this long per try, so it can send again at once instead of
 * sitting out EAT_WAIT_TICKS while it is hit.
 */
export const EAT_ATTEMPT_TICKS = 3;

export type EatResult =
    | { ok: true; hpGained: number }
    | { ok: false; reason: 'no-option' | 'send-failed' | 'timeout'; message: string };

const hpOf = (s: BotWorldState) => s.player?.hp ?? 0;

/**
 * Eats (or drinks) `food` and waits up to `waitTicks` until HP rises or one is used up; `hpGained` may be 0 at full HP.
 * Healing items that are drunk (beer, wine) publish Drink rather than Eat; both are accepted.
 */
export function* eat(ctx: ActionContext, food: InventoryItem, waitTicks = EAT_WAIT_TICKS): Op<EatResult> {
    const option =
        food.optionsWithIndex.find(o => /^(eat|drink)$/i.test(o.text)) ??
        food.optionsWithIndex.find(o => /eat|drink/i.test(o.text));
    if (!option) return { ok: false, reason: 'no-option', message: `No eat/drink option on ${food.name}` };
    const before = ctx.state();
    const hpBefore = hpOf(before);
    const held = countItemId(before, food.id);
    const sent = yield* send({
        type: 'useInventoryItem',
        slot: food.slot,
        optionIndex: option.opIndex,
        reason: `${option.text} ${food.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(`eat ${food.name}`, s => hpOf(s) > hpBefore || countItemId(s, food.id) < held, waitTicks);
    if (w.kind === 'timeout') return { ok: false, reason: 'timeout', message: `Failed to eat ${food.name}` };
    return { ok: true, hpGained: hpOf(w.state) - hpBefore };
}
