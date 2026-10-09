// Ported from sdk/actions.ts useItemOnLoc @ 4c2069cc0
// useItemOnLoc takes the item and loc from the caller and does not walk first or retry through doors:
// the client's own pathing takes the bot to the loc, and a task that must walk does so itself. The
// SDK has no bot.* method for item on item, only sdk.sendUseItemOnItem; useItemOnItem here waits for
// the same evidence useItemOnLoc does. Both also end at once on the game's refusal ("Nothing
// interesting happens."), which upstream waits out to its timeout.
import type { BotAction, BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** bot.useItemOnLoc's default 10s wait for evidence of the use, in ticks. */
export const USE_WAIT_TICKS = Math.ceil(10_000 / TICK_MS);

const NOTHING = /nothing interesting happens/i;

export type UseResult =
    | { ok: true }
    | { ok: false; reason: 'cant-reach' | 'nothing-happened' | 'send-failed' | 'timeout'; message: string };

const inventorySignature = (s: BotWorldState) => s.inventory.map(i => `${i.slot}:${i.id}:${i.count}`).join(',');

/**
 * Sends `action` (`item` used on `on`) and waits for evidence that the game acted on it: the inventory
 * changed, a dialog or modal opened, the player started an animation (one already playing at the send,
 * from an earlier action, does not count), or a refusal message arrived. Some uses (a flour bin) only swap an item, so the inventory change counts on its own.
 */
function* used(ctx: ActionContext, item: InventoryItem, on: string, action: BotAction): Op<UseResult> {
    const label = `use ${item.name} on ${on}`;
    const before = ctx.state();
    const cursor = messageCursor(before);
    const inventory = inventorySignature(before);
    const sent = yield* send(action);
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(
        label,
        s =>
            !!messageSince(s, cursor, CANT_REACH) ||
            !!messageSince(s, cursor, NOTHING) ||
            (s.dialog.isOpen && !before.dialog.isOpen) ||
            (s.interface.isOpen && !before.interface.isOpen) ||
            (!!s.player && s.player.animId !== -1 && s.player.animId !== before.player?.animId) ||
            inventorySignature(s) !== inventory,
        USE_WAIT_TICKS,
    );
    const cantReach = messageSince(w.state, cursor, CANT_REACH);
    if (cantReach) return { ok: false, reason: 'cant-reach', message: `Cannot reach ${on}` };
    const nothing = messageSince(w.state, cursor, NOTHING);
    if (nothing) return { ok: false, reason: 'nothing-happened', message: nothing };
    if (w.kind === 'timeout') return { ok: false, reason: 'timeout', message: `Timeout using ${item.name} on ${on}` };
    return { ok: true };
}

/** Uses inventory `item` on inventory `target` (feathers on arrow shafts, a knife on logs). */
export function* useItemOnItem(ctx: ActionContext, item: InventoryItem, target: InventoryItem): Op<UseResult> {
    return yield* used(ctx, item, target.name, {
        type: 'useItemOnItem',
        sourceSlot: item.slot,
        targetSlot: target.slot,
        reason: `use ${item.name} on ${target.name}`,
    });
}

/** Uses inventory `item` on `loc` (a bucket on a fountain, ore on a furnace). */
export function* useItemOnLoc(ctx: ActionContext, item: InventoryItem, loc: NearbyLoc): Op<UseResult> {
    return yield* used(ctx, item, loc.name, {
        type: 'useItemOnLoc',
        itemSlot: item.slot,
        x: loc.x,
        z: loc.z,
        locId: loc.id,
        reason: `use ${item.name} on ${loc.name}`,
    });
}
