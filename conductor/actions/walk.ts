// Ported from sdk/actions.ts walkTo @ 4c2069cc0, with walkStepToward, waitForMovementComplete,
// openDoorAt, tryOpenBlockingDoor and walkAdjacentTo from sdk/actions-helpers.ts @ 4c2069cc0.
// Differences from bot.walkTo:
// - Routes come from `ctx.pathfinder` (default `collisionPaths`, the SDK's collision data as
//   sdk.findPath reads it), so a unit test supplies its own.
// - A door given up on (locked, or out of reach three times) is routed around for the rest of this walk
//   only; upstream blocks it for 30 s of wall clock across the SDK session. A caller that walks again
//   tries it again.
// - No death check and no dismissBlockingUI: the death guard ends the run (cancelling the walk), and the
//   dialog and interface guards clear what would block it.
// - Waits are ticks. waitForMovementComplete's 15 s wall-clock failsafe is gone (the engine ends a run
//   whose client stops publishing ticks); openDoorAt's 8 s wait is DOOR_OPEN_TICKS.
// - The whole walk has a tick budget (walkBudgetTicks, from the first route's length), where upstream is
//   bounded only by its 50 route queries; past it the walk ends `timeout` where it stands, and walking
//   again carries on from there. Inside a task step the budget is also capped to the step's ticks left
//   less `reserveTicks`, so a step that walks never overruns its own budget; with none left it is `no-time`.
// - A door open the client refuses to send fails that attempt at once instead of waiting for nothing.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { log, type Op, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { interactLoc } from './interact';
import { messageCursor, messageSince } from './messages';
import { collisionPaths, type DoorInfo, type PathResult, type Pathfinder, type Waypoint } from './paths';

/** bot.walkTo's default tolerance, in tiles (Chebyshev, the game's metric). */
export const WALK_TOLERANCE = 3;
/** Route queries before the walk gives up (upstream MAX_ITERATIONS). */
const MAX_ROUTES = 50;
/** Blocking-door opens a walk tries when it is stuck (upstream MAX_DOOR_RETRIES). */
const MAX_DOOR_RETRIES = 3;
/** Failed opens of one door before the walk routes around it. */
const DOOR_FAIL_LIMIT = 3;
/** How far a door may be to be opened: a door on the route, or the nearest openable when stuck. */
const DOOR_REACH = 15;
/** How close an intermediate waypoint must be passed. */
const WAYPOINT_PASS = 2;
/** Waypoints in a row the bot does not move toward before it tries a door and re-routes. */
const STUCK_WAYPOINTS = 3;
/** Routes in a row that bring the bot no closer before it tries a door, then gives up. */
const POOR_PROGRESS_LIMIT = 3;
/** openDoorAt's 8 s wait for the door to change, in ticks. */
export const DOOR_OPEN_TICKS = Math.ceil(8000 / TICK_MS);
/** Running speed: a leg gets 1.5x the ticks it needs at it. */
const RUN_TILES_PER_TICK = 2;
/** A leg has stopped when the bot has not moved for this many ticks. */
const STOPPED_TICKS = 2;
const MIN_LEG_TICKS = 3;
/** The most ticks one walk takes, whatever its route; a step's ticks left may cap it lower (WalkOptions). */
export const WALK_MAX_TICKS = 200;
/** Ticks a walk leaves its step by default: enough to act on the result (a log, a count) and return. */
export const WALK_RESERVE_TICKS = 3;
/** A walk's ticks on top of its route's: one door taking both open attempts and the walk beside it. */
export const WALK_BASE_TICKS = 2 * DOOR_OPEN_TICKS + 20;
/** Ticks per tile of route: walking pace (1 tile a tick) with as much again for slack. */
export const WALK_TICKS_PER_TILE = 2;

const OPEN = /^open$/i;
const LOCKED = /locked/i;
const DOOR_REFUSAL = /locked|can't reach|cannot reach/i;

export type WalkResult =
    | { ok: true; message: string }
    | {
          ok: false;
          reason:
              | 'bad-coordinates'
              | 'no-player'
              | 'no-path'
              | 'dead-end'
              | 'stuck'
              | 'gave-up'
              | 'timeout'
              | 'no-time';
          message: string;
      };

export interface WalkOptions {
    /** The most ticks the walk may take; default WALK_MAX_TICKS. */
    maxTicks?: number;
    /**
     * Ticks the step still needs once the walk is over (the op and waits that follow it); default
     * WALK_RESERVE_TICKS. The walk takes at most the step's ticks left (ActionContext.stepTicksLeft) less
     * these, so the step finishes inside its tick budget instead of the engine ending the run `stuck`.
     */
    reserveTicks?: number;
}

