// Ported from sdk/actions.ts walkTo @ df3d8888a, with walkStepToward, waitForMovementComplete,
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
// - The whole walk has a tick budget (walkBudgetTicks, from the first route's length), where upstream has
//   50 route queries and a 120 s wall-clock timeout, and refuses to walk on stale state; past it the walk
//   ends `timeout` where it stands, and walking again carries on from there. Inside a task step the budget is also capped to the step's ticks left
//   less `reserveTicks`, so a step that walks never overruns its own budget; with none left it is `no-time`.
// - A door open the client refuses to send fails that attempt at once instead of waiting for nothing.
// - A route that crosses the Wilderness (the surface one, or the Edgeville dungeon's) to a destination
//   outside it is `no-path`, never walked: upstream walks whatever the pathfinder returns.
// - A closed slashable web (SLASH_WEBS in paths.ts, the Varrock Sewers one among them) is a door the route may cross:
//   the walk sends Slash on it (the server needs a slash weapon wielded) and repeats on "You fail to cut
//   through it." up to WEB_SLASH_ATTEMPTS times; upstream has no web handling and fails `no-path`.
// - On a raised section of an agility course, or inside the Gnome Stronghold's fence with a destination outside
//   it, the ground pathfinder has no route out, so the walk first crosses the course's obstacles forward to the
//   ground, or walks to the gate and passes it outward (leaveEnclosure); upstream fails `no-path`.
// - A walk is planned over the world index's graph (lib/walk-graph.ts planWay) before it is walked: a destination on
//   another plane (a level above or below, or underground at z >= 6400) is reached through the level connectors of
//   lib/connectors.ts (staircases, ladders), used with the climb op, and a way on any plane through the moves the
//   graph has (scripted moves, teleports, agility shortcuts priced at the bot's level, gate jumps) made with the
//   cross op, or through a bank detour for an obj a move needs; upstream has none of them and fails `no-path` or
//   walks round. The walk keeps one tick budget across the legs and the hops.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { actName } from '../../wiki/world/reach';
import { CAME_FROM, cameFrom } from '../../wiki/world/requirements';
import { log, type Op, send, wait } from '../core/op';
import { type Account, accountOf, meetsOneOf } from '../lib/account';
import { BANK_STAND_RADIUS, BANKS } from '../lib/banks';
import { chebyshev, CONNECTORS, MAX_HOPS, planeOf, type Tile, UNDERGROUND_Z } from '../lib/connectors';
import { configId, objInfo } from '../lib/packs';
import { INVENTORY_SLOTS, TICK_MS } from '../lib/util';
import { type Detour, type Hop, type Move, planWay, type WalkWorld, worldGraph } from '../lib/walk-graph';
import { isInWilderness } from '../lib/wilderness';
import { BANK_TRANSFER_WAIT_TICKS, CLOSE_BANK_WAIT_TICKS, OPEN_BANK_WAIT_TICKS, withBank, withdraw } from './bank';
import { CLIMB_MAX_TICKS, climb } from './climb';
import type { ActionContext } from './context';
import { courseSectionOf, leaveCourse } from './course';
import { cross, crossAttemptTicks, retryFits } from './cross';
import { GATE_ATTEMPT_TICKS, GATE_MAX_TICKS, GATE_STAND_TOLERANCE, GNOME_GATE, insideFence, passGate } from './gate';
import { interactLoc } from './interact';
import { canPayToll, isEastOfToll, isTollGate, payToll, TOLL_GATE_LOCS, TOLL_LEVEL, TOLL_MAX_TICKS } from './toll';
import { messageCursor, messageSince } from './messages';
import { collisionPaths, type DoorInfo, type PathResult, type Pathfinder, type Waypoint } from './paths';

/** bot.walkTo's default tolerance, in tiles (Chebyshev, the game's metric). */
export const WALK_TOLERANCE = 3;
/** Open clicks of the outward pass of the Gnome Stronghold gate (no dialog starts from inside, so one rarely repeats). */
const GATE_OUT_ATTEMPTS = 2;
/** The worst case of that pass, in ticks, which a walk keeps back for it. */
export const GATE_OUT_TICKS = GATE_OUT_ATTEMPTS * GATE_ATTEMPT_TICKS;
/** Hops (climbs, moves, bank detours, the plans again after one fails) a walk makes before it gives up. */
const MAX_WALK_HOPS = 16;
/** A plan's targets are the tiles within the walk's tolerance of its destination, at most this far. */
const PLAN_RADIUS = 3;
/** A bank detour's hop at its worst: the open, a withdrawal, the close. */
const BANK_HOP_TICKS = OPEN_BANK_WAIT_TICKS + BANK_TRANSFER_WAIT_TICKS + CLOSE_BANK_WAIT_TICKS;
/** The Gnome Stronghold gate's loc config (gate.ts GNOME_GATE). */
const GNOME_GATE_LOC = 'gnome_areagate';
/** Route queries before the walk gives up (upstream MAX_ITERATIONS). */
const MAX_ROUTES = 50;
/** Slashes of one web a walk tries (each cuts it half the time) before it routes around. */
export const WEB_SLASH_ATTEMPTS = 6;
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
/** Running speed, in tiles a tick. */
const RUN_TILES_PER_TICK = 2;
/**
 * A leg gets this many times the ticks running straight to its waypoint takes: the server's route there
 * can be longer than the straight line (round a corner, a door), and the send itself can cost a tick.
 */
const LEG_SLACK = 1.5;
/**
 * A leg that stopped short having moved less than this (straight line) is stuck: under one running
 * tick's distance, so something blocked the bot rather than the leg running out of ticks mid-stride.
 */
const STUCK_MOVE_TILES = 2;
/** A leg has stopped when the bot has not moved for this many ticks. */
const STOPPED_TICKS = 2;
const MIN_LEG_TICKS = 3;
/** The most ticks one walk takes, whatever its route; a step's ticks left may cap it lower (WalkOptions). */
export const WALK_MAX_TICKS = 200;
/**
 * Ticks a walk leaves its step by default: enough to act on the result (a log, a count) and return. A
 * `reserveTicks` passed in its place must count the send that follows the walk, one tick, as well as
 * the waits after it.
 */
export const WALK_RESERVE_TICKS = 3;
/** A walk's ticks on top of its route's: one door taking both open attempts and the walk beside it. */
export const WALK_BASE_TICKS = 2 * DOOR_OPEN_TICKS + 20;
/** Ticks per tile of route: walking pace (1 tile a tick) with as much again for slack. */
export const WALK_TICKS_PER_TILE = 2;

