// "Stay near here": the area param, the walk back to it, and which targets count as inside it.
// Every task that works one spot (trees, rocks, fishing spots, monsters) shares this.
import { z } from 'zod/v4';
import type { Step, TaskContext } from './task';
import { distance } from './util';

/** Radius floor: the walk tolerance is radius - 1, so a smaller area could never be reached. */
const MIN_AREA_RADIUS = 2;
const DEFAULT_AREA_RADIUS = 15;
/**
 * The bot stands up to this many tiles from what it works on, so a target at the area's edge must
 * not pull it far enough out to trigger the walk back.
 */
const WORK_REACH = 2;
const MAX_WALK_TOLERANCE = 3;
const WALK_FAIL_LIMIT = 3;

/**
 * Surface Wilderness box (plane 0), from wilderness_zones.dbrow: x 2944..3391, z >= 3520.
 * No task goes there: PvP, and death drops items.
 */
const WILDERNESS_MIN_X = 2944;
const WILDERNESS_MAX_X = 3391;
const WILDERNESS_MIN_Z = 3520;

/** On the surface in the Wilderness. */
export const isInWilderness = (level: number, worldX: number, worldZ: number): boolean =>
    level === 0 && worldX >= WILDERNESS_MIN_X && worldX <= WILDERNESS_MAX_X && worldZ >= WILDERNESS_MIN_Z;

/** True when the area's bounding square overlaps the surface Wilderness. */
const areaReachesWilderness = (area: Area): boolean =>
    area.x + area.radius >= WILDERNESS_MIN_X &&
    area.x - area.radius <= WILDERNESS_MAX_X &&
    area.z + area.radius >= WILDERNESS_MIN_Z;

export const AreaSchema = z.object({
    x: z.number(),
    z: z.number(),
    radius: z.number().min(MIN_AREA_RADIUS).default(DEFAULT_AREA_RADIUS),
});
export type Area = z.infer<typeof AreaSchema>;

/** A target the task may work on: within the radius when there is an area, anywhere when there isn't. */
export function inArea(area: Area | undefined, point: { x: number; z: number }): boolean {
    return !area || distance(area, point) <= area.radius;
}

/** Preflight check for an area param; returns a refusal reason or null. */
export function refuseArea(area: Area | undefined): string | null {
    if (area && areaReachesWilderness(area))
        return `area (${area.x},${area.z}) radius ${area.radius} reaches the Wilderness`;
    return null;
}

/**
 * Walk to the area centre, counting consecutive failures; returns a fail reason once past the limit.
 * Every caller in a run shares one `area.walkFails` counter, so the limit is per run, not per caller.
 */
export async function walkToArea(ctx: TaskContext, area: Area): Promise<string | null> {
    const r = await ctx.bot.walkTo(area.x, area.z, Math.min(MAX_WALK_TOLERANCE, area.radius - 1));
    const fails = ctx.counter('area.walkFails');
    if (r.success) {
        fails.reset();
        return null;
    }
    return fails.add() >= WALK_FAIL_LIMIT ? `can't walk to area (${r.message})` : null;
}

/** A step that walks the bot back once it has strayed beyond the area plus its work reach. */
export function returnToAreaStep<P>(areaOf: (params: P) => Area | undefined): Step<P> {
    return {
        name: 'return-to-area',
        // No player (logging in, respawning) is not "far away": distanceTo would be Infinity.
        when: ctx => {
            const a = areaOf(ctx.params);
            return !!a && !!ctx.state().player && ctx.distanceTo(a.x, a.z) > a.radius + WORK_REACH;
        },
        async run(ctx) {
            const a = areaOf(ctx.params);
            const failure = a ? await walkToArea(ctx, a) : null;
            if (failure) return { fail: failure };
        },
    };
}
