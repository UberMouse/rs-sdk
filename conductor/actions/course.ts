// Not ported: sdk/actions.ts has no agility method (closest: interactLoc @ 4c2069cc0).
// Agility course data and next-obstacle choice, shared by the agility task and by walkTo. The ground
// pathfinder has no route off a raised section, so walkTo finishes the course obstacles forward to the ground.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { log, type Op, scan } from '../core/op';
import { type Connector, UNDERGROUND_Z } from '../lib/connectors';
import { distance } from '../lib/util';
import { climb, type ClimbResult } from './climb';
import type { ActionContext } from './context';
import { obstacle, OBSTACLE_SETTLE_TICKS, OBSTACLE_WAIT_TICKS, type ObstacleResult } from './obstacle';

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
export interface Spot {
    x: number;
    z: number;
    level: number;
}

export interface Obstacle {
    /** For logs and fail reasons. */
    label: string;
    name: RegExp;
    option: RegExp;
    /** When several locs share the name and option, the one with this id (the crumbling walls: two of the three leave the lap's progress out). */
    locId?: number;
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
    /**
     * Walk to within `radius` of this tile before interacting when farther: the script only works from one
     * side (the client's own approach stops at the nearest edge of the loc, which may be the wrong one).
     */
    stand?: { x: number; z: number; radius: number };
    /**
     * Where the bot may be, after this obstacle fell, for it to be tried again. A pit's ladder lands the bot
     * where the position alone names the next obstacle of the lap, which skips this one (no bonus then).
     */
    retryFrom?: (p: Spot) => boolean;
    /**
     * A ladder out of a pit or off a ledge instead of an obstacle: climbed with the connector, pays no XP, and
     * does not end the retry of the obstacle that fell.
     */
    ladder?: Connector;
    /** The lap starts here, outside the course's danger (the Wilderness door): a run that stops at a lap's edge stops here. */
    lapStart?: boolean;
}

