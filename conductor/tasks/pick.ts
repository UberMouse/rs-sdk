import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { PICK_OPTION, PICK_WAIT_TICKS, pick } from '../actions/pick';
import { log, type Op, wait } from '../core/op';
import { WALK_MAX_TICKS } from '../actions/walk';
import { areaWatchReport, type AreaWatch, newAreaWatch, outsideSighting, trackIdle } from '../lib/area-watch';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT } from '../lib/area';
import { underAttackGuard } from '../lib/interrupts';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { countItems, exactName, TICK_MS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/** Ticks with no pickable loc at all before failing (40 s); above flax's 10-tick respawn (pickables.rs2 loc_del(10)). */
const NO_LOC_GIVE_UP_TICKS = 100;
/** Consecutive failed picks (timeouts, refused sends) before the task fails. */
const PICK_FAIL_LIMIT = 8;
/** Consecutive picks that ended with the plant gone and nothing gained (another picker, a click that never ran). */
const GONE_FAIL_LIMIT = 20;
/**
 * Nothing changes while a pick times out, so the watchdog must outlast PICK_FAIL_LIMIT timeouts in a row
 * for the task to report them; the no-loc wait and the walks back to the area are the other silences.
 */
export const SILENT_STREAK_TICKS = [
    failStreakTicks(PICK_FAIL_LIMIT, PICK_WAIT_TICKS),
    failStreakTicks(GONE_FAIL_LIMIT, PICK_WAIT_TICKS),
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
    NO_LOC_GIVE_UP_TICKS,
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
/** The longest legitimate step is a walk back to a far area; the engine default (120s) can be shorter. */
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    /** The pickable loc's exact name as the game shows it (case-insensitive), e.g. "Flax". */
    loc: z.string().min(1),
    /** The exact name of the item one pick gives, e.g. "Flax". */
    item: z.string().min(1),
    /** Stop `done` once the inventory holds this many of `item`. Omit to pick until the inventory is full. */
    count: z.number().int().positive().max(28).optional(),
    /** Stay near here; walk back when further than `radius`. Omit to pick wherever the bot is. */
    area: AreaSchema.optional(),
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
    const seconds = Math.round(((respawn.state.tick - since) * TICK_MS) / 1000);
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
        'Pick a pickable loc (the "Pick" option: flax, and the game\'s other crops) one by one until the inventory holds `count` ' +
        'of `item`, or is full when `count` is omitted; then it ends done ("picked N" / "inventory full: N"). ' +
        '`loc` and `item` are exact names ("Flax"/"Flax"). One click gives one item (about 3 ticks with the step to the next plant); ' +
        'a plant sometimes vanishes for a few ticks after a pick, and the task waits up to 40 s for a respawn, then fails "area depleted". ' +
        'With `area` it stays within `radius` of that centre, otherwise it picks wherever the bot stands. ' +
        "Pauses while attacked (auto-retaliate must finish the fight). Verified: Seers' Village flax field, " +
        'area {x:2743,z:3445,radius:10} (the field spans x 2732-2755, z 3433-3456). Needs nothing carried. ' +
        'Refuses areas reaching the Wilderness.',
    params: Params,
    diagnostics: ctx => areaWatchReport(ctx.memory.areaWatch, ctx.params.area),
    memory: (): PickMemory => ({ noLocSinceTick: null, areaWatch: newAreaWatch() }),
    // Interacting with a loc cancels auto-retaliate, so a bot under attack must not touch one.
    guards: [underAttackGuard],
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

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
                const fails = ctx.streak('pickFails');
                const gone = ctx.streak('goneFails');
                if (picked.ok) {
                    fails.reset();
                    gone.reset();
                    return;
                }
                if (picked.reason === 'gone') {
                    fails.reset();
                    if (gone.add() >= GONE_FAIL_LIMIT)
                        return { fail: `${GONE_FAIL_LIMIT} plants in a row vanished before they were picked` };
                    return;
                }
                gone.reset();
                yield* log(`pick failed: ${picked.message}`);
                if (fails.add() >= PICK_FAIL_LIMIT)
                    return { fail: `${PICK_FAIL_LIMIT} picks in a row failed (last: ${picked.message})` };
            },
        },
    ],
});
