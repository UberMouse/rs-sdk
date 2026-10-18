// Not ported: sdk/actions.ts has no crossing method; closest upstream is interactLoc, interactNpc and useItemOnLoc
// @ 4c2069cc0, which wait for an animation, dialog or interface that a scripted move need not show.
// Makes one move of the walk graph (lib/walk-graph.ts Move: a crossing row's act, a gate row's op): finds the loc,
// npc or obj by its config (lib/packs.ts), sends the act, answers the row's dialogue choices as they are shown and
// waits until the bot stands on one of the move's landings. The walk to the move's approach is the caller's
// (walkTo's); the client's own pathing covers the last tiles. Refusals are read as obstacle.ts reads them, and a
// failed roll as obstacle.ts reads a fall: tried again while `retry` says the way through is still the better one.
import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { CROSSING_TICKS } from '../../wiki/world/distance';
import { actName } from '../../wiki/world/reach';
import { type Op, scan, send, ticks, wait } from '../core/op';
import { configId, configName, objInfo } from '../lib/packs';
import { chebyshev, sameTile, type Tile } from '../lib/connectors';
import type { Move } from '../lib/walk-graph';
import type { ActionContext } from './context';
import { cleanText } from './dismiss';
import { interactItem, interactLoc, interactNpc } from './interact';
import { REFUSAL } from './interaction';
import { CANT_REACH, messageCursor, messageSince } from './messages';
import { OBSTACLE_FELL, OBSTACLE_REFUSED } from './obstacle';

/** Ticks for the client's walk from the approach tile to the loc or npc, before the act runs. */
export const CROSS_APPROACH_TICKS = 10;
/**
 * The move's own ticks are CROSSING_TICKS by its kind, which floors its script's delays (an npc's teleport talks
 * first); the wait gives it this many times that.
 */
export const CROSS_SLACK = 4;
/** Attempts of a rolled move however long `retry` holds: a bound, not a plan. */
export const CROSS_MAX_ATTEMPTS = 10;
/** How far from the row's tile a loc or npc may be found: a multi-tile loc reports one tile, an npc wanders. */
const LOC_SLACK = 3;
const NPC_SLACK = 16;
/** A teleport that lands the bot this far from where it stood, off every landing, has still moved it. */
const TELEPORT_JUMP = 10;
/** A choice dialog has more than one option; a lone Continue is the dialog guard's. */
const CHOICE_MIN_OPTIONS = 2;

/** The sends of a move besides its act: its dialogue choices. */
const CROSS_SEND_TICKS = 2;

/** The ticks one attempt of `m` waits for its move: the approach, the move's slack, a failed roll's delays. */
export const crossWaitTicks = (m: Move): number =>
    CROSS_APPROACH_TICKS + CROSS_SLACK * CROSSING_TICKS[m.via] + (m.roll?.fail.ticks ?? 0);

/** The ticks one attempt of `m` takes at its worst: its wait and its sends. */
export const crossAttemptTicks = (m: Move): number => crossWaitTicks(m) + CROSS_SEND_TICKS;

/** The ticks a failed roll of `m` waits before it is tried again: the failure's own delays. */
const retryDelayTicks = (m: Move): number => m.roll?.fail.ticks ?? 1;

export type CrossResult =
    | { ok: true; at: Tile; attempts: number }
    | {
          ok: false;
          /**
           * `refused`: the game said no (a message, a discarded op, a choice the row does not answer); `fell`: a failed
           * roll not tried again; `no-move`: nothing moved the bot in time; `no-target`, `no-item`, `send-failed`:
           * nothing reached the game.
           */
          reason: 'refused' | 'fell' | 'no-move' | 'no-target' | 'no-item' | 'send-failed';
          message: string;
      };

export interface CrossOptions {
    /** After a failed roll: whether to try again (the walk's plan still prices the move as the better way). */
    retry?(): boolean;
    /**
     * The tick the move is to be over by (a walk's deadline): a failed roll is tried again only when the retry's
     * delay and another attempt at its worst (crossAttemptTicks) end by it.
     */
    deadline?: number;
}

const here = (s: BotWorldState): Tile | undefined =>
    s.player ? { level: s.player.level, x: s.player.worldX, z: s.player.worldZ } : undefined;
/** A dialog's options as one string. */
const shown = (s: BotWorldState) => s.dialog.options.map(o => cleanText(o.text)).join(' / ');
const where = (m: Move) => `${actName(m)} at (${m.at.x}, ${m.at.z})`;

