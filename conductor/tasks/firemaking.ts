import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { BURN_WAIT_TICKS, burn } from '../actions/burn';
import { collisionPaths } from '../actions/paths';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, wait } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { countItems, exactName, findSkill } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

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
/**
 * The watchdog outlasts the fail streaks, so the task's own reason surfaces and not `stuck`: the walks
 * back to the area (WALK_FAIL_LIMIT of them, each up to WALK_MAX_TICKS without moving the bot) and the
 * lights (BURN_FAIL_LIMIT timed-out ones, each BURN_WAIT_TICKS of nothing).
 */
export const SILENT_STREAK_TICKS = [
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
    failStreakTicks(BURN_FAIL_LIMIT, BURN_WAIT_TICKS),
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
/** Ticks to let the bot step west off a fire it just lit before deciding from where it stands. */
const STEP_OFF_WAIT_TICKS = 3;
/** Consecutive walks to a line's start that fail before the task gives up. */
const LINE_WALK_FAIL_LIMIT = 3;
/** One light plus the walk back to an area can exceed the engine's default step timeout. */
const STEP_TIMEOUT_MS = 120_000;

const Params = z.object({
    /** Exact item name of the logs to burn. */
    logs: z.string().default('Logs'),
    /** Burn near here; walk back when further than `radius`. Lines are picked only inside it. */
    area: AreaSchema,
});

type FiremakingParams = z.infer<typeof Params>;

const hasTinderbox = (state: BotWorldState) => state.inventory.some(i => TINDERBOX.test(i.name));

/** The client reports nearby locs (fires) only this far (Chebyshev) from the player; a tile further out may hold an unseen fire. */
const SCAN_RADIUS = 15;

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
 * bot among equals. A line of n clear tiles in a row, east to west, gives n - 1 lights. Only tiles within
 * SCAN_RADIUS of the bot count: beyond it the state cannot show a fire.
 */
export function pickLine(ctx: Ctx, logs: number): Line | null {
    const s = ctx.state();
    const p = s.player;
    const a = ctx.params.area;
    if (!p) return null;
    let best: { line: Line; lights: number; dist: number } | null = null;
    const west = a.x - a.radius;
    const seen = (x: number, tileZ: number) =>
        Math.max(Math.abs(p.worldX - x), Math.abs(p.worldZ - tileZ)) <= SCAN_RADIUS;
    for (let tz = a.z - a.radius; tz <= a.z + a.radius; tz++) {
        // run[x - west]: clear tiles in a row from x westward, inside the area.
        const run: number[] = [];
        for (let x = west; x <= a.x + a.radius; x++) {
            const ok = inArea(a, { x, z: tz }) && seen(x, tz) && tileClear(ctx, s, x, tz);
            run.push(ok ? (run[x - west - 1] ?? 0) + 1 : 0);
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
        'Light logs from the inventory with a tinderbox until none of the given log type are left. ' +
        'Needs a tinderbox, the logs (exact item name, default "Logs") and the Firemaking level for them. ' +
        'Each light moves the bot one tile west, so it first picks a line inside `area` of clear tiles running east to west ' +
        '(walkable per the collision data, no fire or other loc, no ground item; walls or fences between two tiles are not checked), long enough for the logs held, and burns along it; ' +
        'when the line is used up, or a tile refuses a fire, it picks a fresh line, and fails when no line is left in the area, when line starts are unreachable, or when lights keep failing. ' +
        'Requires `area`: it stays within `radius` of that centre (lines are picked only on tiles within 15 of the bot, as far as the client reports fires), so pick open ground; narrow paths between walls fit only a few fires. ' +
        'Verified spot: area {x:3230,z:3240,radius:6} (field east of the Lumbridge General Store).',
    params: Params,
    memory: (): Mem => ({ line: null, bad: new Set(), lit: 0 }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

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
                    const walkFails = ctx.streak('lineWalkFails');
                    if (walked.ok) {
                        walkFails.reset();
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
                    if (walkFails.add() >= LINE_WALK_FAIL_LIMIT)
                        return {
                            fail: `${LINE_WALK_FAIL_LIMIT} line starts in a row unreachable (last: ${walked.message})`,
                        };
                    return;
                }
                const burned = yield* burn(ctx, exactName(ctx.params.logs));
                const fails = ctx.streak('burnFails');
                if (burned.ok) {
                    fails.reset();
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
                if (fails.add() >= BURN_FAIL_LIMIT)
                    return { fail: `${BURN_FAIL_LIMIT} lights in a row failed (last: ${burned.message})` };
                // A refused tile, or one holding the logs after a timeout (burn.ts), is never lit on again; pick a
                // fresh line. Other failures are not about the tile.
                if (burned.reason === 'cant-light-here' || burned.reason === 'timeout') abandonLine(mem, line);
            },
        },
    ],
});
