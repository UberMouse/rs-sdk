import { describe, expect, test } from 'bun:test';
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../../sdk/types';
import {
    DOOR_OPEN_TICKS,
    WALK_BASE_TICKS,
    WALK_MAX_TICKS,
    WALK_RESERVE_TICKS,
    WALK_TICKS_PER_TILE,
    ROUTE_TOO_LONG,
    walkBudgetTicks,
    type WalkResult,
    walkTo,
} from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { type Guard, interpret } from '../../core/interpret';
import { ticks } from '../../core/op';
import { door, type FakePaths, fakePaths, type Router, straightPaths } from '../paths';
import { walking } from '../react';
import { world } from '../world';

type Tile = { x: number; z: number };
type Blocked = (from: Tile, to: Tile, s: BotWorldState) => boolean;
const route = (...tiles: Tile[]) => tiles.map(t => ({ ...t, level: 0 }));
const full =
    (...tiles: Tile[]): Router =>
    () => ({ success: true, reachedDestination: true, waypoints: route(...tiles) });

interface Run {
    paths?: FakePaths;
    blocked?: Blocked;
    /** What a send other than a walk does to the world (a door opening). */
    react?: (action: BotAction, state: BotWorldState) => Effect | undefined;
    respond?: (action: BotAction) => ActionResult | undefined;
    guards?: Guard[];
    maxTicks?: number;
    reserveTicks?: number;
    maxRouteTiles?: number;
    /** The step's tick budget, counted from the first state's tick, as the engine gives ctx.stepTicksLeft. */
    stepBudget?: number;
}

/** Walks to (x, z) from the first state, with sends moving the bot (`walking`). */
async function walk(states: BotWorldState[], x: number, z: number, tolerance?: number, opts: Run = {}) {
    const paths = opts.paths ?? straightPaths();
    const sentAt: number[] = [];
    const driver: TimelineDriver = new TimelineDriver(states, {
        react: walking((a, s) => opts.react?.(a, s), opts.blocked),
        respond: a => {
            sentAt.push(driver.state().tick);
            return opts.respond?.(a);
        },
    });
    const startTick = driver.state().tick;
    const { stepBudget } = opts;
    const ctx = {
        state: () => driver.state(),
        pathfinder: paths,
        stepTicksLeft: () => (stepBudget === undefined ? undefined : startTick + stepBudget - driver.state().tick),
    };
    const walkOpts = { maxTicks: opts.maxTicks, reserveTicks: opts.reserveTicks, maxRouteTiles: opts.maxRouteTiles };
    const run = await interpret(walkTo(ctx, x, z, tolerance, walkOpts), {
        driver,
        guards: opts.guards,
    });
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : []));
    const logs = driver.commands.flatMap(c => (c.type === 'log' ? [c.msg] : []));
    const at = () => {
        const p = driver.state().player;
        return p && { x: p.worldX, z: p.worldZ };
    };
    const result = (): WalkResult => {
        if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
        return run.value;
    };
    return { run, result, driver, paths, sends, sentAt, logs, at };
}

const standing = (at: Tile) => world().player({ at }).series(1);

describe('walkTo: partial routes (ported from sdk/test/walkto-partial-path.test.ts)', () => {
    const start = { x: 3153, z: 3427 };

    test('fails fast with the shortfall when re-queries dead-end at the same tile', async () => {
        // From inside a Varrock house every route to the bank stops at (3164, 3435), 21 tiles short.
        const deadEnd = { x: 3164, z: 3435 };
        const paths = fakePaths(() => ({
            success: true,
            reachedDestination: false,
            waypoints: route({ x: 3160, z: 3432 }, deadEnd),
        }));
        const w = await walk(standing(start), 3185, 3436, 2, { paths });
        expect(w.result()).toMatchObject({ ok: false, reason: 'dead-end' });
        expect(w.result().message).toContain('stops');
        expect(w.result().message).toContain('(3164, 3435)');
        // One partial route walked, and one re-query that finds the repeat: not 50 walks of it.
        expect(paths.queries).toHaveLength(2);
    });

    test('a partial route that reaches within tolerance still succeeds', async () => {
        const paths = fakePaths(() => ({
            success: true,
            reachedDestination: false,
            waypoints: route({ x: 3183, z: 3436 }),
        }));
        const w = await walk(standing(start), 3185, 3436, 3, { paths });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
    });

    test('full routes still arrive', async () => {
        const paths = fakePaths(full({ x: 3170, z: 3430 }, { x: 3185, z: 3436 }));
        const w = await walk(standing(start), 3185, 3436, 2, { paths });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(w.sends).toEqual(['walk to (3170, 3430)', 'walk to (3185, 3436)']);
    });

    test('rejects non-numeric coordinates instead of walking', async () => {
        const paths = straightPaths();
        const w = await walk(standing(start), undefined as never, undefined as never, 3, { paths });
        expect(w.result()).toMatchObject({ ok: false, reason: 'bad-coordinates' });
        expect(w.result().message).toContain('numeric');
        expect(paths.queries).toHaveLength(0);
        expect(w.sends).toEqual([]);
    });
});

