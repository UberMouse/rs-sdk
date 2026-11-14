import { z } from 'zod/v4';
import { GATE_MAX_TICKS, GNOME_GATE, insideFence, passGate } from '../actions/gate';
import { collisionPaths } from '../actions/paths';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo, type WalkResult } from '../actions/walk';
import { log, ticks } from '../core/op';
import { chebyshev } from '../lib/connectors';
import { foodCount } from '../lib/interrupts';
import { FINAL_WALK_FAILURES } from '../lib/spot';
import { defineTask, type TaskContext } from '../lib/task';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness, WILDERNESS_MIN_FOOD, wildernessFoodRefusal } from '../lib/wilderness';

/** Failed walks in a row (not out of ticks while closing in) before the task fails. */
const WALK_FAIL_LIMIT = 3;
/** A far trip is many walks of WALK_MAX_TICKS; one step is one walk, so the step budget covers a walk and a gate. */
const STEP_TIMEOUT_MS = 180_000;
const STUCK_AFTER_MS = stuckWindowMs(failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS), GATE_MAX_TICKS);
/** Loops (a tick each) `flee` waits at the destination for the fight to end before it fails. */
const FLEE_SETTLE_LOOPS = 15;
/** How close a user waypoint must be passed. */
const WAYPOINT_TOLERANCE = 4;
/** Standing this close to the gate's stand tile the gate is opened. */
const GATE_STAND_TOLERANCE = 2;

const Point = z.object({
    x: z.number().describe('World tile x coordinate.'),
    z: z.number().describe('World tile z coordinate (north).'),
});
const Params = z.object({
    to: Point.extend({
        level: z
            .number()
            .int()
            .optional()
            .describe("The floor; defaults to the bot's own (0 across the surface/underground divide)."),
    }).describe('The destination.'),
    met: z
        .array(z.string())
        .default([])
        .describe(
            'Requirement tokens the plan knows the account meets that the state does not show, for every walk of the trip ' +
                '(e.g. `quest:priestperil>=4` for the Priest in Peril temple door, which the walk plans through only with it); ' +
                'the same tokens as `met` on a spot (lib/spot.ts).',
        ),
    tolerance: z.number().int().min(1).default(3).describe('Tiles from `to` that count as arrived.'),
    waypoints: z
        .array(Point)
        .default([])
        .describe(
            'Points to pass in order before `to`: to keep to a safe road (e.g. north of z 3240 past the Draynor dark ' +
                'wizards), or to cross a stretch the route finder cannot.',
        ),
    flee: z
        .boolean()
        .default(false)
        .describe(
            'Run from a fight: the task may start in combat (every other task refuses to) and is done only once out of ' +
                'combat at `to`. In combat at low HP with no food held it keeps walking instead of failing (out of combat ' +
                'it still rests to regenerate).',
        ),
    wilderness: z
        .boolean()
        .default(false)
        .describe(
            'Opt in to the Wilderness: `to` and the waypoints may lie in it, and the Wilderness guard stands down (death still ends the run).',
        ),
    minFood: z
        .number()
        .int()
        .min(0)
        .default(WILDERNESS_MIN_FOOD)
        .describe(
            'Food items (anything with an Eat option) a `wilderness` run must carry to start; at least 1 whatever this is set to.',
        ),
});

type TravelParams = z.infer<typeof Params>;
interface TravelMemory {
    /** Index of the next user waypoint to reach. */
    nextWaypoint: number;
}
type Ctx = TaskContext<TravelParams, TravelMemory>;

const here = (ctx: Ctx) => ctx.state().player;
/**
 * Tiles to (x, z) in the metric walkTo's tolerance uses (Chebyshev). ctx.distanceTo is Euclidean: at
 * (3189,3428) the point (3188,3425) is 3.16 away, outside a tolerance of 3 that walkTo calls "Already
 * at destination", so the walk step returned at once and spun without a tick until the watchdog.
 */
