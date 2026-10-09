import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { AreaSchema, inArea, refuseArea, returnToAreaStep } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { findSkill } from '../lib/util';

/**
 * Firemaking level per log type, from server/content/scripts/skill_firemaking/configs/firemaking.obj
 * (levelrequire). Lookups can miss: unknown log types are refused in preflight.
 */
const LOG_LEVELS: Record<string, number | undefined> = {
    logs: 1,
    'oak logs': 15,
    'willow logs': 30,
    'maple logs': 45,
    'yew logs': 60,
    'magic logs': 75,
};

const TINDERBOX = /^tinderbox$/i;
const BURN_FAIL_LIMIT = 5;
/** How far a refused light moves the bot to find another tile. */
const SIDESTEP_MAX_TILES = 3;
/**
 * Candidate sidestep directions, tried in order. After each light the bot steps west off the fire, so the tile
 * just east is usually the fire it just lit (fires block movement): east goes last.
 */
const SIDESTEP_DIRS: readonly (readonly [number, number])[] = [
    [0, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
];
/** One light plus the walk back to an area can exceed the engine's default step timeout. */
const STEP_TIMEOUT_MS = 120_000;

const Params = z.object({
    /** Exact item name of the logs to burn. */
    logs: z.string().default('Logs'),
    /** Burn near here; walk back when further than `radius`. Bounds the westward drift and sidesteps. */
    area: AreaSchema,
});

type FiremakingParams = z.infer<typeof Params>;
type Ctx = TaskContext<FiremakingParams>;

const isLogs = (name: string, wanted: string) => name.toLowerCase() === wanted.toLowerCase();

const countLogs = (state: BotWorldState, wanted: string) =>
    state.inventory.filter(i => isLogs(i.name, wanted)).reduce((n, i) => n + i.count, 0);

const hasTinderbox = (state: BotWorldState) => state.inventory.some(i => TINDERBOX.test(i.name));

/** After a refused light, walk to the first reachable tile 1..SIDESTEP_MAX_TILES away inside the area. */
async function sidestep(ctx: Ctx): Promise<void> {
    const p = ctx.state().player;
    if (!p) return;
    for (let d = 1; d <= SIDESTEP_MAX_TILES; d++) {
        for (const [dx, dz] of SIDESTEP_DIRS) {
            const tx = p.worldX + dx * d;
            const tz = p.worldZ + dz * d;
            if (!inArea(ctx.params.area, { x: tx, z: tz })) continue;
            const r = await ctx.bot.walkTo(tx, tz, 0);
            if (r.success) return;
            ctx.log(`sidestep to (${tx},${tz}) failed: ${r.message}`);
        }
    }
    ctx.log('sidestep: no candidate tile reachable');
}

export default defineTask({
    name: 'firemaking',
    description:
        'Light logs from the inventory with a tinderbox until none of the given log type are left. ' +
        'Needs a tinderbox, the logs (exact item name, default "Logs") and the Firemaking level for them. ' +
        'Each light moves the bot one tile west; a refused light makes it step to another tile. ' +
        'Requires `area`: it stays within `radius` of that centre, so pick open ground away from walls, water and monsters. ' +
        'Verified spot: area {x:3230,z:3240,radius:6} (field east of the Lumbridge General Store).',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,

    preflight(ctx) {
        const s = ctx.state();
        if (!hasTinderbox(s)) return 'no tinderbox in inventory';
        if (countLogs(s, ctx.params.logs) === 0) return `no "${ctx.params.logs}" in inventory`;
        const need = LOG_LEVELS[ctx.params.logs.toLowerCase()];
        if (need === undefined)
            return `unknown log type "${ctx.params.logs}" (known: ${Object.keys(LOG_LEVELS).join(', ')})`;
        const skill = findSkill(s, 'Firemaking');
        if (!skill) return 'no Firemaking skill in state';
        if (skill.baseLevel < need) return `${ctx.params.logs} needs firemaking ${need}, bot has ${skill.baseLevel}`;
        return refuseArea(ctx.params.area);
    },

    steps: [
        {
            name: 'finish',
            when: ctx => countLogs(ctx.state(), ctx.params.logs) === 0,
            run: async ctx => ({ done: `no ${ctx.params.logs} left to burn` }),
        },
        returnToAreaStep<FiremakingParams>(params => params.area),
        {
            name: 'no-tinderbox',
            when: ctx => !hasTinderbox(ctx.state()),
            run: async () => ({ fail: 'no tinderbox in inventory' }),
        },
        {
            name: 'burn',
            when: () => true,
            async run(ctx) {
                const logs = ctx.state().inventory.find(i => isLogs(i.name, ctx.params.logs));
                if (!logs) return { fail: `no ${ctx.params.logs} in inventory` };
                const r = await ctx.bot.burnLogs(logs);
                const fails = ctx.counter('burnFails');
                if (r.success) {
                    fails.reset();
                    return;
                }
                ctx.log(`light failed: ${r.message}`);
                if (fails.add() >= BURN_FAIL_LIMIT)
                    return { fail: `${BURN_FAIL_LIMIT} lights in a row failed (last: ${r.message})` };
                await sidestep(ctx);
            },
        },
    ],
});
