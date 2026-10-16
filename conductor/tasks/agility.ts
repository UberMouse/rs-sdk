import { z } from 'zod/v4';
import {
    COURSES,
    crossObstacle,
    GNOME,
    nextObstacle,
    onCourseGround,
    spotOf,
    type Course,
    type Obstacle,
} from '../actions/course';
import { eat } from '../actions/eat';
import { OBSTACLE_SETTLE_TICKS, OBSTACLE_WAIT_TICKS } from '../actions/obstacle';
import { timedOutAdvancing, walkTo, WALK_MAX_TICKS } from '../actions/walk';
import { log, type Op, ticks } from '../core/op';
import { walkToArea, WALK_FAIL_LIMIT } from '../lib/area';
import { findFood, foodCount } from '../lib/interrupts';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { findSkill } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/** Consecutive obstacles that did not pay out (refused, no effect, not found) before the task fails. */
const OBSTACLE_FAIL_LIMIT = 6;
/** Falls or displacements (moved without XP) in a row: a failable course is expected to drop the bot now and then. */
const FALL_LIMIT = 10;
/** The longest silence is a run of failed obstacles; a far walk back is the other (walkToArea, per attempt). */
const STUCK_AFTER_MS = stuckWindowMs(
    failStreakTicks(OBSTACLE_FAIL_LIMIT, OBSTACLE_WAIT_TICKS + OBSTACLE_SETTLE_TICKS),
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
);
/** Ticks to wait after a refusal before trying the obstacle again. */
const REFUSED_RETRY_TICKS = 3;
/**
 * Ticks the script of a failed obstacle still has to run after its message (the log's fall: delays, a swim, a
 * teleport) before the bot stands where the next obstacle is chosen from.
 */
const FALL_SETTLE_TICKS = 8;
/** The worst case of an obstacle after its stand walk: its send, wait and settle, and a fall's settle. */
const CROSS_TICKS = OBSTACLE_WAIT_TICKS + OBSTACLE_SETTLE_TICKS + 1 + FALL_SETTLE_TICKS;
const STEP_TIMEOUT_MS = 300_000;
/**
 * Eats between obstacles below this fraction of max HP (food in the inventory): the worst obstacle (the stones' lava, 22% of
 * max HP) and a skeleton's hits must not take a bot that eats at the low-HP guard's 50% under it mid-script, where a sent
 * eat is ignored (the bot is moved by the obstacle's script) and the guard then fails the run.
 */
const EAT_BELOW_FRACTION = 0.75;
/** Eats in a row that did nothing before the run fails. */
const EAT_FAIL_LIMIT = 3;
/** Food a course's run needs to start with unless `minFood` says otherwise: the Wilderness course hurts and has no way out but its lap. */
const DEFAULT_MIN_FOOD = { gnome: 0, barbarian: 0, wilderness: 3 } as const;
/**
 * Food a lap of a course with a lap start (the Wilderness) must start with, capped by `minFood`: once the bot is at the
 * door with fewer it stops there. A lap costs up to 22% of max HP an obstacle and has no way out but its end, so a lap
 * begun on the last bite can run dry in the cave.
 */
const LAP_FOOD_RESERVE = 2;

const Params = z.object({
    course: z.enum(['gnome', 'barbarian', 'wilderness']).default('gnome'),
    /** Stop after this many completed laps; omit to run until a `--until` stop. */
    laps: z.number().int().min(1).optional(),
    /**
     * Food items (anything with an Eat option) the bot must carry to start; the run stops at a lap's edge once it
     * is short (none left; on the Wilderness course, fewer than 2 or `minFood`, whichever is lower, at the door). Default
     * 0 on the gnome and barbarian courses, 3 on the Wilderness course, where it is at least 1. A Wilderness run can still
     * end `failed` at the low-HP guard if the food runs out mid-lap (the lap has no way out).
     */
    minFood: z.number().int().min(0).optional(),
});

