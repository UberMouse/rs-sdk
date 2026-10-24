import { z } from 'zod/v4';
import { INTERACT_WAIT_TICKS, interact } from '../actions/interaction';
import { messageCursor, messageSince } from '../actions/messages';
import { ROUTE_TOO_LONG, timedOutAdvancing, walkTo } from '../actions/walk';
import { log, wait } from '../core/op';
import { AreaSchema, type Area, refuseArea, returnToAreaStep } from '../lib/area';
import { ItemSpec, itemLabel, itemMatches, matcher, missingItem, Pattern } from '../lib/spot';
import { defineTask } from '../lib/task';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/** Locates that got no hint in a row before the task fails. */
const LOCATE_FAIL_LIMIT = 3;
/** Walks of a hop that failed in a row before the task fails. */
const HOP_WALK_FAIL_LIMIT = 3;
/** One hop's walk: a few tiles, so a stalled one is cut short and the next hint re-aims it. */
export const HOP_WALK_TICKS = 40;
/** A hop's route may run this many tiles over twice its length: round a tree, not round a pond. */
const HOP_DETOUR_TILES = 4;
/** The longest route the long-way retry of a hop takes (it is walked HOP_WALK_TICKS at a time). */
const FAR_ROUTE_TILES = 120;
/** Ticks after the stop message the target NPC is given to appear in view. */
export const SPAWN_WAIT_TICKS = 5;
/** Ticks held back from a hop's walk budget for the step's own work after the walk. */
const HOP_RESERVE_TICKS = 2;
/** The step covers one locate wait and one walk with room to spare. */
const STEP_TIMEOUT_MS = 120_000;
const STUCK_AFTER_MS = stuckWindowMs(
    failStreakTicks(LOCATE_FAIL_LIMIT, INTERACT_WAIT_TICKS),
    failStreakTicks(HOP_WALK_FAIL_LIMIT, HOP_WALK_TICKS),
);
/** A step never shrinks below this many tiles. */
const MIN_STEP = 1;

/** The eight compass words, longest first so "north-west" is not read as "north". */
export const COMPASS_HINT = '\\b(?:north-?east|north-?west|south-?east|south-?west|north|south|east|west)\\b';

const Params = z.object({
    /** The inventory item whose option prints the hint (name regex or `{ id }`): the Hunters' talisman. */
    item: ItemSpec,
    /** The item option that asks for a hint (regex on the option text): "Locate". */
    option: Pattern,
    /** A game message carrying a compass word (north, south-east, ...): the direction to walk. */
    hint: Pattern.default(COMPASS_HINT),
    /** A game message that ends the run done: the target is found ("The Draugen is here"). */
    stop: Pattern,
    /**
     * A game message saying the thing hunted moved off and the hint now points at a new one ("moved elsewhere"):
     * the step sizes start over. Without this match no relocation is noticed.
     */
    moved: Pattern.default('moved elsewhere'),
    /** An NPC name regex; the run is done as soon as one stands in view (checked before each locate). */
    target: Pattern.optional(),
    /** Tiles walked per hop along each compass axis at most; an axis whose direction flips halves its step (to 1), the same direction twice doubles it back. */
    step: z.number().int().min(MIN_STEP).max(30).default(8),
    /** Stay inside this area: a hop is clipped to it, and a hint that points out of it fails the run. */
    area: AreaSchema.optional(),
    /** Locate-and-walk hops before the run fails: the hints did not converge. */
    maxHops: z.number().int().min(1).default(60),
    /** Times the hunted thing may move off (see `moved`) before the run fails. */
    maxRelocations: z.number().int().min(0).default(6),
});

type LocateParams = z.infer<typeof Params>;
interface Sign {
    x: number;
    z: number;
}
interface LocateMemory {
    /** Current step per axis, in tiles. */
    stepX: number;
    stepZ: number;
    /** The previous hint's direction per axis (-1, 0, 1), null before the first. */
    last: Sign | null;
    relocations: number;
}

