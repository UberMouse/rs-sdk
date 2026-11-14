import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { PICK_OPTION, PICK_WAIT_TICKS, pick } from '../actions/pick';
import { log, type Op, wait } from '../core/op';
import { areaWatchReport, type AreaWatch, newAreaWatch, outsideSighting, trackIdle } from '../lib/area-watch';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_TO_AREA_SILENT_TICKS } from '../lib/area';
import { UNDER_ATTACK_NOTE, underAttackGuard } from '../lib/interrupts';
import { failStreak } from '../lib/streak';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { countItems, exactName, ticksToSeconds } from '../lib/util';

/** Ticks with no pickable loc at all before failing (40 s); above flax's 10-tick respawn (pickables.rs2 loc_del(10)). */
const NO_LOC_GIVE_UP_TICKS = 100;
/** Consecutive failed picks (timeouts, refused sends) before the task fails. */
const PICK_FAIL_LIMIT = 8;
/** Consecutive picks that ended with the plant gone and nothing gained (another picker, a click that never ran). */
const GONE_FAIL_LIMIT = 20;
// Nothing changes while a pick times out: PICK_WAIT_TICKS each.
const PICK_FAILS = failStreak({
    name: 'pickFails',
    limit: PICK_FAIL_LIMIT,
    worstTicks: PICK_WAIT_TICKS,
    what: 'picks',
});
// A pick that ends with the plant gone waited at most PICK_WAIT_TICKS.
const GONE_FAILS = failStreak({
    name: 'goneFails',
    limit: GONE_FAIL_LIMIT,
    worstTicks: PICK_WAIT_TICKS,
});
/** The watchdog outlasts the fail streaks, the no-loc wait and the walks back to the area. */
const SILENT = [PICK_FAILS, GONE_FAILS, WALK_TO_AREA_SILENT_TICKS, NO_LOC_GIVE_UP_TICKS];
/** The longest legitimate step is a walk back to a far area; the engine default (120s) can be shorter. */
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    loc: z
        .string()
        .min(1)
        .describe(
            'The pickable loc to pick, by its whole name as the game shows it, compared case-insensitively, e.g. "Flax".',
        ),
    item: z
        .string()
        .min(1)
        .describe(
            'The item one pick gives, by its whole name compared case-insensitively, e.g. "Flax". Counted in the inventory.',
        ),
    count: z
        .number()
        .int()
        .positive()
        .max(28)
        .optional()
        .describe(
            'Stop done once the inventory holds this many of `item`, counting any held before the run. It fails if the inventory fills first. Omitted, it picks until the inventory is full. One click gives one item, about 3 ticks with the step to the next plant.',
        ),
    area: AreaSchema.optional().describe(
        'Where to pick: only plants inside it are picked, and the bot walks back when further than `radius`. Without it the bot picks wherever it stands.',
    ),
});

type PickParams = z.infer<typeof Params>;
interface PickMemory {
    /** The tick the bot first found nothing to pick, until it finds something again. */
    noLocSinceTick: number | null;
    /** Idle ticks and the ones with a plant in view outside the area (diagnostic, lib/area-watch.ts). */
    areaWatch: AreaWatch;
}
type Ctx = TaskContext<PickParams, PickMemory>;

const held = (ctx: Ctx) => countItems(ctx.state(), exactName(ctx.params.item));

/** A loc of the task's kind the bot can pick now, inside the area when there is one. */
function pickable(params: PickParams): (loc: NearbyLoc) => boolean {
    const isPlant = plantOfKind(params);
    return l => isPlant(l) && inArea(params.area, l);
}

/** A loc of the task's kind the bot could pick, wherever it stands. */
function plantOfKind(params: PickParams): (loc: NearbyLoc) => boolean {
    const name = exactName(params.loc);
    return l => name.test(l.name) && l.reachable === true && l.options.some(o => PICK_OPTION.test(o));
}