type AgilityParams = z.infer<typeof Params>;
interface AgilityMemory {
    /** Laps completed this run (the last obstacle crossed). */
    laps: number;
    /** The obstacle that last fell and has not been crossed since: tried again from anywhere its `retryFrom` says. */
    retry?: string;
}
type Ctx = TaskContext<AgilityParams, AgilityMemory>;

const courseOf = (ctx: Ctx): Course => COURSES[ctx.params.course];
const minFood = (params: AgilityParams): number => {
    const n = params.minFood ?? DEFAULT_MIN_FOOD[params.course];
    return params.course === 'wilderness' ? Math.max(1, n) : n;
};
/** Food the bot needs at a decision point to go on: the lap reserve at a lap start, any at all elsewhere. */
const foodNeeded = (ctx: Ctx, atLapStart: boolean): number =>
    atLapStart ? Math.min(LAP_FOOD_RESERVE, minFood(ctx.params)) : 1;
/** Tiles (Chebyshev, as a walk's tolerance counts) between the bot and a tile; Infinity without a player. */
const awayFrom = (ctx: Ctx, t: { x: number; z: number }): number => {
    const p = ctx.state().player;
    return p ? Math.max(Math.abs(p.worldX - t.x), Math.abs(p.worldZ - t.z)) : Infinity;
};
/** A finished Wilderness run leaves the bot in the Wilderness: say so in the done reason for the caller. */
const leaveNote = (ctx: Ctx): string =>
    ctx.params.course === 'wilderness' ? ' (still in the Wilderness: travel out now)' : '';
const nextOf = (ctx: Ctx): Obstacle | undefined => nextObstacle(courseOf(ctx), ctx.state(), ctx.memory.retry);

/** How close to a ladder's stand tile the bot walks before climbing. */
const LADDER_STAND_RADIUS = 1;

/**
 * Walks to within `to.radius` of a tile before an obstacle. Returns 'arrived' when there, `{ fail }` past the failure
 * limit, else nothing (a walk that ended short, closing in or counted as failed: the step runs again).
 */
function* walkToward(
    ctx: Ctx,
    o: Obstacle,
    to: { x: number; z: number; radius: number },
    fails: { add(): number },
): Op<Outcome | 'arrived'> {
    const before = awayFrom(ctx, to);
    const w = yield* walkTo(ctx, to.x, to.z, to.radius, { reserveTicks: CROSS_TICKS });
    if (!w.ok && !timedOutAdvancing(w, before, awayFrom(ctx, to))) {
        yield* log(`${o.label}: walk to (${to.x},${to.z}) failed: ${w.message}`);
        if (fails.add() >= OBSTACLE_FAIL_LIMIT)
            return { fail: `${OBSTACLE_FAIL_LIMIT} obstacles in a row failed (last: ${w.message})` };
        return;
    }
    // The walk ended short of the tile (a far walk is carried on next loop): the obstacle waits for it.
    return awayFrom(ctx, to) > to.radius ? undefined : 'arrived';
}