const OPEN = /^open$/i;
const SLASH = /^slash$/i;
const LOCKED = /locked/i;
const NO_BLADE = /sharp blade/i;
const WEB_CUT_FAILED = /fail to cut/i;
// A web has no locked outcome, so its stop set differs from DOOR_REFUSAL; NO_BLADE is a subset of WEB_STOP.
const WEB_STOP = /sharp blade|can't reach|cannot reach/i;
const DOOR_REFUSAL = /locked|can't reach|cannot reach/i;

export type WalkResult =
    | { ok: true; message: string }
    | {
          ok: false;
          reason:
              | 'bad-coordinates'
              | 'no-player'
              | 'no-path'
              | 'no-blade'
              | 'no-connector'
              | 'climb-failed'
              | 'cross-failed'
              | 'dead-end'
              | 'stuck'
              | 'gave-up'
              | 'timeout'
              | 'no-time';
          message: string;
          /** A `timeout` of a walk across planes that was still on its way (see timedOutAdvancing). */
          advancing?: boolean;
      };

/** Matches the `no-path` message of a walk refused by `WalkOptions.maxRouteTiles`. */
export const ROUTE_TOO_LONG = /tiles, over the \d+ allowed$/;

export interface WalkOptions {
    /**
     * The destination's level. Default: the bot's own level (so a bot on an upper floor walking to a tile
     * outside its building says `level: 0`), or level 0 when the destination is on the other side of the
     * surface/underground divide (z >= 6400). A destination on another plane than the bot is reached by
     * staircase or ladder (lib/connectors.ts).
     */
    level?: number;
    /** The most ticks the walk may take; default WALK_MAX_TICKS. */
    maxTicks?: number;
    /**
     * Ticks the step still needs once the walk is over (the op and waits that follow it, and the one
     * tick of its send); default WALK_RESERVE_TICKS. The walk takes at most the step's ticks left (ActionContext.stepTicksLeft) less
     * these, so the step finishes inside its tick budget instead of the engine ending the run `stuck`.
     */
    reserveTicks?: number;
    /**
     * Requirement tokens the caller has checked the account meets that its state does not show: a quest done
     * (`quest:runemysteries`), the wizard it came into the essence mine by (`other:came from aubury`). A move that
     * asks one is planned only with it (lib/account.ts).
     */
    met?: Iterable<string>;
    /**
     * Refuse (`no-path`, message matching `ROUTE_TOO_LONG`) a walk whose first direct route on the plane is longer than
     * this many tiles, before taking a step: for a short hop toward a spot that is near as the crow flies but far round
     * (across a pond, past a cliff). A walk planned through graph hops (connectors) is not limited. Default: no limit.
     */
    maxRouteTiles?: number;
}

/**
 * A walk that ended `timeout` nearer its destination than it started (`before` and `after` are the
 * distances): it ran out of ticks still closing in, and walking again carries on, so a caller counting
 * failed walks does not count it. A walk across planes (to a staircase, then a floor above) cannot be
 * judged by distance, so it says itself (`advancing`).
 */
export const timedOutAdvancing = (r: WalkResult, before: number, after: number): boolean =>
    !r.ok && r.reason === 'timeout' && (after < before || r.advancing === true);

/**
 * The tick budget of a walk whose first route is `tiles` long (a partial one to the destination),
 * capped at `maxTicks`.
 */
export const walkBudgetTicks = (tiles: number, maxTicks = WALK_MAX_TICKS): number =>
    Math.min(maxTicks, WALK_BASE_TICKS + WALK_TICKS_PER_TILE * tiles);

type Point = { x: number; z: number };
type DoorOpen = 'opened' | 'already-open' | 'locked' | 'cant-reach' | 'not-found' | 'no-blade' | 'unslashed';

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
    /** The web the server said needs a sharper weapon: ends the walk `no-blade`. */
    noBlade?: Point;
}

const posOf = (p: { worldX: number; worldZ: number }): Point => ({ x: p.worldX, z: p.worldZ });
const tileKey = (p: Point) => `${p.x},${p.z}`;
const doorKey = (d: DoorInfo) => `${d.level},${d.x},${d.z}`;
const hasOpen = (l: NearbyLoc) => l.optionsWithIndex.some(o => OPEN.test(o.text));
/** A closed door, gate or web: it has an Open or Slash option (an open one has neither). */
const isShut = (l: NearbyLoc) => l.optionsWithIndex.some(o => OPEN.test(o.text) || SLASH.test(o.text));
const adjacent = (a: Point, b: Point) => chebyshev(a, b) === 1;
/** A route's last waypoint; undefined for a failed or empty route. */
const lastWaypoint = (p: PathResult) => (p.success ? p.waypoints.at(-1) : undefined);
/** A tile's own offset and its four cardinal neighbours'. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/** Ticks of `n` the walk's budget still allows. */
const allowed = (w: Walk, n: number) => Math.max(0, Math.min(n, w.deadline - w.ctx.state().tick));
const outOfTime = (w: Walk, s: BotWorldState = w.ctx.state()) => s.tick >= w.deadline;

/** Walks `n` ticks, or what is left of the budget. */
function* pause(w: Walk, n: number): Op<void> {
    yield* wait(`ticks:${n}`, () => false, allowed(w, n));
}

/**
 * Walks to within `tolerance` tiles of (x, z), opening the doors and gates on the way. The way is planned over the
 * world index's graph (walkRoute): when it changes plane (`opts.level`, or across the surface/underground divide at
 * z >= 6400) the walk goes to the staircase or ladder of lib/connectors.ts that leads there and climbs it (`climb`);
 * when it is shorter through a move (a scripted move, a teleport, a shortcut, a gate jump) the walk goes to the
 * move's approach and makes it (`cross`); when a move needs an obj the bot does not carry and the bank holds one
 * (ActionContext.bank) it may go to a bank first; and after each it plans again from where it landed. A way with no
 * hop is walked on the plane (`walkOnPlane`). `no-connector` is no way leading to another plane; `climb-failed` a
 * climb that did not change the plane (the loc missing, refused or out of reach); `cross-failed` no way left once
 * the moves refused on the way are given up on. The one tick budget covers the legs and the hops, and a `timeout`
 * in the middle (`advancing`) is carried on by walking again.
 *
 * `no-blade` is a slashable web on the route and no slash weapon wielded: final, do not retry.
 *
 * Spends coins: a route through the Al Kharid toll gate pays its toll (TOLL_FEE, 10 coins) on each crossing,
 * automatically; with fewer coins the route goes round the gate instead. A move that takes an obj (a Shantay pass)
 * spends it, and a bank detour withdraws what the way on needs.
 */
