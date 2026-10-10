import { z } from 'zod/v4';
import type { NearbyLoc } from '../../sdk/types';
import { COOK_WAIT_TICKS, cook } from '../actions/cook';
import { drop } from '../actions/drop';
import { WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { type Op, log, scan } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT } from '../lib/area';
import { defineTask, stepBudgetTicks, type TaskContext } from '../lib/task';
import { countItems, exactName, findSkill } from '../lib/util';
import { isInWilderness } from '../lib/wilderness';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/**
 * Raw foods this task cooks (free-world ones), by lowercase item name: the Cooking level from
 * server/content/scripts/skill_cooking/configs/cooking_source/cooking_generic.dbrow (levelrequired).
 * The members-only foods (cod, mackerel, bass, shark, manta ray, sea turtle, lava eel, ugthanki meat) are left out:
 * the game refuses them on this world. A name missing here is refused in preflight.
 */
const FOOD_LEVELS: Record<string, number | undefined> = {
    'raw shrimps': 1,
    'raw anchovies': 1,
    'raw sardine': 1,
    'raw herring': 5,
    'raw trout': 15,
    'raw pike': 20,
    'raw salmon': 25,
    'raw tuna': 30,
    'raw lobster': 40,
    'raw swordfish': 45,
    'raw beef': 1,
    'raw chicken': 1,
    'raw rat meat': 1,
    'raw bear meat': 1,
};

/**
 * Loc names of usable cooking sources: Range (cooking_oven), Fire, Fireplace and Cooking pot
 * (cooking_fire). The castle kitchen's "Cooking range" is quest-gated (Cook's Assistant) and does not match.
 */
const SOURCE = /^(range|fire|fireplace|cooking pot)$/i;
/** What cooking the foods above leaves behind when it burns. */
const BURNT = /^burnt (fish|meat|chicken|lobster|swordfish)$/i;
/** Within this many tiles of the source the client's own pathing reaches it; further, the task walks first. */
const SOURCE_REACH = 2;
const COOK_FAIL_LIMIT = 4;
const STEP_TIMEOUT_MS = 120_000;
/** The longest walk to a source: walkTo caps itself to the step's budget less the cook that follows it. */
const SOURCE_WALK_TICKS = Math.min(WALK_MAX_TICKS, stepBudgetTicks(STEP_TIMEOUT_MS) - COOK_WAIT_TICKS);
/** The longest attempt the watchdog sees nothing change in: a walk that never moves the bot, then a cook that does nothing. */
const ATTEMPT_SILENT_TICKS = SOURCE_WALK_TICKS + COOK_WAIT_TICKS;
/** The watchdog outlasts the fail streaks, so the task's own reason surfaces and not `stuck`. */
export const SILENT_STREAK_TICKS = [
    failStreakTicks(COOK_FAIL_LIMIT, ATTEMPT_SILENT_TICKS),
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);

const Params = z.object({
    /** Exact item name of the raw food to cook, e.g. "Raw shrimps". Only this food is cooked. */
    food: z.string(),
    /** Cook at a source within `radius` of this centre; walk there when further. Omit to use one in sight of the bot. */
    area: AreaSchema.optional(),
    /** Drop the burnt food (fish, meat, chicken, lobster, swordfish) once nothing is left to cook. */
    dropBurnt: z.boolean().default(false),
});

type CookingParams = z.infer<typeof Params>;
type Ctx = TaskContext<CookingParams>;

const rawHeld = (ctx: Ctx) => countItems(ctx.state(), exactName(ctx.params.food));
const burntHeld = (ctx: Ctx) => countItems(ctx.state(), BURNT);

/** The nearest reachable cooking source (inside the area, if any) among `locs`. */
function usable(ctx: Ctx, locs: readonly NearbyLoc[]): NearbyLoc | null {
    const away = (l: NearbyLoc) => ctx.distanceTo(l.x, l.z);
    const candidates = locs.filter(
        l =>
            SOURCE.test(l.name) &&
            l.reachable !== false &&
            !isInWilderness(l.level, l.x, l.z) &&
            inArea(ctx.params.area, l),
    );
    return candidates.sort((a, b) => away(a) - away(b))[0] ?? null;
}

// Counter.add(0) reads the total without changing it.
const tally = (ctx: Ctx) => `${ctx.counter('cooked').add(0)} cooked, ${ctx.counter('burnt').add(0)} burnt`;

