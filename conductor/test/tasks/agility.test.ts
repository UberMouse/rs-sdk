import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import type { Effect } from '../../core/drivers/timeline';
import agility from '../../tasks/agility';
import { simulate, type Simulation } from '../simulate';
import { walking } from '../react';
import { world, type World } from '../world';

/** Every loc of the Gnome course as the map data has it (server/content/maps/m38_53.jm2); the log is not listed by the SDK. */
const OBSTACLES = [
    { name: 'Obstacle net', x: 2471, z: 3425, level: 0, options: ['Climb-over'] },
    { name: 'Obstacle net', x: 2473, z: 3425, level: 0, options: ['Climb-over'] },
    { name: 'Obstacle net', x: 2475, z: 3425, level: 0, options: ['Climb-over'] },
    { name: 'Tree branch', x: 2473, z: 3422, level: 1, options: ['Climb'] },
    { name: 'Balancing rope', x: 2478, z: 3420, level: 2, options: ['Walk-on'] },
    { name: 'Tree branch', x: 2486, z: 3419, level: 2, options: ['Climb-down'] },
    { name: 'Tree branch', x: 2487, z: 3418, level: 2, options: ['Climb-down'] },
    { name: 'Tree branch', x: 2487, z: 3420, level: 2, options: ['Climb-down'] },
    { name: 'Obstacle net', x: 2483, z: 3426, level: 0, options: ['Climb-over'] },
    { name: 'Obstacle net', x: 2485, z: 3426, level: 0, options: ['Climb-over'] },
    { name: 'Obstacle net', x: 2487, z: 3426, level: 0, options: ['Climb-over'] },
    { name: 'Obstacle pipe', x: 2484, z: 3431, level: 0, options: ['Squeeze-through'] },
    { name: 'Obstacle pipe', x: 2487, z: 3431, level: 0, options: ['Squeeze-through'] },
    { name: 'Obstacle pipe', x: 2484, z: 3435, level: 0, options: ['Squeeze-through'] },
];
const course = OBSTACLES.reduce(
    (w, o) => w.loc(o.name, o.x, o.z, { level: o.level, options: o.options }),
    world().skill('Agility', 1, 0).player({ hp: 19, maxHp: 19 }),
);

const START = { x: 2474, z: 3436, level: 0 };
const WALK = 'Walk-across Log balance';
const NET_UP = 'Climb-over Obstacle net';
const BRANCH_UP = 'Climb Tree branch';
const ROPE = 'Walk-on Balancing rope';
const BRANCH_DOWN = 'Climb-down Tree branch';
const PIPE = 'Squeeze-through Obstacle pipe';
const LAP = [WALK, NET_UP, BRANCH_UP, ROPE, BRANCH_DOWN, NET_UP, PIPE];

interface Result {
    to: { x: number; z: number; level: number };
    xp: number;
    /** A message the bot sees after crossing instead of a payout. */
    message?: string;
}
/** What the course does to the bot, by the obstacle's tile and plane (xp in 25x units). */
function crossing(a: Extract<BotAction, { type: 'interactLoc' }>, s: BotWorldState): Result | undefined {
    const level = s.player?.level ?? 0;
    const { x, z } = a;
    if (x === 2474 && z === 3435) return { to: { x: 2474, z: 3428, level: 0 }, xp: 187 };
    if (level === 0 && z === 3425 && x < 2480) return { to: { x, z: 3423, level: 1 }, xp: 187 };
    if (level === 1) return { to: { x: 2473, z: 3420, level: 2 }, xp: 125 };
    if (level === 2 && x === 2478) return { to: { x: 2483, z: 3420, level: 2 }, xp: 187 };
    if (level === 2) return { to: { x: 2487, z: 3420, level: 0 }, xp: 125 };
    if (z === 3426) return { to: { x, z: 3428, level: 0 }, xp: 187 };
    if (z === 3431) return { to: { x, z: 3434, level: 0 }, xp: 187 + 975 };
    return undefined;
}