export function* walkTo(
    ctx: ActionContext,
    x: number,
    z: number,
    tolerance = WALK_TOLERANCE,
    opts: WalkOptions = {},
): Op<WalkResult> {
    const p = ctx.state().player;
    // The inner walk reports a missing player or bad coordinates.
    if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return yield* walkOnPlane(ctx, x, z, tolerance, opts);
    const left = yield* leaveEnclosure(ctx, x, z, opts);
    if (left) return left;
    // Where the bot stands once out: leaving a course section changes its level.
    const now = ctx.state().player ?? p;
    const sameSide = z >= UNDERGROUND_Z === now.worldZ >= UNDERGROUND_Z;
    const level = opts.level ?? (sameSide ? now.level : 0);
    return yield* walkRoute(ctx, { level, x, z }, tolerance, opts);
}

/**
 * Gets the bot out of where the ground pathfinder has no route from, before a walk to (x, z) starts, and
 * returns nothing when there is nothing to do (every ordinary walk) or when the bot is out. A failure is
 * `stuck` (`timeout`, advancing, when the walk to the gate ran out of ticks nearer it).
 */
function* leaveEnclosure(ctx: ActionContext, x: number, z: number, opts: WalkOptions): Op<WalkResult | undefined> {
    const early = yield* leaveCourseSection(ctx, x, z, opts);
    if (early) return early;
    return yield* leaveGnomeStronghold(ctx, x, z, opts);
}

/** On a raised obstacle section of an agility course (a run that ended mid-course): crosses its obstacles on to the ground (course.ts `leaveCourse`). */
function* leaveCourseSection(ctx: ActionContext, x: number, z: number, opts: WalkOptions): Op<WalkResult | undefined> {
    if (!courseSectionOf(ctx.state())) return undefined;
    const r = yield* leaveCourse(ctx, opts.reserveTicks ?? WALK_RESERVE_TICKS);
    if (r.ok) return undefined;
    return {
        ok: false,
        reason: r.reason === 'no-time' ? 'no-time' : 'stuck',
        message: `Could not leave the agility course to walk to (${x}, ${z}): ${r.message}`,
    };
}

/**
 * Inside the Gnome Stronghold's fence with a destination outside it: walks to the gate's inside stand tile and
 * passes the gate outward (gate.ts `passGate`); the fence is closed all round, so the pathfinder finds no route
 * out. The inward direction is the travel task's `gnome-gate` step.
 */
function* leaveGnomeStronghold(
    ctx: ActionContext,
    x: number,
    z: number,
    opts: WalkOptions,
): Op<WalkResult | undefined> {
    const reserve = opts.reserveTicks ?? WALK_RESERVE_TICKS;
    const p = ctx.state().player;
    const g = GNOME_GATE;
    const b = g.bounds;
    if (!p || p.level !== 0 || z >= UNDERGROUND_Z) return undefined;
    // The bounds box first: the fence fill (cached) is only worth asking about near the Stronghold.
    const inBox = (px: number, pz: number) => px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ;
    if (!inBox(p.worldX, p.worldZ)) return undefined;
    const paths = ctx.pathfinder ?? collisionPaths;
    if (!insideFence(paths, g, p.worldX, p.worldZ)) return undefined;
    // A destination tile blocked by a tree, booth or loc is outside the fill, so a tile next to the fill counts too.
    if (inBox(x, z) && nearFill(paths, g, x, z)) return undefined;

    const what = `the Gnome Stronghold gate to walk to (${x}, ${z})`;
    const stand = g.innerStand;
    const before = chebyshev(posOf(p), stand);
    const walked = yield* walkOnPlane(ctx, stand.x, stand.z, GATE_STAND_TOLERANCE, {
        maxTicks: opts.maxTicks,
        reserveTicks: reserve + GATE_OUT_TICKS,
    });
    if (!walked.ok) {
        const now = ctx.state().player;
        const nearer = !!now && chebyshev(posOf(now), stand) < before;
        return failedLeg(walked, nearer, `walking to ${what}: `);
    }
    const left = ctx.stepTicksLeft?.();
    if (left !== undefined && left < GATE_OUT_TICKS + reserve)
        return { ok: false, reason: 'no-time', message: `No time to pass ${what}: ${left} ticks left` };
    const through = yield* passGate(ctx, g, 'out', GATE_OUT_ATTEMPTS);
    if (!through.ok) return { ok: false, reason: 'stuck', message: `Could not pass ${what}: ${through.message}` };
    yield* log('walk: passed the Gnome Stronghold gate outward');
    return undefined;
}

/** The tile is in the gate's fence fill or within one tile (Chebyshev) of it. */
function nearFill(paths: Pathfinder, g: typeof GNOME_GATE, x: number, z: number): boolean {
    for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) if (insideFence(paths, g, x + dx, z + dz)) return true;
    return false;
}

/**
 * The ticks a walk may take: `opts.maxTicks` (default WALK_MAX_TICKS) and the step's ticks left less the
 * ticks it still needs after the walk. `noTime` is the `no-time` result when none is left (nothing to send).
 */
function walkBudget(
    ctx: ActionContext,
    opts: WalkOptions,
    what: string,
): { maxTicks: number; reserve: number; noTime?: WalkResult } {
    const left = ctx.stepTicksLeft?.();
    const reserve = opts.reserveTicks ?? WALK_RESERVE_TICKS;
    const maxTicks = Math.min(opts.maxTicks ?? WALK_MAX_TICKS, left === undefined ? Infinity : left - reserve);
    if (maxTicks > 0) return { maxTicks, reserve };
    const noTime: WalkResult = {
        ok: false,
        reason: 'no-time',
        message: `No time to walk to ${what}: the step has ${left} ticks left and needs ${reserve} after the walk`,
    };
    return { maxTicks, reserve, noTime };
}

/**
 * A failed leg of a walk across planes, as that walk's failure. A `timeout` (or a `no-time`, the budget
 * spent) of a walk that `progressed` is an advancing `timeout`: walking again carries on. Without progress
 * the leg's own result stands, so a caller's failure count bounds a walk that goes nowhere.
 */
function failedLeg(r: Extract<WalkResult, { ok: false }>, progressed: boolean, prefix = ''): WalkResult {
    const message = prefix + r.message;
    if (progressed && (r.reason === 'timeout' || r.reason === 'no-time'))
        return { ok: false, reason: 'timeout', advancing: true, message };
    return { ...r, message };
}