/** The tick budget of a walk whose first route is `tiles` long (a partial one to the destination), capped at `maxTicks`. */
export const walkBudgetTicks = (tiles: number, maxTicks = WALK_MAX_TICKS): number =>
    Math.min(maxTicks, WALK_BASE_TICKS + WALK_TICKS_PER_TILE * tiles);

type Point = { x: number; z: number };
type DoorOpen = 'opened' | 'already-open' | 'locked' | 'cant-reach' | 'not-found';

/** One walk's shared state: its budget and the doors it has given up on. */
interface Walk {
    ctx: ActionContext;
    paths: Pathfinder;
    target: Point;
    startTick: number;
    /** The tick the walk ends `timeout` at. */
    deadline: number;
    /** Doors given up on, routed around (upstream's temporary door blocklist). */
    avoided: Map<string, DoorInfo>;
    /** Failed opens per door. */
    doorFails: Map<string, number>;
    /** Blocking-door opens tried so far. */
    doorRetries: number;
}

const dist = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const posOf = (p: { worldX: number; worldZ: number }): Point => ({ x: p.worldX, z: p.worldZ });
const tileKey = (p: Point) => `${p.x},${p.z}`;
const doorKey = (d: DoorInfo) => `${d.level},${d.x},${d.z}`;
const hasOpen = (l: NearbyLoc) => l.optionsWithIndex.some(o => OPEN.test(o.text));
const adjacent = (a: Point, b: Point) => dist(a, b) === 1;

/** Ticks of `n` the walk's budget still allows. */
const allowed = (w: Walk, n: number) => Math.max(0, Math.min(n, w.deadline - w.ctx.state().tick));
const outOfTime = (w: Walk, s: BotWorldState = w.ctx.state()) => s.tick >= w.deadline;

/** Walks `n` ticks, or what is left of the budget. */
function* pause(w: Walk, n: number): Op<void> {
    yield* wait(`ticks:${n}`, () => false, allowed(w, n));
}

/**
 * Walks to within `tolerance` tiles of (x, z) on the bot's level, along routes from the pathfinder, one
 * waypoint at a time, opening the doors and gates on the way. A route that stops short is walked once
 * (doors open and the map loads along it); stopping at the same tile again is `dead-end`. `stuck` is
 * no closer after three routes and no door to open; `no-path` is no route at all; `gave-up` is 50 routes
 * without arriving; `timeout` is the tick budget spent (walkBudgetTicks, capped to the step's ticks left
 * less `reserveTicks`), wherever the bot then stands; `no-time` is a step with no ticks left to walk in,
 * nothing sent.
 */
