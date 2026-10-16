import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { shortestNameMatch } from '../../sdk/action-quantity';
import {
    SPIN_CLOSE_TICKS,
    SPIN_MENU_TICKS,
    SPIN_STALL_TICKS,
    SPIN_START_TICKS,
    SPINNABLES,
    spin,
} from '../actions/spin';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, wait } from '../core/op';
import { underAttackGuard } from '../lib/interrupts';
import { defineTask, stepBudgetTicks, type TaskContext } from '../lib/task';
import { countItems, findSkill, INVENTORY_SLOTS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness } from '../lib/wilderness';

const WHEEL = /^spinning wheel$/i;
export const FAIL_LIMIT = 4;
/** Within this many tiles of the wheel (on its floor) the client's own pathing reaches it; further, the task walks first. */
const STATION_REACH = 2;
/** Ticks a missing wheel is waited for before the miss counts as a failure (the loc list can lose it for a tick). */
export const STATION_WAIT_TICKS = 3;
const STEP_TIMEOUT_MS = 180_000;
/** The longest spin op: a stale menu closed, the menu wait, a whole inventory spun at 2 ticks each, a stall, and the close. */
export const SPIN_MAX_TICKS =
    2 * (SPIN_CLOSE_TICKS + 1) + SPIN_MENU_TICKS + SPIN_START_TICKS + INVENTORY_SLOTS * 2 + SPIN_STALL_TICKS;
/** The longest walk to the wheel: walkTo caps itself to the step's budget less SPIN_MAX_TICKS. */
export const WHEEL_WALK_TICKS = Math.min(WALK_MAX_TICKS, stepBudgetTicks(STEP_TIMEOUT_MS) - SPIN_MAX_TICKS);
/** The longest attempt that changes nothing the watchdog sees: a walk that never moves the bot, then the op. */
export const ATTEMPT_SILENT_TICKS = WHEEL_WALK_TICKS + SPIN_MAX_TICKS;
const STUCK_AFTER_MS = stuckWindowMs(failStreakTicks(FAIL_LIMIT, ATTEMPT_SILENT_TICKS));

const Params = z.object({
    /** What to spin: flax into bow strings (Crafting 10) or wool into balls of wool. */
    material: z.enum(['flax', 'wool']).default('flax'),
    /**
     * The wheel's tile and floor; the task walks there (by the floor's stairs or ladder, lib/connectors.ts).
     * Omit to use a wheel already in view. Seers' Village: {x:2711,z:3471,level:1}.
     */
    wheel: z.object({ x: z.number(), z: z.number(), level: z.number().int().min(0).default(0) }).optional(),
});

type SpinParams = z.infer<typeof Params>;
type Ctx = TaskContext<SpinParams>;

const material = (ctx: Ctx) => SPINNABLES[ctx.params.material];
const held = (ctx: Ctx) => countItems(ctx.state(), material(ctx).input);

/** The nearest reachable spinning wheel in view, or null. */
function findWheel(state: BotWorldState): NearbyLoc | null {
    const match = shortestNameMatch(state.nearbyLocs, WHEEL);
    return match && match.reachable !== false ? match : null;
}

/** Not within reach of the wheel's tile on its floor. */
function awayFromWheel(ctx: Ctx): boolean {
    const wheel = ctx.params.wheel;
    const player = ctx.state().player;
    if (!wheel || !player) return false;
    return player.level !== wheel.level || ctx.distanceTo(wheel.x, wheel.z) > STATION_REACH;
}

export default defineTask({
    name: 'spinning',
    description:
        'Spin flax into bow strings (or wool into balls of wool) at a spinning wheel: opens the wheel\'s menu, picks "Make X" and spins everything held in one go ' +
        '(about 2 ticks per item). Ends done when none is left. Needs Crafting 10 for flax (members world), the material in the inventory and a wheel: ' +
        '`wheel` gives its tile and floor and the task walks there, up the stairs or ladder if needed; omit it to use a wheel in view. ' +
        "Known wheel: Seers' Village {x:2711,z:3471,level:1} (ladder in the house at (2715,3470), door at (2716,3472); bank 25 tiles away). " +
        'Flax comes from the `pick` task; the strings go to a `bank` run.',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,
    guards: [underAttackGuard],

    preflight(ctx) {
        const s = ctx.state();
        const m = material(ctx);
        if (countItems(s, m.input) === 0) return `no ${ctx.params.material} in the inventory`;
        const level = findSkill(s, 'Crafting')?.baseLevel ?? 0;
        if (level < m.level) return `${ctx.params.material} needs crafting ${m.level}, bot has ${level}`;
        const w = ctx.params.wheel;
        if (w && squareReachesWilderness(w.x, w.z, STATION_REACH))
            return `wheel (${w.x},${w.z}) reaches the Wilderness`;
        if (!w && !findWheel(s)) return 'no reachable spinning wheel in view (pass `wheel`)';
        return null;
    },

    steps: [
        {
            name: 'finish',
            when: ctx => held(ctx) === 0,
            run: () => ({ done: 'nothing left to spin' }),
        },
        {
            name: 'walk-to-wheel',
            when: awayFromWheel,
            *run(ctx) {
                const wheel = ctx.params.wheel;
                if (!wheel) return;
                const fails = ctx.streak('walkFails');
                const before = ctx.distanceTo(wheel.x, wheel.z);
                const w = yield* walkTo(ctx, wheel.x, wheel.z, STATION_REACH, {
                    level: wheel.level,
                    reserveTicks: SPIN_MAX_TICKS,
                });
                if (w.ok) {
                    fails.reset();
                    return;
                }
                yield* log(`walk to the wheel failed: ${w.message}`);
                // A walk that ran out of ticks closer than it started is progress (a far wheel, a floor change).
                if (timedOutAdvancing(w, before, ctx.distanceTo(wheel.x, wheel.z))) return;
                if (fails.add() >= FAIL_LIMIT) return { fail: `can't reach the wheel (${w.message})` };
            },
        },
        {
            name: 'spin',
            when: () => true,
            *run(ctx) {
                const fails = ctx.streak('spinFails');
                const seen = yield* wait('wheel in view', st => findWheel(st) !== null, STATION_WAIT_TICKS);
                const wheel = findWheel(seen.state);
                if (!wheel) {
                    if (fails.add() >= FAIL_LIMIT) return { fail: 'no reachable spinning wheel nearby (pass `wheel`)' };
                    return;
                }
                const r = yield* spin(ctx, wheel, ctx.params.material);
                if (r.ok) {
                    fails.reset();
                    return;
                }
                yield* log(`spin failed: ${r.message}`, { reason: r.reason });
                // The level, the members world, the wheel's owner and the menu's products will not change by retrying.
                if (['level-too-low', 'members', 'not-allowed', 'no-product', 'no-material'].includes(r.reason))
                    return { fail: r.message };
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} spins in a row failed (last: ${r.message})` };
            },
        },
    ],
});
