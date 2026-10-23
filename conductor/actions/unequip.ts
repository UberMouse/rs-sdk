// Ported from sdk/actions.ts unequipItem @ 4c2069cc0
// Unlike bot.unequipItem it takes the worn item from the caller instead of a name, refuses before
// sending when the inventory has no room (upstream waits out its timeout for the server's refusal),
// reads that refusal from the game messages, and decides from the state its wait ended on: the item
// no longer in its equipment slot. Upstream's "inventory grew" check is no evidence when the
// inventory changed for another reason.
import type { InventoryItem } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { INVENTORY_SLOTS, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { messageCursor, messageSince } from './messages';

/** bot.unequipItem's 5s wait for the item to leave the equipment, in ticks. */
export const UNEQUIP_WAIT_TICKS = Math.ceil(5000 / TICK_MS);
/**
 * The option that takes a worn item off: option 1 of the equipment tab, as upstream sends. The item's own
 * `optionsWithIndex` are the object's inventory options (Wield), so they cannot name it.
 */
export const UNEQUIP_OPTION_INDEX = 1;
const NO_SPACE = /inventory space|inventory.*full/i;

export type UnequipResult =
    | { ok: true }
    | { ok: false; reason: 'no-room' | 'send-failed' | 'timeout'; message: string };

/** `item` (a worn item, as `state.equipment` lists it) is still worn in its slot. */
const worn = (item: InventoryItem) => (s: { equipment: InventoryItem[] }) =>
    s.equipment.some(e => e.slot === item.slot && e.id === item.id);

/** Takes `item` off and waits until its equipment slot no longer holds it. */
export function* unequip(ctx: ActionContext, item: InventoryItem): Op<UnequipResult> {
    const before = ctx.state();
    const full = before.inventory.length >= INVENTORY_SLOTS && !before.inventory.some(i => i.id === item.id);
    if (full) return { ok: false, reason: 'no-room', message: `No inventory room to take off ${item.name}` };
    const cursor = messageCursor(before);
    const sent = yield* send({
        type: 'useEquipmentItem',
        slot: item.slot,
        optionIndex: UNEQUIP_OPTION_INDEX,
        reason: `remove ${item.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const stillWorn = worn(item);
    const w = yield* wait(
        `unequip ${item.name}`,
        s => !stillWorn(s) || !!messageSince(s, cursor, NO_SPACE),
        UNEQUIP_WAIT_TICKS,
    );
    if (!stillWorn(w.state)) return { ok: true };
    if (messageSince(w.state, cursor, NO_SPACE))
        return { ok: false, reason: 'no-room', message: `No inventory room to take off ${item.name}` };
    return { ok: false, reason: 'timeout', message: `Failed to take off ${item.name}` };
}
