import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import type { Effect } from '../../core/drivers/timeline';
import agility from '../../tasks/agility';
import { simulate, type Simulation } from '../simulate';
import { consume, walking } from '../react';
import { attackedFrom, world, type NpcOptions, type World } from '../world';

type Spot = { x: number; z: number; level: number };
type Interact = Extract<BotAction, { type: 'interactLoc' }>;
/** What the course does to the bot for a send: where it lands, the Agility xp (25x units) and a message. */
interface Result {
    to: Spot;
    xp: number;
    message?: string;
}
type Crossing = (a: Interact, s: BotWorldState) => Result | undefined;
type Override = (a: Interact, r: Result, n: number) => Result | null;

/** The world pays each obstacle on the send: the bot moves, the XP lands. `override` changes one crossing (null: nothing happens). */
function react(crossing: Crossing, agilityLevel: number, override: Override = (_, r) => r) {
    let xp = 0;
    let n = 0;
    return (action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type !== 'interactLoc') return undefined;
        const r0 = crossing(action, state);
        if (!r0) return undefined;
        const r = override(action, r0, n++);
        if (!r) return undefined;
        xp += r.xp;
        const total = xp;
        return s => {
            const w = world(s).player({ at: r.to }).skill('Agility', agilityLevel, total);
            return (r.message ? w.tick(s.tick).message(r.message) : w).build();
        };
    };
}

const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const withoutWalks = (sends: string[]) => sends.filter(s => !s.startsWith('walk to'));
const at = (w: World, p: Spot) => w.player({ at: p });

/** The barbarian course: where each obstacle (by tile and loc id) leaves the bot, and its xp in 25x units. */
const barbarianCrossing: Crossing = (a, s) => {
    const level = s.player?.level ?? 0;
    if (a.z === 3559) return { to: { x: 2552, z: 3558, level: 0 }, xp: 250 };
    if (a.z === 3550 && a.x === 2551) {
        // Only from the north of the swing's start (the script says so from the south).
        if ((s.player?.worldZ ?? 0) < 3554)
            return { to: { x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0, level: 0 }, xp: 0 };
        return { to: { x: 2551, z: 3549, level: 0 }, xp: 500 };
    }
    if (a.z === 3546 && a.x === 2550) return { to: { x: 2541, z: 3546, level: 0 }, xp: 312 };
    if (a.x === 2538 && a.z === 3545) return { to: { x: 2537, z: 3546, level: 1 }, xp: 187 };
    if (a.x === 2535 && a.z === 3547) return { to: { x: 2532, z: 3546, level: 1 }, xp: 500 };
    if (a.x === 2532 && a.z === 3545) return { to: { x: 2532, z: 3546, level: 0 }, xp: 0 };
    if (a.z === 9951) return { to: { x: 2548, z: 3551, level: 0 }, xp: 0 };
    if (a.z === 3553 && level === 0) {
        if (a.locId !== 1948) return undefined;
        const last = a.x === 2542;
        return { to: { x: a.x + 1, z: 3553, level: 0 }, xp: 312 + (last ? 1050 : 0) };
    }
    return undefined;
};

const barbarianReactor = (override?: Override) => walking(react(barbarianCrossing, 41, override));

