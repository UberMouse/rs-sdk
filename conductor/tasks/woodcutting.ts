import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { AreaSchema, inArea, refuseArea, returnToAreaStep } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { waitUnlessThreatened } from '../lib/threat';
import { findSkill } from '../lib/util';

// Each tree drops exactly one log item; dropping by that exact name keeps other *logs items safe.
const TREES = {
    tree: { pattern: /^tree$/i, level: 1, logs: /^Logs$/i },
    oak: { pattern: /^oak( tree)?$/i, level: 15, logs: /^Oak logs$/i },
    willow: { pattern: /^willow( tree)?$/i, level: 30, logs: /^Willow logs$/i },
} as const;

const AXE = /(^|\s)axe$/i;

/** The longest a tree chop is awaited (logs gained or tree gone) before it counts as a failed chop. */
const CHOP_WAIT_MS = 30_000;
/** One wait for a respawn; it ends early when a tree appears or the bot is threatened. */
const RESPAWN_WAIT_MS = 5_000;
/** How long with no tree at all before failing; above the 48-80s normal-tree respawn. */
const NO_TREE_GIVE_UP_MS = 120_000;
/** Above the give-up time and the engine default (90s) so a full respawn wait is not reported as a stall. */
const STUCK_AFTER_MS = 150_000;
/** Consecutive failed chops before the task fails. */
const CHOP_FAIL_LIMIT = 8;
/** Ticks one combat episode may last while the bot only waits for auto-retaliate to win it. */
const COMBAT_TICK_LIMIT = 40;
/** The longest legitimate step is a walk back to a far area; the engine default (120s) can be shorter. */
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    tree: z.enum(['tree', 'oak', 'willow']).default('tree'),
    /** Stay near here; walk back when further than `radius`. Omit to chop wherever the bot is. */
    area: AreaSchema.optional(),
    /** What to do when the inventory is full: drop the logs and keep chopping, or end the run holding them. */
    onFull: z.enum(['drop', 'stop']).default('drop'),
});

type WoodcuttingParams = z.infer<typeof Params>;
type Ctx = TaskContext<WoodcuttingParams>;

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

export default defineTask({
    name: 'woodcutting',
    description:
        'Chop trees of one type; when the inventory is full, `onFull` "drop" (default) drops the logs and keeps chopping, ' +
        '"stop" ends the run done ("inventory full: N logs") holding them, e.g. to feed fletching/firemaking. Needs an axe and the level for the tree. ' +
        'When every tree in reach is a stump it waits up to 2 min for respawns, then fails "area depleted". ' +
        'With `area` it stays within `radius` of that centre; without it, it chops wherever the bot stands. ' +
        'Verified spot: Lumbridge trees (3195,3220, radius 12). Unverified: Varrock oaks (3190,3458); ' +
        'Draynor willows (3087,3235, dark wizards nearby). Refuses areas reaching the Wilderness.',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const s = ctx.state();
        if (![...s.inventory, ...s.equipment].some(i => AXE.test(i.name))) return 'no axe in inventory or equipped';
        const need = TREES[ctx.params.tree].level;
        const skill = findSkill(s, 'Woodcutting');
        if (!skill) return 'no Woodcutting skill in state';
        if (skill.baseLevel < need) return `${ctx.params.tree} needs woodcutting ${need}, bot has ${skill.baseLevel}`;
        return refuseArea(ctx.params.area);
    },

    steps: [
        {
            name: 'stop-full',
            when: ctx => ctx.params.onFull === 'stop' && ctx.inventoryFull(),
            async run(ctx) {
                const logs = countLogs(ctx.state(), TREES[ctx.params.tree].logs);
                if (logs === 0) return { fail: `inventory full with no ${ctx.params.tree} logs` };
                return { done: `inventory full: ${logs} logs` };
            },
        },
        {
            name: 'drop-logs',
            when: ctx => ctx.params.onFull === 'drop' && ctx.inventoryFull(),
            async run(ctx) {
                const r = await ctx.bot.dropItem(TREES[ctx.params.tree].logs, 'all');
                if (ctx.inventoryFull()) {
                    return { fail: `inventory still full after dropping logs (${r.message})` };
                }
            },
        },
        returnToAreaStep<WoodcuttingParams>(params => params.area),
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
                    if (ctx.counter('combatTicks').add() > COMBAT_TICK_LIMIT)
                        return { fail: `under attack for ${COMBAT_TICK_LIMIT} ticks at ${at}` };
                    await ctx.sdk.waitForTicks(1);
                    return;
                }
                ctx.counter('combatTicks').reset();
                const { pattern } = TREES[ctx.params.tree];
                const a = ctx.params.area;
                // Only trees inside the area, or return-to-area and chop would trade the bot back and forth.
                const isChoppable = (t: NearbyLoc) =>
                    pattern.test(t.name) &&
                    t.reachable === true &&
                    t.options.some(o => /chop/i.test(o)) &&
                    inArea(a, t);
                const tree = ctx.sdk
                    .getNearbyLocs()
                    .filter(isChoppable)
                    .sort((x, y) => x.distance - y.distance)[0];
                if (!tree) {
                    // Stumps count as no tree: stay put (returnToAreaStep keeps us inside) and wait for a respawn.
                    const stored = ctx.memory.noTreeSince;
                    const since = typeof stored === 'number' ? stored : Date.now();
                    if (typeof stored !== 'number') {
                        ctx.memory.noTreeSince = since;
                        ctx.log(`no ${ctx.params.tree} available, waiting for a respawn`);
                    }
                    const waited = Date.now() - since;
                    if (waited >= NO_TREE_GIVE_UP_MS) {
                        const waitedSeconds = Math.round(waited / 1000);
                        return {
                            fail: a
                                ? `area depleted: no reachable ${ctx.params.tree} in radius ${a.radius} for ${waitedSeconds}s`
                                : `no reachable ${ctx.params.tree} nearby for ${waitedSeconds}s`,
                        };
                    }
                    await waitUnlessThreatened(ctx.sdk, s => s.nearbyLocs.some(isChoppable), RESPAWN_WAIT_MS);
                    return;
                }
                delete ctx.memory.noTreeSince;
                const r = await chopTree(ctx, tree);
                if (r.kind === 'threatened') {
                    // Pace the loop; the low-HP interrupt acts on the next one if HP is the problem.
                    await ctx.sdk.waitForTicks(1);
                    return;
                }
                const chopFails = ctx.counter('chopFails');
                if (r.kind === 'chopped') {
                    chopFails.reset();
                    return;
                }
                ctx.log(`chop failed: ${r.message}`);
                if (chopFails.add() >= CHOP_FAIL_LIMIT)
                    return { fail: `${CHOP_FAIL_LIMIT} chops in a row failed (last: ${r.message})` };
            },
        },
    ],
});
