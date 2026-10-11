// Not ported: sdk/actions.ts has no gate method; closest upstream is openDoor (bot.openDoor) @ 4c2069cc0.
// Passes a gate the player walks through from the south, as the Gnome Stronghold's entrance gate
// (gnome_gate.rs2): one "Open" click walks the bot through to `throughZ`. The gate is a 5x2 loc, not a
// door, so the pathfinder routes to its south side and stops, and walkTo's door opening does not apply.
// While the Grand Tree's Femi is beside the gate and the bot has not yet answered him (varp femi_help =
// 0), the first Open starts his dialog ("Could you help me lift these boxes?") and the gate stays shut;
// answering "Sorry, I'm a bit busy." ends it, and the next Open passes. This op clicks that choice
// (the dialog guard clears the "continue" pages and leaves the choice) and clicks Open again, up to
// GATE_ATTEMPTS times. Femi's dialog is the one this op opens on purpose, so it is answered here.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, scan, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { interactLoc } from './interact';
import { CANT_REACH, messageCursor, messageSince } from './messages';
import type { Pathfinder } from './paths';

/** Open clicks before the gate is given up on (the first may only start Femi's dialog). */
export const GATE_ATTEMPTS = 3;
/** Ticks from the Open click to the bot through or the dialog's choice: the walk to the gate and the pages before it. */
export const GATE_DIALOG_TICKS = Math.ceil(12_000 / TICK_MS);
/** Ticks after answering Femi for the rest of his chat to end, or the bot to pass. */
export const GATE_SETTLE_TICKS = Math.ceil(8000 / TICK_MS);
/** The worst case of one pass, in ticks. Walks and steps reserve this. */
export const GATE_MAX_TICKS = GATE_ATTEMPTS * (1 + GATE_DIALOG_TICKS + 1 + GATE_SETTLE_TICKS);
/** How far from the gate's origin tile a loc may be found (a multi-tile loc reports one of its tiles). */
const LOC_SLACK = 3;
const OPEN = /^open$/i;

/** A gate entered from its south side. */
export interface GateSpec {
    /** The gate loc's origin tile. */
    loc: { x: number; z: number };
    /** The loc's width in tiles, east from `loc.x`. */
    width: number;
    /** The tile south of the gate to stand on before opening it. */
    stand: { x: number; z: number };
    /** The bot has passed once its z is this or more, within `loc.x - 1 .. loc.x + width`. */
    throughZ: number;
    /** A tile inside the fence the gate leads into, and the box the fence interior is searched in. */
    inside: { x: number; z: number };
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    /** The dialog choice that ends a dialog which keeps the gate shut. */
    decline: RegExp;
}

/** The Gnome Stronghold entrance gate (loc 2459,3383, 5 wide; Femi's boxes stand beside it). */
export const GNOME_GATE: GateSpec = {
    loc: { x: 2459, z: 3383 },
    width: 5,
    stand: { x: 2461, z: 3381 },
    throughZ: 3385,
    inside: { x: 2474, z: 3436 },
    bounds: { minX: 2340, maxX: 2540, minZ: 3330, maxZ: 3540 },
    decline: /busy/i,
};

export type GateResult =
    | { ok: true }
    | {
          ok: false;
          reason: 'no-loc' | 'send-failed' | 'cant-reach' | 'no-dialog' | 'timeout';
          message: string;
      };

const clean = (text: string) => text.replaceAll('\\n', '').replace(/@\w+@/g, '').trim();
const passed = (s: BotWorldState, g: GateSpec) =>
    !!s.player &&
    s.player.worldZ >= g.throughZ &&
    s.player.worldX >= g.loc.x - 1 &&
    s.player.worldX <= g.loc.x + g.width;
const gap = (l: NearbyLoc, g: GateSpec) => Math.max(Math.abs(l.x - g.loc.x), Math.abs(l.z - g.loc.z));
const findGate = (locs: readonly NearbyLoc[], g: GateSpec) =>
    locs
        .filter(l => l.optionsWithIndex.some(o => OPEN.test(o.text)) && gap(l, g) <= LOC_SLACK)
        .sort((a, b) => gap(a, g) - gap(b, g))[0];

/**
 * Opens the gate and walks through it, answering Femi's boxes dialog by declining. `ok` once the bot
 * stands north of the gate. The bot should stand near the gate's south side (walkTo there first); the
 * client's own pathing covers the last tiles. A bot already through is `ok` at once.
 */