describe('agility: barbarian course', () => {
    /** The course's locs as the map data has them (server/content/maps/m39_55.jm2, m39_155.jm2); the log is not listed by the SDK. */
    const course = [
        ['Obstacle pipe', 2552, 3559, 0, 'Squeeze-through', 2287],
        ['Ropeswing', 2551, 3550, 0, 'Swing-on', 2282],
        ['Obstacle net', 2538, 3545, 0, 'Climb-over', 2284],
        ['Balancing ledge', 2535, 3547, 1, 'Walk-across', 2302],
        ['Ladder', 2532, 3545, 1, 'Climb-down', 3205],
        // The shortcut's walls at z 3552 and 3554 have the same name and option but no lap progress.
        ['Crumbling wall', 2536, 3552, 0, 'Climb-over', 1947],
        ['Crumbling wall', 2536, 3553, 0, 'Climb-over', 1948],
        ['Crumbling wall', 2539, 3553, 0, 'Climb-over', 1948],
        ['Crumbling wall', 2542, 3553, 0, 'Climb-over', 1948],
        ['Ladder', 2547, 9951, 0, 'Climb-up', 1755],
    ].reduce(
        (w, [name, x, z, level, option, id]) =>
            w.loc(name as string, x as number, z as number, {
                level: level as number,
                options: [option as string],
                id: id as number,
            }),
        world().skill('Agility', 41, 0).player({ hp: 50, maxHp: 50 }).inv('Salmon', 5, { id: 329 }),
    );

    const PIPE = 'Squeeze-through Obstacle pipe';
    const ROPE = 'Swing-on Ropeswing';
    const LOG = 'Walk-across Log balance';
    const NET = 'Climb-over Obstacle net';
    const LEDGE = 'Walk-across Balancing ledge';
    const LADDER = 'Climb-down Ladder';
    const WALL = 'Climb-over Crumbling wall';
    const PIT_LADDER = 'Climb-up Ladder';
    const LAP = [ROPE, LOG, NET, LEDGE, LADDER, WALL, WALL, WALL];
    const OUTSIDE = { x: 2552, z: 3562, level: 0 };
    const YARD = { x: 2548, z: 3555, level: 0 };

    const LAP_XP = 500 + 312 + 187 + 500 + 312 * 3 + 1050;

    test('one lap from the yard: rope, log, net, ledge, ladder, three walls, then done', async () => {
        const r = await simulate(agility, {
            params: { course: 'barbarian', laps: 1 },
            timeline: at(course, YARD).series(300),
            react: barbarianReactor(),
        });
        expect(r.result.reason).toBe('stop-laps: 1 laps');
        expect(withoutWalks(r.sends)).toEqual(LAP);
        expect(r.result.xpGained).toEqual({ Agility: LAP_XP });
        expect(logged(r)).toEqual(['lap 1 complete']);
    });

    test('from outside it squeezes through the pipe first; the rope is entered from the north', async () => {
        const r = await simulate(agility, {
            params: { course: 'barbarian', laps: 1 },
            timeline: at(course, OUTSIDE).series(300),
            react: barbarianReactor(),
        });
        expect(r.result.reason).toBe('stop-laps: 1 laps');
        expect(withoutWalks(r.sends)).toEqual([PIPE, ...LAP]);
        // The pipe lands at (2552,3558); the rope needs z >= 3554, so it stands within one tile of (2551,3555) first.
        expect(r.sends.slice(0, 3)).toEqual([PIPE, 'walk to (2551, 3555)', ROPE]);
    });

    test('the walls are the lap bonus ones: the loc id 1948, never the shortcut walls beside them', async () => {
        const r = await simulate(agility, {
            params: { course: 'barbarian', laps: 1 },
            timeline: at(course, { x: 2532, z: 3546, level: 0 }).series(200),
            react: barbarianReactor(),
        });
        const walls = r.commands.flatMap(c =>
            c.type === 'send' && c.action.type === 'interactLoc' ? [c.action.locId] : [],
        );
        expect(walls).toEqual([1948, 1948, 1948]);
        expect(r.result.reason).toBe('stop-laps: 1 laps');
    });

    const run = async (p: Spot, laps = 1) =>
        (
            await simulate(agility, {
                params: { course: 'barbarian', laps },
                timeline: at(course, p).series(300),
                react: barbarianReactor(),
            })
        ).sends;

    test('resumes from every part of the lap', async () => {
        // After the rope (south of the lake's north shore), after the log, up on the platform, below it, between walls.
        expect(withoutWalks(await run({ x: 2551, z: 3549, level: 0 }))[0]).toBe(LOG);
        expect(withoutWalks(await run({ x: 2541, z: 3546, level: 0 }))[0]).toBe(NET);
        expect(withoutWalks(await run({ x: 2537, z: 3546, level: 1 }))[0]).toBe(LEDGE);
        expect(withoutWalks(await run({ x: 2532, z: 3546, level: 1 }))[0]).toBe(LADDER);
        expect(withoutWalks(await run({ x: 2532, z: 3546, level: 0 }))[0]).toBe(WALL);
        expect(withoutWalks(await run({ x: 2537, z: 3553, level: 0 }))).toEqual([WALL, WALL]);
        expect(withoutWalks(await run({ x: 2543, z: 3553, level: 0 }))[0]).toBe(ROPE);
    });

    test('a fall off the rope into the pit climbs the ladder and tries the rope again, not the log', async () => {
        const fell = { done: false };
        const r = await simulate(agility, {
            params: { course: 'barbarian', laps: 1 },
            timeline: at(course, YARD).series(400),
            react: barbarianReactor((a, c) =>
                a.x === 2551 && a.z === 3550 && !fell.done
                    ? ((fell.done = true),
                      { to: { x: 2551, z: 9948, level: 0 }, xp: 0, message: 'You slip and fall to the pit below.' })
                    : c,
            ),
        });
        expect(r.result.reason).toBe('stop-laps: 1 laps');
        // The ladder lands at (2548,3551) by the log; the rope is retried (from its stand tile) before anything else.
        expect(withoutWalks(r.sends)).toEqual([ROPE, PIT_LADDER, ROPE, ...LAP.slice(1)]);
        expect(r.result.xpGained).toEqual({ Agility: LAP_XP });
    });

    test('a fall into the lake lands on the south shore and the log is tried again', async () => {
        const fell = { done: false };
        const r = await simulate(agility, {
            params: { course: 'barbarian', laps: 1 },
            timeline: at(course, { x: 2551, z: 3549, level: 0 }).series(300),
            react: barbarianReactor((a, c) =>
                a.x === 2550 && !fell.done
                    ? ((fell.done = true),
                      {
                          to: { x: 2545, z: 3542, level: 0 },
                          xp: 0,
                          message: '...You lose your footing and fall into the water.',
                      })
                    : c,
            ),
        });
        expect(withoutWalks(r.sends).slice(0, 3)).toEqual([LOG, LOG, NET]);
        expect(r.result.reason).toBe('stop-laps: 1 laps');
    });

    test('a fall off the ledge lands on the spikes below and the net is climbed again', async () => {
        const fell = { done: false };
        const r = await simulate(agility, {
            params: { course: 'barbarian', laps: 1 },
            timeline: at(course, { x: 2537, z: 3546, level: 1 }).series(300),
            react: barbarianReactor((a, c) =>
                a.x === 2535 && !fell.done
                    ? ((fell.done = true),
                      {
                          to: { x: 2534, z: 3546, level: 0 },
                          xp: 0,
                          message: 'You slip and fall onto the spikes below.',
                      })
                    : c,
            ),
        });
        expect(withoutWalks(r.sends).slice(0, 4)).toEqual([LEDGE, NET, LEDGE, LADDER]);
        expect(r.result.reason).toBe('stop-laps: 1 laps');
    });

    test('a fall is waited out before the next obstacle is chosen, and ten in a row fail the run', async () => {
        const r = await simulate(agility, {
            params: { course: 'barbarian' },
            timeline: at(course, { x: 2551, z: 3549, level: 0 }).series(600),
            react: barbarianReactor(a =>
                a.x === 2550
                    ? {
                          to: { x: 2545, z: 3542, level: 0 },
                          xp: 0,
                          message: '...You lose your footing and fall into the water.',
                      }
                    : null,
            ),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(
            /^obstacle: 10 falls or displacements in a row \(last: Log balance at \(2550,3546\)/,
        );
        expect(withoutWalks(r.sends)).toEqual(Array(10).fill(LOG));
        // Each fall waits for the script's last moves (8 ticks) before the bot is looked at again.
        expect(r.driver.state().tick).toBeGreaterThanOrEqual(9 * 8);
    });

    test('a ladder that is not in the scene is not found, six misses fail the run', async () => {
        const bare = at(world().skill('Agility', 41, 0).player({ hp: 50, maxHp: 50 }), { x: 2532, z: 3546, level: 1 });
        const r = await simulate(agility, { params: { course: 'barbarian' }, timeline: bare.series(1) });
        expect(r.result.reason).toBe('obstacle: ledge ladder not found 6 times in a row');
    });

    test('needs agility 35, and the bot to be at the course; food is not required by default', async () => {
        const low = await simulate(agility, {
            params: { course: 'barbarian' },
            timeline: at(world().skill('Agility', 34, 0), YARD).series(1),
        });
        expect(low.result.reason).toBe('preflight: the barbarian course needs agility 35, bot has 34');
        const far = await simulate(agility, {
            params: { course: 'barbarian' },
            timeline: world().skill('Agility', 41, 0).series(1),
        });
        expect(far.result.reason).toMatch(/^preflight: not at the barbarian course: at \(3222,3218\) level 0/);
        const ok = await simulate(agility, {
            params: { course: 'barbarian', laps: 1 },
            timeline: at(course, YARD).inv('Salmon', 0).series(300),
            react: barbarianReactor(),
        });
        expect(ok.result.reason).toBe('stop-laps: 1 laps');
    });

    test('minFood asks for food to start', async () => {
        const r = await simulate(agility, {
            params: { course: 'barbarian', minFood: 6 },
            timeline: at(course, YARD).series(1),
        });
        expect(r.result.reason).toBe('preflight: the barbarian course needs 6 food (minFood), bot has 5');
    });

    test('low HP after a fall eats, then the obstacle is tried again', async () => {
        const r = await simulate(agility, {
            params: { course: 'barbarian', laps: 1 },
            timeline: at(course, { x: 2541, z: 3546, level: 0 }).series(300, (w, i) =>
                w.player({ hp: i === 2 ? 20 : 50 }),
            ),
            react: barbarianReactor((_, c, n) => (n === 0 ? null : c)),
        });
        expect(r.sends.slice(0, 3)).toEqual([NET, 'Eat Salmon', NET]);
        expect(r.result.reason).toBe('stop-laps: 1 laps');
    });
});

/** The Wilderness course, by loc id. */
const wildernessCrossing: Crossing = a => {
    if (a.locId === 2309) return { to: { x: 2998, z: 3932, level: 0 }, xp: 375 };
    if (a.locId === 2288) return { to: { x: 3004, z: 3950, level: 0 }, xp: 312 };
    if (a.locId === 2283) return { to: { x: 3005, z: 3958, level: 0 }, xp: 500 };
    if (a.locId === 2311) return { to: { x: 2996, z: 3960, level: 0 }, xp: 500 };
    if (a.locId === 2297) return { to: { x: 2994, z: 3945, level: 0 }, xp: 500 };
    if (a.locId === 2328) return { to: { x: 2993, z: 3933, level: 0 }, xp: 12472 };
    if (a.locId === 2307 || a.locId === 2308) return { to: { x: 2998, z: 3915, level: 0 }, xp: 375 };
    if (a.locId === 1755) return { to: { x: 3005, z: 3963, level: 0 }, xp: 0 };
    return undefined;
};

const wildernessReactor = (override?: Override) => walking(react(wildernessCrossing, 55, override));

/** The reactor of a world whose food is down to `left` once an obstacle with one of `locIds` is crossed. */
const foodLeftAt = (left: number, ...locIds: number[]) => {
    const inner = react(wildernessCrossing, 55);
    let gone = false;
    return walking((a: BotAction, s: BotWorldState) => {
        const effect = inner(a, s);
        if (a.type === 'interactLoc' && locIds.includes(a.locId ?? 0)) gone = true;
        if (!effect) return effect;
        return st => {
            const w = world(effect(st) ?? st);
            return (gone ? w.inv('Salmon', left, { id: 329 }) : w).build();
        };
    });
};
const starvingAt = (...locIds: number[]) => foodLeftAt(0, ...locIds);

/** Eating heals 9 hp: on top of `consume`, which takes the Salmon away. */
const healing = (inner: ReturnType<typeof wildernessReactor>) => (a: BotAction, s: BotWorldState) => {
    const eaten = consume(a, s);
    if (!eaten) return inner(a, s);
    return (st: BotWorldState) =>
        world(eaten(st))
            .player({ hp: Math.min(50, (st.player?.hp ?? 0) + 9) })
            .build();
};

/**
 * A reactor whose world shows `loc` only once the bot is within `range` tiles of it (the client's scene is about 15 tiles
 * wide, and a scan the same): the scripted world must not list it.
 */
const sightOf = (inner: ReturnType<typeof wildernessReactor>, loc: Parameters<World['loc']>, range: number) => {
    const [name, x, z, opts] = loc;
    return (a: BotAction, st: BotWorldState) => {
        const e = inner(a, st);
        if (!e || a.type !== 'walkTo') return e;
        return (s: BotWorldState) => {
            const w = e(s);
            const p = w.player;
            if (!p || Math.max(Math.abs(p.worldX - x), Math.abs(p.worldZ - z)) > range) return w;
            return world(w).loc(name, x, z, opts).build();
        };
    };
};
/** What a finished Wilderness run adds to its done reason, for the caller. */
const LEAVE_NOTE = ' (still in the Wilderness: travel out now)';

describe('agility: wilderness course', () => {
    const course = [
        ['Door', 2998, 3917, 'Open', 2309],
        ['Gate', 2998, 3931, 'Open', 2307],
        ['Gate', 2997, 3931, 'Open', 2308],
        ['Obstacle pipe', 3004, 3938, 'Squeeze-through', 2288],
        ['Ropeswing', 3005, 3952, 'Swing-on', 2283],
        ['Stepping stone', 3001, 3960, 'Jump-from', 2311],
        ['Rocks', 2993, 3936, 'Climb', 2328],
        ['Rocks', 2994, 3936, 'Climb', 2328],
        ['Rocks', 2995, 3936, 'Climb', 2328],
        ['Ladder', 3005, 10363, 'Climb-up', 1755],
    ].reduce(
        (w, [name, x, z, option, id]) =>
            w.loc(name as string, x as number, z as number, { options: [option as string], id: id as number }),
        world().skill('Agility', 55, 0).player({ hp: 50, maxHp: 50, combatLevel: 53 }).inv('Salmon', 5, { id: 329 }),
    );

    const DOOR = 'Open Door';
    const GATE = 'Open Gate';
    const PIPE = 'Squeeze-through Obstacle pipe';
    const ROPE = 'Swing-on Ropeswing';
    const STONES = 'Jump-from Stepping stone';
    const LOG = 'Walk-across Log balance';
    const ROCKS = 'Climb Rocks';
    const CAVE_LADDER = 'Climb-up Ladder';
    const LAP = [DOOR, PIPE, ROPE, STONES, LOG, ROCKS, GATE];
    const ENTRANCE = { x: 2998, z: 3915, level: 0 };
    const LAP_XP = 375 + 312 + 500 + 500 + 500 + 12472 + 375;

    test('one lap: door, pipe, rope, stones, log, rocks, gate, then done, with the Wilderness guard off', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, ENTRANCE).series(400),
            react: wildernessReactor(),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
        expect(withoutWalks(r.sends)).toEqual(LAP);
        expect(r.result.xpGained).toEqual({ Agility: LAP_XP });
        expect(logged(r)).toEqual(['lap 1 complete']);
    });

    test('the log is the loc the map data has (id 2297 at 3001,3945): the scene never lists it', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 2996, z: 3960, level: 0 }).series(300),
            react: wildernessReactor(),
        });
        expect(withoutWalks(r.sends).slice(0, 2)).toEqual([LOG, ROCKS]);
        const first = r.commands.find(c => c.type === 'send' && c.action.type === 'interactLoc');
        expect(first?.type === 'send' && first.action.type === 'interactLoc' && first.action.locId).toBe(2297);
    });

    /** The first obstacle sent from `p`. */
    const firstFrom = async (p: Spot) =>
        withoutWalks(
            (
                await simulate(agility, {
                    params: { course: 'wilderness', laps: 1 },
                    timeline: at(course, p).series(400),
                    react: wildernessReactor(),
                })
            ).sends,
        )[0];

    test('resumes from every part of the lap', async () => {
        // The ridge's far end next to the gate: the pipe; the rocks' end: the gate; the rope's end: the stones.
        expect(await firstFrom({ x: 2998, z: 3932, level: 0 })).toBe(PIPE);
        expect(await firstFrom({ x: 3004, z: 3950, level: 0 })).toBe(ROPE);
        expect(await firstFrom({ x: 3005, z: 3958, level: 0 })).toBe(STONES);
        expect(await firstFrom({ x: 2996, z: 3960, level: 0 })).toBe(LOG);
        expect(await firstFrom({ x: 2994, z: 3945, level: 0 })).toBe(ROCKS);
        expect(await firstFrom({ x: 2993, z: 3933, level: 0 })).toBe(GATE);
        expect(await firstFrom({ x: 3001, z: 3923, level: 0 })).toBe(DOOR);
    });

    test('a fall off the rope into the cave climbs its ladder and swings the rope again, not the stones', async () => {
        const fell = { done: false };
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 3004, z: 3950, level: 0 }).series(400),
            react: wildernessReactor((a, c) =>
                a.locId === 2283 && !fell.done
                    ? ((fell.done = true),
                      { to: { x: 3004, z: 10357, level: 0 }, xp: 0, message: 'You slip and fall to the pit below.' })
                    : c,
            ),
        });
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
        expect(withoutWalks(r.sends)).toEqual([ROPE, CAVE_LADDER, ROPE, STONES, LOG, ROCKS, GATE]);
    });

    test('a fall into the lava lands past the stones and they are jumped again', async () => {
        const fell = { done: false };
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 3005, z: 3958, level: 0 }).series(400),
            react: wildernessReactor((a, c) =>
                a.locId === 2311 && !fell.done
                    ? ((fell.done = true),
                      {
                          to: { x: 3002, z: 3963, level: 0 },
                          xp: 0,
                          message: '...You lose your footing and fall into the lava.',
                      })
                    : c,
            ),
        });
        expect(withoutWalks(r.sends).slice(0, 3)).toEqual([STONES, STONES, LOG]);
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
    });

    test('a fall off the ridge lands in the field and the door is opened again', async () => {
        const fell = { done: false };
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, ENTRANCE).series(400),
            react: wildernessReactor((a, c) =>
                a.locId === 2309 && !fell.done
                    ? ((fell.done = true),
                      {
                          to: { x: 3001, z: 3923, level: 0 },
                          xp: 0,
                          message: 'You lose your footing and fall into the wolf pit.',
                      })
                    : c,
            ),
        });
        expect(withoutWalks(r.sends).slice(0, 3)).toEqual([DOOR, DOOR, PIPE]);
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
    });

    /** The compound world without the loc `name`. */
    const without = (name: string, p: Spot): World => {
        const s = at(course, p).build();
        return world({ ...s, nearbyLocs: s.nearbyLocs.filter(l => l.name !== name) });
    };

    test('a log fall lands 18 tiles from the cave ladder: it walks to the ladder first, then retries the log', async () => {
        const fell = { done: false };
        const ladder: Parameters<World['loc']> = ['Ladder', 3005, 10363, { options: ['Climb-up'], id: 1755 }];
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: without('Ladder', { x: 2996, z: 3960, level: 0 }).series(400),
            react: sightOf(
                wildernessReactor((a, c) =>
                    a.locId === 2297 && !fell.done
                        ? ((fell.done = true),
                          {
                              to: { x: 2998, z: 10345, level: 0 },
                              xp: 0,
                              message: 'You slip and fall onto the spikes below.',
                          })
                        : c,
                ),
                ladder,
                15,
            ),
        });
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
        expect(withoutWalks(r.sends)).toEqual([LOG, CAVE_LADDER, LOG, ROCKS, GATE]);
        expect(r.sends.filter(s => s.startsWith('walk to'))[0]).toContain('3005');
        expect(logged(r).filter(m => String(m).startsWith('No '))).toEqual([]);
    });

    test('an obstacle whose loc is out of sight is walked towards, not counted failed', async () => {
        const pipe: Parameters<World['loc']> = [
            'Obstacle pipe',
            3004,
            3938,
            { options: ['Squeeze-through'], id: 2288 },
        ];
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: without('Obstacle pipe', { x: 3010, z: 3931, level: 0 }).series(400),
            react: sightOf(wildernessReactor(), pipe, 4),
        });
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
        expect(withoutWalks(r.sends)[0]).toBe(PIPE);
        expect(r.sends[0]).toStartWith('walk to');
    });

    test('a ridge fall into the wolf field with the food short of a lap start keeps going: the door is not a lap start there', async () => {
        const fell = { done: false };
        const inner = wildernessReactor((a, c) =>
            a.locId === 2309 && !fell.done
                ? ((fell.done = true),
                  {
                      to: { x: 3001, z: 3923, level: 0 },
                      xp: 0,
                      message: 'You lose your footing and fall into the wolf pit.',
                  })
                : c,
        );
        let eaten = false;
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, ENTRANCE).series(400),
            react: (a, st) => {
                const e = inner(a, st);
                if (a.type === 'interactLoc' && a.locId === 2309) eaten = true;
                if (!e) return e;
                return s => {
                    const w = world(e(s));
                    return (eaten ? w.inv('Salmon', 1, { id: 329 }) : w).build();
                };
            },
        });
        expect(withoutWalks(r.sends).slice(0, 3)).toEqual([DOOR, DOOR, PIPE]);
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
    });

    test('rocks that pay nothing (the lap bonus was missed) are a displacement, and the gate still follows', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 2994, z: 3945, level: 0 }).series(400),
            react: wildernessReactor((a, c) => (a.locId === 2328 ? { ...c, xp: 0 } : c)),
        });
        expect(withoutWalks(r.sends).slice(0, 2)).toEqual([ROCKS, GATE]);
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
        expect(logged(r)[0]).toMatch(/^rocks failed \(no-xp\)/);
    });

    test('needs agility 52 and 3 food by default; minFood changes that', async () => {
        const low = await simulate(agility, {
            params: { course: 'wilderness' },
            timeline: at(world().skill('Agility', 51, 0).inv('Salmon', 3, { id: 329 }), ENTRANCE).series(1),
        });
        expect(low.result.reason).toBe('preflight: the wilderness course needs agility 52, bot has 51');
        const hungry = await simulate(agility, {
            params: { course: 'wilderness' },
            timeline: at(course, ENTRANCE).inv('Salmon', 2, { id: 329 }).series(1),
        });
        expect(hungry.result.reason).toBe('preflight: the wilderness course needs 3 food (minFood), bot has 2');
        const fine = await simulate(agility, {
            params: { course: 'wilderness', minFood: 1, laps: 1 },
            timeline: at(course, ENTRANCE).inv('Salmon', 1, { id: 329 }).series(400),
            react: wildernessReactor(),
        });
        expect(fine.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
    });

    test("with the food gone at the lap's end it stops at the door; mid-lap it carries on to that edge", async () => {
        const atDoor = await simulate(agility, {
            params: { course: 'wilderness', minFood: 1 },
            timeline: at(course, { x: 2993, z: 3933, level: 0 }).inv('Salmon', 1, { id: 329 }).series(200),
            react: starvingAt(2307, 2308),
        });
        expect(atDoor.result.status).toBe('done');
        expect(atDoor.result.reason).toBe(`out-of-food: out of food after 1 laps${LEAVE_NOTE}`);
        expect(withoutWalks(atDoor.sends)).toEqual([GATE]);

        // The last food goes at the pipe, mid-lap: the rest of the lap is crossed, the stop comes at the door.
        const midLap = await simulate(agility, {
            params: { course: 'wilderness', minFood: 1 },
            timeline: at(course, { x: 2998, z: 3932, level: 0 }).inv('Salmon', 1, { id: 329 }).series(500),
            react: starvingAt(2288),
        });
        expect(midLap.result.reason).toBe(`out-of-food: out of food after 1 laps${LEAVE_NOTE}`);
        expect(withoutWalks(midLap.sends)).toEqual(LAP.slice(1));
    });

    test('a lap is not started on the last bite: with one food left at the door it stops there', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', minFood: 2 },
            timeline: at(course, { x: 2993, z: 3933, level: 0 }).inv('Salmon', 2, { id: 329 }).series(200),
            react: foodLeftAt(1, 2307, 2308),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe(`out-of-food: out of food after 1 laps${LEAVE_NOTE}`);
        expect(withoutWalks(r.sends)).toEqual([GATE]);
    });

    test('minFood 0 on the Wilderness course is raised to 1', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', minFood: 0 },
            timeline: at(course, ENTRANCE).inv('Salmon', 0, { id: 329 }).series(1),
        });
        expect(r.result.reason).toBe('preflight: the wilderness course needs 1 food (minFood), bot has 0');
    });

    test('out of food short of the laps asked for fails, with the same reason', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', minFood: 1, laps: 2 },
            timeline: at(course, { x: 2993, z: 3933, level: 0 }).inv('Salmon', 1, { id: 329 }).series(200),
            react: starvingAt(2307, 2308),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`out-of-food: out of food after 1 laps${LEAVE_NOTE}`);
    });

    test('food gone mid-lap and HP falling: the low-HP guard fails the run (no way out of the lap)', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', minFood: 1 },
            timeline: at(course, { x: 2998, z: 3932, level: 0 })
                .inv('Salmon', 1, { id: 329 })
                .series(300, (w, i) => w.player({ hp: Math.max(5, 50 - 3 * i) })),
            react: starvingAt(2288),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^interrupt:low-hp: hp \d+\/50 at \(\d+,\d+\), no food$/);
    });

    test('low HP in the compound eats, then the obstacle is tried again', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 3005, z: 3951, level: 0 }).series(400, (w, i) =>
                w.player({ hp: i === 2 ? 20 : 50 }),
            ),
            react: wildernessReactor((_, c, n) => (n === 0 ? null : c)),
        });
        expect(r.sends.slice(0, 3)).toEqual([ROPE, 'Eat Salmon', ROPE]);
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
    });

    test('a skeleton fighting the bot does not hold the lap up: the obstacles carry the bot off', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 3005, z: 3951, level: 0 }).series(60, (w, i) =>
                attackedFrom(w, i, 6, 22, { name: 'Skeleton' } as NpcOptions),
            ),
            react: wildernessReactor((_, c, n) => (n === 0 ? null : c)),
        });
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
        expect(r.result.stepRuns['interrupt:under-attack']).toBeUndefined();
    });

    test('low HP in a fight with no food left fails the run', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', minFood: 1 },
            // The last food is there for the preflight (tick 0) and gone after.
            timeline: at(course, { x: 3005, z: 3951, level: 0 })
                .inv('Salmon', 1, { id: 329 })
                .series(60, (w, i) =>
                    attackedFrom(w, i, 60, 22)
                        .inv('Salmon', i === 0 ? 1 : 0, { id: 329 })
                        .player({ hp: i >= 3 ? 20 : 50 - i }),
                ),
            react: wildernessReactor((_, c, n) => (n === 0 ? null : c)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^interrupt:low-hp: hp 20\/50 at \(3005,3951\), no food/);
    });

    test('below 75% HP it eats between obstacles, before the next one, until it is above the line', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 3005, z: 3951, level: 0 }).player({ hp: 30 }).series(400),
            react: healing(wildernessReactor()),
        });
        // 30 -> 39 hp in one eat (39 >= 37.5); no mid-obstacle eat by the guard.
        expect(r.sends.slice(0, 2)).toEqual(['Eat Salmon', ROPE]);
        expect(r.sends.filter(s => s.startsWith('Eat'))).toHaveLength(1);
        expect(r.result.stepRuns['interrupt:low-hp']).toBeUndefined();
        expect(r.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
    });

    test('at 75% HP it does not eat; with no food it does not try', async () => {
        const full = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 3005, z: 3951, level: 0 }).player({ hp: 38 }).series(400),
            react: wildernessReactor(),
        });
        expect(full.sends.filter(s => s.startsWith('Eat'))).toEqual([]);
        const hungry = await simulate(agility, {
            params: { course: 'wilderness', minFood: 1, laps: 1 },
            // The last food is there for the preflight (tick 0) and gone after; mid-lap the run carries on.
            timeline: at(course, { x: 3005, z: 3951, level: 0 }).series(400, (w, i) =>
                w.inv('Salmon', i === 0 ? 1 : 0, { id: 329 }).player({ hp: i === 0 ? 50 : 30 }),
            ),
            react: wildernessReactor(),
        });
        expect(hungry.result.reason).toBe(`stop-laps: 1 laps${LEAVE_NOTE}`);
        expect(hungry.sends.filter(s => s.startsWith('Eat'))).toEqual([]);
    });

    test('three eats that do nothing fail the run', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness' },
            timeline: at(course, { x: 3005, z: 3951, level: 0 }).player({ hp: 30 }).series(100),
            // Nothing eats: the world ignores the send (a bot busy in a script).
            react: () => undefined,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('eat: 3 eats in a row failed (last: Failed to eat Salmon)');
        expect(r.sends).toEqual(Array(3).fill('Eat Salmon'));
    });

    test('a bot in the Wilderness on any other course would be ended by the guard; this one is not', async () => {
        const r = await simulate(agility, {
            params: { course: 'wilderness', laps: 1 },
            timeline: at(course, { x: 3004, z: 3950, level: 0 }).series(400),
            react: wildernessReactor(),
        });
        expect(r.result.stepRuns['interrupt:wilderness']).toBeUndefined();
        expect(r.result.status).toBe('done');
    });
});
