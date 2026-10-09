// Ported from sdk/actions.ts pickupItem @ 4c2069cc0
// Unlike bot.pickupItem it takes the ground item from the caller, does not walk first or retry
// through doors (the client's own pathing takes the bot to the item; a task that must walk does so
// itself), and skips upstream's one-tick pauses before and after. It also knows the game's
// inventory-full message ("You don't have enough inventory space to hold that item."), which
// upstream's "inventory ... full" check misses, leaving it to time out.
import type { BotWorldState, GroundItem } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItemId, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { messageCursor, messageSince } from './messages';

/** bot.pickupItem's 10s wait for the item gained, gone or refused, in ticks. */
export const PICKUP_WAIT_TICKS = Math.ceil(10_000 / TICK_MS);
/** bot.pickupItem's 1.5s grace for the inventory add after the item leaves the ground, in ticks. */
export const PICKUP_GRACE_TICKS = Math.ceil(1500 / TICK_MS);

const CANT_REACH = /can't reach|cannot reach/i;
const NO_SPACE = /inventory space|inventory.*full/i;

export type PickupResult =
    | { ok: true }
    | {
          ok: false;
          reason: 'cant-reach' | 'inventory-full' | 'taken-by-other' | 'send-failed' | 'timeout';
          message: string;
      };

/**
 * Picks up `item` and waits until one more of it is held. The ground item also vanishes when another
 * player takes it, so vanishing only ends the wait: success needs the item gained (by id, counted
 * before the send, so a static spawn already in reach can't count as gained).
 */
export function* pickup(ctx: ActionContext, item: GroundItem): Op<PickupResult> {
    const before = ctx.state();
    const cursor = messageCursor(before);
    const held = countItemId(before, item.id);
    const gained = (s: BotWorldState) => countItemId(s, item.id) > held;
    const onGround = (s: BotWorldState) =>
        s.groundItems.some(g => g.x === item.x && g.z === item.z && g.id === item.id);
    const refusal = (s: BotWorldState) => messageSince(s, cursor, CANT_REACH) ?? messageSince(s, cursor, NO_SPACE);

    const sent = yield* send({
        type: 'pickupItem',
        x: item.x,
        z: item.z,
        itemId: item.id,
        reason: `take ${item.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(`take ${item.name}`, s => !!refusal(s) || gained(s) || !onGround(s), PICKUP_WAIT_TICKS);
    if (messageSince(w.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `Cannot reach ${item.name} - path blocked` };
    if (messageSince(w.state, cursor, NO_SPACE))
        return { ok: false, reason: 'inventory-full', message: 'Inventory is full' };
    if (gained(w.state)) return { ok: true };
    if (w.kind === 'timeout') return { ok: false, reason: 'timeout', message: 'Timed out waiting for pickup' };
    // The ground removal can publish a tick before the inventory add lands.
    const grace = yield* wait(`${item.name} in the inventory`, gained, PICKUP_GRACE_TICKS);
    if (grace.kind === 'met') return { ok: true };
    return { ok: false, reason: 'taken-by-other', message: `${item.name} was taken by someone else` };
}
