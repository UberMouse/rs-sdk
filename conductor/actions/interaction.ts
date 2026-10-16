// Sends one option on an NPC, a loc or an inventory item and waits for any visible effect, measured against
// the state before the send. "I can't reach that!", a known refusal message and an opFeedback discard are
// refusals. The caller walks first and answers any dialog the interaction opens.
import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { type Op, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { type InteractResult, interactItem, interactLoc, interactNpc } from './interact';
import { CANT_REACH, dialogSince, messageCursor, messagesSince, messageSince } from './messages';

/** Ticks to wait for the effect (10 s as `use`: the walk up to the target plus the action). */
export const INTERACT_WAIT_TICKS = Math.ceil(10_000 / TICK_MS);

/**
 * Ticks a bare game message waits for a state change to show up beside it before it counts as the
 * effect on its own (a message is weak evidence: hunger, poison and refusals are messages too).
 */
export const MESSAGE_GRACE_TICKS = 2;

/** Game messages that say the interaction did nothing. */
export const REFUSAL =
    /nothing interesting happens|maybe i should|can't do that|cannot do that|you need|you'll need|too busy|you don't have|you haven't|you are not|you're not|isn't possible|already/i;

/** What to interact with. */
export type InteractTarget =
    | { kind: 'npc'; npc: NearbyNpc }
    | { kind: 'loc'; loc: NearbyLoc }
    | { kind: 'item'; item: InventoryItem };

export type InteractionResult =
    | { ok: true; effect: string }
    | {
          ok: false;
          reason: 'no-option' | 'send-failed' | 'cant-reach' | 'refused' | 'rejected' | 'no-effect';
          message: string;
      };

export interface InteractOptions {
    /**
     * When given, only a game message or dialog page matching it is the effect (a state change alone is
     * not): the caller names the outcome it needs.
     */
    expect?: RegExp;
}

/** The option texts a target offers, for a message. */
export function optionsOf(target: InteractTarget): string[] {
    if (target.kind === 'npc') return target.npc.optionsWithIndex.map(o => o.text);
    if (target.kind === 'loc') return target.loc.optionsWithIndex.map(o => o.text);
    return target.item.optionsWithIndex.map(o => o.text);
}

export const targetName = (t: InteractTarget): string =>
    t.kind === 'npc' ? t.npc.name : t.kind === 'loc' ? t.loc.name : t.item.name;

const signature = (xs: readonly { slot?: number; id: number; count: number }[]) =>
    xs.map(i => `${i.slot ?? ''}:${i.id}:${i.count}`).join(',');

/** What changed in the world between `before` and `s`, or null while nothing shows. */
function stateChange(target: InteractTarget, before: BotWorldState, s: BotWorldState): string | null {
    if (s.dialog.isOpen && !before.dialog.isOpen) return 'a dialog opened';
    if (s.interface.isOpen && !before.interface.isOpen) return 'an interface opened';
    if (signature(s.inventory) !== signature(before.inventory)) return 'the inventory changed';
    if (signature(s.equipment) !== signature(before.equipment)) return 'the worn items changed';
    if (target.kind === 'loc') {
        const { x, z, id } = target.loc;
        const at = s.nearbyLocs.filter(l => l.x === x && l.z === z);
        if (!at.some(l => l.id === id)) return at.length > 0 ? 'the loc changed' : 'the loc is gone';
    }
    if (!!s.player && s.player.animId !== -1 && s.player.animId !== before.player?.animId)
        return 'an animation started';
    return null;
}

type Verdict =
    | { kind: 'effect'; effect: string }
    | { kind: 'failed'; reason: 'cant-reach' | 'refused'; message: string };

/**
 * How the interaction stands in `s`, or null while it is undecided. A state change is the effect; a
 * bare message counts only once it is `grace` ticks old. With `expect`, only a matching message or
 * dialog page does. A refusal or "can't reach" ends it as a failure.
 */
function verdictOf(
    target: InteractTarget,
    before: BotWorldState,
    cursor: number,
    expect: RegExp | undefined,
    grace: number,
    s: BotWorldState,
): Verdict | null {
    const name = targetName(target);
    if (messageSince(s, cursor, CANT_REACH))
        return { kind: 'failed', reason: 'cant-reach', message: `Cannot reach ${name}` };
    const messages = messagesSince(s, cursor);
    if (expect) {
        const said = messageSince(s, cursor, expect) ?? dialogSince(s, cursor, expect);
        if (said) return { kind: 'effect', effect: `"${said}"` };
    } else {
        const change = stateChange(target, before, s);
        if (change) return { kind: 'effect', effect: change };
    }
    const refusal = messages.find(m => REFUSAL.test(m.text));
    if (refusal) return { kind: 'failed', reason: 'refused', message: `${name}: "${refusal.text}"` };
    const bare = expect ? undefined : messages.find(m => s.tick - m.tick >= grace);
    return bare ? { kind: 'effect', effect: `game message "${bare.text}"` } : null;
}

/**
 * Sends `option` (a pattern on the option text, or an index) on `target` and waits for its effect. `ok`
 * carries the effect seen. `no-option` and `send-failed` mean nothing reached the game; `cant-reach` is
 * the server's "I can't reach that!", `refused` a refusal message ("Nothing interesting happens."),
 * `rejected` a discarded op with nothing else shown, `no-effect` a timeout. A walk to a far target
 * counts against the wait, so the caller walks near first.
 */
export function* interact(
    ctx: ActionContext,
    target: InteractTarget,
    option: number | RegExp,
    { expect }: InteractOptions = {},
): Op<InteractionResult> {
    const before = ctx.state();
    const cursor = messageCursor(before);
    const rejected = before.opFeedback?.opRejectedCount ?? 0;
    const name = targetName(target);
    const sent: InteractResult =
        target.kind === 'npc'
            ? yield* interactNpc(target.npc, option)
            : target.kind === 'loc'
              ? yield* interactLoc(target.loc, option)
              : yield* interactItem(target.item, option);
    if (!sent.ok) return sent;
    const w = yield* wait(
        `${option} ${name}`,
        s => verdictOf(target, before, cursor, expect, MESSAGE_GRACE_TICKS, s) !== null,
        INTERACT_WAIT_TICKS,
    );
    // At the end of the wait a bare message counts at once.
    const verdict = verdictOf(target, before, cursor, expect, 0, w.state);
    if (verdict?.kind === 'effect') return { ok: true, effect: verdict.effect };
    if (verdict) return { ok: false, reason: verdict.reason, message: verdict.message };
    if ((w.state.opFeedback?.opRejectedCount ?? 0) > rejected)
        return { ok: false, reason: 'rejected', message: `the server discarded the ${option} on ${name}` };
    return {
        ok: false,
        reason: 'no-effect',
        message: `${option} on ${name} showed no effect within ${INTERACT_WAIT_TICKS} ticks`,
    };
}
