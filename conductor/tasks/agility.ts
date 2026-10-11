import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { obstacle, OBSTACLE_SETTLE_TICKS, OBSTACLE_WAIT_TICKS } from '../actions/obstacle';
import { WALK_MAX_TICKS } from '../actions/walk';
import { log, type Op, scan, ticks } from '../core/op';
import { walkToArea, WALK_FAIL_LIMIT, type Area } from '../lib/area';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { distance, findSkill } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/** The log balance's tile: the lap starts one tile north of it, and the map data places the loc here. */
const LOG_TILE = { x: 2474, z: 3435 } as const;
/** The z range of the nets' and the pipe's side of the course; north of it the bot is at the log. */
const NET_ROW_MIN_Z = 3426;
const NET_ROW_MAX_Z = 3431;
const LOG_MIN_Z = 3432;
/** The west half of the course (net up, rope start) ends at this x; the east half starts after it. */
const WEST_MAX_X = 2478;
const EAST_MIN_X = 2479;
/** The east half's ground south of the nets, where the bot lands from the branch. */
const NET_DOWN_MAX_Z = 3425;

/** Where the bot stands: world tile and plane. */
interface Spot {
    x: number;
    z: number;
    level: number;
}

interface Obstacle {
    /** For logs and fail reasons. */
    label: string;
    name: RegExp;
    option: RegExp;
    /** The loc to use is the nearest one with this name and option within `radius` of (x, z) on the bot's plane. */
    near: { x: number; z: number; radius: number };
    /** The part of the course the bot stands on when this is the next obstacle. */
    from: (p: Spot) => boolean;
    /**
     * The loc as the map data has it, for an obstacle the client's scene never lists: the log balance sits
     * on a bridge-flagged tile, so neither nearbyLocs nor a scan reports it. It is sent by id and tile.
     */
    known?: { id: number; x: number; z: number; opIndex: number; name: string; text: string };
    /** Crossing this one completes a lap. */
    lastOfLap?: boolean;
}

interface Course {
    /** Where a lap starts (the bot is walked here from the ground of the course when it stands on no obstacle's side). */
    start: Area;
    /** On the ground this close to `start` (Chebyshev) the bot counts as at the course. */
    reach: number;
    agilityLevel: number;
    obstacles: Obstacle[];
}

/**
 * Tree Gnome Stronghold course (server/content/scripts/skill_agility/scripts/gnome_course.rs2; locs from
 * server/content/maps/m38_53.jm2 at x+2432, z+3392). Nothing fails. Each obstacle is chosen from where the
 * bot stands, so a lap resumes from wherever a stop left the bot:
 * log (2474,3435) west along z -7 to (2474,3428); net (2471/2473/2475,3425) up to plane 1 (z-2); branch
 * (2473,3422) up to plane 2; rope (2478,3420) east +6 to (2483,3420); branch down (2486,3419) or
 * (2487,3418/3420) to the ground at (2487,3420); net (2483..2487,3426) north (z+2); pipe (2484 or 2487,3431)
 * north to z 3434, then back west to the log. Only the nets and the pipe are checked for which side
 * the bot is on ("You can not do that from here").
 */
