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

const Point = z.object({ x: z.number(), z: z.number() });
const Params = z.object({
    /** The destination. `level` defaults to the bot's own (0 across the surface/underground divide). */
    to: Point.extend({ level: z.number().int().optional() }),
    /**
     * Requirement tokens for every walk of the trip; see AtSchema.met in lib/spot.ts for what they are and examples.
     */
    met: z.array(z.string()).default([]),
    /** Tiles from `to` that count as arrived. */
    tolerance: z.number().int().min(1).default(3),
    /** Points to pass in order before `to` (to keep to a safe road, or to cross a stretch the route finder cannot). */
    waypoints: z.array(Point).default([]),
    /**
     * Run from a fight: the task may start in combat (every other task refuses to), walks without
     * stopping for the attack, and is done only once out of combat at `to`.
     */
    flee: z.boolean().default(false),
    /**
     * Opt in to the Wilderness: `to` and the waypoints may lie in it and the Wilderness guard stands down
     * (death still ends the run). Needs `minFood` food to start; it eats at low HP and, with no food left
     * in a fight or still losing HP, the low-hp guard fails the run rather than walking on to die.
     */
    wilderness: z.boolean().default(false),
    /** Food items (anything with an Eat option) a `wilderness` run must carry to start (at least 1 whatever is set). */
    minFood: z.number().int().min(0).default(WILDERNESS_MIN_FOOD),
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
        'Walk to a point `to` {x,z,level?} within `tolerance` (default 3) tiles, optionally through `waypoints` [{x,z}] first ' +
        '(a safe road, e.g. north of z 3240 past the Draynor dark wizards). Uses the walkTo op, so it opens the doors and gates ' +
        "on its route and climbs the stairs, ladders and trapdoors of lib/connectors.ts (including the quest dungeons: the Paterdomus mausoleum, the Tree Gnome Village cellar, Glarial's tomb (its ladder out only: a pebble move enters it)); `met` [tokens] names requirements the plan knows the account meets that the state does not show (e.g. `quest:priestperil>=4` for the Priest in Peril temple door, which the walk plans through only with it); it never enters the Wilderness unless `wilderness: true` (then `to` may be inside it, e.g. the Wilderness agility course door 2998,3915 from Edgeville; needs `minFood` (default 3, at least 1) food items to start, eats at low HP, and the low-hp guard fails the run when low in a fight with no food (except with `flee`, which walks on); death still ends it; walking is not stopped by attacks, so skeletons and wolves en route cost HP, not the run; carry only food and no valuables: a PvP or skeleton death loses the inventory). A destination inside the Gnome " +
        'Stronghold (the agility course start 2474,3436) goes via its entrance gate at 2459,3383, opened here ' +
        "(declining Femi's boxes dialog once). Far trips take several walks (Lumbridge to the Gnome Stronghold is about 700 tiles). " +
        'CARRY FOOD (a dozen or more) for long trips: the route from Lumbridge to the Gnome Stronghold crosses White Wolf Mountain, ' +
        'where wolves attack and cost HP; it eats at low HP, and with no food the low-hp guard fails the run. ' +
        'With `flee: true` it also starts while in combat (the way out of a fight no other task will start in), walks on ' +
        'without stopping for the attack, eats held food at low HP, and is done only once out of combat at `to`. In combat at low HP with no food held it keeps walking (the low-hp guard does not end a flee run; out of combat it still rests to regenerate); death still ends it. ' +
        'Fails where the route breaks: no path, a locked gate, or three failed walks in a row.',
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
