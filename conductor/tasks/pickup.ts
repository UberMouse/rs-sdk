import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { pickup } from '../actions/pickup';
import { log, type Op, ticks } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, walkToArea } from '../lib/area';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { countItems, exactName, INVENTORY_SLOTS, TICK_MS } from '../lib/util';
import { stuckWindowMs } from '../lib/watchdog';

const FAIL_LIMIT = 3;
/** Ticks to wait for a spawn to reappear before looking again. */
const WAIT_TICKS = 5;
const MAX_WAIT_SECONDS = 300;
/** The engine's no-progress watchdog must outlast the longest allowed wait, so the task's own give-up fires first. */
export const SILENT_STREAK_TICKS = [Math.ceil((MAX_WAIT_SECONDS * 1000) / TICK_MS)];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
/** Walking to a far area outlasts the default step timeout. */
const STEP_TIMEOUT_MS = 120_000;

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
}
type Ctx = TaskContext<PickupParams, PickupMemory>;

const held = (state: BotWorldState, name: string) => countItems(state, exactName(name));

/** The first wanted item still short of its count. */
const missing = (ctx: Ctx) => ctx.params.items.find(w => held(ctx.state(), w.item) < w.count);

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
        const pattern = exactName(want);
        const unreachable = ctx.state().groundItems.some(g => pattern.test(g.name) && inArea(area, g));
        return {
            fail: unreachable
                ? `${want} is present in the area but unreachable (waited ${maxWaitSeconds}s)`
                : `no ${want} appeared in the area within ${maxWaitSeconds}s`,
        };
    }
    yield* ticks(WAIT_TICKS);
}

export default defineTask({
    name: 'pickup',
    description:
        'Walk to an area and pick up named ground items (exact names, with counts) until the inventory holds each count, ' +
        'waiting up to maxWaitSeconds for respawns. Verified spot: Knife at area {x:3224,z:3202,radius:4} ' +
        '(SE of Lumbridge castle). Fails if attacked or the inventory is full.',
    params: Params,
    memory: (): PickupMemory => ({ noItemSinceTick: null }),
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
                const item = ctx
                    .state()
                    .groundItems.filter(
                        g => pattern.test(g.name) && g.reachable !== false && inArea(ctx.params.area, g),
                    )
                    .sort((a, b) => a.distance - b.distance)[0];
                if (!item) return yield* waitForSpawn(ctx, want.item);
                ctx.memory.noItemSinceTick = null;
                const picked = yield* pickup(ctx, item);
                const fails = ctx.streak('pickupFails');
                if (picked.ok) {
                    fails.reset();
                    return;
                }
                yield* log(`pickup of ${item.name} at (${item.x},${item.z}) failed: ${picked.message}`);
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} pickups in a row failed (last: ${picked.message})` };
            },
        },
    ],
});
