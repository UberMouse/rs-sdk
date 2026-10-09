// Ported from sdk/actions.ts chopTree @ 4c2069cc0
// Unlike bot.chopTree it takes the tree and its exact log name from the caller, and leaves dialogs
// (a level-up as the log lands) to the dialog guard, which clears them inside the wait.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { interactLoc } from './interact';

/** bot.chopTree's 30s wait for logs or the tree gone, in ticks. */
export const CHOP_WAIT_TICKS = Math.ceil(30_000 / TICK_MS);
const CHOP = /chop/i;

export type ChopResult =
    | { ok: true }
    | { ok: false; reason: 'felled-by-other' | 'timeout' | 'send-failed'; message: string };

const count = (s: BotWorldState, item: RegExp) =>
    s.inventory.filter(i => item.test(i.name)).reduce((n, i) => n + i.count, 0);

/**
 * Chops `tree` and waits until `logs` are gained or the tree is gone. Success needs logs gained: a tree
 * that falls with none was felled by another player, and logs already carried don't count.
 * `send-failed` means nothing reached the game: no Chop option, or the client refused the send (not
 * logged in, tree out of the loaded scene).
 */
export function* chop(ctx: ActionContext, tree: NearbyLoc, logs: RegExp): Op<ChopResult> {
    const before = count(ctx.state(), logs);
    const sent = yield* interactLoc(tree, CHOP);
    if (!sent.ok) return { ok: false, reason: 'send-failed', message: sent.message };
    const gained = (s: BotWorldState) => count(s, logs) > before;
    const gone = (s: BotWorldState) => !s.nearbyLocs.some(l => l.x === tree.x && l.z === tree.z && l.id === tree.id);
    const w = yield* wait(`chop ${tree.name}`, s => gained(s) || gone(s), CHOP_WAIT_TICKS);
    if (gained(w.state)) return { ok: true };
    if (w.kind === 'timeout')
        return { ok: false, reason: 'timeout', message: `timed out waiting for logs from ${tree.name}` };
    return { ok: false, reason: 'felled-by-other', message: `${tree.name} was felled by someone else` };
}
