// Sends one option on an NPC, a loc or an inventory item and waits for any visible effect, measured against
// the state before the send. "I can't reach that!", a known refusal message and an opFeedback discard are
// refusals. The caller walks first and answers any dialog the interaction opens.
import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { type Op, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import { MOVED_PREFIX, movementWatch } from './movement';
import type { ActionContext } from './context';
import { type InteractResult, interactItem, interactLoc, interactNpc, sendUseOnLoc, sendUseOnNpc } from './interact';
import { CANT_REACH, dialogPageSince, dialogSince, messageCursor, messagesSince, messageSince } from './messages';

/** Ticks to wait for the effect (10 s as `use`: the walk up to the target plus the action). */
export const INTERACT_WAIT_TICKS = Math.ceil(10_000 / TICK_MS);

/**
 * Ticks a bare game message waits for a state change to show up beside it before it counts as the
 * effect on its own (a message is weak evidence: hunger, poison and refusals are messages too).
 */
export const MESSAGE_GRACE_TICKS = 2;

/** Game messages that say the interaction did nothing. */
export const REFUSAL =
    /nothing interesting happens|maybe i should|can't do that|cannot do that|you need|you'll need|too busy|doesn't want that|you don't have|you haven't|you are not|you're not|isn't possible|already|don't see that being any help|little far with that strong current|can't get a good shot|remember putting that type of rune/i;

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

/**
 * Most ticks the settle after a game-driven move waits: a rope thrown across water ends on the throw
 * animation, the bot then holds two ticks and swims the crossing a tile a tick (about 10 ticks in all).
 */
export const SETTLE_MAX_TICKS = 16;
/** Consecutive ticks with position, floor and animation unchanged that count as settled. */
export const SETTLE_STABLE_TICKS = 3;

export interface InteractOptions {
    /**
     * Wait for the world to settle after the effect (position, floor and animation unchanged for
     * SETTLE_STABLE_TICKS ticks, at most SETTLE_MAX_TICKS; the effect notes when the cap ended it) before returning: for an op whose effect is a move the
     * game makes a few ticks later (a rope thrown across water). A `use` always settles, and so does any
     * effect that is the player moved by the game; `expect` still names a specific later message.
     */
    settle?: boolean;
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

/**
 * The movement watch for `target`: a bot that began on a loc's own tile has nothing to walk, and an inventory
 * item is not walked to at all, so any move of the player is the game's.
 */
const watchFor = (target: InteractTarget, before: BotWorldState) =>
    movementWatch(
        before,
        target.kind === 'item' ||
            (target.kind === 'loc' &&
                !!before.player &&
                before.player.worldX === target.loc.x &&
                before.player.worldZ === target.loc.z &&
                before.player.level === target.loc.level),
    );

/** What changed in the world between `before` and `s`, or null while nothing shows. `moved` is the movement watch's finding. */
function stateChange(
    target: InteractTarget,
    before: BotWorldState,
    s: BotWorldState,
    moved: string | null,
): string | null {
    if (s.dialog.isOpen && !before.dialog.isOpen) return 'a dialog opened';
    if (s.interface.isOpen && !before.interface.isOpen) return 'an interface opened';
    if (signature(s.inventory) !== signature(before.inventory)) return 'the inventory changed';
    if (signature(s.equipment) !== signature(before.equipment)) return 'the worn items changed';
    if (moved) return moved;
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
    moved: string | null,
): Verdict | null {
    const name = targetName(target);
    if (messageSince(s, cursor, CANT_REACH))
        return { kind: 'failed', reason: 'cant-reach', message: `Cannot reach ${name}` };
    const messages = messagesSince(s, cursor);
    if (expect) {
        const said = messageSince(s, cursor, expect) ?? dialogSince(s, cursor, expect);
        if (said) return { kind: 'effect', effect: `"${said}"` };
    } else {
        const change = stateChange(target, before, s, moved);
        if (change) return { kind: 'effect', effect: change };
    }
    const refusal = messages.find(m => REFUSAL.test(m.text));
    if (refusal) return { kind: 'failed', reason: 'refused', message: `${name}: "${refusal.text}"` };
    if (!expect) {
        // A message box the op opened can be clicked away (the dialog guard) before the wait sees it open; the
        // page the client recorded is still the effect (the Chaos altar's inscription). A refusal outranks it.
        const page = dialogPageSince(s, cursor);
        if (page) return { kind: 'effect', effect: `a dialog page appeared: "${page}"` };
    }
    const bare = expect ? undefined : messages.find(m => s.tick - m.tick >= grace);
    return bare ? { kind: 'effect', effect: `game message "${bare.text}"` } : null;
}

/**
 * Sends `option` (a pattern on the option text, or an index) on `target` and waits for its effect. `ok`
 * carries the effect seen. `no-option` and `send-failed` mean nothing reached the game; `cant-reach` is
 * the server's "I can't reach that!", `refused` a refusal message ("Nothing interesting happens."),
 * `rejected` a discarded op with nothing else shown, `no-effect` a timeout. A walk to a far target
 * counts against the wait, so the caller walks near first. The effect can also be the player moved by the
 * game (a teleport, a door pass-through) or the loc changed.
 */
export function* interact(
    ctx: ActionContext,
    target: InteractTarget,
    option: number | RegExp,
    opts: InteractOptions = {},
): Op<InteractionResult> {
    return yield* attempt(
        ctx,
        target,
        `${option}`,
        () =>
            target.kind === 'npc'
                ? interactNpc(target.npc, option)
                : target.kind === 'loc'
                  ? interactLoc(target.loc, option)
                  : interactItem(target.item, option),
        opts,
    );
}

/**
 * Uses inventory `item` on `loc`, sent once, and waits for the same effects as `interact` (judged here,
 * not as `useItemOnLoc` does: no inventory change is needed, and a use that only moves the player or prints
 * a message, like a key on a door or a rope on a rock, is an effect). It sends once per call; the caller decides on a retry
 * (a key door used from the far side walks the bot back through). It settles after the effect (see `InteractOptions.settle`).
 */
export function* useOn(
    ctx: ActionContext,
    item: InventoryItem,
    loc: NearbyLoc,
    opts: InteractOptions = {},
): Op<InteractionResult> {
    return yield* attempt(ctx, { kind: 'loc', loc }, `use ${item.name}`, () => sendUseOnLoc(item, loc), {
        ...opts,
        settle: true,
    });
}

/**
 * Uses inventory `item` on `npc`, sent once, judged and settled as `useOn` (the NPC is not tracked for a
 * change: the effect is the inventory, a dialog, the player moved, or a message).
 */
export function* useOnNpc(
    ctx: ActionContext,
    item: InventoryItem,
    npc: NearbyNpc,
    opts: InteractOptions = {},
): Op<InteractionResult> {
    return yield* attempt(ctx, { kind: 'npc', npc }, `use ${item.name}`, () => sendUseOnNpc(item, npc), {
        ...opts,
        settle: true,
    });
}

/** What the settle compares from tick to tick. */
const look = (s: BotWorldState) => `${s.player?.worldX},${s.player?.worldZ},${s.player?.level},${s.player?.animId}`;

/** Waits (bounded by SETTLE_MAX_TICKS) until the player's tile, floor and animation hold for SETTLE_STABLE_TICKS ticks; false when the cap ended it. */
function* settled(from: BotWorldState): Op<boolean> {
    let last = look(from);
    let stable = 0;
    let first = true;
    const w = yield* wait(
        'settle',
        s => {
            // The wait checks the state the effect was seen in first: that one is the baseline, not a stable tick.
            if (first) {
                first = false;
                return false;
            }
            const now = look(s);
            stable = now === last ? stable + 1 : 0;
            last = now;
            return stable >= SETTLE_STABLE_TICKS;
        },
        SETTLE_MAX_TICKS,
    );
    return w.kind !== 'timeout';
}

function* attempt(
    ctx: ActionContext,
    target: InteractTarget,
    what: string,
    send: () => Op<InteractResult>,
    { expect, settle }: InteractOptions,
): Op<InteractionResult> {
    const before = ctx.state();
    const cursor = messageCursor(before);
    const rejected = before.opFeedback?.opRejectedCount ?? 0;
    const name = targetName(target);
    const sent = yield* send();
    if (!sent.ok) return sent;
    const watch = watchFor(target, before);
    const w = yield* wait(
        `${what} ${name}`,
        s => verdictOf(target, before, cursor, expect, MESSAGE_GRACE_TICKS, s, watch(s)) !== null,
        INTERACT_WAIT_TICKS,
    );
    // At the end of the wait a bare message counts at once.
    const verdict = verdictOf(target, before, cursor, expect, 0, w.state, watch(w.state));
    if (verdict?.kind === 'effect') {
        const moved = verdict.effect.startsWith(MOVED_PREFIX);
        if (settle || moved) {
            const stable = yield* settled(w.state);
            if (!stable)
                return { ok: true, effect: `${verdict.effect} (still moving after ${SETTLE_MAX_TICKS} ticks)` };
        }
        return { ok: true, effect: verdict.effect };
    }
    if (verdict) return { ok: false, reason: verdict.reason, message: verdict.message };
    if ((w.state.opFeedback?.opRejectedCount ?? 0) > rejected)
        return { ok: false, reason: 'rejected', message: `the server discarded the ${what} on ${name}` };
    return {
        ok: false,
        reason: 'no-effect',
        message: `${what} on ${name} showed no effect within ${INTERACT_WAIT_TICKS} ticks`,
    };
}