export function* walkTo(
    ctx: ActionContext,
    x: number,
    z: number,
    tolerance = WALK_TOLERANCE,
    opts: WalkOptions = {},
): Op<WalkResult> {
    if (!Number.isFinite(x) || !Number.isFinite(z))
        return {
            ok: false,
            reason: 'bad-coordinates',
            message: `walkTo requires numeric coordinates - got (${x}, ${z}). Nearby entities (players included) expose them as .x/.z; your own position is state.player.worldX/.worldZ`,
        };
    const start = ctx.state();
    if (!start.player) return { ok: false, reason: 'no-player', message: 'No player state' };
    const target = { x, z };
    let pos = posOf(start.player);
    if (dist(pos, target) <= tolerance) return { ok: true, message: 'Already at destination' };

    // The step's budget caps the walk's, keeping back what the step does after it.
    const left = ctx.stepTicksLeft?.();
    const reserve = opts.reserveTicks ?? WALK_RESERVE_TICKS;
    const maxTicks = Math.min(opts.maxTicks ?? WALK_MAX_TICKS, left === undefined ? Infinity : left - reserve);
    if (maxTicks <= 0)
        return {
            ok: false,
            reason: 'no-time',
            message: `No time to walk to (${x}, ${z}): the step has ${left} ticks left and needs ${reserve} after the walk`,
        };
    const w: Walk = {
        ctx,
        paths: ctx.pathfinder ?? collisionPaths,
        target,
        startTick: start.tick,
        deadline: start.tick + maxTicks,
        avoided: new Map(),
        doorFails: new Map(),
        doorRetries: 0,
    };
    const timedOut = (): WalkResult => {
        const p = ctx.state().player;
        const at = p ? `(${p.worldX}, ${p.worldZ})` : 'an unknown tile';
        return {
            ok: false,
            reason: 'timeout',
            message: `Walk to (${x}, ${z}) ran out of its ${w.deadline - w.startTick} ticks at ${at}`,
        };
    };

    let budgeted = false;
    let poorProgress = 0;
    // Where the last partial route stopped: walking the same dead end twice cannot succeed.
    let lastPartialEnd: Point | null = null;
    // Progress is closing on the destination, not distance walked: an oscillating route moves every
    // time without getting closer.
    let bestRemaining = dist(pos, target);

    for (let i = 0; i < MAX_ROUTES; i++) {
        if (outOfTime(w)) return timedOut();
        let path = route(w);
        if (!path.success || !path.waypoints.length) {
            yield* pause(w, 1);
            path = route(w);
            if (!path.success || !path.waypoints.length) {
                // The usual cause is a destination that is itself blocked (a wall, a loc's tile), not
                // broken collision data: say which.
                const level = ctx.state().player?.level ?? 0;
                const why =
                    path.error ?? (w.paths.walkable(level, x, z) ? 'no waypoints' : 'destination tile is blocked');
                return {
                    ok: false,
                    reason: 'no-path',
                    message: `No path to (${x}, ${z}) from (${pos.x}, ${pos.z}): ${why}`,
                };
            }
        }
        const { waypoints } = path;
        const end = waypoints[waypoints.length - 1]!;
        if (!budgeted) {
            w.deadline = w.startTick + walkBudgetTicks(routeTiles(pos, waypoints, target), maxTicks);
            budgeted = true;
        }

        // A partial route is worth walking once; a re-query from its end that ends there again loops.
        const partial = path.reachedDestination === false && dist(end, target) > tolerance;
        if (partial && lastPartialEnd && end.x === lastPartialEnd.x && end.z === lastPartialEnd.z) {
            if (!(yield* tryOpenDoor(w))) {
                const short = Math.round(dist(end, target));
                return {
                    ok: false,
                    reason: 'dead-end',
                    message: `Path to (${x}, ${z}) stops ${short} tiles short at (${end.x}, ${end.z}) - the rest is unroutable from here (locked door or separate room?)`,
                };
            }
            lastPartialEnd = null;
            continue;
        }
        lastPartialEnd = partial ? { x: end.x, z: end.z } : null;

        // Doors the route crosses, opened as the bot comes within reach of them.
        const doors = w.paths.doorsAlong(waypoints);
        const shut = new Set(doors.map(tileKey));
        let stuckInARow = 0;
        for (const wp of waypoints) {
            if (outOfTime(w)) return timedOut();
            if (shut.size > 0 && nearDoor(shut, wp) && dist(pos, wp) <= DOOR_REACH)
                yield* openDoorBy(w, doors, shut, wp);

            // Intermediate waypoints only need passing near; the last must honour the caller's
            // tolerance, or a tolerance under 2 could never be met.
            const last = wp === end;
            const leg = yield* walkLeg(w, wp, last ? Math.min(WAYPOINT_PASS, tolerance) : WAYPOINT_PASS, pos);
            if (dist(leg.pos, target) <= tolerance) return { ok: true, message: 'Arrived' };
            if (leg.status === 'stuck') {
                if (++stuckInARow >= STUCK_WAYPOINTS) {
                    yield* tryOpenDoor(w);
                    break;
                }
            } else {
                stuckInARow = 0;
                pos = leg.pos;
            }
        }

        const remaining = dist(pos, target);
        if (remaining < bestRemaining) {
            bestRemaining = remaining;
            poorProgress = 0;
        } else if (++poorProgress >= POOR_PROGRESS_LIMIT) {
            if (!(yield* tryOpenDoor(w)))
                return { ok: false, reason: 'stuck', message: `Stuck at (${pos.x}, ${pos.z})` };
            poorProgress = 0;
        }
    }
    if (outOfTime(w)) return timedOut();
    return { ok: false, reason: 'gave-up', message: `Could not reach (${x}, ${z}) - stopped at (${pos.x}, ${pos.z})` };
}

/** A route from where the bot stands now, around the doors this walk gave up on. */
function route(w: Walk): PathResult {
    const p = w.ctx.state().player;
    if (!p) return { success: false, waypoints: [], error: 'No player state available' };
    return w.paths.findPath({ x: p.worldX, z: p.worldZ, level: p.level }, w.target, [...w.avoided.values()]);
}

/** Tiles from `from` along `waypoints`, and on to `target` in a line where a partial route stops short. */
function routeTiles(from: Point, waypoints: readonly Waypoint[], target: Point): number {
    let tiles = 0;
    let at = from;
    for (const wp of waypoints) {
        tiles += dist(at, wp);
        at = wp;
    }
    return tiles + dist(at, target);
}