/** Edgeville, just south of the Wilderness ditch (z 3520). */
const EDGEVILLE = { x: 3090, z: 3500 };
/** A route from Edgeville that bulges north over the ditch. */
const clipping: Router = () => ({
    success: true,
    reachedDestination: true,
    waypoints: route({ x: 3090, z: 3521 }, { x: 3100, z: 3521 }, { x: 3100, z: 3510 }),
});
/** The same route kept one tile south of the ditch. */
const alongTheEdge: Router = () => ({
    success: true,
    reachedDestination: true,
    waypoints: route({ x: 3090, z: 3519 }, { x: 3100, z: 3519 }, { x: 3100, z: 3510 }),
});

describe('walkTo: the Wilderness', () => {
    const south = EDGEVILLE;

    test('a route through the Wilderness to a destination outside it is no-path, nothing sent', async () => {
        const w = await walk(standing(south), 3100, 3510, 0, { paths: fakePaths(clipping) });
        expect(w.result()).toEqual({
            ok: false,
            reason: 'no-path',
            message: 'Route to (3100, 3510) crosses the Wilderness at (3090, 3521); not walking it',
        });
        expect(w.sends).toEqual([]);
    });

    test('a re-route that turns into the Wilderness is refused too', async () => {
        // The first route stops short on safe ground; the one from there crosses the ditch.
        const paths = fakePaths(from =>
            from.z === south.z
                ? { success: true, reachedDestination: false, waypoints: route({ x: 3090, z: 3505 }) }
                : clipping(from, { x: 3100, z: 3510 }, []),
        );
        const w = await walk(standing(south), 3100, 3510, 0, { paths });
        expect(w.result()).toMatchObject({ ok: false, reason: 'no-path' });
        expect(w.sends).toEqual(['walk to (3090, 3505)']);
    });

    test('a route along the edge, all of it south of z 3520, is walked', async () => {
        const w = await walk(standing(south), 3100, 3510, 0, { paths: fakePaths(alongTheEdge) });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
    });

    test('a walk that starts in the Wilderness may leave it, by a route through the Wilderness', async () => {
        const inside = { x: 3090, z: 3525 };
        const paths = fakePaths(() => ({
            success: true,
            reachedDestination: true,
            waypoints: route({ x: 3090, z: 3521 }, { x: 3100, z: 3521 }, { x: 3100, z: 3510 }),
        }));
        const w = await walk(standing(inside), 3100, 3510, 0, { paths });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
    });

    test('a destination in the Wilderness is not refused here (preflight and the guard own that)', async () => {
        const w = await walk(standing(south), 3090, 3525, 0);
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
    });
});

describe('walkTo: tolerance (ported from sdk/test/walkto-tolerance.test.ts)', () => {
    test('tolerance 0 reaches the exact tile; an intermediate waypoint is only passed within 2', async () => {
        const paths = fakePaths(full({ x: 3205, z: 3200 }, { x: 3210, z: 3200 }));
        const w = await walk(standing({ x: 3200, z: 3200 }), 3210, 3200, 0, { paths });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(w.at()).toEqual({ x: 3210, z: 3200 });
        // Running 2 tiles a tick, the bot is within 2 of (3205, 3200) at tick 2, one tick before it
        // could stand on it: the next leg goes then.
        expect(w.sends).toEqual(['walk to (3205, 3200)', 'walk to (3210, 3200)']);
        expect(w.sentAt).toEqual([0, 2]);
    });

    test('tolerance 1 accepts a diagonally adjacent tile, with no route asked for', async () => {
        const paths = straightPaths();
        const w = await walk(standing({ x: 3201, z: 3201 }), 3200, 3200, 1, { paths });
        expect(w.result()).toEqual({ ok: true, message: 'Already at destination' });
        expect(paths.queries).toHaveLength(0);
    });
});

