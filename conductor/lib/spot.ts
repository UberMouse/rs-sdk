// Shared by the tasks that stand at a spot first and then work on what is there (talk, interact): the
// `at` param, the regex param type, and the step that walks to the spot.
import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { timedOutAdvancing, walkTo } from '../actions/walk';
import { log } from '../core/op';
import type { Step, TaskContext } from './task';

const DEFAULT_TOLERANCE = 3;

/** The walk's failure reasons that retrying cannot fix. */
export const FINAL_WALK_FAILURES: readonly string[] = ['no-path', 'no-connector', 'no-blade', 'bad-coordinates'];

const isPattern = (source: string) => {
    try {
        void new RegExp(source, 'i');
        return true;
    } catch {
        return false;
    }
};
/** A case-insensitive regex given as a string. */
export const Pattern = z.string().refine(isPattern, 'not a valid regular expression');
export const matcher = (source: string) => new RegExp(source, 'i');

/** Where to stand first: walked to (across floors, through doors) unless already within `tolerance`. */
export const AtSchema = z.object({
    x: z.number(),
    z: z.number(),
    level: z.number().int().optional(),
    tolerance: z.number().int().min(1).default(DEFAULT_TOLERANCE),
});
export type At = z.infer<typeof AtSchema>;

/** Within `tolerance` tiles of `at` as walkTo counts them (Chebyshev, not straight-line), on its level. */
export function atSpot(at: At | undefined, state: BotWorldState): boolean {
    const p = state.player;
    if (!at || !p) return true;
    return (
        Math.max(Math.abs(p.worldX - at.x), Math.abs(p.worldZ - at.z)) <= at.tolerance &&
        (at.level === undefined || p.level === at.level)
    );
}

/** The step that walks to `params.at` until the bot stands there; `failLimit` walks in a row failing ends the run. */
export function walkToSpotStep<P extends { at?: At }, M extends object>(failLimit: number): Step<P, M> {
    const here = (ctx: TaskContext<P, M>) => atSpot(ctx.params.at, ctx.state());
    return {
        name: 'walk',
        when: ctx => !!ctx.params.at && !!ctx.state().player && !ctx.state().dialog.isOpen && !here(ctx),
        *run(ctx) {
            const { at } = ctx.params;
            // Narrowing only: when() guarantees it.
            if (!at) return;
            const before = ctx.distanceTo(at.x, at.z);
            const r = yield* walkTo(ctx, at.x, at.z, at.tolerance, at.level === undefined ? {} : { level: at.level });
            const fails = ctx.streak('walkFails');
            // `ok` while not at the spot (another floor, a different measure) must count as a failure, or this loops.
            if ((r.ok && here(ctx)) || timedOutAdvancing(r, before, ctx.distanceTo(at.x, at.z))) {
                fails.reset();
                return;
            }
            const why = r.ok ? 'ended away from the spot' : r.reason;
            yield* log(`walk to (${at.x},${at.z}) failed (${why}): ${r.message}`);
            if (!r.ok && FINAL_WALK_FAILURES.includes(r.reason))
                return { fail: `can't walk to (${at.x},${at.z}): ${r.message}` };
            if (fails.add() >= failLimit)
                return { fail: `${failLimit} walks in a row failed toward (${at.x},${at.z}); last: ${r.message}` };
        },
    };
}
