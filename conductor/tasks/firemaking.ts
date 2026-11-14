import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { BURN_WAIT_TICKS, burn } from '../actions/burn';
import { collisionPaths } from '../actions/paths';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, wait } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_TO_AREA_SILENT_TICKS } from '../lib/area';
import { failStreak } from '../lib/streak';
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
// A timed-out light changes nothing the watchdog sees for BURN_WAIT_TICKS.
const BURN_FAILS = failStreak({
    name: 'burnFails',
    limit: BURN_FAIL_LIMIT,
    worstTicks: BURN_WAIT_TICKS,
    what: 'lights',
});
/** Consecutive walks to a line's start that fail before the task gives up. */
const LINE_WALK_FAIL_LIMIT = 3;
// A failed walk to a line's start can stall for WALK_MAX_TICKS without moving the bot.
const LINE_WALK_FAILS = failStreak({
    name: 'lineWalkFails',
    limit: LINE_WALK_FAIL_LIMIT,
    worstTicks: WALK_MAX_TICKS,
});
/** The watchdog outlasts the fail streaks, so the task's own reason surfaces and not `stuck`. */
const SILENT = [WALK_TO_AREA_SILENT_TICKS, LINE_WALK_FAILS, BURN_FAILS];
/** Ticks to let the bot step west off a fire it just lit before deciding from where it stands. */
const STEP_OFF_WAIT_TICKS = 3;
/** One light plus the walk back to an area can exceed the engine's default step timeout. */
const STEP_TIMEOUT_MS = 120_000;

/** The client reports nearby locs (fires) only this far (Chebyshev) from the player; a tile further out may hold an unseen fire. */
const SCAN_RADIUS = 15;

const Params = z.object({
    logs: z.string().default('Logs').describe('The logs to burn, by exact item name (whole name, case-insensitive).'),
    area: AreaSchema.describe(
        `Where to burn: the bot stays within \`radius\` of this centre and walks back when further, and lines are picked only on tiles inside it within ${SCAN_RADIUS} of the bot, as far as the client reports fires. Pick open ground: narrow paths between walls fit only a few fires.`,
    ),
});

type FiremakingParams = z.infer<typeof Params>;

const hasTinderbox = (state: BotWorldState) => state.inventory.some(i => TINDERBOX.test(i.name));

const key = (x: number, tileZ: number) => `${x},${tileZ}`;

/**
 * A run of tiles to light along, west from `x`: the bot stands on (x, z), lights, and steps onto (x-1, z), and
 * so on. `endX` is the last tile it lights on; the tile west of that is clear too, for the step off.
 */
interface Line {
    z: number;
    x: number;
    endX: number;
}

interface Mem {
    line: Line | null;
    /** Tiles that refused a fire, kept the logs, or could not be reached: never part of a line again this run. */
    bad: Set<string>;
    /** Lights that caught this run. */
    lit: number;
}
type Ctx = TaskContext<FiremakingParams, Mem>;

/** Marks the line's start tile bad for the rest of the run and drops the line, so the next loop picks a fresh one. */
function abandonLine(mem: Mem, line: Line): void {
    mem.bad.add(key(line.x, line.z));
    mem.line = null;
}

/** Walkable per the collision data, and holding no loc (a fire, a tree, a sign) or ground item, and not refused before. */
function tileClear(ctx: Ctx, s: BotWorldState, x: number, tileZ: number): boolean {
    if (ctx.memory.bad.has(key(x, tileZ))) return false;
    if (!(ctx.pathfinder ?? collisionPaths).walkable(s.player?.level ?? 0, x, tileZ)) return false;
    if (s.nearbyLocs.some(l => l.x === x && l.z === tileZ)) return false;
    return !s.groundItems.some(g => g.x === x && g.z === tileZ);
}

/**
 * The best line in the area for `logs` logs: as many lights as the logs (or the longest there is), nearest the
 * bot among equals. A line of n clear tiles in a row, east to west, gives n - 1 lights; each step west must be open
 * (`canStep`), since the game moves the bot west after a light. Only tiles within SCAN_RADIUS of the bot count:
 * beyond it the state cannot show a fire.
 */