/** A door on the route is on the waypoint's tile or a cardinal neighbour of it. */
const nearDoor = (shut: Set<string>, wp: Point) =>
    [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ].some(([dx, dz]) => shut.has(tileKey({ x: wp.x + dx!, z: wp.z + dz! })));

/**
 * Opens the first route door within a tile (Manhattan) of `wp`, as upstream does: one opened (or open
 * already) leaves `shut`; a locked one is routed around from the next route on; one out of reach three
 * times is too; one the scene does not show (the collision data has a door the map does not) is skipped
 * for the next. Only one door is tried per waypoint, and the walk goes on either way.
 */
function* openDoorBy(w: Walk, doors: readonly DoorInfo[], shut: Set<string>, wp: Point): Op<void> {
    for (const door of doors) {
        if (w.avoided.has(doorKey(door))) return;
        if (Math.abs(door.x - wp.x) + Math.abs(door.z - wp.z) > 1) continue;
        const key = tileKey(door);
        const r = yield* openDoorAt(w, door);
        if (r === 'not-found') {
            shut.delete(key);
            continue;
        }
        if (r === 'opened' || r === 'already-open') {
            shut.delete(key);
            yield* pause(w, 1);
        } else if (r === 'locked') {
            w.avoided.set(doorKey(door), door);
            shut.delete(key);
            yield* log(`walk: door at (${door.x}, ${door.z}) is locked; routing around it`);
        } else {
            const fails = (w.doorFails.get(key) ?? 0) + 1;
            w.doorFails.set(key, fails);
            if (fails >= DOOR_FAIL_LIMIT) {
                w.avoided.set(doorKey(door), door);
                shut.delete(key);
                yield* log(`walk: door at (${door.x}, ${door.z}) out of reach ${fails} times; routing around it`);
            } else
                yield* log(`walk: door at (${door.x}, ${door.z}) out of reach (attempt ${fails}/${DOOR_FAIL_LIMIT})`);
        }
        return;
    }
}

/**
 * When stuck: opens the nearest openable loc (door, gate, fence) within DOOR_REACH, at most
 * MAX_DOOR_RETRIES times a walk. When none opens, counts a failure against the nearest openable and
 * routes around it once it has DOOR_FAIL_LIMIT. True if something opened.
 */
function* tryOpenDoor(w: Walk): Op<boolean> {
    if (w.doorRetries >= MAX_DOOR_RETRIES) return false;
    const nearest = openables(w.ctx.state())[0];
    if (nearest) {
        const r = yield* openDoorAt(w, nearest);
        if (r === 'opened' || r === 'already-open') {
            w.doorRetries++;
            yield* pause(w, 1);
            return true;
        }
    }
    // Upstream looks again after the failed open: the nearest may have changed as the bot moved.
    const s = w.ctx.state();
    const blocking = openables(s)[0];
    if (blocking) {
        const level = s.player?.level ?? 0;
        const key = tileKey(blocking);
        const fails = (w.doorFails.get(key) ?? 0) + 1;
        w.doorFails.set(key, fails);
        const door = w.paths.doorAt(level, blocking.x, blocking.z);
        if (fails >= DOOR_FAIL_LIMIT && door && !w.avoided.has(doorKey(door))) {
            w.avoided.set(doorKey(door), door);
            yield* log(`walk: door at (${door.x}, ${door.z}) will not open; routing around it`);
        }
    }
    return false;
}

/** Locs with an Open option within DOOR_REACH, nearest first. */
const openables = (s: BotWorldState) =>
    s.nearbyLocs.filter(l => hasOpen(l) && l.distance <= DOOR_REACH).sort((a, b) => a.distance - b.distance);

/**
 * Opens the door at `at`: Open on it, letting the server walk the bot there; if that neither opens it
 * nor shows it locked, walks beside it first (the server's route to it may run through the door) and
 * tries once more.
 */
function* openDoorAt(w: Walk, at: Point): Op<DoorOpen> {
    const door = w.ctx.state().nearbyLocs.find(l => l.x === at.x && l.z === at.z);
    if (!door) return 'not-found';
    const open = door.optionsWithIndex.find(o => OPEN.test(o.text));
    if (!open) return 'already-open';
    const first = yield* tryOpen(w, door, open.opIndex);
    if (first === 'opened' || first === 'locked') return first;
    if (!(yield* walkBeside(w, door))) return 'cant-reach';
    const second = yield* tryOpen(w, door, open.opIndex);
    return second === 'opened' || second === 'locked' ? second : 'cant-reach';
}

