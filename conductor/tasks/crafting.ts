import { z } from 'zod/v4';
import { shortestNameMatch } from '../../sdk/action-quantity';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import {
    CLAY,
    FIRE_WAIT_TICKS,
    fire,
    POTTERY,
    POTTERY_PRODUCTS,
    type PotteryProduct,
    SHAPE_CLOSE_TICKS,
    SHAPE_MAKE_TICKS,
    SHAPE_MENU_TICKS,
    shape,
    SOFT_CLAY,
    soften,
    SOFTEN_WAIT_TICKS,
    unfiredOf,
    WATER_SOURCE,
} from '../actions/pottery';
import { WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, type Op, type Outcome, wait } from '../core/op';
import { AreaSchema, refuseArea, returnToAreaStep, WALK_TO_AREA_SILENT_TICKS } from '../lib/area';
import { UNDER_ATTACK_NOTE, underAttackGuard } from '../lib/interrupts';
import { failStreak, type ReasonStreak } from '../lib/streak';
import { defineTask, stepBudgetTicks, type TaskContext } from '../lib/task';
import { countItems, findSkill } from '../lib/util';

const WHEEL = /potter'?s wheel/i;
const OVEN = /pottery oven/i;
export const FAIL_LIMIT = 4;
/** Within this many tiles of the wheel or oven the client's own pathing reaches it; further, the task walks first. */
const STATION_REACH = 2;
const STEP_TIMEOUT_MS = 90_000;
/** Ticks a missing station is waited for before the miss counts as a failure (the loc list can lose it for a tick). */
export const STATION_WAIT_TICKS = 3;
const CLOSE_MAX_TICKS = SHAPE_CLOSE_TICKS + 1;
/** The longest shape op: a stale menu closed, the menu wait, the make wait, and the close on a bailout (a bailout never waits for the make, so this over-counts). */
export const SHAPE_MAX_TICKS = 2 * CLOSE_MAX_TICKS + SHAPE_MENU_TICKS + SHAPE_MAKE_TICKS;
/** The longest op after a walk to a station: what the walk leaves of the step (its reserveTicks). */
export const OP_MAX_TICKS = Math.max(SHAPE_MAX_TICKS, FIRE_WAIT_TICKS, SOFTEN_WAIT_TICKS);
/** The longest walk to a station: walkTo caps itself to the step's budget less OP_MAX_TICKS. */
export const STATION_WALK_TICKS = Math.min(WALK_MAX_TICKS, stepBudgetTicks(STEP_TIMEOUT_MS) - OP_MAX_TICKS);
/** The longest attempt that changes nothing the watchdog sees: a walk that never moves the bot, then the op. */
export const ATTEMPT_SILENT_TICKS = STATION_WALK_TICKS + OP_MAX_TICKS;
const streakOf = (name: string) => failStreak({ name, limit: FAIL_LIMIT, worstTicks: ATTEMPT_SILENT_TICKS });
const SHAPE_FAILS = streakOf('shapeFails');
const FIRE_FAILS = streakOf('fireFails');
const SOFTEN_FAILS = failStreak({
    name: 'softenFails',
    limit: FAIL_LIMIT,
    worstTicks: ATTEMPT_SILENT_TICKS,
    what: 'softens',
});
const SILENT = [SHAPE_FAILS, FIRE_FAILS, SOFTEN_FAILS, WALK_TO_AREA_SILENT_TICKS];

const Params = z.object({
    product: z
        .enum(POTTERY_PRODUCTS)
        .default('pot')
        .describe(
            `The pottery item to shape, with the base Crafting level it needs: ${POTTERY_PRODUCTS.map(p => `"${p}" ${POTTERY[p].level}`).join(', ')}.`,
        ),
    fire: z
        .boolean()
        .default(true)
        .describe(
            'Also fire the unfired product in a pottery oven (more XP, no level needed; the product sometimes cracks); false stops at the unfired item.',
        ),
    area: AreaSchema.optional().describe(
        'Centre it on the wheel and oven: the bot stays near them and walks back when further than `radius`. Omit to work where it stands.',
    ),
});