/** What one walk has learned on its way: what it came in by, the moves it gave up on, the bank objs not there. */
interface Learned {
    met: Set<string>;
    avoid: Set<string>;
    absent: Set<string>;
    /** The failed rolls of each move (by moveKey) that cross() did not try again. */
    falls: Map<string, number>;
    /** The last hop that failed, for the message when no way is left. */
    failed?: string;
    /** A hop's stand the walk could not walk to: with no way left on the plane, the walk falls back to walkOnPlane. */
    unreached?: boolean;
}

/** A rolled move that fell this many times on one walk, with no retry left, is given up on for the rest of it. */
export const MAX_FALLS = 3;

/** A leg's failures that end the walk however optional its hop: the budget spent, a web, no player. */
const FINAL_LEG: ReadonlySet<string> = new Set(['timeout', 'no-time', 'no-blade', 'no-player']);

/** Cycles of the same hops, each ending the same way, after which a walk ends `stuck` (the essence-mine hop loop). */
export const HOP_REPEAT_LIMIT = 4;
/** The longest hop cycle looked for: a hop and its way back, or a hop, a landing fix and the way back. */
const HOP_CYCLE_MAX = 3;
/** The hops a run has made since a walk last arrived, as `name from -> to` (or `name failed: reason`), newest last. */
const hopHistory = new WeakMap<object, string[]>();

/**
 * Notes a hop the walk made (or failed) in the run's history, and says the hop sequence it is repeating when the
 * last HOP_REPEAT_LIMIT cycles of 1 to HOP_CYCLE_MAX hops are the same, each hop ending as before: a walk that
 * keeps making the same hops and never arrives (which no timeout or failure streak stops, each walk ending
 * differently or advancing). A run of a task is one ctx, so the history spans the walks of a bank or travel loop.
 */
function repeatedHops(ctx: ActionContext, entry: string): string | undefined {
    const h = hopHistory.get(ctx) ?? [];
    hopHistory.set(ctx, h);
    h.push(entry);
    if (h.length > HOP_CYCLE_MAX * HOP_REPEAT_LIMIT) h.shift();
    for (let period = 1; period <= HOP_CYCLE_MAX; period++) {
        const n = period * HOP_REPEAT_LIMIT;
        if (h.length < n) continue;
        const tail = h.slice(-n);
        if (tail.every((e, i) => e === tail[i % period])) return tail.slice(0, period).join('; ');
    }
    return undefined;
}

const stuckOnHops = (cycle: string): WalkResult => ({
    ok: false,
    reason: 'stuck',
    message: `Repeating the same hops ${HOP_REPEAT_LIMIT} times without arriving: ${cycle}`,
});

/** Gives up on a move or a bank detour for the rest of the walk: the move avoided, the detour's objs absent. */
function giveUp(h: Extract<Hop, { kind: 'cross' | 'bank' }>, rec: Learned): void {
    if (h.kind === 'cross') rec.avoid.add(moveKey(h.move));
    else for (const w of h.withdraw) rec.absent.add(w.obj);
}

/** A move's key: its act on its tile, and its source line. */
const moveKey = (m: Move) => `${actName(m)} ${m.at.level},${m.at.x},${m.at.z} ${m.source}`;

/** The tiles a walk to (x, z) within `tolerance` may end on, as a plan's targets: at least the tile's neighbours. */
function targetsOf(dest: Tile, tolerance: number): Tile[] {
    const r = Math.max(1, Math.min(tolerance, PLAN_RADIUS));
    const out: Tile[] = [dest];
    for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) if (dx || dz) out.push({ level: dest.level, x: dest.x + dx, z: dest.z + dz });
    return out;
}

/**
 * The account a walk plans for: what the state shows (`accountOf`, which adds the essence mine's any-wizard way out)
 * and what the walk has learned (`learned`; a wizard on record beats that wildcard in meetsToken).
 */
export function walkAccount(s: BotWorldState, learned: Iterable<string>): Account {
    const seen = accountOf(s);
    return { ...seen, met: new Set([...(seen.met ?? []), ...learned]) };
}

/** The way from where the bot stands to `dest`, over what the bot carries and the walk has learned. */
function planRoute(ctx: ActionContext, s: BotWorldState, dest: Tile, tolerance: number, rec: Learned) {
    const p = s.player!;
    const world = worldOf(ctx);
    const account = walkAccount(s, rec.met);
    const banks = world.banks.filter(b => meetsOneOf(account, b.reach)).map(b => b.stand);
    const counted = ctx.bank;
    const detour: Detour | undefined = counted && {
        bank: obj => (rec.absent.has(obj) ? 0 : counted(objInfo(obj)?.name ?? obj)),
        banks,
        free: INVENTORY_SLOTS - s.inventory.length,
        stackable: obj => objInfo(obj)?.stackable ?? false,
    };
    return planWay({ level: p.level, x: p.worldX, z: p.worldZ }, targetsOf(dest, tolerance), {
        account,
        connectors: world.connectors,
        maxHops: MAX_HOPS,
        graph: world.graph,
        avoid: m => rec.avoid.has(moveKey(m)),
        ...(detour && { detour }),
    });
}

let builtWorld: WalkWorld | undefined;
/** The world index's walk world: its graph, the connector table, the banks a task may pick on its own. */
const defaultWorld = (): WalkWorld =>
    (builtWorld ??= { graph: worldGraph(), connectors: CONNECTORS, banks: BANKS.filter(b => b.auto) });
/** The walk world a walk plans on: the context's, else the world index's. */
const worldOf = (ctx: ActionContext): WalkWorld => ctx.walkWorld ?? defaultWorld();

/** The first hop of a way the walk acts on: a door is opened along the walk to the next one. */
const firstHop = (hops: readonly Hop[] | undefined) => hops?.find(h => h.kind !== 'door');

/** What a hop is, for logs and messages. */
function hopName(h: Exclude<Hop, { kind: 'door' }>): string {
    if (h.kind === 'climb') return `${h.connector.name} at (${h.connector.stand.x}, ${h.connector.stand.z})`;
    if (h.kind === 'bank') return `the bank at (${h.stand.x}, ${h.stand.z})`;
    return `${actName(h.move)} at (${h.move.at.x}, ${h.move.at.z})`;
}

/** The ticks a hop takes once the walk is at its stand, which the walk to it keeps back. */
function hopTicks(h: Exclude<Hop, { kind: 'door' }>): number {
    if (h.kind === 'climb') return CLIMB_MAX_TICKS;
    if (h.kind === 'bank') return BANK_HOP_TICKS;
    if (isGnomeGate(h.move)) return GATE_MAX_TICKS;
    return crossAttemptTicks(h.move);
}