/** The world pays each obstacle on the send: the bot moves, the XP lands. `override` changes one crossing. */
function courseReact(
    override: (a: Extract<BotAction, { type: 'interactLoc' }>, r: Result, n: number) => Result | null = (_, r) => r,
) {
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
            const w = world(s).player({ at: r.to }).skill('Agility', 1, total);
            return (r.message ? w.tick(s.tick).message(r.message) : w).build();
        };
    };
}

const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const startAt = (w: World, p: { x: number; z: number; level: number }) => w.player({ at: p });

describe('agility: gnome course laps', () => {
    test('one lap crosses the seven obstacles in order, then stops done', async () => {
        const r = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, START).series(200),
            react: courseReact(),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('stop-laps: 1 laps');
        expect(r.sends).toEqual(LAP);
        expect(r.result.xpGained).toEqual({ Agility: 187 * 4 + 125 * 2 + 187 + 975 });
        expect(logged(r)).toEqual(['lap 1 complete']);
    });

    test('three laps go round again from the pipe exit', async () => {
        const r = await simulate(agility, {
            params: { laps: 3 },
            timeline: startAt(course, START).series(400),
            react: courseReact(),
        });
        expect(r.result.reason).toBe('stop-laps: 3 laps');
        expect(r.sends).toEqual([...LAP, ...LAP, ...LAP]);
    });

    test('without laps it runs until an xp stop', async () => {
        const r = await simulate(agility, {
            timeline: startAt(course, START).series(400),
            react: courseReact(),
            stops: [{ kind: 'xp', skill: 'Agility', amount: 3000 }],
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +3000 Agility xp');
    });

    test('resumes mid-lap from where a stop left the bot (the second plane)', async () => {
        const r = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, { x: 2473, z: 3420, level: 2 }).series(200),
            react: courseReact(),
        });
        expect(r.sends).toEqual([ROPE, BRANCH_DOWN, NET_UP, PIPE]);
        expect(r.result.reason).toBe('stop-laps: 1 laps');
    });

    test('on the first plane it climbs the branch; the ground after the rope takes the net, not the pipe', async () => {
        const a = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, { x: 2473, z: 3423, level: 1 }).series(200),
            react: courseReact(),
        });
        expect(a.sends.slice(0, 2)).toEqual([BRANCH_UP, ROPE]);
        const b = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, { x: 2487, z: 3420, level: 0 }).series(200),
            react: courseReact(),
        });
        expect(b.sends).toEqual([NET_UP, PIPE]);
    });

    test('on the ground off the obstacles it walks to the lap start first', async () => {
        const r = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, { x: 2474, z: 3410, level: 0 }).series(400),
            react: walking(courseReact()),
        });
        expect(r.result.reason).toBe('stop-laps: 1 laps');
        expect(r.sends[0]).toMatch(/^walk to/);
        expect(r.sends.filter(s => !s.startsWith('walk to'))).toEqual(LAP);
    });
});