type CraftParams = z.infer<typeof Params>;
type Ctx = TaskContext<CraftParams>;

const craftingLevel = (s: BotWorldState) => findSkill(s, 'Crafting')?.baseLevel ?? 0;

/** Clay the inventory can still soften: as many as there are clays and water containers. */
const softenable = (s: BotWorldState) => Math.min(countItems(s, CLAY), countItems(s, WATER_SOURCE));
const softClay = (s: BotWorldState) => countItems(s, SOFT_CLAY);
/** Items to shape: the soft clay held and what the clay and water can still make. */
const toShape = (s: BotWorldState) => softClay(s) + softenable(s);
const toFire = (ctx: Ctx, product: PotteryProduct) =>
    ctx.params.fire ? countItems(ctx.state(), unfiredOf(product)) : 0;

/** The nearest reachable station matching `name`, or null. */
function findStation(state: BotWorldState, name: RegExp): NearbyLoc | null {
    const match = shortestNameMatch(state.nearbyLocs, name);
    return match && match.reachable !== false ? match : null;
}

/** Walks within STATION_REACH of a station further away, leaving the step room for the op after it; the failure message, or null. */
function* walkToStation(ctx: Ctx, station: NearbyLoc): Op<string | null> {
    if (ctx.distanceTo(station.x, station.z) <= STATION_REACH) return null;
    const w = yield* walkTo(ctx, station.x, station.z, STATION_REACH, { reserveTicks: OP_MAX_TICKS });
    return w.ok ? null : w.message;
}

interface StationWork {
    /** The verb the log line uses ("shape failed"). */
    verb: string;
    fails: ReasonStreak;
    /** "shapes" or "firings", for the failure after FAIL_LIMIT in a row. */
    plural: string;
    station: RegExp;
    /** What the station is called in a failure ("potter's wheel"); the last word ("wheel") names it in short. */
    noun: string;
    op: (station: NearbyLoc) => Op<{ ok: true } | { ok: false; reason: string; message: string }>;
    /** Reasons not worth retrying: the run fails with the op's message. */
    fatal: readonly string[];
}

/** One attempt at a station step: find the station, walk up to it, run its op; FAIL_LIMIT failures in a row end the run. */
function* workAtStation(ctx: Ctx, w: StationWork): Op<Outcome> {
    const short = w.noun.split(' ').at(-1) ?? w.noun;
    const seen = yield* wait('station in view', st => findStation(st, w.station) !== null, STATION_WAIT_TICKS);
    const station = findStation(seen.state, w.station);
    if (!station) {
        return w.fails.missWith(ctx, `no reachable ${w.noun} nearby (pass \`area\` at the ${short})`);
    }
    const walkFailed = yield* walkToStation(ctx, station);
    if (walkFailed) {
        yield* log(`walk to the ${short} failed: ${walkFailed}`);
        return w.fails.missWith(ctx, `can't reach the ${short} (${walkFailed})`);
    }
    const r = yield* w.op(station);
    if (r.ok) {
        w.fails.clear(ctx);
        return;
    }
    yield* log(`${w.verb} failed: ${r.message}`, { reason: r.reason });
    if (w.fatal.includes(r.reason)) return { fail: r.message };
    return w.fails.missWith(ctx, `${FAIL_LIMIT} ${w.plural} in a row failed (last: ${r.message})`);
}