/** The Gnome Stronghold gate, which gate.ts passes (Femi's dialog asks a choice its rows do not carry). */
const isGnomeGate = (m: Move) => m.act.kind === 'loc-op' && m.act.loc === GNOME_GATE_LOC;

/**
 * Walks to `dest` hop by hop: plans the way over the world index's graph (lib/walk-graph.ts planWay), walks to its
 * first hop (a connector, a move, a bank detour) and makes it, then plans again from where the bot stands, so a
 * random landing or a failed roll is walked on from wherever it left the bot. A way with no hop is walked on the
 * plane (walkOnPlane), as is a destination the graph has no way to on the bot's own plane, unless the walk gave up on
 * a move on the way (`cross-failed`). A move the game refuses is given up on for the rest of the walk, a bank obj
 * found missing too, and so is a move or a bank whose stand the walk could not walk to (then a destination on the
 * plane with no way left is walked on the plane). Inside a step a hop starts only with its ticks (hopTicks) left
 * before the walk's reserve, else the walk ends `no-time` (an advancing `timeout` once it has moved).
 */
function* walkRoute(ctx: ActionContext, dest: Tile, tolerance: number, opts: WalkOptions): Op<WalkResult> {
    const start = ctx.state();
    const what = `(${dest.x}, ${dest.z}) on level ${dest.level}`;
    const p0 = start.player;
    if (
        p0 &&
        planeOf(p0.level, p0.worldX, p0.worldZ) === planeOf(dest.level, dest.x, dest.z) &&
        chebyshev(posOf(p0), dest) <= tolerance
    ) {
        hopHistory.delete(ctx);
        return { ok: true, message: 'Already at destination' };
    }
    // On its own level a walk names the destination as walkOnPlane does.
    const own = p0?.level === dest.level ? `(${dest.x}, ${dest.z})` : what;
    const { maxTicks, reserve, noTime } = walkBudget(ctx, opts, own);
    if (noTime) return noTime;
    const deadline = start.tick + maxTicks;
    const rec: Learned = { met: new Set(opts.met ?? []), avoid: new Set(), absent: new Set(), falls: new Map() };
    for (let hop = 0; hop <= MAX_WALK_HOPS; hop++) {
        const s = ctx.state();
        const p = s.player;
        if (!p) return { ok: false, reason: 'no-player', message: 'No player state' };
        if (s.tick >= deadline)
            return {
                ok: false,
                reason: 'timeout',
                advancing: hop > 0,
                message: `Walk to ${what} ran out of its ${maxTicks} ticks at (${p.worldX}, ${p.worldZ}) level ${p.level}`,
            };
        const here = { level: p.level, x: p.worldX, z: p.worldZ };
        const samePlane = planeOf(here.level, here.x, here.z) === planeOf(dest.level, dest.x, dest.z);
        if (samePlane && chebyshev(here, dest) <= tolerance) {
            hopHistory.delete(ctx);
            return { ok: true, message: 'Arrived' };
        }
        const way = planRoute(ctx, s, dest, tolerance, rec);
        const next = firstHop(way?.hops);
        if (!next) {
            // A walk that gave up on a move and finds no way left ends; one with no hop to make, or a destination the
            // graph does not reach, is walked on the plane, as is one whose graph planned a way to a stand the
            // pathfinder could not walk to (the graph's way there is not the collision's).
            if (!way && rec.failed && !(samePlane && rec.unreached))
                return { ok: false, reason: 'cross-failed', message: `No way left to ${what}: ${rec.failed}` };
            if (samePlane) {
                const last = yield* walkOnPlane(ctx, dest.x, dest.z, tolerance, {
                    maxTicks: deadline - s.tick,
                    reserveTicks: reserve,
                    ...(opts.maxRouteTiles === undefined ? {} : { maxRouteTiles: opts.maxRouteTiles }),
                });
                if (last.ok) {
                    hopHistory.delete(ctx);
                    return last;
                }
                // A fallback after the graph's way was given up on says why it was, as cross-failed would.
                const why = !way && rec.failed ? `; no way left to ${what}: ${rec.failed}` : '';
                return failedLeg({ ...last, message: last.message + why }, hop > 0);
            }
            return {
                ok: false,
                reason: 'no-connector',
                message: `No connector from level ${here.level} (${here.x}, ${here.z}) to ${what}`,
            };
        }
        const name = hopName(next);
        const stand = next.kind === 'climb' ? next.connector.stand : next.stand;
        // The stand tile exactly: a tile beside it can be across a wall (the Falador stairs are in a house).
        const walked = yield* walkOnPlane(ctx, stand.x, stand.z, next.kind === 'bank' ? BANK_STAND_RADIUS - 1 : 0, {
            maxTicks: deadline - s.tick,
            reserveTicks: reserve + hopTicks(next),
        });
        const now = ctx.state().player;
        const progressed = hop > 0 || (!!now && chebyshev(posOf(now), stand) < chebyshev(here, stand));
        if (!walked.ok) {
            if (next.kind === 'climb' || FINAL_LEG.has(walked.reason))
                return failedLeg(walked, progressed, `walking to the ${name}: `);
            const again = repeatedHops(
                ctx,
                `${name} failed at (${here.x}, ${here.z}) level ${here.level}: ${walked.reason}`,
            );
            if (again) return stuckOnHops(again);
            giveUp(next, rec);
            rec.failed = `walking to the ${name}: ${walked.message}`;
            rec.unreached = true;
            yield* log(`walk: ${rec.failed}; planning without it`);
            continue;
        }
        const left = ctx.stepTicksLeft?.();
        if (left !== undefined && left - reserve < hopTicks(next)) {
            const message = `No time for the ${name}: the step has ${left} ticks left and needs ${hopTicks(next) + reserve}`;
            return failedLeg({ ok: false, reason: 'no-time', message }, progressed);
        }
        let crossed = true; // climb and bank hops always count; a failed bank hop is still recorded
        if (next.kind === 'climb') {
            const c = next.connector;
            if (c.hazard) yield* log(`walk: WARNING at the ${c.name}: ${c.hazard}`);
            const climbed = yield* climb(ctx, c);
            if (!climbed.ok) return { ok: false, reason: 'climb-failed', message: `${name}: ${climbed.message}` };
            yield* log(`walk: climbed ${c.direction} the ${c.name}`);
        } else if (next.kind === 'bank') yield* bankHop(ctx, next, rec);
        else
            crossed = yield* crossHop(ctx, next, rec, deadline, () => {
                const again = firstHop(planRoute(ctx, ctx.state(), dest, tolerance, rec)?.hops);
                return again?.kind === 'cross' && moveKey(again.move) === moveKey(next.move);
            });
        // A move that fell or was refused has its own limits (MAX_FALLS, giving the move up).
        if (!crossed) continue;
        const after = ctx.state().player;
        const landed = after ? `(${after.worldX}, ${after.worldZ}) level ${after.level}` : 'nowhere';
        const cycle = repeatedHops(ctx, `${name} from (${here.x}, ${here.z}) level ${here.level} to ${landed}`);
        if (cycle) return stuckOnHops(cycle);
    }
    const why = rec.failed ? `; the last hop that failed: ${rec.failed}` : '';
    return { ok: false, reason: 'gave-up', message: `Could not reach ${what} in ${MAX_WALK_HOPS} hops${why}` };
}

