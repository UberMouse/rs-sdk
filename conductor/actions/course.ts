// Not ported: sdk/actions.ts has no agility method (closest: interactLoc @ 4c2069cc0).
// Agility course data and next-obstacle choice, shared by the agility task and by walkTo. The ground
// pathfinder has no route off a raised section, so walkTo finishes the course obstacles forward to the ground.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { log, type Op, scan } from '../core/op';
import { distance } from '../lib/util';
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

export const COURSES = { gnome: GNOME } as const;

export function spotOf(s: BotWorldState): Spot | null {
    return s.player ? { x: s.player.worldX, z: s.player.worldZ, level: s.player.level } : null;
}

/** On the course's plane and within its reach of the start. */
export function onCourseGround(course: Course, p: Spot): boolean {
    return p.level === 0 && distance(p, course.start) <= course.reach;
}

/** The next obstacle for where the bot stands, or undefined when it is away from the course or on none of its sides. */
export function nextObstacle(course: Course, s: BotWorldState): Obstacle | undefined {
    const p = spotOf(s);
    return p && distance(p, course.start) <= course.reach ? course.obstacles.find(o => o.from(p)) : undefined;
}

/** The obstacle's loc among `locs`: nearest to the bot of those within its `near` radius. */
export function findObstacleLoc(o: Obstacle, locs: readonly NearbyLoc[], level: number): NearbyLoc | undefined {
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

/** Crosses obstacle `o` from where the bot stands: finds its loc (scene, scan, then the map data), then `obstacle`. */
export function* crossObstacle(ctx: ActionContext, o: Obstacle): Op<CrossResult> {
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
