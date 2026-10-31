import { z } from 'zod/v4';
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { interactNpc } from '../actions/interact';
import { messageCursor, messageSince } from '../actions/messages';
import { walkTo } from '../actions/walk';
import { log, send, wait } from '../core/op';
import { defineTask, type TaskContext } from '../lib/task';
import { Pattern, matcher } from '../lib/spot';

// Herding: an NPC that a prod (op1) moves one tile directly away from the player, as the diseased sheep of
// Sheep Herder do (server/content/scripts/quests/quest_sheepherder/scripts/npcs/diseased_sheep.rs2: the larger
// axis of the player-to-NPC offset, a tie going east or west). The player must stand orthogonally beside the NPC,
// opposite the way it should go; a diagonal prod is ignored. The NPC wanders home within ~10-30 ticks of a prod,
// so the task prods again as soon as it has stepped to the next stand tile, locked onto one NPC instance.

/** Ticks to reach the stand tile (usually one tile away) before the approach counts as failed. */
export const APPROACH_WAIT_TICKS = 6;
/** Ticks for a prod to move the NPC (the arrive delay, the NPC's step) before it counts as without effect. */
export const PROD_WAIT_TICKS = 5;
/** The player animation of a prod (seq cattleprod): the script ran and the NPC's step follows within a tick or two. */
export const PROD_ANIM = 799;
/** Prods the plan may run ahead of the NPC steps the state shows. */
const MAX_AHEAD = 2;
/** Within this many tiles of the stand tile the bot steps there directly instead of planning a route. */
const NEAR_STAND_TILES = 2;
/** Approaches in a row that do not reach the stand tile before the task fails. */
const APPROACH_FAIL_LIMIT = 4;
/** Prods in a row that do not move the NPC before the task fails. */
const PROD_FAIL_LIMIT = 4;
/** Prods in a row without the route getting shorter than ever before; the NPC wanders back, so some are lost. */
const NO_PROGRESS_LIMIT = 12;
/**
 * `goneIsDone` counts only within this many tiles (Chebyshev) of the goal: the state shows the NPC up to MAX_AHEAD
 * steps late and the Sheep Herder gate zone (the jump) is 3 tiles wide, beside the pen.
 */
const GONE_NEAR_TILES = MAX_AHEAD + 4;

const TileParam = z.object({ x: z.number().int(), z: z.number().int() });
const RectParam = z.object({
    minX: z.number().int(),
    maxX: z.number().int(),
    minZ: z.number().int(),
    maxZ: z.number().int(),
});

const Params = z.object({
    /** The NPC's name (case-insensitive regex), e.g. "^Diseased sheep 2$". */
    name: Pattern,
    /** Which copy to herd: the one nearest this tile when the run starts. Omit for the nearest to the bot. */
    from: TileParam.optional(),
    /** The option index to send: 1 is the NPC's first option ("Prod"). */
    op: z.number().int().min(1).max(5).default(1),
    /**
     * The tiles the NPC should pass, in order. Each leg is pushed along its larger axis (x on a tie); give a
     * corner as a waypoint wherever a fence or wall forbids the diagonal. After the last one the NPC is pushed on
     * in the last leg's direction until `stop` holds.
     */
    route: z.tuple([TileParam], TileParam),
    /** A waypoint counts as passed within this many tiles (Chebyshev). */
    tolerance: z.number().int().min(0).default(0),
    /** Done when the NPC stands in this rectangle. Omit: done when it reaches the last waypoint. */
    stop: RectParam.optional(),
    /**
     * Done, not failed, when the NPC leaves the view after the first prod (a prod teleported it away), but only if it
     * was last seen within a few tiles of the goal (`stop`, else the last waypoint); farther off it is lost.
     */
    goneIsDone: z.boolean().default(false),
});
type HerdParams = z.infer<typeof Params>;
type Tile = z.infer<typeof TileParam>;

