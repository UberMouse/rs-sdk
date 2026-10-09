import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { burn } from '../actions/burn';
import { walkTo } from '../actions/walk';
import { log, type Op } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { countItems, exactName, findSkill } from '../lib/util';

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

const hasTinderbox = (state: BotWorldState) => state.inventory.some(i => TINDERBOX.test(i.name));

/** After a refused or timed-out light, walk to the first reachable tile 1..SIDESTEP_MAX_TILES away inside the area. */
function* sidestep(ctx: Ctx): Op<void> {
    const p = ctx.state().player;
    if (!p) return;
    for (let d = 1; d <= SIDESTEP_MAX_TILES; d++) {
        for (const [dx, dz] of SIDESTEP_DIRS) {
            const tx = p.worldX + dx * d;
            const tz = p.worldZ + dz * d;
            if (!inArea(ctx.params.area, { x: tx, z: tz })) continue;
            const r = yield* walkTo(ctx, tx, tz, 0);
            if (r.ok) return;
            yield* log(`sidestep to (${tx},${tz}) failed: ${r.message}`);
            // The step's budget is spent: the next light, in a fresh step, sidesteps again if it must.
            if (r.reason === 'no-time') return;
        }
    }
    yield* log('sidestep: no candidate tile reachable');
}

export default defineTask({
    name: 'firemaking',
    description:
        'Light logs from the inventory with a tinderbox until none of the given log type are left. ' +
        'Needs a tinderbox, the logs (exact item name, default "Logs") and the Firemaking level for them. ' +
        'Each light moves the bot one tile west; a refused light, or one that never catches, makes it step to another tile. ' +
        'Requires `area`: it stays within `radius` of that centre, so pick open ground away from walls, water and monsters. ' +
        'Verified spot: area {x:3230,z:3240,radius:6} (field east of the Lumbridge General Store).',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,

    preflight(ctx) {
        const s = ctx.state();
        if (!hasTinderbox(s)) return 'no tinderbox in inventory';
        if (countItems(s, exactName(ctx.params.logs)) === 0) return `no "${ctx.params.logs}" in inventory`;
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
            when: ctx => countItems(ctx.state(), exactName(ctx.params.logs)) === 0,
            run: ctx => ({ done: `no ${ctx.params.logs} left to burn` }),
        },
        returnToAreaStep<FiremakingParams>(params => params.area),
        {
            name: 'no-tinderbox',
            when: ctx => !hasTinderbox(ctx.state()),
            run: () => ({ fail: 'no tinderbox in inventory' }),
        },
        {
            name: 'burn',
            when: () => true,
            *run(ctx) {
                const burned = yield* burn(ctx, exactName(ctx.params.logs));
                const fails = ctx.streak('burnFails');
                if (burned.ok) {
                    fails.reset();
                    return;
                }
                yield* log(`light failed: ${burned.message}`);
                if (fails.add() >= BURN_FAIL_LIMIT)
                    return { fail: `${BURN_FAIL_LIMIT} lights in a row failed (last: ${burned.message})` };
                // A refused tile needs another; after a timeout the logs lie on this one (burn.ts), so leave it
                // rather than light again on top of them. Other failures are not about the tile.
                if (burned.reason === 'cant-light-here' || burned.reason === 'timeout') yield* sidestep(ctx);
            },
        },
    ],
});