export interface Course {
    /** Where a lap starts (the bot is walked here from the ground of the course when it stands on no obstacle's side). */
    start: { x: number; z: number; radius: number };
    /**
     * The raised part of the course: a tile in this box on a plane above the ground is on an obstacle section the
     * ground pathfinder cannot leave, so a walk from there first crosses the obstacles on (leaveCourse).
     */
    section: { minX: number; maxX: number; minZ: number; maxZ: number };
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
export const GNOME: Course = {
    start: { x: LOG_TILE.x, z: LOG_TILE.z + 1, radius: 3 },
    reach: 40,
    // Planes 1 and 2: the nets up (z 3425) to the branch down (x 2487), with a margin.
    section: { minX: 2468, maxX: 2490, minZ: 3414, maxZ: 3427 },
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

/** The Barbarian Outpost's training yard: closed in by walls, entered by the pipe from the Outpost (north, z >= 3560). */
const BARB_YARD = { minX: 2528, maxX: 2553, minZ: 3541, maxZ: 3559 } as const;
const inBarbYard = (p: Spot) =>
    p.level === 0 && p.x >= BARB_YARD.minX && p.x <= BARB_YARD.maxX && p.z >= BARB_YARD.minZ && p.z <= BARB_YARD.maxZ;
/** The yard's north strip (the crumbling walls and the rope's start); south of it are the lake, the net and the log. */
const BARB_WALL_MIN_Z = 3550;
/** The pit under the rope swing and its ladder (server/content/maps/m39_155.jm2). */
const underground = (p: Spot) => p.level === 0 && p.z >= UNDERGROUND_Z;
const tile = (level: number, x: number, z: number) => ({ level, x, z });

const BARB_LEDGE_LADDER: Connector = {
    name: 'Barbarian ledge ladder',
    direction: 'down',
    loc: tile(1, 2532, 3545),
    stand: tile(1, 2532, 3546),
    to: tile(0, 2532, 3546),
};
const BARB_PIT_LADDER: Connector = {
    name: 'Barbarian rope pit ladder',
    direction: 'up',
    loc: tile(0, 2547, 9951),
    stand: tile(0, 2548, 9951),
    to: tile(0, 2548, 3551),
};
/**
 * Barbarian Outpost course (skill_agility/scripts/barbarian_course.rs2; locs from server/content/maps/m39_55.jm2 at
 * x+2496, z+3520). A lap is the rope swing (2551,3550; from z >= 3554, swings south to 3549), the log balance (2550,3546, on a
 * bridge-flagged tile like the gnome log; west to 2541, falls into the lake and lands on its south shore), the net
 * (2538,3545; climbs from the east to level 1), the ledge (level 1, 2535,3547; falls onto spikes below it), the ladder
 * down (2532,3545) and the three crumbling walls (z 3553, x 2536, 2539, 2542; each climbed eastward). The third
 * wall pays the 42 xp lap bonus when the whole sequence went through (the script keeps a progress varp). The yard has no
 * other way out, so the way back to the rope is on foot. The pipe (2552,3559) only leads from the Outpost into the
 * yard: it is crossed once when the bot starts outside. A fall off the rope lands in a pit under the yard (z 9949) whose ladder
 * (2547,9951) lands the bot by the log, so the rope is retried by memory (retryFrom).
 */
export const BARBARIAN: Course = {
    start: { x: 2548, z: 3555, radius: 3 },
    reach: 40,
    // Level 1: the platform of the net, the ledge and the ladder.
    section: { minX: 2531, maxX: 2539, minZ: 3544, maxZ: 3548 },
    agilityLevel: 35,
    obstacles: [
        {
            label: 'rope pit ladder',
            name: /^ladder$/i,
            option: /^climb-up$/i,
            near: { x: 2547, z: 9951, radius: 3 },
            from: p => underground(p),
            ladder: BARB_PIT_LADDER,
        },
        {
            label: 'ledge ladder',
            name: /^ladder$/i,
            option: /^climb-down$/i,
            near: { x: 2532, z: 3545, radius: 3 },
            from: p => p.level === 1 && p.x <= 2534,
            ladder: BARB_LEDGE_LADDER,
        },
        {
            label: 'ledge',
            name: /^balancing ledge$/i,
            option: /^walk-across$/i,
            near: { x: 2535, z: 3547, radius: 2 },
            from: p => p.level === 1 && p.x >= 2535,
        },
        {
            label: 'pipe',
            name: /^obstacle pipe$/i,
            option: /^squeeze-through$/i,
            near: { x: 2552, z: 3559, radius: 3 },
            from: p => p.level === 0 && p.z >= 3560,
        },
        {
            label: 'rope swing',
            name: /^ropeswing$/i,
            option: /^swing-on$/i,
            near: { x: 2551, z: 3550, radius: 3 },
            stand: { x: 2551, z: 3555, radius: 1 },
            from: p => inBarbYard(p) && p.z >= BARB_WALL_MIN_Z && p.x >= 2543,
            retryFrom: inBarbYard,
        },
        {
            label: 'log balance',
            name: /^log balance$/i,
            option: /^walk-across$/i,
            near: { x: 2550, z: 3546, radius: 3 },
            known: { id: 2294, x: 2550, z: 3546, opIndex: 1, name: 'Log balance', text: 'Walk-across' },
            from: p => inBarbYard(p) && p.z < BARB_WALL_MIN_Z && p.x >= 2542,
            retryFrom: inBarbYard,
        },
        {
            label: 'net',
            name: /^obstacle net$/i,
            option: /^climb-over$/i,
            near: { x: 2538, z: 3545, radius: 3 },
            stand: { x: 2541, z: 3545, radius: 1 },
            from: p => inBarbYard(p) && p.z < BARB_WALL_MIN_Z && p.x >= 2533 && p.x <= 2541,
        },
        {
            label: 'wall 1',
            locId: 1948,
            name: /^crumbling wall$/i,
            option: /^climb-over$/i,
            near: { x: 2536, z: 3553, radius: 1 },
            stand: { x: 2535, z: 3553, radius: 1 },
            from: p => inBarbYard(p) && (p.x <= 2532 || (p.z >= BARB_WALL_MIN_Z && p.x <= 2535)),
        },
        {
            label: 'wall 2',
            locId: 1948,
            name: /^crumbling wall$/i,
            option: /^climb-over$/i,
            near: { x: 2539, z: 3553, radius: 1 },
            stand: { x: 2538, z: 3553, radius: 1 },
            from: p => inBarbYard(p) && p.z >= BARB_WALL_MIN_Z && p.x >= 2536 && p.x <= 2539,
        },
        {
            label: 'wall 3',
            locId: 1948,
            name: /^crumbling wall$/i,
            option: /^climb-over$/i,
            near: { x: 2542, z: 3553, radius: 1 },
            stand: { x: 2541, z: 3553, radius: 1 },
            from: p => inBarbYard(p) && p.z >= BARB_WALL_MIN_Z && p.x >= 2540 && p.x <= 2542,
            lastOfLap: true,
        },
    ],
};

const WILD_PIT_LADDER: Connector = {
    name: 'Wilderness course cave ladder',
    direction: 'up',
    loc: tile(0, 3005, 10363),
    stand: tile(0, 3005, 10362),
    to: tile(0, 3005, 3963),
};
/** The compound's first row, where its gate is; the ridge corridor and the wolf field are south of it. */
const WILD_COMPOUND_MIN_Z = 3931;
/** The compound's ground. */
const inCompound = (p: Spot) => p.level === 0 && p.z >= WILD_COMPOUND_MIN_Z && p.z < UNDERGROUND_Z;
/** The gate is taken from here south (the rocks' end of the compound). */
const WILD_GATE_MAX_Z = 3935;
/** The rocks' first row (the lap's end, back towards the gate). */
const WILD_ROCKS_Z = 3936;
/** The pipe's row: it is crossed from here south; the rope swing's side starts north of it. */
const WILD_PIPE_Z = 3938;
/** The rope swing is taken from this row south (its stand is 3952). */
const WILD_ROPE_MAX_Z = 3953;
/** The stones and the log are taken from this row north (the rope's end). */
const WILD_STONES_MIN_Z = 3954;
/**
 * Wilderness course (skill_agility/scripts/wilderness_course.rs2; locs from server/content/maps/m46_61.jm2 at x+2944,
 * z+3904, and m46_161.jm2 for the cave). A compound (z >= 3931) behind a 13-tile ridge corridor (x 2998, z 3917..3930),
 * entered through the door (2998,3917) and left through the gate (2998,3931), both ridge walks that can fall
 * into the wolf field south of the compound (white wolves, combat 38, around 2988..3006 x 3917..3926). A lap:
 * ridge north (15 xp), pipe (3004,3938; from the south side only, 12.5), rope swing (3005,3952; from z <= 3953, falls into
 * the skeleton cave at z 10357), stepping stones (3001,3960; falls into lava, to (3002,3963)), log balance
 * (3001,3945; bridge-flagged; falls into the cave at (2998,10345)), rocks (2993..2995,3936; no xp of their own, the
 * 498.9 xp bonus when the whole lap went through), then the gate: ridge south (15). The cave's only ladder
 * (3005,10363) lands at (x, z-6400) by the stones, so the rope, the stones and the log are retried by memory.
 * A failed obstacle costs 15 to 22 percent of max HP (the stones' lava is the worst).
 */
export const WILDERNESS: Course = {
    start: { x: 2998, z: 3915, radius: 3 },
    reach: 60,
    // Nothing of this course is above the ground.
    section: { minX: 2984, maxX: 3016, minZ: 3931, maxZ: 3965 },
    agilityLevel: 52,
    obstacles: [
        {
            label: 'cave ladder',
            name: /^ladder$/i,
            option: /^climb-up$/i,
            near: { x: 3005, z: 10363, radius: 3 },
            from: p => underground(p),
            ladder: WILD_PIT_LADDER,
        },
        {
            label: 'ridge door',
            name: /^door$/i,
            option: /^open$/i,
            near: { x: 2998, z: 3917, radius: 2 },
            from: p => p.level === 0 && p.z < WILD_COMPOUND_MIN_Z,
            lapStart: true,
        },
        {
            label: 'gate',
            name: /^gate$/i,
            option: /^open$/i,
            near: { x: 2998, z: WILD_COMPOUND_MIN_Z, radius: 2 },
            from: p => inCompound(p) && p.x <= 2996 && p.z <= WILD_GATE_MAX_Z,
            lastOfLap: true,
        },
        {
            label: 'pipe',
            name: /^obstacle pipe$/i,
            option: /^squeeze-through$/i,
            near: { x: 3004, z: 3938, radius: 2 },
            from: p => inCompound(p) && p.x >= 2997 && p.z <= WILD_PIPE_Z,
        },
        {
            label: 'rope swing',
            name: /^ropeswing$/i,
            option: /^swing-on$/i,
            near: { x: 3005, z: 3952, radius: 3 },
            stand: { x: 3005, z: 3952, radius: 1 },
            from: p => inCompound(p) && p.x >= 2997 && p.z > WILD_PIPE_Z && p.z <= WILD_ROPE_MAX_Z,
            retryFrom: inCompound,
        },
        {
            label: 'stepping stones',
            name: /^stepping stone$/i,
            option: /^jump-from$/i,
            near: { x: 3001, z: 3960, radius: 2 },
            from: p => inCompound(p) && p.x >= 2999 && p.z >= WILD_STONES_MIN_Z,
            retryFrom: inCompound,
        },
        {
            label: 'log balance',
            name: /^log balance$/i,
            option: /^walk-across$/i,
            near: { x: 3001, z: 3945, radius: 3 },
            known: { id: 2297, x: 3001, z: 3945, opIndex: 1, name: 'Log balance', text: 'Walk-across' },
            from: p => inCompound(p) && p.x <= 2998 && p.z >= WILD_STONES_MIN_Z,
            retryFrom: inCompound,
        },
        {
            label: 'rocks',
            name: /^rocks$/i,
            option: /^climb$/i,
            near: { x: 2994, z: 3936, radius: 3 },
            from: p => inCompound(p) && p.x <= 2996 && p.z >= WILD_ROCKS_Z && p.z <= WILD_ROPE_MAX_Z,
        },
    ],
};

export const COURSES = { gnome: GNOME, barbarian: BARBARIAN, wilderness: WILDERNESS } as const;

export function spotOf(s: BotWorldState): Spot | null {
    return s.player ? { x: s.player.worldX, z: s.player.worldZ, level: s.player.level } : null;
}

/** The tile with an underground z (pits and caves are drawn 6400 south of the surface) on the surface, for distances. */
const surfaceOf = (p: Spot) => ({ x: p.x, z: p.z >= UNDERGROUND_Z ? p.z - UNDERGROUND_Z : p.z });

/** On the course's plane and within its reach of the start. */
export function onCourseGround(course: Course, p: Spot): boolean {
    return p.level === 0 && distance(p, course.start) <= course.reach;
}

/**
 * The next obstacle for where the bot stands, or undefined when it is away from the course or on none of its sides.
 * `retry` is the label of an obstacle that just fell: when the bot is anywhere that obstacle can be tried again from
 * (`retryFrom`), that obstacle is next, ahead of what the position alone says.
 */
export function nextObstacle(course: Course, s: BotWorldState, retry?: string): Obstacle | undefined {
    const p = spotOf(s);
    if (!p || distance(surfaceOf(p), course.start) > course.reach) return undefined;
    const again = retry ? course.obstacles.find(o => o.label === retry) : undefined;
    if (again?.retryFrom?.(p)) return again;
    return course.obstacles.find(o => o.from(p));
}

/** The obstacle's loc among `locs`: nearest to the bot of those within its `near` radius. */
export function findObstacleLoc(o: Obstacle, locs: readonly NearbyLoc[], level: number): NearbyLoc | undefined {
    return locs
        .filter(
            l =>
                l.level === level &&
                (o.locId === undefined || l.id === o.locId) &&
                o.name.test(l.name) &&
                l.optionsWithIndex.some(opt => o.option.test(opt.text)) &&
                l.reachable !== false &&
                distance(l, o.near) <= o.near.radius,
        )
        .sort((a, b) => a.distance - b.distance)[0];
}

/** The obstacle's loc from the map data, as the SDK would list it. */
export function knownLoc(o: Obstacle, s: BotWorldState): NearbyLoc | undefined {
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

/** The crossing, or an obstacle whose loc the scene does not show. */
export type CrossResult = ObstacleResult | { ok: false; reason: 'not-found'; message: string };

/** A ladder's result as an obstacle's: it pays no XP. */
function ladderResult(r: ClimbResult): CrossResult {
    if (r.ok) return { ok: true, xp: 0 };
    if (r.reason === 'no-loc') return { ok: false, reason: 'not-found', message: r.message };
    if (r.reason === 'cant-reach') return { ok: false, reason: 'refused', message: r.message };
    if (r.reason === 'send-failed') return { ok: false, reason: 'send-failed', message: r.message };
    return { ok: false, reason: 'timeout', message: r.message };
}

/** Crosses obstacle `o` from where the bot stands: finds its loc (scene, scan, then the map data), then `obstacle`. */
export function* crossObstacle(ctx: ActionContext, o: Obstacle): Op<CrossResult> {
    if (o.ladder) return ladderResult(yield* climb(ctx, o.ladder));
    const state = ctx.state();
    const level = state.player?.level ?? 0;
    let loc = findObstacleLoc(o, state.nearbyLocs, level);
    if (!loc) loc = findObstacleLoc(o, yield* scan(), level);
    if (!loc) loc = knownLoc(o, state);
    if (!loc) return { ok: false, reason: 'not-found', message: `no ${o.label} found near (${o.near.x},${o.near.z})` };
    return yield* obstacle(ctx, loc, o.option);
}

/** The course whose raised section the bot stands on. */
export function courseSectionOf(s: BotWorldState): { name: string; course: Course } | undefined {
    const p = spotOf(s);
    if (!p || p.level === 0) return undefined;
    for (const [name, course] of Object.entries(COURSES)) {
        const b = course.section;
        if (p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ) return { name, course };
    }
    return undefined;
}

/**
 * Obstacle attempts (crossed or not) a walk makes to get off a course section before giving up. From plane 1
 * the gnome course crosses three (branch up, tightrope, branch down); 5 is those three plus 2 retries.
 */
export const LEAVE_COURSE_ATTEMPTS = 5;
/** The worst case of one obstacle attempt, in ticks (its send, wait and settle). */
export const LEAVE_ATTEMPT_TICKS = OBSTACLE_WAIT_TICKS + OBSTACLE_SETTLE_TICKS + 1;

export type LeaveCourseResult =
    | { ok: true; crossed: number }
    | { ok: false; reason: 'no-time' | 'failed'; message: string };

/**
 * When the bot stands on a course's raised section, crosses its obstacles forward until it is back on the
 * ground, where the pathfinder routes from. Nothing to do (`crossed: 0`) anywhere else. `reserveTicks` are the
 * ticks the caller still needs afterwards: an obstacle is not started without its worst case left.
 */
export function* leaveCourse(ctx: ActionContext, reserveTicks = 0): Op<LeaveCourseResult> {
    let crossed = 0;
    for (let attempt = 0; attempt < LEAVE_COURSE_ATTEMPTS; attempt++) {
        const s = ctx.state();
        const section = courseSectionOf(s);
        if (!section) return { ok: true, crossed };
        const p = spotOf(s);
        const at = `(${p?.x},${p?.z}) level ${p?.level}`;
        const left = ctx.stepTicksLeft?.();
        if (left !== undefined && left < LEAVE_ATTEMPT_TICKS + reserveTicks)
            return {
                ok: false,
                reason: 'no-time',
                message: `on the ${section.name} course at ${at} with ${left} ticks left to cross an obstacle`,
            };
        const o = nextObstacle(section.course, s);
        if (!o) return { ok: false, reason: 'failed', message: `no obstacle leads on from ${at}` };
        if (attempt === 0)
            yield* log(`walk: on the ${section.name} course at ${at}; crossing obstacles to the ground first`);
        const r = yield* crossObstacle(ctx, o);
        if (r.ok) crossed++;
        else yield* log(`walk: ${o.label} failed (${r.reason}): ${r.message}`);
    }
    const section = courseSectionOf(ctx.state());
    if (!section) return { ok: true, crossed };
    return {
        ok: false,
        reason: 'failed',
        message: `still on the ${section.name} course section after ${LEAVE_COURSE_ATTEMPTS} obstacles`,
    };
}
