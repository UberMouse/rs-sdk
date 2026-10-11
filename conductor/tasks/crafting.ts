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
import { AreaSchema, refuseArea, returnToAreaStep } from '../lib/area';
import { underAttackGuard } from '../lib/interrupts';
import { defineTask, stepBudgetTicks, type TaskContext } from '../lib/task';
import { countItems, findSkill } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

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
const STUCK_AFTER_MS = stuckWindowMs(failStreakTicks(FAIL_LIMIT, ATTEMPT_SILENT_TICKS));

const Params = z.object({
    /** Pottery product: "pot", "pie dish" or "bowl". */
    product: z.enum(POTTERY_PRODUCTS).default('pot'),
    /** Also fire the unfired product in a pottery oven (more XP, no level needed); false stops at the unfired item. */
    fire: z.boolean().default(true),
    /** Stay near the wheel and oven; walk back when further than `radius`. */
    area: AreaSchema.optional(),
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
    /** The verb the log line uses ("shape failed"); the streak is `<verb>Fails`. */
    verb: string;
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
    const fails = ctx.streak(`${w.verb}Fails`);
    const short = w.noun.split(' ').at(-1) ?? w.noun;
    const seen = yield* wait('station in view', st => findStation(st, w.station) !== null, STATION_WAIT_TICKS);
    const station = findStation(seen.state, w.station);
    if (!station) {
        return fails.add() >= FAIL_LIMIT
            ? { fail: `no reachable ${w.noun} nearby (pass \`area\` at the ${short})` }
            : undefined;
    }
    const walkFailed = yield* walkToStation(ctx, station);
    if (walkFailed) {
        yield* log(`walk to the ${short} failed: ${walkFailed}`);
        return fails.add() >= FAIL_LIMIT ? { fail: `can't reach the ${short} (${walkFailed})` } : undefined;
    }
    const r = yield* w.op(station);
    if (r.ok) {
        fails.reset();
        return;
    }
    yield* log(`${w.verb} failed: ${r.message}`, { reason: r.reason });
    if (w.fatal.includes(r.reason)) return { fail: r.message };
    if (fails.add() >= FAIL_LIMIT) return { fail: `${FAIL_LIMIT} ${w.plural} in a row failed (last: ${r.message})` };
}

export default defineTask({
    name: 'crafting',
    description:
        'Crafting by pottery. Works the inventory down: soft clay is shaped on a potter\'s wheel into `product` ("pot" level 1, ' +
        '"pie dish" level 7, "bowl" level 8) one by one, any clay with a bucket, jug or bowl of water is first softened, ' +
        'and with `fire` (default true) the unfired products are fired in a pottery oven (cracks sometimes). ' +
        'Stops when no soft clay, softenable clay or unfired product is left. Needs the Crafting level for the product ' +
        'and the wheel (and, to fire, the oven) within reach: `area` centres on them and it walks there when far away. ' +
        'Known spot: Barbarian Village wheels (3087,3409) and oven (3084,3407), ground floor, no gate. ' +
        'Materials come from elsewhere: clay is mined (Varrock south-east mine (3180,3372), Rimmington (2986,3239)), ' +
        'water from a well or fountain (bucket from the Lumbridge General Store, 2 gp). Each soften uses up one ' +
        'filled container, so bring one per clay. Does not use the spinning wheel, leather or gems.',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,
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
                const fails = ctx.streak('softenFails');
                const r = yield* soften(ctx);
                if (r.ok) {
                    fails.reset();
                    return;
                }
                yield* log(`soften failed: ${r.message}`);
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} softens in a row failed (last: ${r.message})` };
            },
        },
        {
            name: 'shape',
            when: ctx => softClay(ctx.state()) > 0,
            run: ctx =>
                workAtStation(ctx, {
                    verb: 'shape',
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
                    plural: 'firings',
                    station: OVEN,
                    noun: 'pottery oven',
                    op: oven => fire(ctx, unfiredOf(ctx.params.product), oven),
                    fatal: ['not-allowed'],
                }),
        },
    ],
});