/** The move's loc in `locs`: by config id on its level within LOC_SLACK of its tile, else whatever is on its tile. */
function findLoc(locs: readonly NearbyLoc[], m: Move, loc: string): NearbyLoc | undefined {
    const id = configId('loc', loc);
    const near = locs.filter(l => l.level === m.at.level && chebyshev(l, m.at) <= LOC_SLACK);
    return (
        near.filter(l => l.id === id).sort((a, b) => chebyshev(a, m.at) - chebyshev(b, m.at))[0] ??
        near.find(l => l.x === m.at.x && l.z === m.at.z)
    );
}

/** The move's npc: by config id within NPC_SLACK of its spawn, the nearest to the bot. */
function findNpc(s: BotWorldState, m: Move, npc: string): NearbyNpc | undefined {
    const id = configId('npc', npc);
    return s.nearbyNpcs
        .filter(n => n.id === id && chebyshev(n, m.at) <= NPC_SLACK && n.reachable !== false)
        .sort((a, b) => a.distance - b.distance)[0];
}

/** The inventory item of an obj, or of any obj of a category. */
function findItem(s: BotWorldState, by: { obj: string } | { category: string }): InventoryItem | undefined {
    if ('obj' in by) {
        const id = configId('obj', by.obj);
        return s.inventory.find(i => i.id === id);
    }
    return s.inventory.find(i => {
        const obj = configName('obj', i.id);
        return !!obj && objInfo(obj)?.category === by.category;
    });
}

type Sent = { ok: true } | { ok: false; reason: 'no-target' | 'no-item' | 'send-failed'; message: string };
const sentOrFailed = (r: { ok: true } | { ok: false; message: string }): Sent =>
    r.ok ? { ok: true } : { ok: false, reason: 'send-failed', message: r.message };

/** Sends the move's act once. */
function* sendAct(ctx: ActionContext, m: Move): Op<Sent> {
    const { act } = m;
    const s = ctx.state();
    switch (act.kind) {
        case 'loc-op':
        case 'item-on-loc': {
            const loc = findLoc(s.nearbyLocs, m, act.loc) ?? findLoc(yield* scan(), m, act.loc);
            if (!loc) return { ok: false, reason: 'no-target', message: `No ${act.loc} in sight for ${where(m)}` };
            if (act.kind === 'loc-op') return sentOrFailed(yield* interactLoc(loc, act.op));
            const item = findItem(s, act);
            if (!item) return { ok: false, reason: 'no-item', message: `Nothing to use for ${where(m)}` };
            const sent = yield* send({
                type: 'useItemOnLoc',
                itemSlot: item.slot,
                x: loc.x,
                z: loc.z,
                locId: loc.id,
                reason: `use ${item.name} on ${loc.name}`,
            });
            return sent.success ? { ok: true } : { ok: false, reason: 'send-failed', message: sent.message };
        }
        case 'npc-op': {
            const npc = findNpc(s, m, act.npc);
            if (!npc)
                return { ok: false, reason: 'no-target', message: `No reachable ${act.npc} in sight for ${where(m)}` };
            return sentOrFailed(yield* interactNpc(npc, act.op));
        }
        case 'item-op': {
            const item = findItem(s, { obj: act.obj });
            if (!item) return { ok: false, reason: 'no-item', message: `No ${act.obj} carried for ${where(m)}` };
            return sentOrFailed(yield* interactItem(item, act.op));
        }
        case 'interface': {
            const componentId = configId('interface', act.component);
            if (componentId === undefined)
                return { ok: false, reason: 'no-target', message: `No interface component ${act.component}` };
            const sent = yield* send({ type: 'clickComponent', componentId, reason: `click ${act.component}` });
            return sent.success ? { ok: true } : { ok: false, reason: 'send-failed', message: sent.message };
        }
    }
}

/**
 * Makes the move `m`: sends its act, answers its choices (Act `choices`, in order, by their text) as they are shown,
 * and waits until the bot stands on one of its landings, or, for a teleport, until it has carried the bot off (another
 * plane, or TELEPORT_JUMP tiles from where it stood). `refused` is the game turning it down (obstacle.ts's refusals,
 * "I can't reach that!", a refusal message, a discarded op, a choice dialog the row has no answer for); `fell` a
 * failed roll (obstacle.ts's fall messages, or the bot moved to the roll's fail tile), which is tried again while
 * `opts.retry` holds and another attempt fits before `opts.deadline`, up to CROSS_MAX_ATTEMPTS; `no-move` nothing in
 * crossWaitTicks. The bot should stand on or near the move's approach (walkTo there first).
 */