describe('agility: failures and falls', () => {
    test('a fall off the rope lands on the ground and the bot re-routes from there', async () => {
        const fell = { done: false };
        const r = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, START).series(400),
            react: courseReact((a, c) =>
                a.x === 2478 && c.xp === 187 && a.reason === ROPE && !fell.done
                    ? ((fell.done = true), { to: { x: 2480, z: 3419, level: 0 }, xp: 0, message: 'You slip and fall.' })
                    : c,
            ),
        });
        expect(r.result.reason).toBe('stop-laps: 1 laps');
        // The fall lands at (2480,3419) on the ground south of the nets: next is the net, then the pipe.
        expect(r.sends.slice(0, 6)).toEqual([WALK, NET_UP, BRANCH_UP, ROPE, NET_UP, PIPE]);
    });

    test('a refused obstacle six times in a row fails with the last message', async () => {
        const r = await simulate(agility, {
            timeline: startAt(course, START).series(400),
            react: () => s => world(s).tick(s.tick).message('You can not do that from here.').build(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'obstacle: 6 obstacles in a row failed (last: Log balance at (2474,3435): You can not do that from here.)',
        );
        expect(r.sends).toHaveLength(6);
        // Each refusal but the last waits before the retry, so another player has time to leave the obstacle.
        expect(r.driver.state().tick).toBeGreaterThanOrEqual(5 * 3);
    });

    test('an obstacle that does nothing times out, six in a row fail the run', async () => {
        const r = await simulate(agility, { timeline: startAt(course, START).series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'obstacle: 6 obstacles in a row failed (last: timed out crossing Log balance at (2474,3435))',
        );
    });

    test('a success in between resets the failure streak', async () => {
        // The log fails five times, pays on the sixth; the net then fails five times: never six in a row.
        const r = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, START).series(2000),
            react: courseReact((_, c, n) => (n % 6 === 5 ? c : null)),
        });
        expect(r.result.reason).not.toMatch(/in a row failed/);
    });

    test('an obstacle missing from the scene is logged, and six misses fail the run', async () => {
        const r = await simulate(agility, {
            timeline: startAt(world().skill('Agility', 1, 0), { x: 2474, z: 3428, level: 0 }).series(1),
        });
        expect(r.result.reason).toBe('obstacle: net up not found 6 times in a row');
        expect(r.sends).toEqual([]);
        expect(logged(r)).toHaveLength(6);
    });

    test('an obstacle the scene lacks but a scan finds is used', async () => {
        const net = course.build().nearbyLocs.find(l => l.x === 2473 && l.z === 3425)!;
        const r = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(world().skill('Agility', 1, 0), { x: 2474, z: 3428, level: 0 }).series(100),
            react: courseReact(),
            scan: () => [net, ...course.build().nearbyLocs.filter(l => l.level !== 0)],
        });
        expect(r.sends[0]).toBe(NET_UP);
    });

    test('an unreachable net is not used', async () => {
        const w = startAt(world().skill('Agility', 1, 0), { x: 2474, z: 3428, level: 0 }).loc(
            'Obstacle net',
            2473,
            3425,
            {
                options: ['Climb-over'],
                reachable: false,
            },
        );
        const r = await simulate(agility, { timeline: w.series(1) });
        expect(r.result.reason).toBe('obstacle: net up not found 6 times in a row');
    });
});

describe('agility: guards', () => {
    test('low HP mid-obstacle eats, then the obstacle is sent again', async () => {
        const r = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, { x: 2473, z: 3423, level: 1 })
                .inv('Shrimps', 1)
                .series(200, (w, i) => w.player({ hp: i === 2 ? 4 : 19 })),
            react: courseReact((_, c, n) => (n === 0 ? null : c)),
        });
        expect(r.sends.slice(0, 3)).toEqual([BRANCH_UP, 'Eat Shrimps', BRANCH_UP]);
        expect(r.result.reason).toBe('stop-laps: 1 laps');
    });

    test('a level-up dialog during the obstacle is cleared and the wait carries on', async () => {
        const r = await simulate(agility, {
            params: { laps: 1 },
            timeline: startAt(course, START).series(200, (w, i) => (i >= 1 && i < 3 ? w.dialog() : w)),
            react: courseReact(),
        });
        expect(r.result.reason).toBe('stop-laps: 1 laps');
        expect(r.sends[0]).toBe(WALK);
        expect(r.sends).toContain('continue dialog');
    });
});

describe('agility: preflight', () => {
    test('refuses a bot far from the course', async () => {
        const r = await simulate(agility, { timeline: world().skill('Agility', 1, 0).series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^preflight: not at the gnome course: at \(3222,3218\) level 0/);
    });

    test('refuses a bot on a plane that is not the course', async () => {
        const r = await simulate(agility, {
            timeline: startAt(world().skill('Agility', 1, 0), { x: 2474, z: 3436, level: 3 }).series(1),
        });
        expect(r.result.reason).toMatch(/not at the gnome course/);
    });

    test('refuses a state with no Agility skill', async () => {
        const w = world();
        const state = { ...w.build(), skills: [] };
        const r = await simulate(agility, { timeline: [state] });
        expect(r.result.reason).toBe('preflight: no Agility skill in state');
    });

    test('an unknown course is a params error', async () => {
        const r = await simulate(agility, { params: { course: 'sailing' }, timeline: course.series(1) });
        expect(r.result.status).toBe('error');
    });
});
