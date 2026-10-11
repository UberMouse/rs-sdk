import { z } from 'zod/v4';
import type { BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { FILL_WAIT_TICKS, fillContainer } from '../actions/fill';
import { log } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep } from '../lib/area';
import { underAttackGuard } from '../lib/interrupts';
import { defineTask, stepBudgetTicks, type TaskContext } from '../lib/task';
import { countItems } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

// server/content/scripts/general_use/scripts/water_sources.rs2: one use fills one container. A Fountain or
// Sink fills a bucket, jug, bowl or vial; a Well (and the desert well) only a bucket.
const Containers = z.enum(['Bucket', 'Jug', 'Bowl', 'Vial']);
type Container = z.infer<typeof Containers>;

const CONTAINERS: Record<Container, { empty: RegExp; full: RegExp; wells: boolean }> = {
    Bucket: { empty: /^bucket$/i, full: /^bucket of water$/i, wells: true },
    Jug: { empty: /^jug$/i, full: /^jug of water$/i, wells: false },
    Bowl: { empty: /^bowl$/i, full: /^bowl of water$/i, wells: false },
    Vial: { empty: /^vial$/i, full: /^vial of water$/i, wells: false },
};

const TAP_SOURCE = /^(fountain|sink)$/i;
const WELL_SOURCE = /^well$/i;

export const FAIL_LIMIT = 4;
/** Within this many tiles the client's own pathing reaches the source; further, the task walks first. */
const SOURCE_REACH = 2;
const STEP_TIMEOUT_MS = 90_000;
/** The longest walk to the source: walkTo caps itself to the step's budget less the fill after it. */
export const SOURCE_WALK_TICKS = Math.min(WALK_MAX_TICKS, stepBudgetTicks(STEP_TIMEOUT_MS) - FILL_WAIT_TICKS);
/** The longest attempt that changes nothing the watchdog sees: a walk that never moves the bot, then the fill. */
export const ATTEMPT_SILENT_TICKS = SOURCE_WALK_TICKS + FILL_WAIT_TICKS;
const STUCK_AFTER_MS = stuckWindowMs(failStreakTicks(FAIL_LIMIT, ATTEMPT_SILENT_TICKS));

const Params = z.object({
    /** What to fill: "Bucket", "Jug", "Bowl" or "Vial". */
    container: Containers.default('Bucket'),
    /** Stay near the water source; walk there when far away. Omit to use one already in view. */
    area: AreaSchema.optional(),
});

type FillParams = z.infer<typeof Params>;

interface FillMemory {
    /** Sources (`id@x,z`) that answered "nothing interesting happens": quest decoys named Fountain or Well. */
    skipped: string[];
}
type Ctx = TaskContext<FillParams, FillMemory>;
const sourceKey = (l: NearbyLoc) => `${l.id}@${l.x},${l.z}`;

const emptyOf = (s: BotWorldState, container: Container): InventoryItem | undefined =>
    s.inventory.find(i => CONTAINERS[container].empty.test(i.name));

/** Predicate for a water source this container can be filled from: a reachable Fountain/Sink (or a Well for buckets) inside the area. */
function usable(params: FillParams, skipped: string[]): (loc: NearbyLoc) => boolean {
    const { wells } = CONTAINERS[params.container];
    return l =>
        (TAP_SOURCE.test(l.name) || (wells && WELL_SOURCE.test(l.name))) &&
        l.reachable !== false &&
        !skipped.includes(sourceKey(l)) &&
        inArea(params.area, l);
}

export default defineTask({
    name: 'fill',
    description:
        'Fills every empty `container` ("Bucket" default, "Jug", "Bowl" or "Vial") in the inventory with water, one use at a time, ' +
        'at a Fountain, Sink or (buckets only) Well in view; done when no empty one is left. `area` walks to the source first ' +
        'and keeps to it. Feeds the crafting task, which softens clay with a bucket, jug or bowl of water (one per clay). ' +
        "Known sources by the Barbarian Village potter's wheel (3087,3409): none in the village; " +
        'nearest are the Falador park fountain (3038,3353), the Varrock sink (3146,3451) and the Varrock fountains (3190,3468); ' +
        'in Lumbridge the castle fountain (3221,3210) and sink (3205,3215), well (3142,3208).',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,
    memory: (): FillMemory => ({ skipped: [] }),
    guards: [underAttackGuard],

    preflight(ctx) {
        const { container, area } = ctx.params;
        if (!emptyOf(ctx.state(), container)) return `no empty ${container} in inventory`;
        return refuseArea(area);
    },

    steps: [
        {
            name: 'finish',
            when: ctx => !emptyOf(ctx.state(), ctx.params.container),
            run(ctx) {
                const { full } = CONTAINERS[ctx.params.container];
                return { done: `no empty ${ctx.params.container} left; ${countItems(ctx.state(), full)} full` };
            },
        },
        returnToAreaStep<FillParams>(params => params.area),
        {
            name: 'fill',
            when: () => true,
            *run(ctx: Ctx) {
                const fails = ctx.streak('fillFails');
                const failed = (message: string) =>
                    fails.add() >= FAIL_LIMIT
                        ? { fail: `${FAIL_LIMIT} fills in a row failed (last: ${message})` }
                        : undefined;
                const container = emptyOf(ctx.state(), ctx.params.container);
                if (!container) return;
                const source = ctx
                    .state()
                    .nearbyLocs.filter(usable(ctx.params, ctx.memory.skipped))
                    .sort((a, b) => a.distance - b.distance)[0];
                if (!source) {
                    yield* log(`no water source in view for a ${ctx.params.container}`);
                    return failed('no water source in view (pass `area` at one)');
                }
                if (ctx.distanceTo(source.x, source.z) > SOURCE_REACH) {
                    const w = yield* walkTo(ctx, source.x, source.z, SOURCE_REACH, { reserveTicks: FILL_WAIT_TICKS });
                    if (!w.ok) {
                        yield* log(`walk to the ${source.name} failed: ${w.message}`);
                        return failed(w.message);
                    }
                }
                const r = yield* fillContainer(ctx, container, source);
                if (r.ok) {
                    fails.reset();
                    return;
                }
                yield* log(`fill failed: ${r.message}`, { reason: r.reason });
                if (r.reason === 'nothing-happened') {
                    ctx.memory.skipped.push(sourceKey(source));
                    yield* log(`skipping the ${source.name} at ${source.x},${source.z}: not a water source`);
                }
                return failed(r.message);
            },
        },
    ],
});