/** Nothing to pick: stay put (returnToAreaStep keeps us inside) and wait for a respawn, failing after NO_LOC_GIVE_UP_TICKS. */
function* waitForRespawn(ctx: Ctx): Op<Outcome> {
    const now = ctx.state().tick;
    if (ctx.memory.noLocSinceTick === null) {
        ctx.memory.noLocSinceTick = now;
        yield* log(`no ${ctx.params.loc} to pick, waiting for a respawn`);
    }
    const since = ctx.memory.noLocSinceTick;
    const isPickable = pickable(ctx.params);
    const seen = (s: BotWorldState) => outsideSighting(s, ctx.params.area, s.nearbyLocs, plantOfKind(ctx.params));
    const respawn = yield* trackIdle(
        ctx,
        ctx.memory.areaWatch,
        seen,
        wait('respawn', s => s.nearbyLocs.some(isPickable), Math.max(0, since + NO_LOC_GIVE_UP_TICKS - now)),
    );
    if (respawn.kind === 'met') return;
    const seconds = ticksToSeconds(respawn.state.tick - since);
    const { area } = ctx.params;
    return {
        fail: area
            ? `area depleted: no reachable ${ctx.params.loc} in radius ${area.radius} for ${seconds}s`
            : `no reachable ${ctx.params.loc} nearby for ${seconds}s`,
    };
}

export default defineTask({
    name: 'pick',
    description:
        'Picks items from scenery objects with a "Pick" option, such as flax plants. ' +
        'It picks until the inventory holds `count` of `item`, or is full when `count` is omitted, then ends done ("picked N" / "inventory full: N"); needs nothing carried. ' +
        `A plant may vanish briefly after a pick; the task waits up to ${ticksToSeconds(NO_LOC_GIVE_UP_TICKS)} s for a respawn, then fails "area depleted: no reachable <loc> in radius N for Ns" with \`area\`, "no reachable <loc> nearby for Ns" without. ` +
        UNDER_ATTACK_NOTE,
    rules: ['Refuses an `area` reaching the Wilderness.'],
    spots: [
        "Seers' Village flax field: `area` {x:2743,z:3445,radius:10} (the field spans x 2732-2755, z 3433-3456); verified.",
    ],
    params: Params,
    diagnostics: ctx => areaWatchReport(ctx.memory.areaWatch, ctx.params.area),
    memory: (): PickMemory => ({ noLocSinceTick: null, areaWatch: newAreaWatch() }),
    // Interacting with a loc cancels auto-retaliate, so a bot under attack must not touch one.
    guards: [underAttackGuard],
    stepTimeoutMs: STEP_TIMEOUT_MS,
    silent: SILENT,

    preflight: ctx => refuseArea(ctx.params.area),

    steps: [
        {
            name: 'finish',
            when: ctx => (ctx.params.count !== undefined ? held(ctx) >= ctx.params.count : ctx.inventoryFull()),
            run(ctx) {
                const n = held(ctx);
                if (ctx.params.count !== undefined) return { done: `picked ${n} ${ctx.params.item}` };
                return n === 0
                    ? { fail: `inventory full with no ${ctx.params.item}` }
                    : { done: `inventory full: ${n} ${ctx.params.item}` };
            },
        },
        {
            name: 'full-short',
            when: ctx => ctx.params.count !== undefined && ctx.inventoryFull(),
            run: ctx => ({ fail: `inventory full with ${held(ctx)} of ${ctx.params.count} ${ctx.params.item}` }),
        },
        returnToAreaStep<PickParams>(params => params.area),
        {
            name: 'pick',
            when: () => true,
            *run(ctx) {
                const loc = ctx
                    .state()
                    .nearbyLocs.filter(pickable(ctx.params))
                    .sort((x, y) => x.distance - y.distance)[0];
                if (!loc) return yield* waitForRespawn(ctx);
                ctx.memory.noLocSinceTick = null;
                const picked = yield* pick(ctx, loc, exactName(ctx.params.item));
                if (picked.ok) {
                    PICK_FAILS.clear(ctx);
                    GONE_FAILS.clear(ctx);
                    return;
                }
                if (picked.reason === 'gone') {
                    PICK_FAILS.clear(ctx);
                    return GONE_FAILS.missWith(
                        ctx,
                        `${GONE_FAIL_LIMIT} plants in a row vanished before they were picked`,
                    );
                }
                GONE_FAILS.clear(ctx);
                yield* log(`pick failed: ${picked.message}`);
                return PICK_FAILS.miss(ctx, picked.message);
            },
        },
    ],
});