describe('walkTo: maxRouteTiles', () => {
    // A tile 8 away as the crow flies, reached by a 60-tile detour round a pond.
    const detour = fakePaths(full({ x: 3200, z: 3260 }, { x: 3208, z: 3260 }, { x: 3208, z: 3200 }));
    test('a first route longer than the limit is refused before a step is taken', async () => {
        const w = await walk(standing({ x: 3200, z: 3200 }), 3208, 3200, 0, { paths: detour, maxRouteTiles: 20 });
        expect(w.result()).toEqual({
            ok: false,
            reason: 'no-path',
            message: 'Route to (3208, 3200) from (3200, 3200) is 128 tiles, over the 20 allowed',
        });
        expect(w.sends).toEqual([]);
        expect(ROUTE_TOO_LONG.test(w.result().message)).toBe(true);
    });

    test('a route within the limit is walked, and with no limit any route is', async () => {
        const near = await walk(standing({ x: 3200, z: 3200 }), 3208, 3200, 0, { maxRouteTiles: 20 });
        expect(near.result()).toEqual({ ok: true, message: 'Arrived' });
        const far = await walk(standing({ x: 3200, z: 3200 }), 3208, 3200, 0, { paths: detour });
        expect(far.sends[0]).toBe('walk to (3200, 3260)');
    });
});

const empty: Router = () => ({ success: true, waypoints: [] });

describe('walkTo: no route', () => {
    test('a failed query is asked again a tick later, then reported with its error', async () => {
        const paths = fakePaths(() => ({ success: false, waypoints: [], error: 'no route' }));
        const w = await walk(standing({ x: 3200, z: 3200 }), 3210, 3200, 0, { paths });
        expect(w.result()).toEqual({
            ok: false,
            reason: 'no-path',
            message: 'No path to (3210, 3200) from (3200, 3200): no route',
        });
        expect(paths.queries).toHaveLength(2);
        expect(w.driver.state().tick).toBe(1);
    });

    test('an empty route says whether the destination tile itself is blocked', async () => {
        const wall = await walk(standing({ x: 3200, z: 3200 }), 3210, 3200, 0, {
            paths: fakePaths(empty, [], (x, z) => x === 3210 && z === 3200),
        });
        expect(wall.result().message).toBe('No path to (3210, 3200) from (3200, 3200): destination tile is blocked');
        const open = await walk(standing({ x: 3200, z: 3200 }), 3210, 3200, 0, { paths: fakePaths(empty) });
        expect(open.result().message).toBe('No path to (3210, 3200) from (3200, 3200): no waypoints');
    });

    test('no player state is no-player', async () => {
        const w = await walk([{ ...world().build(), player: null }], 3210, 3200);
        expect(w.result()).toEqual({ ok: false, reason: 'no-player', message: 'No player state' });
    });
});

// A corridor north from (3200, 3200): a wall at z 3205 with a door in it at (3200, 3205) and, for the
// routes round, a gap at x 3203. The door blocks the way while it offers Open.
const START = { x: 3200, z: 3200 };
const DEST = { x: 3200, z: 3215 };
const DOOR = door(3200, 3205);
const DOOR_ID = 1530;
const GAP_X = 3203;
const corridor = (opts: { doorOptions?: string[] | null } = {}) => {
    let w = world().player({ at: START });
    if (opts.doorOptions !== null)
        w = w.loc('Door', DOOR.x, DOOR.z, { id: DOOR_ID, options: opts.doorOptions ?? ['Open'] });
    return w.series(1);
};
const isShut = (s: BotWorldState, at: Tile) =>
    s.nearbyLocs.some(l => l.x === at.x && l.z === at.z && l.optionsWithIndex.some(o => o.text === 'Open'));
