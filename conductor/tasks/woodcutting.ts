import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { areaReachesWilderness } from '../lib/interrupts';
import { defineTask, type TaskContext } from '../lib/task';
import { waitUnlessThreatened } from '../lib/threat';
import { findSkill, readCount } from '../lib/util';

// Each tree drops exactly one log item; dropping by that exact name keeps other *logs items safe.
const TREES = {
    tree: { pattern: /^tree$/i, level: 1, logs: /^Logs$/i },
    oak: { pattern: /^oak( tree)?$/i, level: 15, logs: /^Oak logs$/i },
    willow: { pattern: /^willow( tree)?$/i, level: 30, logs: /^Willow logs$/i },
} as const;

const AXE = /(^|\s)axe$/i;

const INVENTORY_SLOTS = 28;
/** Radius floor: the walk tolerance is radius - 1, so a smaller area could never be reached. */
const MIN_AREA_RADIUS = 2;
const DEFAULT_AREA_RADIUS = 15;
/** The bot stands up to this many tiles from the tree it chops, so a tree at the area's edge must not trigger a walk back. */
const CHOP_REACH = 2;
/** The longest a tree chop is awaited (logs gained or tree gone) before it counts as a failed chop. */
const CHOP_WAIT_MS = 30_000;
const MAX_WALK_TOLERANCE = 3;
const WALK_FAIL_LIMIT = 3;
const NO_TREE_LIMIT = 10;
const CHOP_FAIL_LIMIT = 8;
/** Ticks one combat episode may last while the bot only waits for auto-retaliate to win it. */
const COMBAT_TICK_LIMIT = 40;
const TREE_RESPAWN_WAIT_TICKS = 3;
/** The longest legitimate step is a walk back to a far area; the engine default (120s) can be shorter. */
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    tree: z.enum(['tree', 'oak', 'willow']).default('tree'),
    /** Stay near here; walk back when further than `radius`. Omit to chop wherever the bot is. */
    area: z
        .object({ x: z.number(), z: z.number(), radius: z.number().min(MIN_AREA_RADIUS).default(DEFAULT_AREA_RADIUS) })
        .optional(),
});

type Ctx = TaskContext<z.infer<typeof Params>>;
type Counter = 'walkFails' | 'noTree' | 'chopFails' | 'combatTicks';

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const isInventoryFull = (ctx: Ctx) => ctx.state().inventory.length >= INVENTORY_SLOTS;
const count = (ctx: Ctx, key: Counter) => readCount(ctx.memory, key);
const walkTolerance = (radius: number) => Math.min(MAX_WALK_TOLERANCE, radius - 1);

const countLogs = (state: BotWorldState, logs: RegExp) =>
    state.inventory.filter(i => logs.test(i.name)).reduce((n, i) => n + i.count, 0);

type ChopOutcome = { kind: 'chopped' } | { kind: 'threatened' } | { kind: 'failed'; message: string };

/**
 * Interact with the tree, then wait for logs or for the tree to disappear. Returns at once
 * when the bot is hurt or in combat so the low-HP interrupt runs before the next chop.
 * Success needs logs gained: a tree felled by someone else is a failed chop.
 */
async function chopTree(ctx: Ctx, tree: NearbyLoc): Promise<ChopOutcome> {
    await ctx.bot.dismissBlockingUI();
    const logs = TREES[ctx.params.tree].logs;
    const logsBefore = countLogs(ctx.state(), logs);
    const sent = await ctx.sdk.sendInteractLoc(tree.x, tree.z, tree.id, 1);
    if (!sent.success) return { kind: 'failed', message: sent.message };
    const treeGone = (s: BotWorldState) =>
        !s.nearbyLocs.some(l => l.x === tree.x && l.z === tree.z && l.id === tree.id);
    const waited = await waitUnlessThreatened(
        ctx.sdk,
        s => countLogs(s, logs) > logsBefore || treeGone(s),
        CHOP_WAIT_MS,
    );
    if (waited.kind === 'timeout') return { kind: 'failed', message: `timed out waiting for logs from ${tree.name}` };
    if (waited.kind === 'threatened') return { kind: 'threatened' };
    if (countLogs(waited.state, logs) <= logsBefore)
        return { kind: 'failed', message: `${tree.name} was felled by someone else` };
    return { kind: 'chopped' };
}

/** Walk to the area centre, counting consecutive failures; returns a fail reason once past the limit. */
async function walkToArea(ctx: Ctx): Promise<string | null> {
    const a = ctx.params.area;
    if (!a) return null;
    const r = await ctx.bot.walkTo(a.x, a.z, walkTolerance(a.radius));
    ctx.memory.walkFails = r.success ? 0 : count(ctx, 'walkFails') + 1;
    return count(ctx, 'walkFails') >= WALK_FAIL_LIMIT ? `can't walk to area (${r.message})` : null;
}

