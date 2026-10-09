// Ported from sdk/actions.ts equipItem @ 4c2069cc0
// Unlike bot.equipItem it takes the inventory item from the caller instead of a name, and decides
// from the state its wait ended on, which already covers upstream's late re-check of the equipment.
import type { InventoryItem } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';

/** bot.equipItem's 5s wait for the item to leave its slot or show as worn, in ticks. */
export const EQUIP_WAIT_TICKS = Math.ceil(5000 / TICK_MS);
/** The option that puts an item on. */
export const EQUIP_OPTION = /wield|wear|equip/i;

export type EquipResult =
    | { ok: true }
    | { ok: false; reason: 'no-option' | 'send-failed' | 'timeout'; message: string };

/**
 * Wields or wears `item` and waits until it leaves its inventory slot or shows as worn. A copy that is
 * already worn is no evidence, so then only the slot counts. A refusal (too low a level) is a timeout.
 */
export function* equip(ctx: ActionContext, item: InventoryItem): Op<EquipResult> {
    const option = item.optionsWithIndex.find(o => EQUIP_OPTION.test(o.text));
    if (!option) return { ok: false, reason: 'no-option', message: `No equip option on ${item.name}` };
    const wornBefore = ctx.state().equipment.some(e => e.id === item.id);
    const sent = yield* send({
        type: 'useInventoryItem',
        slot: item.slot,
        optionIndex: option.opIndex,
        reason: `${option.text} ${item.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(
        `equip ${item.name}`,
        s =>
            !s.inventory.some(i => i.slot === item.slot && i.id === item.id) ||
            (!wornBefore && s.equipment.some(e => e.id === item.id)),
        EQUIP_WAIT_TICKS,
    );
    if (w.kind === 'timeout') return { ok: false, reason: 'timeout', message: `Failed to equip ${item.name}` };
    return { ok: true };
}