/** The wall: crossing z 3205 needs the gap, or the door's tile while the door is not shut. */
const wall: Blocked = (from, to, s) => {
    const crosses = from.z < DOOR.z !== to.z < DOOR.z;
    if (!crosses || to.x === GAP_X) return false;
    return to.x !== DOOR.x || isShut(s, DOOR);
};
const throughDoor = fakePaths(full(DOOR, DEST), [DOOR]);
const openDoor = world()
    .loc('Door', DOOR.x, DOOR.z, { id: DOOR_ID + 1, options: ['Close'] })
    .build().nearbyLocs[0]!;

const openAt = (l: NearbyLoc): NearbyLoc => ({ ...openDoor, distance: l.distance });

type DoorAnswer = 'open' | 'locked' | 'cant-reach' | 'ignore';
/**
 * The door answers each Open in turn (the last answer repeats): it opens from the next tick on, or the
 * game says it is locked or out of reach, or nothing happens.
 */
function doorAnswers(...answers: DoorAnswer[]) {
    let n = 0;
    let opened = false;
    return (action: BotAction): Effect | undefined => {
        if (action.type !== 'interactLoc' || action.reason !== 'Open Door') return undefined;
        const answer = answers[Math.min(n++, answers.length - 1)];
        if (answer === 'ignore') return undefined;
        if (answer === 'open') {
            if (opened) return undefined;
            opened = true;
            return s => ({
                ...s,
                nearbyLocs: s.nearbyLocs.map(l => (l.x === DOOR.x && l.z === DOOR.z ? openAt(l) : l)),
            });
        }
        const text = answer === 'locked' ? 'The door is locked.' : "I can't reach that!";
        let said = false;
        // Said once, on the next tick.
        return s => {
            if (said) return s;
            said = true;
            return world(s).message(text).build();
        };
    };
}