function* crossNext(ctx: Ctx, o: Obstacle): Op<Outcome> {
    const fails = ctx.streak('obstacleFails');
    // Some obstacles only work from one side: stand there first (the client would stop at the loc's nearest edge).
    // A ladder out of a pit is walked to likewise: a fall can land farther from it than the scan sees (the log's pit is 18 tiles off).
    const stand = o.stand ?? (o.ladder ? { ...o.ladder.stand, radius: LADDER_STAND_RADIUS } : undefined);
    if (stand && awayFrom(ctx, stand) > stand.radius) {
        const walked = yield* walkToward(ctx, o, stand, fails);
        if (walked !== 'arrived') return walked;
    }
    const r = yield* crossObstacle(ctx, o);
    if (!r.ok && r.reason === 'not-found') {
        yield* log(r.message);
        // The loc is out of the scene's sight (a fall landed far from it): walk towards it, which is no failure while it closes in.
        if (awayFrom(ctx, o.near) > o.near.radius) {
            const walked = yield* walkToward(ctx, o, o.near, fails);
            return walked === 'arrived' ? undefined : walked; // there: the next loop finds the loc
        }
        if (fails.add() >= OBSTACLE_FAIL_LIMIT)
            return { fail: `${o.label} not found ${OBSTACLE_FAIL_LIMIT} times in a row` };
        return;
    }
    if (r.ok) {
        fails.reset();
        ctx.streak('falls').reset();
        // A ladder out of a pit is the way back to the obstacle that fell, not the retry itself.
        if (!o.ladder) ctx.memory.retry = undefined;
        if (o.lastOfLap) {
            ctx.memory.laps += 1;
            yield* log(`lap ${ctx.memory.laps} complete`);
        }
        return;
    }
    yield* log(`${o.label} failed (${r.reason}): ${r.message}`);
    // A fall or a move off the course is routed from where the bot lands; it is not a stuck obstacle.
    if (r.reason === 'fell' || r.reason === 'no-xp') {
        if (r.reason === 'fell') {
            ctx.memory.retry = o.label;
            yield* ticks(FALL_SETTLE_TICKS);
        }
        if (ctx.streak('falls').add() >= FALL_LIMIT)
            return { fail: `${FALL_LIMIT} falls or displacements in a row (last: ${r.message})` };
        return;
    }
    if (fails.add() >= OBSTACLE_FAIL_LIMIT)
        return { fail: `${OBSTACLE_FAIL_LIMIT} obstacles in a row failed (last: ${r.message})` };
    // Refused at once: another player may be on the obstacle ("being used"); give them time to leave.
    if (r.reason === 'refused') yield* ticks(REFUSED_RETRY_TICKS);
}

