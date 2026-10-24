// Diagnostic only, never a decision: a task that works targets inside an `area` and sits idle waiting for one
// counts the idle ticks in which a matching, free target stood in view outside the area. Runs have sat idle for
// minutes with the spot they wanted a few tiles beyond the radius; the result now says so and names the tile.
import type { BotWorldState } from '../../sdk/types';
import type { Op } from '../core/op';
import type { Area } from './area';
import { inArea } from './area';
import { distance } from './util';
import { squareReachesWilderness } from './wilderness';

/** The warning fires when more than this share of idle ticks had a matching target in view outside the area. */
export const OUTSIDE_WARN_SHARE = 0.1;
/** How close to the Wilderness (surface) a target may stand and still be taken or counted: the bot walks to within two tiles of it. */
export const WILDERNESS_MARGIN = 3;

/** A matching target in view but outside the area. */
export interface Sighting {
    name: string;
    x: number;
    z: number;
    /** Tiles from the bot when seen. */
    distance: number;
}

export interface AreaWatch {
    /** Ticks spent waiting for a target inside the area. */
    idleTicks: number;
    /** Idle ticks during which a matching free target was in view outside the area. */
    seenOutsideAreaTicks: number;
    /** The closest such target seen over the run. */
    nearest: Sighting | null;
}

export const newAreaWatch = (): AreaWatch => ({ idleTicks: 0, seenOutsideAreaTicks: 0, nearest: null });

/**
 * The nearest of `items` that `isTarget` accepts (everything but the area test) and that lies outside the
 * area; undefined with no area, or when it stands where the bot must not go (surface, near the Wilderness).
 */
export function outsideSighting<T extends { name: string; x: number; z: number; distance: number }>(
    state: BotWorldState,
    area: Area | undefined,
    items: readonly T[],
    isTarget: (item: T) => boolean,
): Sighting | undefined {
    if (!area) return undefined;
    const surface = state.player?.level === 0;
    let best: T | undefined;
    for (const t of items) {
        if (inArea(area, t) || !isTarget(t)) continue;
        if (surface && squareReachesWilderness(t.x, t.z, WILDERNESS_MARGIN)) continue;
        if (!best || t.distance < best.distance) best = t;
    }
    return best && { name: best.name, x: best.x, z: best.z, distance: best.distance };
}

/**
 * Records `elapsed` idle ticks. They count as seen outside when a sighting is given for the wait's start or its
 * end; a wait is not sampled in between, so `seenOutsideAreaTicks` is a sample taken at those two states and
 * a long wait (a respawn) is counted whole or not at all.
 */
export function noteIdle(watch: AreaWatch, elapsed: number, ...sightings: (Sighting | undefined)[]): void {
    if (elapsed <= 0) return;
    watch.idleTicks += elapsed;
    const seen = sightings.filter((s): s is Sighting => !!s);
    if (seen.length === 0) return;
    watch.seenOutsideAreaTicks += elapsed;
    for (const s of seen) if (!watch.nearest || s.distance < watch.nearest.distance) watch.nearest = s;
}

/**
 * Runs `idle` (the wait for a target) and counts the ticks it took, also when it is cancelled (a guard, a stop,
 * the step budget): the ticks from the state at its start to the latest state, seen outside the area when `seen`
 * finds a target at either end.
 */
export function* trackIdle<T>(
    ctx: { state(): BotWorldState },
    watch: AreaWatch,
    seen: (state: BotWorldState) => Sighting | undefined,
    idle: Op<T>,
): Op<T> {
    const before = ctx.state();
    try {
        return yield* idle;
    } finally {
        try {
            const after = ctx.state();
            noteIdle(watch, after.tick - before.tick, seen(before), seen(after));
        } catch {
            // A diagnostic never masks Cancelled or the step's own error.
        }
    }
}

/** The result's diagnostics and warnings for a watch; both empty when the task never idled. */
export function areaWatchReport(
    watch: AreaWatch,
    area: Area | undefined,
): { diagnostics: Record<string, unknown>; warnings: string[] } {
    if (watch.idleTicks === 0) return { diagnostics: {}, warnings: [] };
    const diagnostics: Record<string, unknown> = {
        idleTicks: watch.idleTicks,
        seenOutsideAreaTicks: watch.seenOutsideAreaTicks,
    };
    const warnings: string[] = [];
    const n = watch.nearest;
    if (area && n && watch.seenOutsideAreaTicks > OUTSIDE_WARN_SHARE * watch.idleTicks) {
        diagnostics['nearestOutsideArea'] = { name: n.name, x: n.x, z: n.z };
        const out = Math.ceil(distance(area, n));
        warnings.push(
            `seenOutsideArea: idle ${watch.idleTicks} ticks, ${watch.seenOutsideAreaTicks} with a matching target in view outside the area at a wait's start or end; ` +
                `nearest ${n.name} at (${n.x},${n.z}), ${out} tiles from the area centre (${area.x},${area.z}) radius ${area.radius}: widen the area to radius ${Math.max(out, area.radius)} or move its centre`,
        );
    }
    return { diagnostics, warnings };
}
