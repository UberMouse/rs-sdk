// Not ported: sdk/actions.ts has no gate method; closest upstream is openDoor (bot.openDoor) @ 4c2069cc0.
// Passes the Al Kharid toll gate (two gate locs at (3268, 3227) and (3268, 3228), border_gate.rs2): one
// Open click starts the border guard's dialog ("Can I come through this gate?", "You must pay a toll of 10
// gold coins to pass." as "continue" pages), then a three-way choice: "No thank you, I'll walk around." / "Who
// does my money go to?" / "Yes, ok." The last takes 10 coins and the script teleports the bot to the other
// side of the gate (west side x 3267, east side x 3268). A player who has finished Prince Ali Rescue gets "You
// may pass for free" and no choice. This op clicks "Yes, ok." (the dialog guard clears the "continue" pages
// and leaves the choice) and is the dialog it opens on purpose, as passGate answers Femi. It is the same
// in both directions; the side comes from where the bot stands. With under TOLL_FEE coins it refuses
// (`no-coins`) before sending anything, so the guard never meets the choice: a walk routes around instead
// (a Prince Ali Rescue finisher with no coins is routed around too; the quest is not read).
import type { BotWorldState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItems, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { cleanText } from './dismiss';
import { interactLoc } from './interact';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** The toll in coins. */
export const TOLL_FEE = 10;
/** The two gate locs, west edge of the tile column x 3268. */
export const TOLL_GATE_LOCS: readonly { x: number; z: number }[] = [
    { x: 3268, z: 3227 },
    { x: 3268, z: 3228 },
];
/** The bot is east of the gate at this x or more, west of it below. */
export const TOLL_EAST_X = 3268;
/** The plane the gate is on. */
export const TOLL_LEVEL = 0;
/** The tile column x is east of the gate. */
export const isEastOfToll = (x: number) => x >= TOLL_EAST_X;
/** Open clicks before the gate is given up on. */
export const TOLL_ATTEMPTS = 2;
/** Ticks from the Open click to the choice (the walk to the gate and the pages before it). */
export const TOLL_DIALOG_TICKS = Math.ceil(12_000 / TICK_MS);
/** Ticks after "Yes, ok." for the rest of the chat and the teleport. */
export const TOLL_SETTLE_TICKS = Math.ceil(8000 / TICK_MS);
/** The worst case of one Open attempt, in ticks. */
export const TOLL_ATTEMPT_TICKS = 1 + TOLL_DIALOG_TICKS + 1 + TOLL_SETTLE_TICKS;
/** The worst case of a whole pass, in ticks. A walk reserves this when it may pay. */
export const TOLL_MAX_TICKS = TOLL_ATTEMPTS * TOLL_ATTEMPT_TICKS;
const OPEN = /^open$/i;
const YES = /yes/i;

export type TollResult =
    | { ok: true }
    | {
          ok: false;
          reason: 'no-coins' | 'no-loc' | 'send-failed' | 'cant-reach' | 'no-dialog' | 'timeout';
          message: string;
      };

/** The loc is one of the toll gate's two. */
export const isTollGate = (l: { x: number; z: number }) => TOLL_GATE_LOCS.some(g => g.x === l.x && g.z === l.z);
const coinsOf = (s: BotWorldState) => countItems(s, /^coins$/i);
/** The bot has the toll. */
export const canPayToll = (s: BotWorldState) => coinsOf(s) >= TOLL_FEE;

const choice = (s: BotWorldState) =>
    s.dialog.isOpen ? s.dialog.options.find(o => YES.test(cleanText(o.text))) : undefined;

/**
 * Pays the toll and passes the gate from the side the bot stands on. The bot should be next to the gate
 * (walkTo there first; the click walks the last tiles). `ok` once it stands on the other side; a bot that
 * already is does nothing. `opts.maxTicks` caps every wait to what the caller has left.
 */
export function* payToll(ctx: ActionContext, opts: { maxTicks?: number } = {}): Op<TollResult> {
    const first = ctx.state();
    const p = first.player;
    if (!p) return { ok: false, reason: 'no-loc', message: 'No player state' };
    const fromWest = !isEastOfToll(p.worldX);
    const crossed = (s: BotWorldState) => !!s.player && isEastOfToll(s.player.worldX) === fromWest;
    if (!canPayToll(first))
        return { ok: false, reason: 'no-coins', message: `The Al Kharid toll gate costs ${TOLL_FEE} coins` };

    const cursor = messageCursor(first);
    const refused = (s: BotWorldState) => !!messageSince(s, cursor, CANT_REACH);
    const startCoins = coinsOf(first);
    const budget = (n: number) => Math.min(n, opts.maxTicks ?? n);
    for (let attempt = 0; attempt < TOLL_ATTEMPTS; attempt++) {
        const s = ctx.state();
        if (crossed(s)) return { ok: true };
        // An earlier attempt took the toll but the bot is not through yet: another Open click would pay nothing, or too little.
        if (attempt > 0 && coinsOf(s) <= startCoins - TOLL_FEE)
            return { ok: false, reason: 'timeout', message: 'paid the toll but not through the gate' };
        const gate = s.nearbyLocs
            .filter(l => isTollGate(l) && l.optionsWithIndex.some(o => OPEN.test(o.text)))
            .toSorted((a, b) => a.distance - b.distance)
            .at(0);
        if (!gate)
            return {
                ok: false,
                reason: 'no-loc',
                message: `No openable toll gate at (${TOLL_GATE_LOCS[0]!.x}, ${TOLL_GATE_LOCS[0]!.z}) in sight`,
            };
        const sent = yield* interactLoc(gate, OPEN);
        if (!sent.ok) return { ok: false, reason: 'send-failed', message: sent.message };
        const w = yield* wait(
            'al kharid toll gate',
            t => crossed(t) || refused(t) || !!choice(t),
            budget(TOLL_DIALOG_TICKS),
        );
        if (crossed(w.state)) return { ok: true };
        if (refused(w.state))
            return { ok: false, reason: 'cant-reach', message: 'Cannot reach the Al Kharid toll gate' };
        const yes = choice(w.state);
        if (!yes) {
            if (w.state.dialog.isOpen)
                return {
                    ok: false,
                    reason: 'no-dialog',
                    message: 'A dialog is open at the toll gate with no "Yes" choice',
                };
            continue;
        }
        const click = yield* send({ type: 'clickDialogOption', optionIndex: yes.index, reason: 'pay the toll' });
        if (!click.success) return { ok: false, reason: 'send-failed', message: click.message };
        const done = yield* wait('toll gate dialog end', t => crossed(t), budget(TOLL_SETTLE_TICKS));
        if (crossed(done.state)) return { ok: true };
    }
    return {
        ok: false,
        reason: 'timeout',
        message: `The toll gate did not let the bot through after ${TOLL_ATTEMPTS} tries`,
    };
}