describe('walkTo: doors', () => {
    test('a door on the route is opened as the bot comes within reach, then walked through', async () => {
        const w = await walk(corridor(), DEST.x, DEST.z, 0, {
            paths: throughDoor,
            blocked: wall,
            react: doorAnswers('open'),
        });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(w.sends).toEqual(['Open Door', 'walk to (3200, 3205)', 'walk to (3200, 3215)']);
        expect(w.at()).toEqual(DEST);
    });

    test('a door that does not open is tried again from beside it', async () => {
        const w = await walk(corridor(), DEST.x, DEST.z, 0, {
            paths: throughDoor,
            blocked: wall,
            react: doorAnswers('ignore', 'open'),
        });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(w.sends).toEqual([
            'Open Door',
            'walk to (3200, 3204)',
            'Open Door',
            'walk to (3200, 3205)',
            'walk to (3200, 3215)',
        ]);
        // The first open waited its full DOOR_OPEN_TICKS.
        expect(w.sentAt[1]).toBe(DOOR_OPEN_TICKS);
    });

    test('a locked door is routed around from the next route on', async () => {
        const paths = fakePaths(
            (_from, _to, avoid) =>
                avoid.length
                    ? {
                          success: true,
                          reachedDestination: true,
                          waypoints: route({ x: GAP_X, z: 3204 }, { x: GAP_X, z: 3206 }, DEST),
                      }
                    : { success: true, reachedDestination: true, waypoints: route(DOOR, DEST) },
            [DOOR],
        );
        const w = await walk(corridor(), DEST.x, DEST.z, 0, { paths, blocked: wall, react: doorAnswers('locked') });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(paths.queries.map(q => q.avoid)).toEqual([[], [DOOR]]);
        expect(w.logs).toEqual(['walk: door at (3200, 3205) is locked; routing around it']);
        expect(w.sends.filter(s => s === 'Open Door')).toHaveLength(1);
    });

    test('a door out of reach three times is routed around; with no other route the walk has no path', async () => {
        const paths = fakePaths(
            (_from, _to, avoid) =>
                avoid.length
                    ? { success: false, waypoints: [], error: 'no route around the door' }
                    : { success: true, reachedDestination: true, waypoints: route(DOOR, DEST) },
            [DOOR],
        );
        const w = await walk(corridor(), DEST.x, DEST.z, 0, { paths, blocked: wall, react: doorAnswers('cant-reach') });
        expect(w.result()).toEqual({
            ok: false,
            reason: 'no-path',
            message: 'No path to (3200, 3215) from (3200, 3204): no route around the door',
        });
        expect(w.logs).toEqual([
            'walk: door at (3200, 3205) out of reach (attempt 1/3)',
            'walk: door at (3200, 3205) out of reach (attempt 2/3)',
            'walk: door at (3200, 3205) out of reach 3 times; routing around it',
        ]);
        // Each attempt is two opens, the second from beside the door.
        expect(w.sends.filter(s => s === 'Open Door')).toHaveLength(6);
    });

    test('an Open the client refuses to send is logged and fails that attempt without a wait', async () => {
        const w = await walk(corridor(), DEST.x, DEST.z, 0, {
            paths: throughDoor,
            blocked: wall,
            respond: a => (a.reason === 'Open Door' ? { success: false, message: 'no route to the door' } : undefined),
        });
        expect(w.logs[0]).toBe('walk: Open on Door at (3200, 3205) not sent: no route to the door');
        // Refused at once, not after DOOR_OPEN_TICKS: the walk beside the door goes the same tick.
        expect(w.sentAt.slice(0, 2)).toEqual([0, 0]);
    });

    test('a door the scene does not show (only the collision data has it) is walked past', async () => {
        const w = await walk(corridor({ doorOptions: null }), DEST.x, DEST.z, 0, { paths: throughDoor });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(w.sends).toEqual(['walk to (3200, 3205)', 'walk to (3200, 3215)']);
    });

    test('a door already open is walked through with no Open sent', async () => {
        const w = await walk(corridor({ doorOptions: ['Close'] }), DEST.x, DEST.z, 0, {
            paths: throughDoor,
            blocked: wall,
        });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(w.sends).toEqual(['walk to (3200, 3205)', 'walk to (3200, 3215)']);
    });

    test('a gate no route knows is opened once the walk stops getting closer', async () => {
        // A straight route: the pathfinder thinks the wall has no door, and the bot runs into it.
        const w = await walk(corridor(), DEST.x, DEST.z, 0, { blocked: wall, react: doorAnswers('open') });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(w.sends.filter(s => s === 'Open Door')).toHaveLength(1);
        expect(w.at()).toEqual(DEST);
    });
});

/** The wall with neither door nor gap. */
const solid: Blocked = (from, to) => from.z < DOOR.z !== to.z < DOOR.z;

describe('walkTo: giving up', () => {
    test('a wall with nothing to open is stuck after three routes that get no closer', async () => {
        const w = await walk(corridor({ doorOptions: null }), DEST.x, DEST.z, 0, { blocked: solid });
        expect(w.result()).toEqual({ ok: false, reason: 'stuck', message: 'Stuck at (3200, 3204)' });
    });

    test('a stuck leg that still got closer counts as progress: three more routes, stuck where the bot stands', async () => {
        // One tile short of the wall: the first leg moves a tile (stuck) and the walk is a tile closer.
        const paths = straightPaths();
        const states = world()
            .player({ at: { x: 3200, z: 3203 } })
            .series(1);
        const w = await walk(states, DEST.x, DEST.z, 0, { paths, blocked: solid });
        expect(w.result()).toEqual({ ok: false, reason: 'stuck', message: 'Stuck at (3200, 3204)' });
        expect(paths.queries).toHaveLength(4);
    });

    test('fifty routes that each get a little closer give up where the bot stands', async () => {
        const paths = fakePaths(from => ({
            success: true,
            reachedDestination: false,
            waypoints: route({ x: from.x, z: from.z + 3 }),
        }));
        const w = await walk(standing(START), 3200, 3400, 3, { paths });
        expect(w.result()).toEqual({
            ok: false,
            reason: 'gave-up',
            message: 'Could not reach (3200, 3400) - stopped at (3200, 3300)',
        });
        expect(paths.queries).toHaveLength(50);
    });
});

