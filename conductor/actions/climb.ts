// Not ported: sdk/actions.ts has no stairs or ladder method; closest upstream is interactLoc @ 4c2069cc0
// (which bot.walkTo's callers used by hand for a "Climb-up").
// Uses one level connector (lib/connectors.ts): finds its loc, sends the option for the direction and waits
// until the bot is on the plane it leads to, read from state (level, and whether z is underground).
// The loc's own Climb-up / Climb-down option is sent where it has one; a middle floor's plain "Climb"
// opens a "Climb up or down?" dialog, answered here as part of the climb. The walk to the loc is the
// caller's (walkTo's); the client's own pathing covers the last tiles.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, scan, send, wait } from '../core/op';
import { type Connector, planeOf } from '../lib/connectors';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { interactLoc } from './interact';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** A choice dialog has more than one option; a lone Continue is left alone. */
const CHOICE_MIN_OPTIONS = 1;

/** The ticks the server takes to walk to the loc, climb (arrive delay and animation) and move the bot. */
export const CLIMB_WAIT_TICKS = Math.ceil(6000 / TICK_MS);
/** The ticks the "Climb up or down?" dialog takes to open, after the walk to the loc. */
export const CLIMB_DIALOG_TICKS = Math.ceil(4000 / TICK_MS);
/** The worst case of one climb, in ticks: a send, the dialog, its answer, the wait. Walks reserve this. */
export const CLIMB_MAX_TICKS = 1 + CLIMB_DIALOG_TICKS + 1 + CLIMB_WAIT_TICKS;
/** How far from the table's tile a loc may be found (a multi-tile loc reports one of its tiles). */
const LOC_SLACK = 2;

export type ClimbResult =
    | { ok: true }
    | {
          ok: false;
          reason: 'wrong-plane' | 'no-loc' | 'cant-reach' | 'no-dialog' | 'send-failed' | 'timeout';
          message: string;
      };

const OPTIONS = {
    up: { direct: /^(climb|walk)-up$/i, choice: /^climb up\.?$/i },
    down: { direct: /^(climb|walk)-down$/i, choice: /^climb down\.?$/i },
} as const;
/** A middle floor's op 1: it asks which way. */
const ASKS = /^climb$/i;

const where = (c: Connector) => `${c.name} at (${c.loc.x}, ${c.loc.z}) level ${c.loc.level}`;
const planeNow = (s: BotWorldState) =>
    s.player ? planeOf(s.player.level, s.player.worldX, s.player.worldZ) : undefined;
const hasOption = (l: NearbyLoc, re: RegExp) => l.optionsWithIndex.some(o => re.test(o.text));
const clean = (text: string) => text.replaceAll('\\n', '').replace(/@\w+@/g, '').trim();
const cantReach = (c: Connector): ClimbResult => ({
    ok: false,
    reason: 'cant-reach',
    message: `Cannot reach the ${where(c)}`,
});

/** The connector's loc among `locs`: on its tile, else the nearest within LOC_SLACK, with a climb option. */
function findLoc(locs: readonly NearbyLoc[], c: Connector): NearbyLoc | undefined {
    const o = OPTIONS[c.direction];
    const usable = locs.filter(l => l.level === c.loc.level && (hasOption(l, o.direct) || hasOption(l, ASKS)));
    const gap = (l: NearbyLoc) => Math.max(Math.abs(l.x - c.loc.x), Math.abs(l.z - c.loc.z));
    return usable.filter(l => gap(l) <= LOC_SLACK).sort((a, b) => gap(a) - gap(b))[0];
}

/**
 * Climbs `c`: sends its option on the loc and waits for the bot to be on the plane it leads to
 * (`c.to`). A direction's option (Climb-up / Walk-up, Climb-down / Walk-down) goes straight; a plain
 * Climb opens the choice, and "Climb Up." or "Climb Down." is clicked. The bot should stand near the
 * loc already: the op sends once and waits CLIMB_WAIT_TICKS.
 */
export function* climb(ctx: ActionContext, c: Connector): Op<ClimbResult> {
    const before = ctx.state();
    if (!before.player) return { ok: false, reason: 'wrong-plane', message: 'No player state' };
    if (planeNow(before) !== planeOf(c.loc.level, c.loc.x, c.loc.z))
        return {
            ok: false,
            reason: 'wrong-plane',
            message: `Not on the plane of the ${where(c)}: at level ${before.player.level}, (${before.player.worldX}, ${before.player.worldZ})`,
        };

    const o = OPTIONS[c.direction];
    let loc = findLoc(before.nearbyLocs, c);
    if (!loc) loc = findLoc(yield* scan(), c);
    if (!loc) return { ok: false, reason: 'no-loc', message: `No ${where(c)} in sight` };

    // findLoc only returns a loc with the direction's option or the plain Climb.
    const direct = loc.optionsWithIndex.find(opt => o.direct.test(opt.text));
    const asks = !direct;

    const cursor = messageCursor(before);
    const there = (s: BotWorldState) => planeNow(s) === planeOf(c.to.level, c.to.x, c.to.z);
    const refused = (s: BotWorldState) => !!messageSince(s, cursor, CANT_REACH);
    const sent = yield* interactLoc(loc, direct ? direct.opIndex : ASKS);
    if (!sent.ok) return { ok: false, reason: 'send-failed', message: sent.message };

    let answered = false;
    try {
        if (asks) {
            const question = yield* wait(
                `${c.name} choice`,
                s => there(s) || refused(s) || s.dialog.options.some(opt => o.choice.test(clean(opt.text))),
                CLIMB_DIALOG_TICKS,
            );
            if (there(question.state)) return { ok: true };
            if (refused(question.state)) return cantReach(c);
            const choice = question.state.dialog.options.find(opt => o.choice.test(clean(opt.text)));
            if (!choice)
                return {
                    ok: false,
                    reason: 'no-dialog',
                    message: `No "Climb ${c.direction}" choice from the ${where(c)}`,
                };
            const click = yield* send({
                type: 'clickDialogOption',
                optionIndex: choice.index,
                reason: `climb ${c.direction} ${c.name}`,
            });
            if (!click.success) return { ok: false, reason: 'send-failed', message: click.message };
            answered = true;
        }
        const w = yield* wait(`climb ${c.direction} ${c.name}`, s => there(s) || refused(s), CLIMB_WAIT_TICKS);
        if (there(w.state)) return { ok: true };
        if (refused(w.state)) return cantReach(c);
        return { ok: false, reason: 'timeout', message: `Still not on the plane above or below the ${where(c)}` };
    } finally {
        // A choice the op opened and did not answer (a cancel, no choice found) must not stay open.
        const d = ctx.state().dialog;
        if (asks && !answered && d.isOpen && d.options.length > CHOICE_MIN_OPTIONS)
            yield* send({ type: 'closeModal', reason: 'close climb choice' });
    }
}