interface HerdMemory {
    /** The locked NPC instance (index and type id), once chosen. */
    npc: { index: number; id: number } | null;
    /** Index of the waypoint being pushed toward. */
    leg: number;
    /** The shortest remaining route length seen. */
    best: number;
    prods: number;
    /** The tile the NPC was last seen on. */
    lastSeen: Tile | null;
    /** The direction of the last push. */
    lastDir: Tile | null;
    /**
     * Where the NPC was last seen, then the tiles the prods that ran (the player's animation) are taking it through,
     * before the state shows the steps. Always at least the tile it was seen on.
     */
    trail: Tile[];
}
type Ctx = TaskContext<HerdParams, HerdMemory>;

const tileOf = (n: NearbyNpc): Tile => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });
const manhattan = (a: Tile, b: Tile) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const same = (a: Tile, b: Tile) => a.x === b.x && a.z === b.z;
const inRect = (r: z.infer<typeof RectParam>, t: Tile) =>
    t.x >= r.minX && t.x <= r.maxX && t.z >= r.minZ && t.z <= r.maxZ;

/** Chebyshev distance from `t` to the rectangle (0 inside it). */
const rectDistance = (r: z.infer<typeof RectParam>, t: Tile): number =>
    Math.max(r.minX - t.x, 0, t.x - r.maxX, r.minZ - t.z, 0, t.z - r.maxZ);

/** The unit step that moves an NPC from `from` toward `to` along the larger axis of the offset (x on a tie); null at `to`. */
export function pushDirection(from: Tile, to: Tile): Tile | null {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (dx === 0 && dz === 0) return null;
    return Math.abs(dx) >= Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
}

/** The tile to prod from so the NPC at `npc` goes in `dir`: directly opposite it. */
export const standTile = (npc: Tile, dir: Tile): Tile => ({ x: npc.x - dir.x, z: npc.z - dir.z });

type Route = readonly [Tile, ...Tile[]];
/** Waypoint `i` of the route (the last for an index past it). */
const wp = (route: Route, i: number): Tile => route[Math.min(i, route.length - 1)] ?? route[0];

/** Route length left from `npc` through the waypoints from `leg` on. */
export function remaining(npc: Tile, route: Route, leg: number): number {
    let total = manhattan(npc, wp(route, leg));
    for (let i = leg + 1; i < route.length; i++) total += manhattan(wp(route, i - 1), wp(route, i));
    return total;
}

/** The direction to push `npc` now, and the waypoint index it heads for. After the last waypoint, on in the last leg's direction. */
export function nextPush(npc: Tile, route: Route, leg: number, tolerance: number): { dir: Tile; leg: number } | null {
    let l = leg;
    while (l < route.length - 1 && cheb(npc, wp(route, l)) <= tolerance) l++;
    const dir = pushDirection(npc, wp(route, l));
    if (dir) return { dir, leg: l };
    // On the last waypoint: carry on the way the last leg ran.
    const prev = l > 0 ? wp(route, l - 1) : null;
    const carry = prev ? pushDirection(prev, wp(route, l)) : null;
    return carry ? { dir: carry, leg: l } : null;
}

/** The NPC is no longer on `tile` (it stepped, or left view). */
const moved = (s: BotWorldState, npc: { index: number; id: number }, tile: Tile): boolean => {
    const n = findNpc(s, npc);
    return !n || !same(tileOf(n), tile);
};

/** The trail from the tile the NPC is now seen on; if it is on none of it, just that tile. */
const syncTrail = (trail: readonly Tile[], seen: Tile): Tile[] => {
    const i = trail.findIndex(t => same(t, seen));
    return i >= 0 ? trail.slice(i) : [seen];
};

const findNpc = (s: BotWorldState, locked: { index: number; id: number }) =>
    s.nearbyNpcs.find(n => n.index === locked.index && n.id === locked.id);

function pick(ctx: Ctx): NearbyNpc | undefined {
    const s = ctx.state();
    const p = s.player;
    const origin = ctx.params.from ?? (p ? { x: p.worldX, z: p.worldZ } : undefined);
    const re = matcher(ctx.params.name);
    const stop = ctx.params.stop;
    return s.nearbyNpcs
        .filter(n => re.test(n.name) && !(stop && inRect(stop, tileOf(n))))
        .sort((a, b) => (origin ? manhattan(tileOf(a), origin) - manhattan(tileOf(b), origin) : 0))[0];
}