const tilesTo = (ctx: Ctx, x: number, tz: number) => {
    const p = here(ctx);
    return p ? chebyshev({ x: p.worldX, z: p.worldZ }, { x, z: tz }) : Infinity;
};
/**
 * The Gnome Stronghold's interior is fenced all round (gnomefence locs); the only way in is the gate,
 * which the pathfinder cannot route through, so a destination inside it from outside goes via the gate.
 */
const inFence = (ctx: Ctx, x: number, tz: number) => insideFence(ctx.pathfinder ?? collisionPaths, GNOME_GATE, x, tz);
const insideStronghold = (ctx: Ctx) => {
    const p = here(ctx);
    return !!p && inFence(ctx, p.worldX, p.worldZ);
};
/** The gate stands between the bot and `to`. */
const needsGnomeGate = (ctx: Ctx) => {
    const { to } = ctx.params;
    return !!here(ctx) && (to.level ?? 0) === 0 && inFence(ctx, to.x, to.z) && !insideStronghold(ctx);
};
/** Close enough to the gate's stand tile to open it. */
const atGnomeGate = (ctx: Ctx) =>
    !!here(ctx) && tilesTo(ctx, GNOME_GATE.stand.x, GNOME_GATE.stand.z) <= GATE_STAND_TOLERANCE;
/** Within tolerance of `to`, and not still outside a fence that `to` is inside. */
const arrived = (ctx: Ctx) => {
    const p = here(ctx);
    const { to, tolerance } = ctx.params;
    return (
        !!p &&
        tilesTo(ctx, to.x, to.z) <= tolerance &&
        (to.level === undefined || p.level === to.level) &&
        !needsGnomeGate(ctx)
    );
};
const fighting = (ctx: Ctx) => !!here(ctx)?.combat.inCombat;
const waypointsLeft = (ctx: Ctx) => ctx.params.waypoints.slice(ctx.memory.nextWaypoint);