/**
 * Makes a move of the way (cross.ts; the Gnome Stronghold gate by gate.ts's passGate), noting what the walk learns:
 * the wizard it came in by (an npc the graph's came-from requirements name), a move refused (given up on for the rest
 * of the walk). A failed roll is tried again where it leaves the bot while `stillBest` holds and another attempt ends
 * by `deadline`; one that leaves it elsewhere (or is not tried again) is planned again from there, until the move has
 * fallen MAX_FALLS times on the walk, when it is given up on and named as the hop that failed. Returns whether the
 * move was made.
 */
function* crossHop(
    ctx: ActionContext,
    h: Extract<Hop, { kind: 'cross' }>,
    rec: Learned,
    deadline: number,
    stillBest: () => boolean,
): Op<boolean> {
    const m = h.move;
    const name = hopName(h);
    if (isGnomeGate(m)) {
        const r = yield* passGate(ctx, GNOME_GATE, h.landing.z > m.at.z ? 'in' : 'out');
        if (r.ok) yield* log('walk: passed the Gnome Stronghold gate');
        else {
            rec.avoid.add(moveKey(m));
            rec.failed = `${name}: ${r.message}`;
            yield* log(`walk: ${rec.failed}; planning without it`);
        }
        return r.ok;
    }
    const r = yield* cross(ctx, m, { deadline, retry: () => !m.roll?.fail.to && stillBest() });
    if (r.ok) {
        const came = m.act.kind === 'npc-op' ? cameFrom(m.act.npc) : undefined;
        if (came && worldOf(ctx).graph.cameFrom.has(came)) {
            for (const t of rec.met) if (t.startsWith(CAME_FROM)) rec.met.delete(t);
            rec.met.add(came);
        }
        yield* log(`walk: crossed ${name}${r.attempts > 1 ? ` in ${r.attempts} attempts` : ''}`);
        return true;
    }
    if (r.reason === 'fell') {
        // A fall the walk's budget left no time to try again ends in its timeout, not as the move's.
        if (!retryFits(m, ctx.state().tick, deadline)) {
            yield* log(`walk: ${r.message}; no time to try it again`);
            return false;
        }
        const key = moveKey(m);
        const falls = (rec.falls.get(key) ?? 0) + 1;
        rec.falls.set(key, falls);
        if (falls < MAX_FALLS) {
            yield* log(`walk: ${r.message}; planning again from here`);
            return false;
        }
        rec.avoid.add(key);
        rec.failed = `${r.message} (fell ${falls} times)`;
        yield* log(`walk: fell: ${rec.failed}; planning without it`);
        return false;
    }
    rec.avoid.add(moveKey(m));
    rec.failed = r.message;
    yield* log(`walk: ${r.reason}: ${r.message}; planning without it`);
    return false;
}

/**
 * A bank detour's hop: opens the bank and withdraws what the way on needs. An obj the bank turns out not to hold (or a
 * bank that does not open) is noted absent, so the walk plans again without it.
 */
function* bankHop(ctx: ActionContext, h: Extract<Hop, { kind: 'bank' }>, rec: Learned): Op<void> {
    const name = hopName(h);
    const r = yield* withBank(
        ctx,
        (function* (): Op<void> {
            for (const w of h.withdraw) {
                const id = configId('obj', w.obj);
                const item = ctx.state().bank.items.find(i => i.id === id);
                if (!item) {
                    rec.absent.add(w.obj);
                    yield* log(`walk: ${name} holds no ${w.obj}; planning without it`);
                    continue;
                }
                const got = yield* withdraw(ctx, item, Math.min(w.count, item.count));
                if (got.ok) yield* log(`walk: withdrew ${got.amountWithdrawn} ${item.name} at ${name}`);
                else {
                    rec.absent.add(w.obj);
                    yield* log(`walk: withdrawing ${item.name} at ${name}: ${got.message}`);
                }
            }
        })(),
    );
    if (r.ok) return;
    for (const w of h.withdraw) rec.absent.add(w.obj);
    yield* log(`walk: ${name} did not open (${r.message}); planning without it`);
}

/**
 * Walks to within `tolerance` tiles of (x, z) on the bot's level, along routes from the pathfinder, one
 * waypoint at a time, opening the doors and gates on the way. A route that stops short is walked once
 * (doors open and the map loads along it); stopping at the same tile again is `dead-end`. `stuck` is
 * no closer after three routes and no door to open; `no-path` is no route at all; `gave-up` is 50 routes
 * without arriving; `timeout` is the tick budget spent (walkBudgetTicks, capped to the step's ticks left
 * less `reserveTicks`), wherever the bot then stands; `no-time` is a step with no ticks left to walk in,
 * nothing sent. A route through the Wilderness (surface or Edgeville dungeon) to a destination outside it is
 * `no-path` too, unless the walk starts in it.
 */