export function* passGate(ctx: ActionContext, g: GateSpec): Op<GateResult> {
    const first = ctx.state();
    if (passed(first, g)) return { ok: true };
    let loc = findGate(first.nearbyLocs, g);
    if (!loc) loc = findGate(yield* scan(), g);
    if (!loc) return { ok: false, reason: 'no-loc', message: `No openable gate at (${g.loc.x}, ${g.loc.z}) in sight` };

    const cursor = messageCursor(first);
    const refused = (s: BotWorldState) => !!messageSince(s, cursor, CANT_REACH);
    const choiceOpen = (s: BotWorldState) =>
        s.dialog.isOpen && s.dialog.options.some(o => g.decline.test(clean(o.text)));
    let declined = false;
    for (let attempt = 0; attempt < GATE_ATTEMPTS; attempt++) {
        const sent = yield* interactLoc(loc, OPEN);
        if (!sent.ok) return { ok: false, reason: 'send-failed', message: sent.message };
        const w = yield* wait(
            `pass gate (${g.loc.x},${g.loc.z})`,
            s => passed(s, g) || refused(s) || choiceOpen(s),
            GATE_DIALOG_TICKS,
        );
        if (passed(w.state, g)) return { ok: true };
        if (refused(w.state))
            return { ok: false, reason: 'cant-reach', message: `Cannot reach the gate at (${g.loc.x}, ${g.loc.z})` };
        const choice = w.state.dialog.options.find(o => g.decline.test(clean(o.text)));
        if (!choice) {
            // Nothing opened: the gate is slow (the click was ignored or the dialog already ended); click again.
            if (w.state.dialog.isOpen)
                return {
                    ok: false,
                    reason: 'no-dialog',
                    message: `A dialog is open at the gate with no "${g.decline.source}" choice`,
                };
            continue;
        }
        const click = yield* send({
            type: 'clickDialogOption',
            optionIndex: choice.index,
            reason: `decline at gate (${g.loc.x},${g.loc.z})`,
        });
        if (!click.success) return { ok: false, reason: 'send-failed', message: click.message };
        declined = true;
        // The rest of his chat is "continue" pages the dialog guard clears during this wait.
        const done = yield* wait(
            `gate dialog end (${g.loc.x},${g.loc.z})`,
            s => passed(s, g) || !s.dialog.isOpen,
            GATE_SETTLE_TICKS,
        );
        if (passed(done.state, g)) return { ok: true };
    }
    return {
        ok: false,
        reason: 'timeout',
        message: `Gate at (${g.loc.x}, ${g.loc.z}) did not let the bot through after ${GATE_ATTEMPTS} tries${declined ? ' (Femi declined)' : ''}`,
    };
}

const interiors = new WeakMap<Pathfinder, Map<GateSpec, Set<number>>>();
const key = (x: number, z: number) => x * 10_000 + z;
const STEPS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
] as const;

/**
 * The tiles inside the gate's fence: a flood fill on the surface from `g.inside` over single steps the
 * collision data allows, within `g.bounds`. Fence edges cut the steps, so the fill stops at the fence
 * and the gate (a loc, not an open edge) is the only way in. Cached per pathfinder (about 11k tiles
 * for the Gnome Stronghold; the first call indexes the collision data).
 */
function interior(paths: Pathfinder, g: GateSpec): Set<number> {
    let byGate = interiors.get(paths);
    if (!byGate) interiors.set(paths, (byGate = new Map()));
    const known = byGate.get(g);
    if (known) return known;
    const { minX, maxX, minZ, maxZ } = g.bounds;
    const seen = new Set<number>([key(g.inside.x, g.inside.z)]);
    const todo: [number, number][] = [[g.inside.x, g.inside.z]];
    for (let at = todo.pop(); at; at = todo.pop()) {
        const [x, z] = at;
        for (const [dx, dz] of STEPS) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < minX || nx > maxX || nz < minZ || nz > maxZ || seen.has(key(nx, nz))) continue;
            if (!paths.canStep(0, x, z, dx, dz)) continue;
            seen.add(key(nx, nz));
            todo.push([nx, nz]);
        }
    }
    byGate.set(g, seen);
    return seen;
}

/** The surface tile (x, z) is inside the gate's fence. */
export const insideFence = (paths: Pathfinder, g: GateSpec, x: number, z: number) => interior(paths, g).has(key(x, z));