/** Walks to `source` if needed and cooks one item: null when it cooked, `{ fail }` when no retry can help, else `{ failure }` to count. */
function* cookOnce(ctx: Ctx, source: NearbyLoc): Op<{ fail: string } | { failure: string } | null> {
    if (ctx.distanceTo(source.x, source.z) > SOURCE_REACH) {
        const w = yield* walkTo(ctx, source.x, source.z, SOURCE_REACH, { reserveTicks: COOK_WAIT_TICKS });
        if (!w.ok) return { failure: `Cannot reach ${source.name}: ${w.message}` };
    }
    const r = yield* cook(ctx, exactName(ctx.params.food), source);
    if (r.ok) {
        ctx.counter(r.burnt ? 'burnt' : 'cooked').add();
        return null;
    }
    // Not cooked, whatever the game said, and retrying cannot change these.
    if (r.reason === 'level-too-low' || r.reason === 'members' || r.reason === 'cant-cook') return { fail: r.message };
    if (r.reason === 'not-allowed')
        return { fail: `${source.name} at (${source.x},${source.z}) is not usable: ${r.message}` };
    return { failure: r.message };
}

export default defineTask({
    name: 'cooking',
    description:
        'Cook one raw food type (`food`, exact item name: Raw shrimps, Raw anchovies, Raw sardine, Raw herring, Raw trout, Raw pike, ' +
        'Raw salmon, Raw tuna, Raw lobster, Raw swordfish, Raw beef, Raw chicken, Raw rat meat, Raw bear meat) on a Range, Fire, Fireplace ' +
        'or Cooking pot until none of it is left, then done. This game version has no cook-all menu: one item is cooked per use, about 3-4 ticks. ' +
        'Burnt food is normal at low levels and never a failure; the run reports "N cooked, M burnt" and `dropBurnt` drops the burnt food at the end. ' +
        'Refuses to start with none of the food, below its Cooking level, or for a members-only food. Fails when no reachable source is in sight (pass `area`). ' +
        'The quest-gated "Cooking range" in the Lumbridge castle kitchen is never used. ' +
        "Verified spot: the Range at (3230,3196), south of Bob's Brilliant Axes in Lumbridge: area {x:3230,z:3196,radius:6}; the Range is reachable only from its east side.",
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const s = ctx.state();
        if (rawHeld(ctx) === 0) return `no "${ctx.params.food}" in inventory`;
        const need = FOOD_LEVELS[ctx.params.food.toLowerCase()];
        if (need === undefined)
            return `unknown or members-only food "${ctx.params.food}" (known: ${Object.keys(FOOD_LEVELS).join(', ')})`;
        const skill = findSkill(s, 'Cooking');
        if (!skill) return 'no Cooking skill in state';
        if (skill.baseLevel < need) return `${ctx.params.food} needs cooking ${need}, bot has ${skill.baseLevel}`;
        return refuseArea(ctx.params.area);
    },

    steps: [
        {
            name: 'drop-burnt',
            when: ctx => ctx.params.dropBurnt && rawHeld(ctx) === 0 && burntHeld(ctx) > 0,
            *run(ctx) {
                const dropped = yield* drop(ctx, BURNT);
                if (!dropped.ok) return { fail: `could not drop the burnt food: ${dropped.message}` };
            },
        },
        {
            name: 'finish',
            when: ctx => rawHeld(ctx) === 0,
            run: ctx => ({ done: `no ${ctx.params.food} left: ${tally(ctx)}` }),
        },
        returnToAreaStep<CookingParams>(params => params.area),
        {
            name: 'cook',
            when: () => true,
            *run(ctx) {
                const fails = ctx.streak('cookFails');
                let source = usable(ctx, ctx.state().nearbyLocs);
                // Beyond what the state lists: the extended scan sees further.
                if (!source) source = usable(ctx, yield* scan());
                if (!source)
                    return {
                        fail: ctx.params.area
                            ? `no reachable Range, Fire, Fireplace or Cooking pot within ${ctx.params.area.radius} tiles of (${ctx.params.area.x},${ctx.params.area.z})`
                            : 'no reachable Range, Fire, Fireplace or Cooking pot in sight (pass `area`)',
                    };
                const r = yield* cookOnce(ctx, source);
                if (r === null) {
                    fails.reset();
                    return;
                }
                if ('fail' in r) return r;
                yield* log(`cook failed: ${r.failure}`);
                if (fails.add() >= COOK_FAIL_LIMIT)
                    return { fail: `${COOK_FAIL_LIMIT} cooks in a row failed (last: ${r.failure})` };
            },
        },
    ],
});
