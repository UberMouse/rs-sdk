// Ported from sdk/actions.ts dropItem @ 4c2069cc0
// Unlike bot.dropItem it takes a pattern only, reads each next slot from the state its last wait
// ended on, and tells a refused send (`send-failed`) and running out of items (`too-few`) apart from
// a drop that never showed (`timeout`), which upstream all report as 'timeout'.
import { validateActionQuantity } from '../../sdk/action-quantity';
import type { InventoryItem } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { INVENTORY_SLOTS, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';

/** bot.dropItem's 5s wait for each drop to leave the inventory, in ticks. */
export const DROP_WAIT_TICKS = Math.ceil(5000 / TICK_MS);

export type DropResult =
    | { ok: true; slotsDropped: number }
    | {
          ok: false;
          reason: 'invalid-amount' | 'no-item' | 'send-failed' | 'timeout' | 'too-few';
          slotsDropped: number;
          message: string;
      };

/**
 * Drops `amount` inventory slots (a stack is one slot) of the first item matching `item`, one at a
 * time, waiting for each to leave the inventory. The item id is pinned at the start, so the pattern
 * can't drift onto another item it also matches. `'all'` drops every slot of it.
 */
export function* drop(ctx: ActionContext, item: RegExp, amount: number | 'all' = 'all'): Op<DropResult> {
    let wanted = Number.POSITIVE_INFINITY;
    if (amount !== 'all') {
        const valid = validateActionQuantity(amount, { max: INVENTORY_SLOTS });
        if (!valid.valid) return { ok: false, reason: 'invalid-amount', slotsDropped: 0, message: valid.message };
        wanted = valid.amount;
    }
    let s = ctx.state();
    const first = s.inventory.find(i => item.test(i.name));
    if (!first)
        return { ok: false, reason: 'no-item', slotsDropped: 0, message: `Item not found in inventory: ${item}` };
    const matches = (i: InventoryItem) => i.id === first.id;

    let slotsDropped = 0;
    while (slotsDropped < wanted) {
        const current = s.inventory.find(matches);
        if (!current) break;
        const slotsBefore = s.inventory.filter(matches).length;
        const sent = yield* send({ type: 'dropItem', slot: current.slot, reason: `drop ${current.name}` });
        if (!sent.success) return { ok: false, reason: 'send-failed', slotsDropped, message: sent.message };
        const w = yield* wait(
            `drop ${current.name}`,
            st => st.inventory.filter(matches).length < slotsBefore,
            DROP_WAIT_TICKS,
        );
        if (w.kind === 'timeout')
            return {
                ok: false,
                reason: 'timeout',
                slotsDropped,
                message: `Drop of ${first.name} (slot ${current.slot}) was not observed`,
            };
        slotsDropped++;
        s = w.state;
    }
    if (amount === 'all' || slotsDropped === wanted) return { ok: true, slotsDropped };
    return {
        ok: false,
        reason: 'too-few',
        slotsDropped,
        message: `Dropped ${first.name} x${slotsDropped} slot${slotsDropped === 1 ? '' : 's'} of ${wanted}`,
    };
}
