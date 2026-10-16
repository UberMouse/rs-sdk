// Not ported: sdk/actions.ts has no stairs or ladder method; closest upstream is interactLoc @ 4c2069cc0
// (which bot.walkTo's callers used by hand for a "Climb-up").
// Uses one level connector (lib/connectors.ts): finds its loc, sends the option for the direction and waits
// until the bot is on the plane it leads to, read from state (level, and whether z is underground).
// The loc's own Climb-up / Climb-down option is sent where it has one; a middle floor's plain "Climb"
// opens a "Climb up or down?" dialog, answered here as part of the climb. A closed trapdoor (only "Open")
// is opened first and the climb goes on once it offers "Climb-down". The walk to the loc is the
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

const CLIMB_WINDOW_MS = 6000;
/** The ticks the server takes to walk to the loc, climb (arrive delay and animation) and move the bot. */
export const CLIMB_WAIT_TICKS = Math.ceil(CLIMB_WINDOW_MS / TICK_MS);
/** The ticks the "Climb up or down?" dialog takes to open, after the walk to the loc. */
export const CLIMB_DIALOG_TICKS = Math.ceil(4000 / TICK_MS);
/** The ticks a closed trapdoor gets to open (the walk to it, then the loc change), after the send. */
export const CLIMB_OPEN_TICKS = CLIMB_WAIT_TICKS;
/** The worst case of one climb, in ticks: a send, the dialog or the opening, the answer or climb send, the wait. Walks reserve this. */
export const CLIMB_MAX_TICKS = 1 + Math.max(CLIMB_DIALOG_TICKS, CLIMB_OPEN_TICKS) + 1 + CLIMB_WAIT_TICKS;
/** How far from the table's tile a loc may be found (a multi-tile loc reports one of its tiles). */
const LOC_SLACK = 2;

export type ClimbResult =
    | { ok: true }
    | {
          ok: false;
          reason: 'wrong-plane' | 'no-loc' | 'cant-reach' | 'no-dialog' | 'send-failed' | 'timeout' | 'not-opened';
          message: string;
      };

const OPTIONS = {
    up: { direct: /^(climb|walk)-up$/i, choice: /^climb up\.?$/i },
    down: { direct: /^(climb|walk)-down$/i, choice: /^climb down\.?$/i },
} as const;
/** A middle floor's op 1: it asks which way. */
const ASKS = /^climb$/i;
/** A closed trapdoor's only option. */
const OPEN = /^open$/i;

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

/** The nearest loc to the connector's tile within LOC_SLACK on its level that `ok` accepts (a multi-tile loc reports one of its tiles). */
function nearestLoc(locs: readonly NearbyLoc[], c: Connector, ok: (l: NearbyLoc) => boolean): NearbyLoc | undefined {
    const gap = (l: NearbyLoc) => Math.max(Math.abs(l.x - c.loc.x), Math.abs(l.z - c.loc.z));
    return locs.filter(l => l.level === c.loc.level && ok(l) && gap(l) <= LOC_SLACK).sort((a, b) => gap(a) - gap(b))[0];
}

/** The connector's loc among `locs`: on its tile, else the nearest within LOC_SLACK, with a climb option. */
const findLoc = (locs: readonly NearbyLoc[], c: Connector) =>
    nearestLoc(locs, c, l => hasOption(l, OPTIONS[c.direction].direct) || hasOption(l, ASKS));

/** The connector's loc when it is closed: a trapdoor within LOC_SLACK offering Open. */
const findClosed = (locs: readonly NearbyLoc[], c: Connector) =>
    nearestLoc(locs, c, l => /trapdoor/i.test(l.name) && hasOption(l, OPEN));

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
    let cursor = messageCursor(before);
    let loc = findLoc(before.nearbyLocs, c);
    const scanned = loc ? [] : yield* scan();
    loc ??= findLoc(scanned, c);
    if (!loc) {
        const closed = findClosed(before.nearbyLocs, c) ?? findClosed(scanned, c);
        if (!closed) return { ok: false, reason: 'no-loc', message: `No ${where(c)} in sight` };
        const opening = yield* interactLoc(closed, OPEN);
        if (!opening.ok) return { ok: false, reason: 'send-failed', message: opening.message };
        const opened = yield* wait(
            `open ${c.name}`,
            s => !!findLoc(s.nearbyLocs, c) || !!messageSince(s, cursor, CANT_REACH),
            CLIMB_OPEN_TICKS,
        );
        loc = findLoc(opened.state.nearbyLocs, c);
        if (!loc)
            return messageSince(opened.state, cursor, CANT_REACH)
                ? cantReach(c)
                : { ok: false, reason: 'not-opened', message: `The ${where(c)} did not open` };
        cursor = messageCursor(opened.state);
    }

    // findLoc only returns a loc with the direction's option or the plain Climb.
    const direct = loc.optionsWithIndex.find(opt => o.direct.test(opt.text));
    const asks = !direct;

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