const GNOME: Course = {
    start: { x: LOG_TILE.x, z: LOG_TILE.z + 1, radius: 3 },
    reach: 40,
    agilityLevel: 1,
    obstacles: [
        {
            label: 'log balance',
            name: /^log balance$/i,
            option: /^walk-across$/i,
            near: { ...LOG_TILE, radius: 3 },
            known: { id: 2295, ...LOG_TILE, opIndex: 1, name: 'Log balance', text: 'Walk-across' },
            from: p => p.level === 0 && p.z >= LOG_MIN_Z,
        },
        {
            label: 'net up',
            name: /^obstacle net$/i,
            option: /^climb-over$/i,
            near: { x: 2473, z: 3425, radius: 3 },
            from: p => p.level === 0 && p.x <= WEST_MAX_X && p.z >= NET_ROW_MIN_Z && p.z <= NET_ROW_MAX_Z,
        },
        {
            label: 'branch up',
            name: /^tree branch$/i,
            option: /^climb$/i,
            near: { x: 2473, z: 3422, radius: 2 },
            from: p => p.level === 1,
        },
        {
            label: 'tightrope',
            name: /^balancing rope$/i,
            option: /^walk-on$/i,
            near: { x: 2478, z: 3420, radius: 2 },
            from: p => p.level === 2 && p.x <= WEST_MAX_X,
        },
        {
            label: 'branch down',
            name: /^tree branch$/i,
            option: /^climb-down$/i,
            near: { x: 2486, z: 3419, radius: 3 },
            from: p => p.level === 2 && p.x >= EAST_MIN_X,
        },
        {
            label: 'net down',
            name: /^obstacle net$/i,
            option: /^climb-over$/i,
            near: { x: 2485, z: 3426, radius: 3 },
            from: p => p.level === 0 && p.x >= EAST_MIN_X && p.z <= NET_DOWN_MAX_Z,
        },
        {
            label: 'pipe',
            name: /^obstacle pipe$/i,
            option: /^squeeze-through$/i,
            near: { x: 2485, z: 3431, radius: 2 },
            from: p => p.level === 0 && p.x >= EAST_MIN_X && p.z >= NET_ROW_MIN_Z && p.z <= NET_ROW_MAX_Z,
            lastOfLap: true,
        },
    ],
};

const COURSES = { gnome: GNOME } as const;

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

function spotOf(s: BotWorldState): Spot | null {
    return s.player ? { x: s.player.worldX, z: s.player.worldZ, level: s.player.level } : null;
}

/** On the course's plane and within its reach of the start. */
function onCourseGround(course: Course, p: Spot): boolean {
    return p.level === 0 && distance(p, course.start) <= course.reach;
}

/** The next obstacle for where the bot stands, or undefined when it is away from the course or on none of its sides. */
function nextObstacle(course: Course, s: BotWorldState): Obstacle | undefined {
    const p = spotOf(s);
    return p && distance(p, course.start) <= course.reach ? course.obstacles.find(o => o.from(p)) : undefined;
}

/** The obstacle's loc among `locs`: nearest to the bot of those within its `near` radius. */
function findObstacleLoc(o: Obstacle, locs: readonly NearbyLoc[], level: number): NearbyLoc | undefined {
    return locs
        .filter(
            l =>
                l.level === level &&
                o.name.test(l.name) &&
                l.optionsWithIndex.some(opt => o.option.test(opt.text)) &&
                l.reachable !== false &&
                distance(l, o.near) <= o.near.radius,
        )
        .sort((a, b) => a.distance - b.distance)[0];
}

/** The obstacle's loc from the map data, as the SDK would list it. */
function knownLoc(o: Obstacle, s: BotWorldState): NearbyLoc | undefined {
    if (!o.known || !s.player) return undefined;
    const { id, x: kx, z: kz, opIndex, name, text } = o.known;
    return {
        id,
        name,
        x: kx,
        z: kz,
        level: s.player.level,
        distance: distance({ x: s.player.worldX, z: s.player.worldZ }, { x: kx, z: kz }),
        optionsWithIndex: [{ text, opIndex }],
        options: [text],
    };
}

function* crossNext(ctx: Ctx, o: Obstacle): Op<Outcome> {
    const state = ctx.state();
    const level = state.player?.level ?? 0;
    let loc = findObstacleLoc(o, state.nearbyLocs, level);
    if (!loc) loc = findObstacleLoc(o, yield* scan(), level);
    if (!loc) loc = knownLoc(o, state);
    const fails = ctx.streak('obstacleFails');
    if (!loc) {
        yield* log(`no ${o.label} found near (${o.near.x},${o.near.z})`);
        if (fails.add() >= OBSTACLE_FAIL_LIMIT)
            return { fail: `${o.label} not found ${OBSTACLE_FAIL_LIMIT} times in a row` };
        return;
    }
    const r = yield* obstacle(ctx, loc, o.option);
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