/** Sends Open on `door` and waits for it to open (gone, or no Open option), or the game's refusal. */
function* tryOpen(w: Walk, door: NearbyLoc, option: number): Op<'opened' | 'locked' | 'cant-reach' | 'timeout'> {
    const cursor = messageCursor(w.ctx.state());
    const sent = yield* interactLoc(door, option);
    if (!sent.ok) return 'timeout';
    const closed = (s: BotWorldState) =>
        s.nearbyLocs.some(l => l.x === door.x && l.z === door.z && l.id === door.id && hasOpen(l));
    const refusal = (s: BotWorldState) => messageSince(s, cursor, DOOR_REFUSAL);
    const waited = yield* wait(`open ${door.name}`, s => !!refusal(s) || !closed(s), allowed(w, DOOR_OPEN_TICKS));
    const said = refusal(waited.state);
    if (said) return LOCKED.test(said) ? 'locked' : 'cant-reach';
    return closed(waited.state) ? 'timeout' : 'opened';
}

/** Walks to a tile beside `door`, trying each cardinal side nearest first. True once beside it. */
function* walkBeside(w: Walk, door: Point): Op<boolean> {
    const p = w.ctx.state().player;
    if (!p) return false;
    const at = posOf(p);
    if (adjacent(at, door)) return true;
    const manhattan = (c: Point) => Math.abs(c.x - at.x) + Math.abs(c.z - at.z);
    const sides = [
        { x: door.x, z: door.z - 1 },
        { x: door.x, z: door.z + 1 },
        { x: door.x - 1, z: door.z },
        { x: door.x + 1, z: door.z },
    ].sort((a, b) => manhattan(a) - manhattan(b));
    // The nearest side may be across a wall.
    for (const side of sides) {
        if (outOfTime(w)) return false;
        yield* sendWalk(side);
        const moved = yield* awaitLeg(w, side, 1);
        if (moved.arrived) return true;
        const q = moved.state.player;
        if (q && adjacent(posOf(q), door)) return true;
    }
    return false;
}

function* sendWalk(to: Point): Op<void> {
    // A walk the client refuses shows as no movement, which the leg's wait reports.
    yield* send({ type: 'walkTo', x: to.x, z: to.z, running: true, reason: `walk to (${to.x}, ${to.z})` });
}

/** One leg toward a waypoint: `arrived` within `tolerance`, `stuck` (moved under 2 tiles), else `progress`. */
function* walkLeg(
    w: Walk,
    wp: Point,
    tolerance: number,
    from: Point,
): Op<{ status: 'arrived' | 'progress' | 'stuck'; pos: Point }> {
    yield* sendWalk(wp);
    const moved = yield* awaitLeg(w, wp, tolerance);
    const p = moved.state.player;
    if (!p) return { status: 'stuck', pos: from };
    const now = posOf(p);
    if (dist(now, wp) <= tolerance) return { status: 'arrived', pos: now };
    // Every leg that did not arrive has stopped (or run out of ticks), so little movement is stuck.
    if (Math.hypot(now.x - from.x, now.z - from.z) < 2) return { status: 'stuck', pos: now };
    return { status: 'progress', pos: now };
}

/**
 * Waits a tick at a time until the bot is within `tolerance` of `to`, has not moved for STOPPED_TICKS,
 * or has had 1.5x the ticks running there takes (at least MIN_LEG_TICKS), within the walk's budget.
 * Like upstream it judges only the states after the send, never the one it was sent on: a leg re-sent
 * to a waypoint already passed takes a tick, in which the bot carries on along its last walk. One tick
 * per wait, so the stop can compare positions; the guards act at every one.
 */
function* awaitLeg(w: Walk, to: Point, tolerance: number): Op<{ arrived: boolean; state: BotWorldState }> {
    const start = w.ctx.state();
    if (!start.player) return { arrived: false, state: start };
    let last = posOf(start.player);
    const legTicks = Math.max(MIN_LEG_TICKS, Math.ceil(Math.ceil(dist(last, to) / RUN_TILES_PER_TICK) * 1.5));
    let lastMoveTick = start.tick;
    for (;;) {
        const s = (yield* wait(`walk to (${to.x}, ${to.z})`, () => false, allowed(w, 1))).state;
        const p = s.player;
        if (p && dist(posOf(p), to) <= tolerance) return { arrived: true, state: s };
        if (p && (p.worldX !== last.x || p.worldZ !== last.z)) {
            last = posOf(p);
            lastMoveTick = s.tick;
        }
        if (s.tick - lastMoveTick >= STOPPED_TICKS || s.tick - start.tick >= legTicks || outOfTime(w, s))
            return { arrived: false, state: s };
    }
}