export function* cross(ctx: ActionContext, m: Move, opts: CrossOptions = {}): Op<CrossResult> {
    for (let attempt = 1; ; attempt++) {
        const before = ctx.state();
        const start = here(before);
        if (!start) return { ok: false, reason: 'no-move', message: 'No player state' };
        const cursor = messageCursor(before);
        const rejected = before.opFeedback?.opRejectedCount ?? 0;
        const sent = yield* sendAct(ctx, m);
        if (!sent.ok) return sent;

        const choices = m.act.kind === 'loc-op' || m.act.kind === 'npc-op' ? [...(m.act.choices ?? [])] : [];
        const landed = (s: BotWorldState): boolean => {
            const p = here(s);
            if (!p) return false;
            if (m.landings.some(l => sameTile(l, p))) return true;
            return m.via === 'teleport' && (p.level !== start.level || chebyshev(p, start) >= TELEPORT_JUMP);
        };
        const refusal = (s: BotWorldState): string | null =>
            messageSince(s, cursor, OBSTACLE_REFUSED) ??
            messageSince(s, cursor, CANT_REACH) ??
            messageSince(s, cursor, REFUSAL);
        const fall = (s: BotWorldState): string | null => {
            const said = messageSince(s, cursor, OBSTACLE_FELL);
            if (said) return said;
            const to = m.roll?.fail.to;
            const p = here(s);
            return to && p && sameTile(to, p) ? `moved to the roll's fail tile (${to.x}, ${to.z})` : null;
        };
        const choice = (s: BotWorldState) => s.dialog.isOpen && s.dialog.options.length >= CHOICE_MIN_OPTIONS;
        const deadline = before.tick + crossWaitTicks(m);
        let w = yield* wait(
            `cross ${where(m)}`,
            s => landed(s) || !!refusal(s) || !!fall(s) || choice(s),
            crossWaitTicks(m),
        );
        // The row's choices, in order, as each is shown; one it does not answer ends the move.
        while (!landed(w.state) && !refusal(w.state) && !fall(w.state) && choice(w.state)) {
            const answered = shown(w.state);
            const want = choices[0];
            const pick =
                want && w.state.dialog.options.find(o => cleanText(o.text).toLowerCase() === want.toLowerCase());
            if (!pick)
                return {
                    ok: false,
                    reason: 'refused',
                    message: `${where(m)}: a choice the row does not answer (${answered})`,
                };
            choices.shift();
            const click = yield* send({ type: 'clickDialogOption', optionIndex: pick.index, reason: `${want}` });
            if (!click.success) return { ok: false, reason: 'send-failed', message: click.message };
            const left = Math.max(1, deadline - ctx.state().tick);
            w = yield* wait(
                `cross ${where(m)}`,
                s => landed(s) || !!refusal(s) || !!fall(s) || (choice(s) && shown(s) !== answered),
                left,
            );
            if (w.kind === 'timeout') break;
        }
        const at = here(w.state);
        if (landed(w.state) && at) return { ok: true, at, attempts: attempt };
        const no = refusal(w.state);
        if (no) return { ok: false, reason: 'refused', message: `${where(m)}: ${no}` };
        const slip = fall(w.state);
        if (slip) {
            const fits =
                opts.deadline === undefined ||
                ctx.state().tick + retryDelayTicks(m) + crossAttemptTicks(m) <= opts.deadline;
            if (attempt >= CROSS_MAX_ATTEMPTS || !fits || !opts.retry?.())
                return { ok: false, reason: 'fell', message: `${where(m)}: ${slip}` };
            // The failure's own delays, before the next try is sent.
            yield* ticks(retryDelayTicks(m));
            continue;
        }
        if ((w.state.opFeedback?.opRejectedCount ?? 0) > rejected)
            return { ok: false, reason: 'refused', message: `${where(m)}: the server discarded the op` };
        return {
            ok: false,
            reason: 'no-move',
            message: `${where(m)}: no move within ${crossWaitTicks(m)} ticks${at ? `; the bot is at (${at.x}, ${at.z})` : ''}`,
        };
    }
}