export function pickLine(ctx: Ctx, logs: number): Line | null {
    const s = ctx.state();
    const p = s.player;
    const a = ctx.params.area;
    if (!p) return null;
    const paths = ctx.pathfinder ?? collisionPaths;
    const level = p.level;
    let best: { line: Line; lights: number; dist: number } | null = null;
    const west = a.x - a.radius;
    const seen = (x: number, tileZ: number) =>
        Math.max(Math.abs(p.worldX - x), Math.abs(p.worldZ - tileZ)) <= SCAN_RADIUS;
    for (let tz = a.z - a.radius; tz <= a.z + a.radius; tz++) {
        // run[x - west]: clear tiles in a row from x westward, inside the area.
        const run: number[] = [];
        for (let x = west; x <= a.x + a.radius; x++) {
            const ok = inArea(a, { x, z: tz }) && seen(x, tz) && tileClear(ctx, s, x, tz);
            // The run carries on west only if the step onto the next tile is open: a wall or fence on the edge
            // between them would stop the bot's step off the fire and the game would move it some other way.
            const joined = x > west && paths.canStep(level, x, tz, -1, 0) ? (run[x - west - 1] ?? 0) : 0;
            run.push(ok ? joined + 1 : 0);
        }
        for (let x = a.x + a.radius; x >= west; x--) {
            const lights = Math.min((run[x - west] ?? 0) - 1, logs);
            if (lights < 1) continue;
            const dist = Math.max(Math.abs(p.worldX - x), Math.abs(p.worldZ - tz));
            if (!best || lights > best.lights || (lights === best.lights && dist < best.dist))
                best = { line: { z: tz, x, endX: x - lights + 1 }, lights, dist };
        }
    }
    return best?.line ?? null;
}

export default defineTask({
    name: 'firemaking',
    description:
        'Lights logs from the inventory with a tinderbox until none of the given log type are left. ' +
        'Each light moves the bot one tile west, so it first picks a line inside `area` of clear tiles running east to west, long enough for the logs held, and burns along it; ' +
        'when the line is used up, or a tile refuses a fire, it picks a fresh line. ' +
        'Fails when no line is left in the area, when line starts are unreachable, or when lights keep failing.',
    rules: [
        `Needs a tinderbox, the logs and the base Firemaking level for them: ${Object.entries(LOG_LEVELS)
            .map(([logs, level]) => `${logs} ${level}`)
            .join(', ')}. Any other log type is refused.`,
        'A line tile must be walkable per the collision data, hold no fire or other loc and no ground item, and the step west between each two tiles must be open (no wall or fence on the edge).',
    ],
    spots: ['`area` {x:3230,z:3240,radius:6}: the field east of the Lumbridge General Store.'],
    params: Params,
    memory: (): Mem => ({ line: null, bad: new Set(), lit: 0 }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    silent: SILENT,

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
            run: ctx => ({ done: `no ${ctx.params.logs} left to burn (lit ${ctx.memory.lit})` }),
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
                const mem = ctx.memory;
                const left = countItems(ctx.state(), exactName(ctx.params.logs));
                if (mem.line && (mem.line.x < mem.line.endX || !tileClear(ctx, ctx.state(), mem.line.x, mem.line.z)))
                    mem.line = null;
                if (!mem.line) {
                    mem.line = pickLine(ctx, left);
                    if (!mem.line) return { fail: `no clear east-west line left in the area for ${left} more logs` };
                    const { x, z: lz, endX } = mem.line;
                    yield* log(`line: (${x},${lz}) west to (${endX - 1},${lz})`);
                }
                const line = mem.line;
                const p = ctx.state().player;
                if (!p) return { fail: 'no player in state' };
                if (p.worldX !== line.x || p.worldZ !== line.z) {
                    const before = ctx.distanceTo(line.x, line.z);
                    const walked = yield* walkTo(ctx, line.x, line.z, 0);
                    if (walked.ok) {
                        LINE_WALK_FAILS.clear(ctx);
                        return;
                    }
                    yield* log(`walk to line start (${line.x},${line.z}) failed: ${walked.message}`);
                    // A walk out of ticks, or one still closing in, is no verdict on the tile: the next loop walks on.
                    if (
                        walked.reason === 'no-time' ||
                        timedOutAdvancing(walked, before, ctx.distanceTo(line.x, line.z))
                    )
                        return;
                    abandonLine(mem, line);
                    return LINE_WALK_FAILS.missWith(
                        ctx,
                        `${LINE_WALK_FAIL_LIMIT} line starts in a row unreachable (last: ${walked.message})`,
                    );
                }
                const burned = yield* burn(ctx, exactName(ctx.params.logs));
                if (burned.ok) {
                    BURN_FAILS.clear(ctx);
                    mem.lit++;
                    mem.line = { ...line, x: line.x - 1 };
                    // The bot steps west once the fire catches: let it, so the next light starts from the next tile.
                    yield* wait(
                        'step off the fire',
                        st => st.player?.worldX === line.x - 1 && st.player.worldZ === line.z,
                        STEP_OFF_WAIT_TICKS,
                    );
                    return;
                }
                yield* log(`light failed: ${burned.message}`);
                // Not about the tile, and retrying cannot help.
                if (burned.reason === 'level-too-low' || burned.reason === 'no-logs') return { fail: burned.message };
                const failed = BURN_FAILS.miss(ctx, burned.message);
                if (failed) return failed;
                // A refused tile, or one holding the logs after a timeout (burn.ts), is never lit on again; pick a
                // fresh line. Other failures are not about the tile.
                if (burned.reason === 'cant-light-here' || burned.reason === 'timeout') abandonLine(mem, line);
            },
        },
    ],
});
