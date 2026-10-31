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
import { log, ticks, wait } from '../core/op';
import { chebyshev } from '../lib/connectors';
import { WORLD } from '../lib/world-index';
import { underAttackGuard } from '../lib/interrupts';
import { defineTask, stepBudgetTicks, type TaskContext } from '../lib/task';
import { countItems, findSkill, INVENTORY_SLOTS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness } from '../lib/wilderness';

const WHEEL = /^spinning wheel$/i;
export const FAIL_LIMIT = 4;
/** Within this many tiles of the wheel's stand tile (on its floor) the client's own pathing reaches it; further, the task walks first. */
const STATION_REACH = 2;
/** The walk's tolerance, tighter than STATION_REACH on purpose: the walk lands beside the wheel, while awayFromWheel tolerates the wider ring. Close enough that the wheel's own side of a wall or door is reached, not just its range. */
const STAND_REACH = 1;
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

/**
 * Where to stand for the wheel at `wheel`: the world index's stand tile for the wheel site holding that tile (a
 * wheel is used from one side only, and a runner copies the loc tile from the services page), else the tile itself.
 */
export function standTile(wheel: { x: number; z: number; level: number }): { x: number; z: number; level: number } {
    const site = WORLD.sites.find(
        s =>
            s.kind === 'spinning-wheel' &&
            s.stand &&
            s.bbox.level === wheel.level &&
            wheel.x >= s.bbox.x1 &&
            wheel.x <= s.bbox.x2 &&
            wheel.z >= s.bbox.z1 &&
            wheel.z <= s.bbox.z2,
    );
    return site?.stand ?? wheel;
}

/** Away from the wheel: on another floor, more than STATION_REACH (Chebyshev) from its stand tile, or in view but unreachable. */
function awayFromWheel(ctx: Ctx): boolean {
    const wheel = ctx.params.wheel;
    const state = ctx.state();
    const player = state.player;
    if (!wheel || !player) return false;
    const stand = standTile(wheel);
    // Chebyshev, as walkTo judges arrival: a Euclidean distance reads a diagonal tile 2 away as 2.8, so a walk that
    // had arrived was sent again at once (a hot loop when `wheel` was the wheel's own tile).
    if (player.level !== wheel.level || chebyshev({ x: player.worldX, z: player.worldZ }, stand) > STATION_REACH)
        return true;
    // Within reach but shut out (the wheel reads unreachable from here): walk on, to its stand tile.
    const seen = shortestNameMatch(state.nearbyLocs, WHEEL);
    return seen !== null && seen.reachable === false;
}

export default defineTask({
    name: 'spinning',
    description:
        'Spin flax into bow strings (or wool into balls of wool) at a spinning wheel: opens the wheel\'s menu, picks "Make X" and spins everything held in one go ' +
        '(about 2 ticks per item). Ends done when none is left. Needs Crafting 10 for flax (members world), the material in the inventory and a wheel: ' +
        '`wheel` gives its tile (the loc tile of services/spinning-wheel is fine: the task stands on the stand tile of the world index beside it) and floor and the task walks there, up the stairs or ladder if needed; omit it to use a wheel in view. ' +
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
                const stand = standTile(wheel);
                const before = ctx.distanceTo(stand.x, stand.z);
                const w = yield* walkTo(ctx, stand.x, stand.z, STAND_REACH, {
                    level: wheel.level,
                    reserveTicks: SPIN_MAX_TICKS,
                });
                if (w.ok) {
                    // A walk that arrived yet leaves the bot away from the wheel changed nothing: count it, never loop.
                    if (!awayFromWheel(ctx)) {
                        fails.reset();
                        return;
                    }
                    yield* log(`walk to the wheel ended away from it: ${w.message}`);
                    if (fails.add() >= FAIL_LIMIT)
                        return { fail: `can't get within reach of the wheel (${w.message})` };
                    yield* ticks(1);
                    return;
                }
                yield* log(`walk to the wheel failed: ${w.message}`);
                // A walk that ran out of ticks closer than it started is progress (a far wheel, a floor change).
                if (timedOutAdvancing(w, before, ctx.distanceTo(stand.x, stand.z))) return;
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
