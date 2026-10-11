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
import { OBSTACLE_SETTLE_TICKS, OBSTACLE_WAIT_TICKS } from '../actions/obstacle';
import { WALK_MAX_TICKS } from '../actions/walk';
import { log, type Op, ticks } from '../core/op';
import { walkToArea, WALK_FAIL_LIMIT } from '../lib/area';
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
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    course: z.enum(['gnome']).default('gnome'),
    /** Stop after this many completed laps; omit to run until a `--until` stop. */
    laps: z.number().int().min(1).optional(),
});

type AgilityParams = z.infer<typeof Params>;
interface AgilityMemory {
    /** Laps completed this run (the last obstacle crossed). */
    laps: number;
}
type Ctx = TaskContext<AgilityParams, AgilityMemory>;

const courseOf = (ctx: Ctx): Course => COURSES[ctx.params.course];

function* crossNext(ctx: Ctx, o: Obstacle): Op<Outcome> {
    const fails = ctx.streak('obstacleFails');
    const r = yield* crossObstacle(ctx, o);
    if (!r.ok && r.reason === 'not-found') {
        yield* log(r.message);
        if (fails.add() >= OBSTACLE_FAIL_LIMIT)
            return { fail: `${o.label} not found ${OBSTACLE_FAIL_LIMIT} times in a row` };
        return;
    }
    if (r.ok) {
        fails.reset();
        ctx.streak('falls').reset();
        if (o.lastOfLap) {
            ctx.memory.laps += 1;
            yield* log(`lap ${ctx.memory.laps} complete`);
        }
        return;
    }
    yield* log(`${o.label} failed (${r.reason}): ${r.message}`);
    // A fall or a move off the course is routed from where the bot lands; it is not a stuck obstacle.
    if (r.reason === 'fell' || r.reason === 'no-xp') {
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
        'Run laps of an agility course for Agility XP. Param `course`: "gnome" (Tree Gnome Stronghold course, Agility 1, ' +
        `no failure, about 86.5 XP per lap before the server's 25x; course start ${GNOME.start.x},${GNOME.start.z}); \`laps\` stops after that many laps, else it runs until a ` +
        '`--until` stop. Each obstacle is picked from where the bot stands, so it resumes mid-lap and re-routes after a fall; it only walks ' +
        "on the ground and the course's own obstacles are the plane changes. The bot must start at the course (within " +
        `${GNOME.reach} tiles of the ` +
        'start, on the course): this task does not travel: run the `travel` task to {x:2474,z:3436} first (Lumbridge is about 700 tiles away, wolves on the way).',
    params: Params,
    memory: (): AgilityMemory => ({ laps: 0 }),
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
        return null;
    },

    steps: [
        {
            name: 'stop-laps',
            when: ctx => ctx.params.laps !== undefined && ctx.memory.laps >= ctx.params.laps,
            run: ctx => ({ done: `${ctx.memory.laps} laps` }),
        },
        {
            // Standing on the course's ground but on none of the obstacles' sides: walk to the lap start.
            name: 'to-course-start',
            when: ctx => !!ctx.state().player && !nextObstacle(courseOf(ctx), ctx.state()),
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
                const o = nextObstacle(courseOf(ctx), ctx.state());
                // to-course-start takes every state with no obstacle, so this is a broken invariant.
                if (!o) return { fail: 'no obstacle for where the bot stands' };
                return yield* crossNext(ctx, o);
            },
        },
    ],
});
