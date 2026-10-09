import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, walkToArea } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { INVENTORY_SLOTS } from '../lib/util';

const FAIL_LIMIT = 3;
/** Ticks to wait for a spawn to reappear before looking again. */
const WAIT_TICKS = 5;
const MAX_WAIT_SECONDS = 300;
/** The engine's no-progress watchdog must outlast the longest allowed wait, so the task's own give-up fires first. */
const STUCK_AFTER_MS = (MAX_WAIT_SECONDS + 60) * 1000;
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
type Ctx = TaskContext<PickupParams>;

const exactName = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const held = (state: BotWorldState, name: string) => {
    const pattern = exactName(name);
    return state.inventory.filter(i => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
};

/** The first wanted item still short of its count. */
const missing = (ctx: Ctx) => ctx.params.items.find(w => held(ctx.state(), w.item) < w.count);

export default defineTask({
    name: 'pickup',
    description:
        'Walk to an area and pick up named ground items (exact names, with counts) until the inventory holds each count, ' +
        'waiting up to maxWaitSeconds for respawns. Verified spot: Knife at area {x:3224,z:3202,radius:4} ' +
        '(SE of Lumbridge castle). Fails if attacked or the inventory is full.',
    params: Params,
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
            run: async () => ({ done: 'holding every requested item' }),
        },
        {
            name: 'attacked',
            when: ctx => !!ctx.state().player?.combat.inCombat,
            run: async ctx => {
                const p = ctx.state().player;
                return { fail: `attacked while picking up at (${p?.worldX},${p?.worldZ})` };
            },
        },
        returnToAreaStep<PickupParams>(params => params.area),
        {
            name: 'pickup',
            when: () => true,
            async run(ctx) {
                const want = missing(ctx);
                if (!want) return;
                const pattern = exactName(want.item);
                const item = ctx.sdk
                    .getGroundItems()
                    .filter(g => pattern.test(g.name) && g.reachable !== false && inArea(ctx.params.area, g))
                    .sort((a, b) => a.distance - b.distance)[0];
                if (!item) {
                    if (ctx.inventoryFull()) return { fail: 'inventory is full' };
                    // Only the radius..radius+WORK_REACH strip: returnToAreaStep handles anything farther out.
                    if (ctx.distanceTo(ctx.params.area.x, ctx.params.area.z) > ctx.params.area.radius) {
                        const failure = await walkToArea(ctx, ctx.params.area);
                        if (failure) return { fail: failure };
                        return;
                    }
                    const stored = ctx.memory.noItemSince;
                    const since = typeof stored === 'number' ? stored : Date.now();
                    if (typeof stored !== 'number') {
                        ctx.memory.noItemSince = since;
                        ctx.log(`no ${want.item} in the area, waiting for a respawn`);
                    }
                    if (Date.now() - since >= ctx.params.maxWaitSeconds * 1000) {
                        const unreachable = ctx.sdk
                            .getGroundItems()
                            .some(g => pattern.test(g.name) && inArea(ctx.params.area, g));
                        const secs = ctx.params.maxWaitSeconds;
                        return {
                            fail: unreachable
                                ? `${want.item} is present in the area but unreachable (waited ${secs}s)`
                                : `no ${want.item} appeared in the area within ${secs}s`,
                        };
                    }
                    await ctx.sdk.waitForTicks(WAIT_TICKS);
                    return;
                }
                delete ctx.memory.noItemSince;
                const fails = ctx.counter('pickupFails');
                const r = await ctx.bot.pickupItem(item);
                if (r.success) {
                    fails.reset();
                    return;
                }
                ctx.log(`pickup of ${item.name} at (${item.x},${item.z}) failed: ${r.message}`);
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} pickups in a row failed (last: ${r.message})` };
            },
        },
    ],
});
