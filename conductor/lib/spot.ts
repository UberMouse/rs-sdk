// Shared by the tasks that stand at a spot first and then work on what is there (talk, interact): the
// `at` param, the regex param type, and the step that walks to the spot.
import { z } from 'zod/v4';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log } from '../core/op';
import type { Step, TaskContext } from './task';
import { assertWindowCovers, failStreakTicks } from './watchdog';

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
/** How a `Pattern` is matched (by `matcher`), told wherever one is a param. */
export const PATTERN_NOTE =
    'A case-insensitive regex given as a string, matched anywhere in the text: "Sheep" also matches any longer text containing it, "^Sheep$" only "Sheep" itself.';
export const Pattern = z.string().refine(isPattern, 'not a valid regular expression').describe(PATTERN_NOTE);
export const matcher = (source: string) => new RegExp(source, 'i');

const describedAtUse = new WeakSet<z.ZodType>();
/** `Pattern` described at its use: `sentence` (what the param means), then PATTERN_NOTE. Same shape and checks.
 * Chaining a cloning method (`.min()`, `.refine()`, another `.describe()`) on the result loses the marker, and the
 * catalog guard then reports the field; wrap it only with `.optional()`, `.default()` or `z.array(...)`. */
export function patternParam(sentence: string): typeof Pattern {
    const schema = Pattern.describe(`${sentence} ${PATTERN_NOTE}`);
    describedAtUse.add(schema);
    return schema;
}
/** Whether `schema` was made by `patternParam`. */
export const isPatternParam = (schema: z.ZodType): boolean => describedAtUse.has(schema);

/** Whether `schema` carries Pattern's regex check: `Pattern` or a schema made from it. */
export const isPatternSchema = (schema: z.ZodType): boolean =>
    (schema.def as { checks?: { def?: { fn?: unknown } }[] }).checks?.some(c => c.def?.fn === isPattern) ?? false;

export const AtSchema = z
    .object({
        x: z.number().describe('Tile x of the spot.'),
        z: z.number().describe('Tile z of the spot.'),
        level: z
            .number()
            .int()
            .optional()
            .describe(
                "The spot's floor (0 for the surface). Omit to walk on the bot's own floor (floor 0 when the spot is across the surface/underground divide) and count any floor as there.",
            ),
        tolerance: z
            .number()
            .int()
            .min(0)
            .default(DEFAULT_TOLERANCE)
            .describe(
                'Tiles (Chebyshev) from `x`, `z` that count as there; 0 is that exact tile (a loc used from one side only, behind a wall from the next tile).',
            ),
        met: z
            .array(z.string())
            .optional()
            .describe(
                "Requirement tokens the plan knows the account meets that its state does not show (the walk's `met`, lib/account.ts): `quest:priestperil>=4` lets the walk plan through the Priest in Peril temple door, `quest:runemysteries` through the Rune Mysteries teleport. Absent: the walk plans only through ways that ask nothing the state cannot show.",
            ),
    })
    .describe('Where to stand first: walked to (across floors, through doors) unless already within `tolerance`.');
export type At = z.infer<typeof AtSchema>;

export const TileSchema = z
    .object({
        x: z.number().int().describe('Tile x.'),
        z: z.number().int().describe('Tile z.'),
        level: z
            .number()
            .int()
            .optional()
            .describe('The floor; applies to locs only: an NPC reports no level, so it is matched on x and z.'),
    })
    .describe('One exact tile: picks the loc (or NPC) standing on it instead of the nearest one of that name.');
export type Tile = z.infer<typeof TileSchema>;

/** A thing at (x, z) stands on `tile`; the level counts only when the tile gives one and the thing knows its own. */
export const onTile = (thing: { x: number; z: number; level?: number }, tile: Tile): boolean =>
    thing.x === tile.x &&
    thing.z === tile.z &&
    (tile.level === undefined || (thing.level ?? tile.level) === tile.level);

export const ItemSpec = z
    .union([patternParam("The item's name."), z.object({ id: z.number().int().describe('The item id.') })])
    .describe(
        'An inventory item to use: a name, or `{ id }` for one exact item (three buckets of water share a name).',
    );
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

/** What walkToSpotStep(failLimit)'s failed walks can hold a task silent for: a task with `silent` using it lists it. */
export const walkToSpotSilentTicks = (failLimit: number): number => failStreakTicks(failLimit, WALK_MAX_TICKS);

/**
 * The step that walks to `params.at` until the bot stands there; `failLimit` walks in a row failing ends the run.
 * A task with `silent` lists walkToSpotSilentTicks(failLimit) in it, or the step throws.
 */
export function walkToSpotStep<P extends { at?: At }, M extends object>(failLimit: number): Step<P, M> {
    const here = (ctx: TaskContext<P, M>) => atSpot(ctx.params.at, ctx.state());
    return {
        name: 'walk',
        when: ctx => !!ctx.params.at && !!ctx.state().player && !ctx.state().dialog.isOpen && !here(ctx),
        *run(ctx) {
            assertWindowCovers(
                ctx,
                `the spot walk (walkToSpotSilentTicks(${failLimit}))`,
                walkToSpotSilentTicks(failLimit),
            );
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