export default defineTask({
    name: 'woodcutting',
    description:
        'Chop trees of one type and drop the logs when full. Needs an axe and the level for the tree. ' +
        'With `area` it stays within `radius` of that centre; without it, it chops wherever the bot stands. ' +
        'Verified spot: Lumbridge trees (3195,3220, radius 12). Unverified: Varrock oaks (3190,3458); ' +
        'Draynor willows (3087,3235, dark wizards nearby). Refuses areas reaching the Wilderness.',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,

    preflight(ctx) {
        const s = ctx.state();
        if (![...s.inventory, ...s.equipment].some(i => AXE.test(i.name))) return 'no axe in inventory or equipped';
        const need = TREES[ctx.params.tree].level;
        const skill = findSkill(s, 'Woodcutting');
        if (!skill) return 'no Woodcutting skill in state';
        if (skill.baseLevel < need) return `${ctx.params.tree} needs woodcutting ${need}, bot has ${skill.baseLevel}`;
        const a = ctx.params.area;
        if (a && areaReachesWilderness(a.x, a.z, a.radius))
            return `area (${a.x},${a.z}) radius ${a.radius} reaches the Wilderness`;
        return null;
    },

    steps: [
        {
            name: 'drop-logs',
            when: isInventoryFull,
            async run(ctx) {
                const r = await ctx.bot.dropItem(TREES[ctx.params.tree].logs, 'all');
                if (isInventoryFull(ctx)) {
                    return { fail: `inventory still full after dropping logs (${r.message})` };
                }
            },
        },
        {
            name: 'return-to-area',
            when: ctx => {
                const a = ctx.params.area;
                const p = ctx.state().player;
                return !!a && !!p && dist(p.worldX, p.worldZ, a.x, a.z) > a.radius + CHOP_REACH;
            },
            async run(ctx) {
                const failure = await walkToArea(ctx);
                if (failure) return { fail: failure };
            },
        },
        {
            name: 'chop',
            when: () => true,
            async run(ctx) {
                // Interacting with a tree cancels auto-retaliate, so a bot under attack must not touch one.
                const state = ctx.state();
                const p = state.player;
                if (p?.combat.inCombat) {
                    const at = `(${p.worldX},${p.worldZ})`;
                    if (state.autoRetaliateEnabled === false)
                        return { fail: `attacked with auto-retaliate off at ${at}` };
                    ctx.memory.combatTicks = count(ctx, 'combatTicks') + 1;
                    if (count(ctx, 'combatTicks') > COMBAT_TICK_LIMIT)
                        return { fail: `under attack for ${COMBAT_TICK_LIMIT} ticks at ${at}` };
                    await ctx.sdk.waitForTicks(1);
                    return;
                }
                ctx.memory.combatTicks = 0;
                const { pattern } = TREES[ctx.params.tree];
                const a = ctx.params.area;
                // Only trees inside the area, or return-to-area and chop would trade the bot back and forth.
                const tree = ctx.sdk
                    .getNearbyLocs()
                    .filter(t => pattern.test(t.name) && t.reachable === true && t.options.some(o => /chop/i.test(o)))
                    .filter(t => !a || dist(t.x, t.z, a.x, a.z) <= a.radius)
                    .sort((x, y) => x.distance - y.distance)[0];
                if (!tree) {
                    ctx.memory.noTree = count(ctx, 'noTree') + 1;
                    if (count(ctx, 'noTree') >= NO_TREE_LIMIT)
                        return { fail: `no reachable ${ctx.params.tree} nearby` };
                    // Trees respawn; wait a few ticks, and drift back to the area centre if we have one.
                    const failure = await walkToArea(ctx);
                    if (failure) return { fail: failure };
                    await ctx.sdk.waitForTicks(TREE_RESPAWN_WAIT_TICKS);
                    return;
                }
                ctx.memory.noTree = 0;
                const r = await chopTree(ctx, tree);
                if (r.kind === 'threatened') {
                    // Pace the loop; the low-HP interrupt acts on the next one if HP is the problem.
                    await ctx.sdk.waitForTicks(1);
                    return;
                }
                ctx.memory.chopFails = r.kind === 'chopped' ? 0 : count(ctx, 'chopFails') + 1;
                if (r.kind === 'failed') ctx.log(`chop failed: ${r.message}`);
                if (r.kind === 'failed' && count(ctx, 'chopFails') >= CHOP_FAIL_LIMIT)
                    return { fail: `${CHOP_FAIL_LIMIT} chops in a row failed (last: ${r.message})` };
            },
        },
    ],
});