// No underAttackGuard on purpose: the bot outwalks an aggressive monster, which a fight guard would turn
// into a failed run. Without `flee`, no food, low HP and an attacker fail the run in the shared low-hp guard.
export default defineTask({
    name: 'travel',
    description:
        'Walks to `to`, through `waypoints` first. Uses walkTo, so it opens the doors and gates on its route and ' +
        'climbs the stairs, ladders and trapdoors in the connectors table of known shortcuts, quest dungeons included. ' +
        `A destination inside the Gnome Stronghold goes via its entrance gate at ${GNOME_GATE.loc.x},${GNOME_GATE.loc.z}, opened here ` +
        "(declining Femi's boxes dialog once). Far trips take several walks. Attacks do not stop the walk, so " +
        "monsters en route cost HP, not the run; it eats held food at low HP, and with none the engine's low-HP guard, which ends the " +
        'run when HP is low, fails it when low in a fight or still losing HP (except with `flee`); death still ends it. Done within `tolerance` of `to` (with ' +
        `\`flee\`, once out of combat there, failing if still in combat after ${FLEE_SETTLE_LOOPS} ticks). Fails where ` +
        `the route breaks: no path, a locked gate, or ${WALK_FAIL_LIMIT} failed walks in a row. Never enters the ` +
        'Wilderness unless `wilderness: true`.',
    rules: [
        'Without `wilderness: true`, `to` and every waypoint must lie outside the Wilderness.',
        "The connectors cover the quest dungeons: the Paterdomus mausoleum, the Tree Gnome Village cellar, Glarial's tomb (its ladder out only: a pebble move enters it).",
        'Carry food (a dozen or more) on long trips: monsters en route cost HP.',
    ],
    spots: [
        "The Gnome Stronghold's agility course start is {x:2474,z:3436}; the route from Lumbridge (about 700 tiles) " +
            'crosses White Wolf Mountain, where wolves attack and cost HP.',
        'Wilderness agility course door {x:2998,z:3915} from Edgeville, with `wilderness: true`; skeletons and wolves en ' +
            'route cost HP. Carry only food and no valuables: a PvP or skeleton death loses the inventory.',
    ],
    params: Params,
    memory: (): TravelMemory => ({ nextWaypoint: 0 }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,
    startInCombat: params => params.flee,
    allowWilderness: params => params.wilderness,
    // Walking away is the answer to low HP when fleeing: in combat with no food the low-hp guard must not end the run.
    keepGoingWithoutFood: params => params.flee,

    preflight(ctx) {
        const { to, waypoints, wilderness, minFood } = ctx.params;
        if (!wilderness) {
            for (const p of [to, ...waypoints])
                if (squareReachesWilderness(p.x, p.z, 0))
                    return `(${p.x},${p.z}) is in the Wilderness (set wilderness: true)`;
            return null;
        }
        return wildernessFoodRefusal(foodCount(ctx.state()), minFood, 'a Wilderness trip');
    },

    steps: [
        {
            name: 'arrived',
            when: ctx => arrived(ctx) && !(ctx.params.flee && fighting(ctx)),
            run: ctx => ({
                done: `arrived within ${ctx.params.tolerance} tiles of (${ctx.params.to.x},${ctx.params.to.z})`,
            }),
        },
        {
            // Arrived with the attacker still on the bot: wait for the fight to end.
            name: 'fight-at-destination',
            when: ctx => arrived(ctx) && ctx.params.flee && fighting(ctx),
            *run(ctx) {
                const settle = ctx.streak('stillFighting');
                const waited = settle.add();
                if (waited === 1)
                    yield* log('arrived with the attacker still on the bot: waiting for the fight to end');
                if (waited >= FLEE_SETTLE_LOOPS)
                    return { fail: `still in combat at (${ctx.params.to.x},${ctx.params.to.z}) after fleeing there` };
                yield* ticks(1);
            },
        },
        {
            name: 'gnome-gate',
            when: ctx => waypointsLeft(ctx).length === 0 && needsGnomeGate(ctx) && atGnomeGate(ctx),
            *run(ctx) {
                const r = yield* passGate(ctx, GNOME_GATE);
                const fails = ctx.streak('gateFails');
                if (r.ok) {
                    fails.reset();
                    yield* log('passed the Gnome Stronghold gate');
                    return;
                }
                yield* log(`gate failed: ${r.message}`);
                if (fails.add() >= WALK_FAIL_LIMIT) return { fail: `Gnome Stronghold gate: ${r.message}` };
            },
        },
        {
            name: 'walk',
            when: () => true,
            *run(ctx) {
                const { to } = ctx.params;
                const wp = waypointsLeft(ctx)[0];
                const gate = !wp && needsGnomeGate(ctx);
                const goal = wp ?? (gate ? GNOME_GATE.stand : to);
                const tolerance = wp ? WAYPOINT_TOLERANCE : gate ? GATE_STAND_TOLERANCE : ctx.params.tolerance;
                const before = tilesTo(ctx, goal.x, goal.z);
                const r: WalkResult = yield* walkTo(ctx, goal.x, goal.z, tolerance, {
                    ...(wp ? {} : { level: to.level }),
                    met: ctx.params.met,
                });
                const fails = ctx.streak('walkFails');
                if (r.ok) {
                    fails.reset();
                    if (wp) ctx.memory.nextWaypoint++;
                    return;
                }
                if (timedOutAdvancing(r, before, tilesTo(ctx, goal.x, goal.z))) {
                    fails.reset();
                    return;
                }
                yield* log(`walk to (${goal.x},${goal.z}) failed (${r.reason}): ${r.message}`);
                if (FINAL_WALK_FAILURES.includes(r.reason))
                    return { fail: `can't travel to (${goal.x},${goal.z}): ${r.message}` };
                if (fails.add() >= WALK_FAIL_LIMIT)
                    return {
                        fail: `${WALK_FAIL_LIMIT} walks in a row failed toward (${goal.x},${goal.z}); last: ${r.message}`,
                    };
            },
        },
    ],
});