/** North is +z and east is +x. A hint with no compass word has no direction. */
export function parseDirection(text: string): Sign | null {
    const t = text.toLowerCase();
    const north = t.includes('north') ? 1 : t.includes('south') ? -1 : 0;
    const east = t.includes('east') ? 1 : t.includes('west') ? -1 : 0;
    return east === 0 && north === 0 ? null : { x: east, z: north };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where a hop of `dir` from (px, pz) lands, clipped to the area. */
function hopTarget(px: number, pz: number, dir: Sign, sx: number, sz: number, area: Area | undefined) {
    const gx = px + dir.x * sx;
    const gz = pz + dir.z * sz;
    if (!area) return { x: gx, z: gz };
    return {
        x: clamp(gx, area.x - area.radius, area.x + area.radius),
        z: clamp(gz, area.z - area.radius, area.z + area.radius),
    };
}

const startOver = (m: LocateMemory, step: number) => {
    m.stepX = step;
    m.stepZ = step;
    m.last = null;
};

export default defineTask({
    name: 'locate',
    description:
        'Follows an item\'s compass hints to a moving target. Each hop uses the item\'s option (`option`, e.g. "Locate"), reads the ' +
        'game message it prints, and walks `step` tiles that way (north/south/east/west/north-east/... by `hint`, +z is north), then asks again; ' +
        'done once a message matching `stop` appears, or an NPC matching `target` is in view. An axis whose direction flips between hints halves its step (down to 1) and the same direction twice doubles it back, a diagonal hop whose tile is blocked is tried along one axis, ' +
        'so the walk closes in on the target instead of circling it. A hop is clipped to `area` (centre, radius), and a hint pointing out of it fails the run; ' +
        'it fails after `maxHops` hops (the hints do not converge), `maxRelocations` times the thing hunted moved off (message `moved`; the server then re-locates by itself), ' +
        "or three locates with no hint. Needs the item held. Verified: the Fremennik Trials Hunters' talisman near Rellekka (Sigli): " +
        '{"item":"^Hunters\' talisman$","option":"^Locate$","stop":"Draugen is here","target":"^The Draugen$","area":{"x":2690,"z":3620,"radius":70}}, ' +
        'then run `combat` on "The Draugen" (wiki/quests/fremennik-trials.md). Pass an `area`: without one a hunt can wander far. Threats on the way are left to the engine guards. A `target` already in view ends the run done, even if it is another hunter\'s. Refuses an area reaching the Wilderness.',
    params: Params,
    memory: (): LocateMemory => ({ stepX: 0, stepZ: 0, last: null, relocations: 0 }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const { item, area } = ctx.params;
        if (!ctx.state().inventory.some(i => itemMatches(item, i))) return missingItem(item, 'locate with');
        return refuseArea(area);
    },

    steps: [
        {
            name: 'in-view',
            when: ctx => {
                const { target } = ctx.params;
                return !!target && ctx.state().nearbyNpcs.some(n => matcher(target).test(n.name));
            },
            run(ctx) {
                const npc = ctx.state().nearbyNpcs.find(n => matcher(ctx.params.target ?? '').test(n.name));
                return { done: `${npc?.name ?? 'the target'} is in view` };
            },
        },
        returnToAreaStep<LocateParams>(params => params.area),
        {
            name: 'hop',
            when: () => true,
            *run(ctx) {
                const p = ctx.params;
                const m = ctx.memory;
                if (m.stepX === 0) startOver(m, p.step);
                const hops = ctx.counter('hops');
                if (hops.add() > p.maxHops)
                    return { fail: `${p.maxHops} hops and the hints have not led to the target` };
                const item = ctx.state().inventory.find(i => itemMatches(p.item, i));
                if (!item) return { fail: missingItem(p.item, 'locate with') };

                const cursor = messageCursor(ctx.state());
                const r = yield* interact(ctx, { kind: 'item', item }, matcher(p.option), {
                    expect: new RegExp(`(?:${p.hint})|(?:${p.stop})`, 'i'),
                });
                const fails = ctx.streak('locateFails');
                if (!r.ok) {
                    yield* log(`${p.option} failed (${r.reason}): ${r.message}`);
                    if (r.reason === 'no-option' || r.reason === 'refused' || r.reason === 'cant-reach')
                        return { fail: `${itemLabel(p.item)} ${p.option}: ${r.message}` };
                    if (fails.add() >= LOCATE_FAIL_LIMIT)
                        return {
                            fail: `${LOCATE_FAIL_LIMIT} locates in a row gave no hint (last ${r.reason}: ${r.message})`,
                        };
                    return;
                }
                fails.reset();
                if (matcher(p.stop).test(r.effect)) {
                    // The thing found spawns with the message; give it a few ticks to show, so a phase after this one sees it.
                    const rx = p.target ? matcher(p.target) : undefined;
                    const seen = rx
                        ? yield* wait('target in view', s => s.nearbyNpcs.some(n => rx.test(n.name)), SPAWN_WAIT_TICKS)
                        : undefined;
                    const shown = seen?.kind === 'met' ? ' (in view)' : '';
                    return { done: `${r.effect} after ${hops.add(0)} hops${shown}` };
                }

                if (messageSince(ctx.state(), cursor, matcher(p.moved))) {
                    m.relocations++;
                    startOver(m, p.step);
                    yield* log(`the target moved off (${m.relocations}); step sizes start over`);
                    if (m.relocations > p.maxRelocations)
                        return { fail: `the target moved off ${m.relocations} times; the hints do not converge` };
                }
                const dir = parseDirection(matcher(p.hint).exec(r.effect)?.[0] ?? r.effect);
                if (!dir) return { fail: `no compass direction in ${r.effect}` };

                // A flipped axis overshot: halve its step. The same direction again: double it back toward `step`.
                // An axis the hint dropped (0) is on the line already.
                if (m.last) {
                    if (m.last.x * dir.x < 0) m.stepX = Math.max(MIN_STEP, Math.ceil(m.stepX / 2));
                    if (m.last.x * dir.x > 0) m.stepX = Math.min(p.step, m.stepX * 2);
                    if (m.last.z * dir.z < 0) m.stepZ = Math.max(MIN_STEP, Math.ceil(m.stepZ / 2));
                    if (m.last.z * dir.z > 0) m.stepZ = Math.min(p.step, m.stepZ * 2);
                }
                m.last = dir;

                const here = ctx.state().player;
                if (!here) return;
                // The diagonal hop first; when its tile is blocked (a tree, a fence) one axis alone may still go.
                const goals = [
                    hopTarget(here.worldX, here.worldZ, dir, m.stepX, m.stepZ, p.area),
                    ...(dir.x !== 0 && dir.z !== 0
                        ? [
                              hopTarget(here.worldX, here.worldZ, { x: dir.x, z: 0 }, m.stepX, m.stepZ, p.area),
                              hopTarget(here.worldX, here.worldZ, { x: 0, z: dir.z }, m.stepX, m.stepZ, p.area),
                          ]
                        : []),
                ].filter(
                    (g, i, all) =>
                        (g.x !== here.worldX || g.z !== here.worldZ) &&
                        all.findIndex(h => h.x === g.x && h.z === g.z) === i,
                );
                if (goals.length === 0)
                    return { fail: `${r.effect} points out of the area at (${here.worldX},${here.worldZ})` };

                const walkFails = ctx.streak('hopWalkFails');
                let lastFailure = '';
                let detoured = false;
                // Each goal on a route not much longer than the hop; when only the detour stopped them (a stream with the
                // bridge up the bank), the first goal once more by any route up to FAR_ROUTE_TILES.
                const attempts = goals.map(goal => ({
                    goal,
                    limit:
                        2 * Math.max(Math.abs(goal.x - here.worldX), Math.abs(goal.z - here.worldZ)) + HOP_DETOUR_TILES,
                }));
                for (let i = 0; i <= attempts.length; i++) {
                    const last = i === attempts.length;
                    if (last && !detoured) break;
                    const attempt = last ? { goal: goals[0]!, limit: FAR_ROUTE_TILES } : attempts[i]!;
                    const { goal } = attempt;
                    yield* log(
                        `hop ${hops.add(0)}: ${r.effect} from (${here.worldX},${here.worldZ}) to (${goal.x},${goal.z})${last ? ' by the long way' : ''}`,
                    );
                    const before = ctx.distanceTo(goal.x, goal.z);
                    // Within a tile of the goal is enough (it may be a tree), except for a 1-tile hop, which would never move.
                    const span = Math.max(Math.abs(goal.x - here.worldX), Math.abs(goal.z - here.worldZ));
                    const w = yield* walkTo(ctx, goal.x, goal.z, span > 1 ? 1 : 0, {
                        maxTicks: HOP_WALK_TICKS,
                        maxRouteTiles: attempt.limit,
                        reserveTicks: HOP_RESERVE_TICKS,
                    });
                    if (w.ok || timedOutAdvancing(w, before, ctx.distanceTo(goal.x, goal.z))) {
                        walkFails.reset();
                        return;
                    }
                    lastFailure = w.message;
                    if (w.reason === 'no-path' && ROUTE_TOO_LONG.test(w.message)) detoured = true;
                    yield* log(`hop to (${goal.x},${goal.z}) failed (${w.reason}): ${w.message}`);
                }
                // Nowhere to go that way (water, a fence): a shorter hop next time.
                m.stepX = Math.max(MIN_STEP, Math.ceil(m.stepX / 2));
                m.stepZ = Math.max(MIN_STEP, Math.ceil(m.stepZ / 2));
                if (walkFails.add() >= HOP_WALK_FAIL_LIMIT)
                    return { fail: `${HOP_WALK_FAIL_LIMIT} hops in a row could not walk (last: ${lastFailure})` };
            },
        },
    ],
});