export default defineTask({
    name: 'agility',
    description:
        'Run laps of an agility course for Agility XP. Param `course`: "gnome" (Tree Gnome Stronghold, Agility 1, no failure, ' +
        `about 86.5 XP per lap before the server's 25x; course start ${GNOME.start.x},${GNOME.start.z}), ` +
        '"barbarian" (Barbarian Outpost, Agility 35; start north of the pipe at (2552,3562) or anywhere in the yard; rope swing, log, net, ledge, ' +
        'ladder, three walls, 139.5 XP a lap before 25x; the rope, log and ledge can fail, 9-17% HP each; falls into the pit under the rope are ' +
        'climbed out of and retried; carry food, `minFood`) or "wilderness" (Wilderness course at (2998,3915), Agility 52, Wilderness level ~53: ' +
        'PvP risk, white wolves in the field south of the door, skeletons in the pit cave; ridge, pipe, rope, stepping stones, log, rocks, ridge, ' +
        "601 XP a lap before 25x; every obstacle but the pipe can fail for 15-22% HP; needs `minFood` (default 3, at least 1) food to start and ends at a lap's edge " +
        'short of food (fewer than 2 at the door; a run fails at the low-HP guard if food runs out mid-lap, and when `laps` is not reached); the Wilderness guard is off for it). `laps` stops after that many completed laps, else it runs until a `--until` stop. ' +
        'Each obstacle is picked from where the bot stands, so it resumes mid-lap and re-routes after a fall; it only walks on the ground and the ' +
        "course's own obstacles are the plane changes. The bot must start at the course (within the course's reach of its start, on the course): " +
        'this task does not travel: run the `travel` task to {x:2474,z:3436} (gnome; Lumbridge is about 700 tiles away, wolves on the way), ' +
        '{x:2552,z:3562} (barbarian) or {x:2998,z:3915} (wilderness; the walk refuses the Wilderness, so stand at its edge first; ' +
        'travel with wilderness:true). WILDERNESS: carry only food and no valuables (a PvP or skeleton death loses the whole inventory); ' +
        'a `done` run (laps reached, or out of food) leaves the bot in the Wilderness at the door (2998,~3915), so the caller must ' +
        'travel out immediately (a plan puts a leave-the-Wilderness travel step after every wilderness agility run).',
    params: Params,
    memory: (): AgilityMemory => ({ laps: 0 }),
    allowWilderness: params => params.course === 'wilderness',
    // No under-attack guard: an obstacle is a script that carries the bot off (the skeletons beside the Wilderness
    // course and its wolves fall behind), and being hit does not cancel it. The low-HP guard eats, and fails the run
    // in a fight with no food left.
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const course = courseOf(ctx);
        const s = ctx.state();
        const skill = findSkill(s, 'Agility');
        if (!skill) return 'no Agility skill in state';
        if (skill.baseLevel < course.agilityLevel)
            return `the ${ctx.params.course} course needs agility ${course.agilityLevel}, bot has ${skill.baseLevel}`;
        const p = spotOf(s);
        if (!p) return 'no player in state';
        if (!nextObstacle(course, s) && !onCourseGround(course, p))
            return `not at the ${ctx.params.course} course: at (${p.x},${p.z}) level ${p.level}; this task does not travel there`;
        const food = foodCount(s);
        if (food < minFood(ctx.params))
            return `the ${ctx.params.course} course needs ${minFood(ctx.params)} food (minFood), bot has ${food}`;
        return null;
    },

    steps: [
        {
            name: 'stop-laps',
            when: ctx => ctx.params.laps !== undefined && ctx.memory.laps >= ctx.params.laps,
            run: ctx => ({ done: `${ctx.memory.laps} laps${leaveNote(ctx)}` }),
        },
        {
            // Between obstacles, where an eat works (mid-script it does not): keep HP out of the low-HP guard's reach.
            name: 'eat',
            when: ctx => {
                const p = ctx.state().player;
                return !!p && p.maxHp > 0 && p.hp < p.maxHp * EAT_BELOW_FRACTION && !!findFood(ctx.state());
            },
            *run(ctx) {
                const food = findFood(ctx.state());
                if (!food) return;
                const r = yield* eat(ctx, food);
                if (r.ok) return;
                yield* log(`eat ${food.name} failed (${r.reason}): ${r.message}`);
                if (ctx.streak('eatFails').add() >= EAT_FAIL_LIMIT)
                    return { fail: `${EAT_FAIL_LIMIT} eats in a row failed (last: ${r.message})` };
            },
        },
        {
            // Out of food on a course that needs it: stop where the course lets the bot stop (a lap's start, outside its danger).
            name: 'out-of-food',
            when: ctx => {
                if (minFood(ctx.params) === 0) return false;
                const course = courseOf(ctx);
                const hasLapStart = course.obstacles.some(o => o.lapStart);
                const next = nextOf(ctx);
                // By tile, not by the obstacle's `from`: the door's side also covers the wolf field a ridge fall lands in.
                const p = ctx.state().player;
                const atLapStart =
                    !!next?.lapStart &&
                    !!p &&
                    awayFrom(ctx, course.start) <= course.start.radius &&
                    p.worldZ <= next.near.z;
                if (hasLapStart && !atLapStart) return false;
                return foodCount(ctx.state()) < foodNeeded(ctx, hasLapStart);
            },
            run(ctx) {
                const reason = `out of food after ${ctx.memory.laps} laps${leaveNote(ctx)}`;
                // Short of the laps asked for: the caller asked for more than the food allowed.
                if (ctx.params.laps !== undefined && ctx.memory.laps < ctx.params.laps) return { fail: reason };
                return { done: reason };
            },
        },
        {
            // Standing on the course's ground but on none of the obstacles' sides: walk to the lap start.
            name: 'to-course-start',
            when: ctx => !!ctx.state().player && !nextOf(ctx),
            *run(ctx) {
                const course = courseOf(ctx);
                const p = spotOf(ctx.state());
                if (!p || !onCourseGround(course, p))
                    return { fail: `off the ${ctx.params.course} course at (${p?.x},${p?.z}) level ${p?.level}` };
                const failure = yield* walkToArea(ctx, course.start);
                if (failure) return { fail: failure };
            },
        },
        {
            name: 'obstacle',
            when: () => true,
            *run(ctx) {
                const o = nextOf(ctx);
                // to-course-start takes every state with no obstacle, so this is a broken invariant.
                if (!o) return { fail: 'no obstacle for where the bot stands' };
                return yield* crossNext(ctx, o);
            },
        },
    ],
});