export default defineTask({
    name: 'crafting',
    description:
        "Shapes soft clay into `product` on a potter's wheel, one by one. " +
        'Any clay with a bucket, jug or bowl of water is first softened, and with `fire` the unfired products are fired in a pottery oven. ' +
        'Stops when no soft clay, softenable clay or unfired product is left. ' +
        `${UNDER_ATTACK_NOTE} ` +
        'Does not use the spinning wheel, leather or gems.',
    rules: [
        'Needs the Crafting level for the product and the wheel within reach, but only when something is left to shape (soft clay, or clay with water); to fire, it needs the oven within reach. With `area` it walks there when far away; without it the wheel and oven must already be reachable nearby, or it refuses.',
        'Each soften uses up one filled water container (bucket, jug or bowl of water), so bring one per clay.',
        'Refuses when there is nothing to craft: no soft clay, no clay with water and, with `fire`, no unfired product.',
    ],
    spots: [
        'Barbarian Village wheels (3087,3409) and oven (3084,3407), ground floor, no gate.',
        'Clay is mined at the Varrock south-east mine (3180,3372) and at Rimmington (2986,3239); water comes from a well or fountain, and a bucket from the Lumbridge General Store for 2 gp.',
    ],
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    silent: SILENT,
    guards: [underAttackGuard],

    preflight(ctx) {
        const s = ctx.state();
        const product = ctx.params.product;
        const shaping = toShape(s);
        const firing = toFire(ctx, product);
        if (shaping + firing === 0) {
            return ctx.params.fire
                ? `nothing to craft: no soft clay, no clay with a bucket/jug/bowl of water, no ${POTTERY[product].unfired}`
                : 'nothing to craft: no soft clay, and no clay with a bucket/jug/bowl of water';
        }
        const level = craftingLevel(s);
        if (shaping > 0 && level < POTTERY[product].level)
            return `${product} needs crafting ${POTTERY[product].level}, bot has ${level}`;
        if (ctx.params.area) return refuseArea(ctx.params.area);
        // Without an area the task works where the bot stands: soften spends the water, so check the stations first.
        if (shaping > 0 && !findStation(s, WHEEL))
            return "no reachable potter's wheel nearby (pass `area` at the wheel)";
        if (ctx.params.fire && !findStation(s, OVEN))
            return 'no reachable pottery oven nearby (pass `area` at the oven)';
        return null;
    },

    steps: [
        {
            name: 'finish',
            when: ctx => toShape(ctx.state()) + toFire(ctx, ctx.params.product) === 0,
            *run(ctx) {
                const left = countItems(ctx.state(), CLAY);
                if (left === 0) return { done: 'nothing left to craft' };
                // The RESULT line has no data field: the count is in the message and the run log.
                yield* log(`${left} clay left over`, { leftoverClay: left });
                return { done: `nothing left to craft; ${left} clay left, no water to soften it` };
            },
        },
        returnToAreaStep<CraftParams>(params => params.area),
        {
            name: 'soften',
            when: ctx => softenable(ctx.state()) > 0,
            *run(ctx) {
                const r = yield* soften(ctx);
                if (r.ok) {
                    SOFTEN_FAILS.clear(ctx);
                    return;
                }
                yield* log(`soften failed: ${r.message}`);
                return SOFTEN_FAILS.miss(ctx, r.message);
            },
        },
        {
            name: 'shape',
            when: ctx => softClay(ctx.state()) > 0,
            run: ctx =>
                workAtStation(ctx, {
                    verb: 'shape',
                    fails: SHAPE_FAILS,
                    plural: 'shapes',
                    station: WHEEL,
                    noun: "potter's wheel",
                    op: wheel => shape(ctx, wheel, ctx.params.product),
                    // The level, the wheel's owner and the menu's products will not change by retrying.
                    fatal: ['level-too-low', 'not-allowed', 'no-product'],
                }),
        },
        {
            name: 'fire',
            when: ctx => toFire(ctx, ctx.params.product) > 0,
            run: ctx =>
                workAtStation(ctx, {
                    verb: 'fire',
                    fails: FIRE_FAILS,
                    plural: 'firings',
                    station: OVEN,
                    noun: 'pottery oven',
                    op: oven => fire(ctx, unfiredOf(ctx.params.product), oven),
                    fatal: ['not-allowed'],
                }),
        },
    ],
});