describe('walkTo: the tick budget', () => {
    test('a walk past its budget ends timeout where the bot stands', async () => {
        const w = await walk(standing(START), 3200, 3240, 0, { maxTicks: 4 });
        expect(w.result()).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Walk to (3200, 3240) ran out of its 4 ticks at (3200, 3208)',
        });
        expect(w.driver.state().tick).toBe(4);
    });

    test('the budget comes from the first route, partial routes counted on to the destination, capped', () => {
        expect(walkBudgetTicks(10)).toBe(WALK_BASE_TICKS + 10 * WALK_TICKS_PER_TILE);
        expect(walkBudgetTicks(10_000)).toBe(WALK_MAX_TICKS);
        expect(walkBudgetTicks(10, 30)).toBe(30);
    });

    test("a step's ticks left, less the reserve, caps the walk's budget", async () => {
        const w = await walk(standing(START), 3200, 3240, 0, { stepBudget: 10, reserveTicks: 4 });
        expect(w.result()).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Walk to (3200, 3240) ran out of its 6 ticks at (3200, 3212)',
        });
        expect(w.driver.state().tick).toBe(6);
    });

    test('the default reserve is WALK_RESERVE_TICKS, and a budget roomier than the route leaves the walk alone', async () => {
        const capped = await walk(standing(START), 3200, 3240, 0, { stepBudget: 10 });
        expect(capped.result().message).toBe(
            `Walk to (3200, 3240) ran out of its ${10 - WALK_RESERVE_TICKS} ticks at (3200, ${3200 + 2 * (10 - WALK_RESERVE_TICKS)})`,
        );
        const roomy = await walk(standing(START), 3200, 3240, 0, { stepBudget: 1000 });
        expect(roomy.result()).toEqual({ ok: true, message: 'Arrived' });
    });

    test('a step with no ticks left past the reserve is no-time, nothing sent', async () => {
        const paths = straightPaths();
        const w = await walk(standing(START), 3200, 3240, 0, { paths, stepBudget: 5, reserveTicks: 5 });
        expect(w.result()).toEqual({
            ok: false,
            reason: 'no-time',
            message: 'No time to walk to (3200, 3240): the step has 5 ticks left and needs 5 after the walk',
        });
        expect(w.sends).toEqual([]);
        expect(paths.queries).toHaveLength(0);
        // Already there needs no time.
        const there = await walk(standing(START), 3200, 3201, 3, { stepBudget: 0 });
        expect(there.result()).toEqual({ ok: true, message: 'Already at destination' });
    });

    test('a short walk that cannot get anywhere ends within its short budget', async () => {
        // The bot never moves (every step refused) and a door that never answers sits on the route.
        const w = await walk(corridor(), DEST.x, DEST.z, 0, {
            paths: throughDoor,
            blocked: () => true,
            react: doorAnswers('ignore'),
        });
        // 15 tiles of route: WALK_BASE_TICKS plus two a tile.
        const budget = walkBudgetTicks(15);
        expect(w.result()).toEqual({
            ok: false,
            reason: 'timeout',
            message: `Walk to (3200, 3215) ran out of its ${budget} ticks at (3200, 3200)`,
        });
        expect(w.driver.state().tick).toBe(budget);
    });
});

describe('walkTo under guards', () => {
    test('an abort guard firing mid-walk cancels the walk: no send after it', async () => {
        const abort: Guard = {
            name: 'test-abort',
            policy: 'abort',
            when: s => s.tick >= 3,
            run: () => ({ fail: 'aborted' }),
        };
        const w = await walk(standing(START), 3200, 3240, 0, { guards: [abort] });
        expect(w.run).toEqual({ kind: 'aborted', by: 'test-abort', outcome: { fail: 'aborted' } });
        expect(w.sends).toEqual(['walk to (3200, 3240)']);
        expect(w.driver.state().tick).toBe(3);
    });

    test('a suspend guard runs inside a leg and the walk carries on to arrive', async () => {
        let ran = 0;
        const suspend: Guard = {
            name: 'test-suspend',
            policy: 'suspend',
            when: s => s.tick === 2 && ran === 0,
            *run() {
                ran++;
                yield* ticks(1);
            },
        };
        const w = await walk(standing(START), 3200, 3210, 0, { guards: [suspend] });
        expect(w.result()).toEqual({ ok: true, message: 'Arrived' });
        expect(ran).toBe(1);
    });
});
