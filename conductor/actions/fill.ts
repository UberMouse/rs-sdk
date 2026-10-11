// Ported from sdk/actions.ts useItemOnLoc @ 3b2be2bc2
// Waits for its own effect (one fewer empty container, or the game's refusal) rather than useItemOnLoc's
// any-evidence wait: the fill animation starts a tick or two before the container swaps, and an early return
// sent the next fill while the player was busy. Does not walk first; the client's pathing handles a nearby source.
import type { InventoryItem, NearbyLoc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItemId, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** useItemOnLoc's 10s wait, in ticks. */
export const FILL_WAIT_TICKS = Math.ceil(10_000 / TICK_MS);

const NOTHING = /nothing interesting happens/i;

export type FillResult =
    | { ok: true }
    | { ok: false; reason: 'cant-reach' | 'nothing-happened' | 'send-failed' | 'timeout'; message: string };

/** Uses the empty container `item` on the water source `source` and waits until one fewer of its kind is held. */
export function* fillContainer(ctx: ActionContext, item: InventoryItem, source: NearbyLoc): Op<FillResult> {
    const before = ctx.state();
    const held = (s: typeof before) => countItemId(s, item.id);
    const had = held(before);
    const cursor = messageCursor(before);
    const sent = yield* send({
        type: 'useItemOnLoc',
        itemSlot: item.slot,
        x: source.x,
        z: source.z,
        locId: source.id,
        reason: `use ${item.name} on ${source.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(
        `fill ${item.name}`,
        s => held(s) < had || !!messageSince(s, cursor, CANT_REACH) || !!messageSince(s, cursor, NOTHING),
        FILL_WAIT_TICKS,
    );
    if (held(w.state) < had) return { ok: true };
    if (messageSince(w.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `Cannot reach ${source.name}` };
    const nothing = messageSince(w.state, cursor, NOTHING);
    if (nothing) return { ok: false, reason: 'nothing-happened', message: nothing };
    return { ok: false, reason: 'timeout', message: `Timeout filling ${item.name} at ${source.name}` };
}
