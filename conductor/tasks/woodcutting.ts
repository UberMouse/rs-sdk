import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { CHOP_OPTION, CHOP_WAIT_TICKS, chop } from '../actions/chop';
import { drop } from '../actions/drop';
import { log, type Op, wait } from '../core/op';
import { WALK_MAX_TICKS } from '../actions/walk';
import { areaWatchReport, type AreaWatch, newAreaWatch, outsideSighting, trackIdle } from '../lib/area-watch';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT } from '../lib/area';
import { underAttackGuard } from '../lib/interrupts';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { countItems, findSkill, TICK_MS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

// Each tree drops exactly one log item; dropping by that exact name keeps other *logs items safe.
const TREES = {
    tree: { pattern: /^tree$/i, level: 1, logs: /^Logs$/i },
    oak: { pattern: /^oak( tree)?$/i, level: 15, logs: /^Oak logs$/i },
    willow: { pattern: /^willow( tree)?$/i, level: 30, logs: /^Willow logs$/i },
} as const;

const AXE = /(^|\s)axe$/i;

/** How long with no tree at all before failing (2 min); above the 120-200 tick normal-tree respawn. */
const NO_TREE_GIVE_UP_TICKS = 300;
/** Consecutive failed chops before the task fails. */
const CHOP_FAIL_LIMIT = 8;
/**
 * Nothing changes while a chop times out, so the watchdog must outlast CHOP_FAIL_LIMIT timeouts in a row
 * for the task to report them; one more chop wait covers the sends between them and slow ticks. That is
 * also above the no-tree give-up and the engine default (90s), so a full respawn wait is not a stall.
 */
export const SILENT_STREAK_TICKS = [
    failStreakTicks(CHOP_FAIL_LIMIT, CHOP_WAIT_TICKS),
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
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
interface WoodcuttingMemory {
    /** The tick the bot first found no tree to chop, until it finds one again. */
    noTreeSinceTick: number | null;
    /** Idle ticks and the ones with a tree in view outside the area (diagnostic, lib/area-watch.ts). */
    areaWatch: AreaWatch;
}
type Ctx = TaskContext<WoodcuttingParams, WoodcuttingMemory>;

const logsHeld = (ctx: Ctx) => countItems(ctx.state(), TREES[ctx.params.tree].logs);
const fullWithoutLogs = (ctx: Ctx) => ({ fail: `inventory full with no ${ctx.params.tree} logs` });

/**
 * A tree of the task's kind the bot can chop now. Only trees inside the area, or return-to-area and
 * chop would trade the bot back and forth.
 */
function choppable(params: WoodcuttingParams): (loc: NearbyLoc) => boolean {
    const isTree = treeOfKind(params);
    return t => isTree(t) && inArea(params.area, t);
}

/** A tree of the task's kind the bot could chop, wherever it stands. */
function treeOfKind(params: WoodcuttingParams): (loc: NearbyLoc) => boolean {
    const { pattern } = TREES[params.tree];
    return t => pattern.test(t.name) && t.reachable === true && t.options.some(o => CHOP_OPTION.test(o));
}

/**
 * No tree to chop. Stumps count as none, so stay put (returnToAreaStep keeps us inside) and wait for a
 * respawn, failing once there has been no tree for NO_TREE_GIVE_UP_TICKS.
 */
function* waitForRespawn(ctx: Ctx): Op<Outcome> {
    const now = ctx.state().tick;
    if (ctx.memory.noTreeSinceTick === null) {
        ctx.memory.noTreeSinceTick = now;
        yield* log(`no ${ctx.params.tree} available, waiting for a respawn`);
    }
    const since = ctx.memory.noTreeSinceTick;
    const left = Math.max(0, since + NO_TREE_GIVE_UP_TICKS - now);
    const isChoppable = choppable(ctx.params);
    const seen = (s: BotWorldState) => outsideSighting(s, ctx.params.area, s.nearbyLocs, treeOfKind(ctx.params));
    const respawn = yield* trackIdle(
        ctx,
        ctx.memory.areaWatch,
        seen,
        wait('tree respawn', s => s.nearbyLocs.some(isChoppable), left),
    );
    if (respawn.kind === 'met') return;
    const seconds = Math.round(((respawn.state.tick - since) * TICK_MS) / 1000);
    const { area } = ctx.params;
    return {
        fail: area
            ? `area depleted: no reachable ${ctx.params.tree} in radius ${area.radius} for ${seconds}s`
            : `no reachable ${ctx.params.tree} nearby for ${seconds}s`,
    };
}

export default defineTask({
    name: 'woodcutting',
    description:
        'Chop trees of one type; when the inventory is full, `onFull` "drop" (default) drops the logs and keeps chopping, ' +
        '"stop" ends the run done ("inventory full: N logs") holding them, e.g. to feed fletching/firemaking. Needs an axe and the level for the tree. ' +
        'When every tree in reach is a stump it waits up to 2 min for respawns, then fails "area depleted". ' +
        'While attacked it pauses and lets auto-retaliate finish a winnable fight, then resumes. It fails at once if auto-retaliate is off or the attacker out-levels the bot, and after 40 ticks if the attacker is unknown. ' +
        'With `area` it stays within `radius` of that centre; without it, it chops wherever the bot stands. ' +
        'Verified spot: Lumbridge trees (3195,3220, radius 12). Unverified: Varrock oaks (3190,3458); ' +
        'Draynor willows (3087,3235, dark wizards nearby). Refuses areas reaching the Wilderness.',
    params: Params,
    diagnostics: ctx => areaWatchReport(ctx.memory.areaWatch, ctx.params.area),
    memory: (): WoodcuttingMemory => ({ noTreeSinceTick: null, areaWatch: newAreaWatch() }),
    // Chopping a tree cancels auto-retaliate, so a bot under attack must not touch one.
    guards: [underAttackGuard],
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
            run(ctx) {
                const held = logsHeld(ctx);
                return held === 0 ? fullWithoutLogs(ctx) : { done: `inventory full: ${held} logs` };
            },
        },
        {
            name: 'drop-logs',
            when: ctx => ctx.params.onFull === 'drop' && ctx.inventoryFull(),
            *run(ctx) {
                if (logsHeld(ctx) === 0) return fullWithoutLogs(ctx);
                const dropped = yield* drop(ctx, TREES[ctx.params.tree].logs);
                if (ctx.inventoryFull()) {
                    const how = dropped.ok ? `dropped ${dropped.slotsDropped}` : dropped.message;
                    return { fail: `inventory still full after dropping logs (${how})` };
                }
            },
        },
        returnToAreaStep<WoodcuttingParams>(params => params.area),
        {
            name: 'chop',
            when: () => true,
            *run(ctx) {
                const tree = ctx
                    .state()
                    .nearbyLocs.filter(choppable(ctx.params))
                    .sort((x, y) => x.distance - y.distance)[0];
                if (!tree) return yield* waitForRespawn(ctx);
                ctx.memory.noTreeSinceTick = null;
                const chopped = yield* chop(ctx, tree, TREES[ctx.params.tree].logs);
                const chopFails = ctx.streak('chopFails');
                if (chopped.ok) {
                    chopFails.reset();
                    return;
                }
                yield* log(`chop failed: ${chopped.message}`);
                if (chopFails.add() >= CHOP_FAIL_LIMIT)
                    return { fail: `${CHOP_FAIL_LIMIT} chops in a row failed (last: ${chopped.message})` };
            },
        },
    ],
});
