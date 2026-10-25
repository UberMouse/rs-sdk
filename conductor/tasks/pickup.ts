import { z } from 'zod/v4';
import type { BotWorldState, GroundItem } from '../../sdk/types';
import { PICKUP_GRACE_TICKS, PICKUP_WAIT_TICKS, pickup } from '../actions/pickup';
import { WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, type Op, ticks } from '../core/op';
import { areaWatchReport, type AreaWatch, newAreaWatch, outsideSighting, trackIdle } from '../lib/area-watch';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT, walkToArea } from '../lib/area';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { countItems, exactName, INVENTORY_SLOTS, TICK_MS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

const FAIL_LIMIT = 3;
/** Ticks to wait for a spawn to reappear before looking again. */
const WAIT_TICKS = 5;
const MAX_WAIT_SECONDS = 300;
/** The engine's no-progress watchdog must outlast the longest allowed wait, so the task's own give-up fires first. */
export const SILENT_STREAK_TICKS = [
    Math.ceil((MAX_WAIT_SECONDS * 1000) / TICK_MS),
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
/** Walking to a far area outlasts the default step timeout. */
const STEP_TIMEOUT_MS = 120_000;

/**
 * An item the client cannot route onto (a spawn on a Table, `reachable: false`) is taken from a tile beside it:
 * the server accepts a Take from a cardinally adjacent tile with no wall between. These are the four sides.
 */
const STANDS = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
] as const;

const Params = z.object({
    /** Walk to this area and pick up inside it. */
    area: AreaSchema,
    /** Ground items to hold in the inventory, by exact name (case-insensitive). */
    items: z.array(z.object({ item: z.string().min(1), count: z.number().int().positive().default(1) })).min(1),
    /** Give up when a wanted item has not appeared for this long (seconds). Default spawns respawn in about 40 s (100 ticks). */
    maxWaitSeconds: z.number().positive().max(MAX_WAIT_SECONDS).default(90),
});

type PickupParams = z.infer<typeof Params>;
interface PickupMemory {
    /** The tick the bot first found none of the wanted item in the area, until it finds one again. */
    noItemSinceTick: number | null;
    /** Index into STANDS of the side to stand on next: advanced after each refused take or unwalkable side, reset on a pickup or when the item is gone. */
    standTries: number;
    /** Idle ticks and the ones with the item in view outside the area (diagnostic, lib/area-watch.ts). */
    areaWatch: AreaWatch;
}
type Ctx = TaskContext<PickupParams, PickupMemory>;

/** Failures in a row that end the run: one per side for a blocked-tile item, FAIL_LIMIT otherwise. */
const failLimit = (blocked: boolean) => (blocked ? STANDS.length : FAIL_LIMIT);

const held = (state: BotWorldState, name: string) => countItems(state, exactName(name));

/** The first wanted item still short of its count. */
const missing = (ctx: Ctx) => ctx.params.items.find(w => held(ctx.state(), w.item) < w.count);

/**
 * Walks to the tile beside a blocked-tile `item` that the take is tried from: the four sides in a fixed order
 * (north first), the next one after each refusal. Returns a failure message, or null once the bot
 * stands there. A side with a wall or another table on it is unwalkable and is skipped here.
 */
function* standBeside(ctx: Ctx, item: GroundItem): Op<string | null> {
    const me = ctx.state().player;
    if (!me) return 'no player state';
    const [dx, dz] = STANDS[ctx.memory.standTries % STANDS.length] ?? STANDS[0];
    const side = { x: item.x + dx, z: item.z + dz };
    if (me.worldX === side.x && me.worldZ === side.z) return null;
    const walked = yield* walkTo(ctx, side.x, side.z, 0, { reserveTicks: PICKUP_WAIT_TICKS + PICKUP_GRACE_TICKS });
    if (walked.ok) return null;
    ctx.memory.standTries += 1;
    yield* log(`walk beside ${item.name} to (${side.x},${side.z}) failed: ${walked.message}`);
    return walked.message;
}

/**
 * Nothing wanted on the ground in the area: fail when the inventory is full, walk in when the bot is just
 * outside it, otherwise wait for a respawn and fail after maxWaitSeconds without one.
 */
function* waitForSpawn(ctx: Ctx, want: string): Op<Outcome> {
    const { area, maxWaitSeconds } = ctx.params;
    if (ctx.inventoryFull()) return { fail: 'inventory is full' };
    // Only the radius..radius+WORK_REACH strip: returnToAreaStep handles anything farther out.
    if (ctx.distanceTo(area.x, area.z) > area.radius) {
        const failure = yield* walkToArea(ctx, area);
        if (failure) return { fail: failure };
        return;
    }
    const now = ctx.state().tick;
    if (ctx.memory.noItemSinceTick === null) {
        ctx.memory.noItemSinceTick = now;
        yield* log(`no ${want} in the area, waiting for a respawn`);
    }
    if (now - ctx.memory.noItemSinceTick >= Math.ceil((maxWaitSeconds * 1000) / TICK_MS)) {
        return { fail: `no ${want} appeared in the area within ${maxWaitSeconds}s` };
    }
    const seen = (s: BotWorldState) => outsideSighting(s, area, s.groundItems, g => exactName(want).test(g.name));
    yield* trackIdle(ctx, ctx.memory.areaWatch, seen, ticks(WAIT_TICKS));
}

export default defineTask({
    name: 'pickup',
    description:
        'Walk to an area and pick up named ground items (exact names, with counts) until the inventory holds each count, ' +
        'waiting up to maxWaitSeconds for respawns. An item on a blocked tile (a spawn on a Table: Panning tray, kitchen pot) is taken from ' +
        'an adjacent tile once nothing reachable is left; a take the server refuses ("I can\'t reach that") counts as a failed pickup. Verified spots: Panning tray on a Table at area {x:3369,z:3379,radius:4}; Pot (kitchen) at {x:3210,z:3212,radius:3}; Knife at area {x:3224,z:3202,radius:4} ' +
        '(SE of Lumbridge castle). Fails if attacked or the inventory is full.',
    params: Params,
    diagnostics: ctx => areaWatchReport(ctx.memory.areaWatch, ctx.params.area),
    memory: (): PickupMemory => ({ noItemSinceTick: null, standTries: 0, areaWatch: newAreaWatch() }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const s = ctx.state();
        const slotsFree = INVENTORY_SLOTS - s.inventory.length;
        const need = ctx.params.items.length;
        if (slotsFree < need) return `${slotsFree} free inventory slots, need up to ${need} for new items`;
        return refuseArea(ctx.params.area);
    },

    steps: [
        {
            name: 'finish',
            when: ctx => !missing(ctx),
            run: () => ({ done: 'holding every requested item' }),
        },
        {
            name: 'attacked',
            when: ctx => !!ctx.state().player?.combat.inCombat,
            run(ctx) {
                const p = ctx.state().player;
                return { fail: `attacked while picking up at (${p?.worldX},${p?.worldZ})` };
            },
        },
        returnToAreaStep<PickupParams>(params => params.area),
        {
            name: 'pickup',
            when: () => true,
            *run(ctx) {
                const want = missing(ctx);
                if (!want) return;
                const pattern = exactName(want.item);
                // Items that route first; one on a blocked tile only when none does (a refused take still fails).
                const item = ctx
                    .state()
                    .groundItems.filter(g => pattern.test(g.name) && inArea(ctx.params.area, g))
                    .sort(
                        (a, b) =>
                            Number(a.reachable === false) - Number(b.reachable === false) || a.distance - b.distance,
                    )[0];
                if (!item) {
                    ctx.memory.standTries = 0;
                    return yield* waitForSpawn(ctx, want.item);
                }
                ctx.memory.noItemSinceTick = null;
                const blocked = item.reachable === false;
                if (blocked) {
                    const stood = yield* standBeside(ctx, item);
                    if (stood) {
                        const fails = ctx.streak('pickupFails');
                        if (fails.add() >= failLimit(true))
                            return { fail: `${STANDS.length} sides beside ${item.name} failed (last: ${stood})` };
                        return;
                    }
                }
                const picked = yield* pickup(ctx, item);
                const fails = ctx.streak('pickupFails');
                if (picked.ok) {
                    fails.reset();
                    ctx.memory.standTries = 0;
                    return;
                }
                yield* log(`pickup of ${item.name} at (${item.x},${item.z}) failed: ${picked.message}`);
                // A take refused from this side (a wall between) is tried from the next side.
                if (blocked && picked.reason === 'cant-reach') ctx.memory.standTries += 1;
                const limit = failLimit(blocked);
                if (fails.add() >= limit) return { fail: `${limit} pickups in a row failed (last: ${picked.message})` };
            },
        },
    ],
});
