// Shared by the tasks that stand at a spot first and then work on what is there (talk, interact): the
// `at` param, the regex param type, and the step that walks to the spot.
import { z } from 'zod/v4';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
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
    /**
     * Requirement tokens the plan knows the account meets that its state does not show (the walk's `met`, lib/account.ts):
     * `quest:priestperil>=4` lets the walk plan through the Priest in Peril temple door, `quest:runemysteries` through
     * the Rune Mysteries teleport. Absent: the walk plans only through ways that ask nothing the state cannot show.
     */
    met: z.array(z.string()).optional(),
});
export type At = z.infer<typeof AtSchema>;

/**
 * One exact tile: picks the loc (or NPC) standing on it instead of the nearest one of that name. `level`
 * applies to locs only: an NPC reports no level, so it is matched on x and z.
 */
export const TileSchema = z.object({ x: z.number().int(), z: z.number().int(), level: z.number().int().optional() });
export type Tile = z.infer<typeof TileSchema>;

/** A thing at (x, z) stands on `tile`; the level counts only when the tile gives one and the thing knows its own. */
export const onTile = (thing: { x: number; z: number; level?: number }, tile: Tile): boolean =>
    thing.x === tile.x &&
    thing.z === tile.z &&
    (tile.level === undefined || (thing.level ?? tile.level) === tile.level);

/** An inventory item to use: a name regex, or `{ id }` for one exact item (three buckets of water share a name). */
export const ItemSpec = z.union([Pattern, z.object({ id: z.number().int() })]);
export type ItemSpec = z.infer<typeof ItemSpec>;

export const itemMatches = (spec: ItemSpec, item: InventoryItem): boolean =>
    typeof spec === 'string' ? matcher(spec).test(item.name) : item.id === spec.id;

/** How a spec reads in a message: the regex, or `#id`. */
export const itemLabel = (spec: ItemSpec): string => (typeof spec === 'string' ? `/${spec}/` : `#${spec.id}`);

/** The message for an inventory with no item matching `spec`, to use on `on`. */
export const missingItem = (spec: ItemSpec, on: string): string =>
    `no item matching ${itemLabel(spec)} in the inventory to use on ${on}`;

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
            const r = yield* walkTo(ctx, at.x, at.z, at.tolerance, {
                ...(at.level === undefined ? {} : { level: at.level }),
                ...(at.met ? { met: at.met } : {}),
            });
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