function* walkOnPlane(
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
    if (chebyshev(pos, target) <= tolerance) return { ok: true, message: 'Already at destination' };

    // The step's budget caps the walk's, keeping back what the step does after it.
    const { maxTicks, noTime } = walkBudget(ctx, opts, `(${x}, ${z})`);
    if (noTime) return noTime;
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
    let bestRemaining = chebyshev(pos, target);
    // A walk to a destination outside the Wilderness never takes a route through it (PvP, items lost on death),
    // unless it starts inside: its first waypoints are then in the Wilderness too, and refusing them would
    // keep a bot there from ever walking out (the critical Wilderness guard ends task runs; this is for
    // manual and recovery use).
    const destinationTame =
        !isInWilderness(start.player.level, x, z) && !isInWilderness(start.player.level, pos.x, pos.z);

    for (let i = 0; i < MAX_ROUTES; i++) {
        if (outOfTime(w)) return timedOut();
        let path = route(w);
        let end = lastWaypoint(path);
        if (!end) {
            yield* pause(w, 1);
            path = route(w);
            end = lastWaypoint(path);
            if (!end) {
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
        const wild = destinationTame ? waypoints.find(wp => isInWilderness(wp.level, wp.x, wp.z)) : undefined;
        if (wild)
            return {
                ok: false,
                reason: 'no-path',
                message: `Route to (${x}, ${z}) crosses the Wilderness at (${wild.x}, ${wild.z}); not walking it`,
            };
        if (!budgeted && opts.maxRouteTiles !== undefined) {
            const tiles = routeTiles(pos, waypoints, target);
            if (tiles > opts.maxRouteTiles)
                return {
                    ok: false,
                    reason: 'no-path',
                    message: `Route to (${x}, ${z}) from (${pos.x}, ${pos.z}) is ${tiles} tiles, over the ${opts.maxRouteTiles} allowed`,
                };
        }
        if (!budgeted) {
            w.deadline = w.startTick + walkBudgetTicks(routeTiles(pos, waypoints, target), maxTicks);
            budgeted = true;
        }

        // A partial route is worth walking once; a re-query from its end that ends there again loops.
        const partial = path.reachedDestination === false && chebyshev(end, target) > tolerance;
        if (partial && lastPartialEnd && end.x === lastPartialEnd.x && end.z === lastPartialEnd.z) {
            if (!(yield* tryOpenDoor(w))) {
                if (w.noBlade) return noBladeFailure(w.noBlade, x, z);
                const short = Math.round(chebyshev(end, target));
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
            if (shut.size > 0 && nearDoor(shut, wp) && chebyshev(pos, wp) <= DOOR_REACH) {
                yield* openDoorBy(w, doors, shut, wp);
                if (w.noBlade) return noBladeFailure(w.noBlade, x, z);
            }

            // Intermediate waypoints only need passing near; the last must honour the caller's
            // tolerance, or a tolerance under 2 could never be met.
            const last = wp === end;
            const leg = yield* walkLeg(w, wp, last ? Math.min(WAYPOINT_PASS, tolerance) : WAYPOINT_PASS, pos);
            // Stuck legs move the bot too: the next leg and the route's progress are judged from here.
            pos = leg.pos;
            if (chebyshev(pos, target) <= tolerance) return { ok: true, message: 'Arrived' };
            if (leg.status === 'stuck') {
                if (++stuckInARow >= STUCK_WAYPOINTS) {
                    yield* tryOpenDoor(w);
                    if (w.noBlade) return noBladeFailure(w.noBlade, x, z);
                    break;
                }
            } else stuckInARow = 0;
        }

        const remaining = chebyshev(pos, target);
        if (remaining < bestRemaining) {
            bestRemaining = remaining;
            poorProgress = 0;
        } else if (++poorProgress >= POOR_PROGRESS_LIMIT) {
            if (!(yield* tryOpenDoor(w))) {
                if (w.noBlade) return noBladeFailure(w.noBlade, x, z);
                return { ok: false, reason: 'stuck', message: `Stuck at (${pos.x}, ${pos.z})` };
            }
            poorProgress = 0;
        }
    }
    if (outOfTime(w)) return timedOut();
    return { ok: false, reason: 'gave-up', message: `Could not reach (${x}, ${z}) - stopped at (${pos.x}, ${pos.z})` };
}

/** The walk's end when a web needs a slash weapon the bot does not wield. */
function noBladeFailure(web: Point, x: number, z: number): WalkResult {
    return {
        ok: false,
        reason: 'no-blade',
        message: `No slash weapon: the web at (${web.x}, ${web.z}) on the way to (${x}, ${z}) needs a sword, scimitar, axe or other slashing weapon wielded`,
    };
}

/** A route from where the bot stands now, around the doors this walk gave up on. */
function route(w: Walk): PathResult {
    const p = w.ctx.state().player;
    if (!p) return { success: false, waypoints: [], error: 'No player state available' };
    // Without the toll the Al Kharid gate is a wall: the route goes round it.
    const avoid = [...w.avoided.values()];
    if (p.level === TOLL_LEVEL && !canPayToll(w.ctx.state()))
        for (const g of TOLL_GATE_LOCS) {
            const door = w.paths.doorAt(TOLL_LEVEL, g.x, g.z);
            if (door && !avoid.includes(door)) avoid.push(door);
        }
    return w.paths.findPath({ x: p.worldX, z: p.worldZ, level: p.level }, w.target, avoid);
}

/** Tiles from `from` along `waypoints`, and on to `target` in a line where a partial route stops short. */
function routeTiles(from: Point, waypoints: readonly Waypoint[], target: Point): number {
    let tiles = 0;
    let at = from;
    for (const wp of waypoints) {
        tiles += chebyshev(at, wp);
        at = wp;
    }
    return tiles + chebyshev(at, target);
}

/** A door on the route is on the waypoint's tile or a cardinal neighbour of it. */
const nearDoor = (shut: Set<string>, wp: Point) =>
    NEIGHBOURS.some(([dx, dz]) => shut.has(tileKey({ x: wp.x + dx, z: wp.z + dz })));

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
        // The toll gate is crossed (and paid) only when this waypoint is on its far side: the route may
        // run through it and back to a destination on the bot's own side, and a waypoint on the near side
        // leaves it for the next one. `continue` (not 'already-open') keeps the door in `shut`, so that next waypoint retries it.
        if (isTollGate(door) && !crossesToll(w, wp)) continue;
        const r = yield* openDoorAt(w, door, wp);
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
        } else if (r === 'no-blade') {
            w.noBlade = { x: door.x, z: door.z };
            yield* log(`walk: web at (${door.x}, ${door.z}): only a sharp blade can cut it`);
        } else if (r === 'unslashed') {
            w.avoided.set(doorKey(door), door);
            shut.delete(key);
            yield* log(
                `walk: web at (${door.x}, ${door.z}) not cut in ${WEB_SLASH_ATTEMPTS} slashes; routing around it`,
            );
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
        if (r === 'no-blade') {
            w.noBlade = { x: nearest.x, z: nearest.z };
            return false;
        }
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

/** Locs with an Open or Slash option within DOOR_REACH, nearest first. */
const openables = (s: BotWorldState) =>
    s.nearbyLocs.filter(l => isShut(l) && l.distance <= DOOR_REACH).sort((a, b) => a.distance - b.distance);

/**
 * Opens the door at `at`: Open on it, letting the server walk the bot there; if that neither opens it
 * nor shows it locked, walks beside it first (the server's route to it may run through the door) and
 * tries once more. The Al Kharid toll gate is paid for (10 coins, toll.ts) when the route crosses it.
 */
function* openDoorAt(w: Walk, at: Point, toward: Point = w.target): Op<DoorOpen> {
    const here = w.ctx.state().nearbyLocs.filter(l => l.x === at.x && l.z === at.z);
    const door = here.find(isShut) ?? here[0];
    if (!door) return 'not-found';
    const slash = door.optionsWithIndex.find(o => SLASH.test(o.text));
    if (slash) return yield* slashWebAt(w, door, slash.opIndex);
    const open = door.optionsWithIndex.find(o => OPEN.test(o.text));
    if (!open) return 'already-open';
    if (isTollGate(door)) {
        // Only to cross it: a bot already on the side it is heading for (just through, or the route runs beside it) pays nothing.
        if (!crossesToll(w, toward)) return 'already-open';
        return yield* payTollAt(w);
    }
    const first = yield* tryOpen(w, door, open.opIndex);
    if (first === 'opened' || first === 'locked') return first;
    if (!(yield* walkBeside(w, door))) return 'cant-reach';
    const second = yield* tryOpen(w, door, open.opIndex);
    return second === 'opened' || second === 'locked' ? second : 'cant-reach';
}

/** Going to `toward` from where the bot stands crosses the toll gate's line. */
function crossesToll(w: Walk, toward: Point): boolean {
    const here = w.ctx.state().player;
    return !!here && isEastOfToll(here.worldX) !== isEastOfToll(toward.x);
}

/** The Al Kharid toll gate: pays and passes it (toll.ts), or is `locked` when the bot cannot pay, which routes around it. */
function* payTollAt(w: Walk): Op<DoorOpen> {
    const r = yield* payToll(w.ctx, { maxTicks: Math.min(TOLL_MAX_TICKS, allowed(w, TOLL_MAX_TICKS)) });
    if (r.ok) {
        yield* log('walk: paid the Al Kharid toll and passed the gate');
        return 'opened';
    }
    yield* log(`walk: Al Kharid toll gate: ${r.message}`);
    return r.reason === 'no-coins' ? 'locked' : 'cant-reach';
}

/**
 * Slashes the web until it is cut: Slash, then wait for the web to change or the game's answer. "You fail
 * to cut through it." slashes again (up to WEB_SLASH_ATTEMPTS); "Only a sharp blade ..." is `no-blade` (no
 * slash weapon wielded); a refused or unanswered slash is `cant-reach`.
 */
function* slashWebAt(w: Walk, web: NearbyLoc, option: number): Op<DoorOpen> {
    const intact = (s: BotWorldState) =>
        s.nearbyLocs.some(l => l.x === web.x && l.z === web.z && l.id === web.id && isShut(l));
    for (let attempt = 1; attempt <= WEB_SLASH_ATTEMPTS; attempt++) {
        const cursor = messageCursor(w.ctx.state());
        const sent = yield* interactLoc(web, option);
        if (!sent.ok) {
            yield* log(`walk: Slash on ${web.name} at (${web.x}, ${web.z}) not sent: ${sent.message}`);
            return 'cant-reach';
        }
        const stop = (s: BotWorldState) => messageSince(s, cursor, WEB_STOP);
        const failed = (s: BotWorldState) => messageSince(s, cursor, WEB_CUT_FAILED);
        const waited = yield* wait(
            `slash ${web.name}`,
            s => !!stop(s) || !!failed(s) || !intact(s),
            allowed(w, DOOR_OPEN_TICKS),
        );
        const said = stop(waited.state);
        if (said) return NO_BLADE.test(said) ? 'no-blade' : 'cant-reach';
        if (!intact(waited.state)) {
            yield* log(
                `walk: slashed the ${web.name} at (${web.x}, ${web.z})${attempt > 1 ? ` in ${attempt} attempts` : ''}`,
            );
            return 'opened';
        }
        if (!failed(waited.state)) return 'cant-reach';
    }
    return 'unslashed';
}

/** Sends Open on `door` and waits for it to open (gone, or no Open option), or the game's refusal. */
function* tryOpen(w: Walk, door: NearbyLoc, option: number): Op<'opened' | 'locked' | 'cant-reach' | 'timeout'> {
    const cursor = messageCursor(w.ctx.state());
    const sent = yield* interactLoc(door, option);
    if (!sent.ok) {
        yield* log(`walk: Open on ${door.name} at (${door.x}, ${door.z}) not sent: ${sent.message}`);
        return 'timeout';
    }
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

/** One leg toward a waypoint: `arrived` within `tolerance`, `stuck` (moved under STUCK_MOVE_TILES), else `progress`. */
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
    if (chebyshev(now, wp) <= tolerance) return { status: 'arrived', pos: now };
    // Every leg that did not arrive has stopped (or run out of ticks), so little movement is stuck.
    if (Math.hypot(now.x - from.x, now.z - from.z) < STUCK_MOVE_TILES) return { status: 'stuck', pos: now };
    return { status: 'progress', pos: now };
}

/**
 * Waits a tick at a time until the bot is within `tolerance` of `to`, has not moved for STOPPED_TICKS,
 * or has had LEG_SLACK times the ticks running there takes (at least MIN_LEG_TICKS), within the walk's budget.
 * Like upstream it judges only the states after the send, never the one it was sent on: a leg re-sent
 * to a waypoint already passed takes a tick, in which the bot carries on along its last walk. One tick
 * per wait, so the stop can compare positions; the guards act at every one.
 */
function* awaitLeg(w: Walk, to: Point, tolerance: number): Op<{ arrived: boolean; state: BotWorldState }> {
    const start = w.ctx.state();
    if (!start.player) return { arrived: false, state: start };
    let last = posOf(start.player);
    const legTicks = Math.max(
        MIN_LEG_TICKS,
        Math.ceil(Math.ceil(chebyshev(last, to) / RUN_TILES_PER_TICK) * LEG_SLACK),
    );
    let lastMoveTick = start.tick;
    for (;;) {
        const s = (yield* wait(`walk to (${to.x}, ${to.z})`, () => false, allowed(w, 1))).state;
        const p = s.player;
        if (p && chebyshev(posOf(p), to) <= tolerance) return { arrived: true, state: s };
        if (p && (p.worldX !== last.x || p.worldZ !== last.z)) {
            last = posOf(p);
            lastMoveTick = s.tick;
        }
        if (s.tick - lastMoveTick >= STOPPED_TICKS || s.tick - start.tick >= legTicks || outOfTime(w, s))
            return { arrived: false, state: s };
    }
}