export default defineTask({
    name: 'herd',
    description:
        'Herd one NPC along a route by repeated prods (option `op`, default 1): each cycle walks to the tile directly opposite the NPC ' +
        'from where it should go and sends the op, re-reading the NPC every tick, locked onto one instance among copies (`from` picks the copy nearest a tile). ' +
        'The NPC moves one tile per prod, along the larger axis, so give the route as waypoints (corners where fences forbid a diagonal); it ends done ' +
        'when the NPC stands in `stop` (default: reaches the last waypoint) or, with `goneIsDone`, leaves view after a prod (teleported) having been last seen within 6 tiles of the goal (farther off it is lost). ' +
        'Fails if the NPC is lost, the stand tile cannot be reached, prods do not move it, or the route gets no shorter for 12 prods. ' +
        'For Sheep Herder: Diseased sheep 2 spawns near (2622,3367); route (2594,3367) then (2594,3363) with `goneIsDone` (the jumped sheep is re-added in the pen as a new NPC) and `stop` the pen x2595-2609 z3351-3364 (needs the suit and prod wielded). A copy fenced off from the bot is walked round to; a prod answered with the can-not-reach message fails.',
    params: Params,
    memory: (): HerdMemory => ({
        npc: null,
        leg: 0,
        best: Infinity,
        prods: 0,
        lastSeen: null,
        lastDir: null,
        trail: [],
    }),

    preflight(ctx) {
        if (!pick(ctx)) return `no NPC matching /${ctx.params.name}/ in view`;
        return null;
    },

    steps: [
        {
            name: 'herd',
            when: () => true,
            *run(ctx) {
                const m = ctx.memory;
                const params = ctx.params;
                if (!m.npc) {
                    const chosen = pick(ctx);
                    if (!chosen) return { fail: `no NPC matching /${params.name}/ in view` };
                    m.npc = { index: chosen.index, id: chosen.id };
                    const t = tileOf(chosen);
                    yield* log(`herding ${chosen.name} #${chosen.index} from (${t.x},${t.z})`);
                }
                const npc = findNpc(ctx.state(), m.npc);
                if (!npc) {
                    const last = m.lastSeen;
                    if (params.goneIsDone && m.prods > 0 && last) {
                        const goal = params.stop ?? wp(params.route, params.route.length - 1);
                        const dist = 'minX' in goal ? rectDistance(goal, last) : cheb(last, goal);
                        if (dist <= GONE_NEAR_TILES) return { done: `${params.name} left view after ${m.prods} prods` };
                        return {
                            fail: `lost the NPC (#${m.npc.index}) after ${m.prods} prods, last seen (${last.x},${last.z}), ${dist} tiles from the goal, not a jump`,
                        };
                    }
                    return { fail: `lost the NPC (#${m.npc.index}) after ${m.prods} prods` };
                }
                const seen = tileOf(npc);
                m.lastSeen = seen;
                if (params.stop ? inRect(params.stop, seen) : same(seen, wp(params.route, params.route.length - 1)))
                    return { done: `NPC at (${seen.x},${seen.z}) after ${m.prods} prods` };
                // Prods that ran but whose steps the state does not show yet: plan from where the last one lands.
                const trail = syncTrail(m.trail, seen);
                m.trail = trail;
                const at = trail[trail.length - 1] ?? seen;
                const ahead = trail.length - 1;
                const landed = params.stop
                    ? inRect(params.stop, at)
                    : same(at, wp(params.route, params.route.length - 1));
                if (ahead > 0 && (ahead >= MAX_AHEAD || landed)) {
                    // Far enough ahead of what the state shows, or it lands in the stop area: let the state catch up.
                    const caught = yield* wait('herd npc step', st => moved(st, m.npc!, seen), PROD_WAIT_TICKS);
                    const misses = ctx.streak('prodMisses');
                    if (caught.kind === 'timeout') {
                        m.trail = [];
                        if (misses.add() >= PROD_FAIL_LIMIT)
                            return {
                                fail: `${PROD_FAIL_LIMIT} prods in a row did not move the NPC at (${seen.x},${seen.z})`,
                            };
                    } else misses.reset();
                    return;
                }
                // On the last waypoint of a one-waypoint route there is no leg to carry on: keep the last push.
                const push =
                    nextPush(at, params.route, m.leg, params.tolerance) ??
                    (m.lastDir ? { dir: m.lastDir, leg: m.leg } : null);
                if (!push) return { fail: `no direction to push from (${at.x},${at.z})` };
                m.leg = push.leg;
                m.lastDir = push.dir;
                const noProgress = ctx.streak('noProgress');
                const left = remaining(at, params.route, m.leg);
                if (left < m.best) {
                    m.best = left;
                    noProgress.reset();
                }

                const stand = standTile(at, push.dir);
                const player = ctx.state().player;
                if (!player) return;
                const here = { x: player.worldX, z: player.worldZ };
                // Standing on the stand tile, or one step behind it on the push line: the prod's own approach is that step.
                const inLine = same(here, stand) || same(here, standTile(stand, push.dir));
                if (!inLine) {
                    if (cheb(here, stand) > NEAR_STAND_TILES) {
                        // Far from the NPC (the start, or after a detour): route round fences and through doors.
                        const walked = yield* walkTo(ctx, stand.x, stand.z, NEAR_STAND_TILES);
                        const fails = ctx.streak('approachFails');
                        if (walked.ok) fails.reset();
                        else if (fails.add() >= APPROACH_FAIL_LIMIT)
                            return { fail: `can't walk to the NPC at (${at.x},${at.z}): ${walked.message}` };
                        return;
                    }
                    yield* send({ type: 'walkTo', x: stand.x, z: stand.z, running: true, reason: 'herd stand tile' });
                    const arrived = yield* wait(
                        'herd stand tile',
                        st =>
                            (st.player?.worldX === stand.x && st.player?.worldZ === stand.z) || moved(st, m.npc!, seen),
                        APPROACH_WAIT_TICKS,
                    );
                    const fails = ctx.streak('approachFails');
                    if (arrived.kind === 'met') {
                        fails.reset();
                        return;
                    }
                    if (fails.add() >= APPROACH_FAIL_LIMIT)
                        return {
                            fail: `can't reach the stand tile (${stand.x},${stand.z}) for the NPC at (${at.x},${at.z})`,
                        };
                    return;
                }

                ctx.streak('approachFails').reset();
                const cursor = messageCursor(ctx.state());
                const sentTick = ctx.state().tick;
                const prod = yield* interactNpc(npc, params.op);
                if (!prod.ok) return { fail: `prod failed: ${prod.message}` };
                m.prods++;
                const effect = yield* wait(
                    'herd prod effect',
                    st =>
                        (ahead === 0 && moved(st, m.npc!, seen)) ||
                        (st.tick > sentTick && st.player?.animId === PROD_ANIM),
                    PROD_WAIT_TICKS,
                );
                const misses = ctx.streak('prodMisses');
                if (effect.kind === 'timeout') {
                    m.trail = [];
                    if (messageSince(effect.state, cursor, /can't reach/i))
                        return { fail: `the NPC at (${at.x},${at.z}) can't be reached from (${stand.x},${stand.z})` };
                    if (misses.add() >= PROD_FAIL_LIMIT)
                        return { fail: `${PROD_FAIL_LIMIT} prods in a row did not move the NPC at (${at.x},${at.z})` };
                    return;
                }
                // Only an observed NPC step clears the misses; the prod's animation alone does not (a fenced NPC stays put).
                if (ahead === 0 && moved(effect.state, m.npc, seen)) misses.reset();
                m.trail = [...trail, { x: at.x + push.dir.x, z: at.z + push.dir.z }];
                if (noProgress.add() >= NO_PROGRESS_LIMIT)
                    return { fail: `no progress in ${NO_PROGRESS_LIMIT} prods (${m.best} tiles left at best)` };
            },
        },
    ],
});
