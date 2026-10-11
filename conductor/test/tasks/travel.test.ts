import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import type { Effect } from '../../core/drivers/timeline';
import travel from '../../tasks/travel';
import { fakePaths } from '../paths';
import { consume, walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { attackedFrom, world } from '../world';

const START = { x: 3222, z: 3222 };
const base = world().player({ at: START });
/** The walkTo sends' destinations, in order. */
const walks = (r: Simulation) =>
    r.commands.flatMap(c => (c.type === 'send' && c.action.type === 'walkTo' ? [`${c.action.x},${c.action.z}`] : []));
const noRoute = fakePaths(() => ({ success: false, waypoints: [], error: 'no route' }));

describe('travel: the walk', () => {
    test('walks to the destination and is done', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 } },
            timeline: base.series(1),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('arrived: arrived within 3 tiles of (3300,3250)');
        expect(r.steps).toEqual(['walk', 'arrived']);
        expect(r.result.finalPos).toMatchObject({ x: 3298, z: 3250 });
    });

    test('already there is done at once without a send', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3224, z: 3222 } },
            timeline: base.series(1),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([]);
    });

    test('walks the waypoints in order before the destination', async () => {
        const r = await simulate(travel, {
            params: {
                to: { x: 3300, z: 3250 },
                waypoints: [
                    { x: 3200, z: 3275 },
                    { x: 3250, z: 3290 },
                ],
            },
            timeline: base.series(1),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(walks(r).slice(0, 3)).toEqual(['3200,3275', '3250,3290', '3300,3250']);
    });

    test('a walk that runs out of ticks closing in is not a failure; the next walk carries on', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 2700, z: 3222 } },
            timeline: base.series(1),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns.walk).toBeGreaterThan(1);
    });
});

describe('travel: where the route breaks', () => {
    test('no route fails at once, naming the goal', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 } },
            timeline: base.series(1),
            pathfinder: noRoute,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith("walk: can't travel to (3300,3250):");
        expect(r.steps).toEqual(['walk']);
    });

    test('a walk that goes nowhere fails after three in a row', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 } },
            timeline: base.series(1),
            react: consume,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('walk: 3 walks in a row failed toward (3300,3250)');
    });

    test('a walk that works in between resets the count', async () => {
        let n = 0;
        const flaky = walking();
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 } },
            timeline: base.series(1),
            // Every third walk send moves the bot; the others leave it where it stands.
            react: (a: BotAction, s) => (a.type === 'walkTo' && ++n % 3 !== 0 ? undefined : flaky(a, s)),
        });
        expect(r.result.status).toBe('done');
    });
});

describe('travel: preflight', () => {
    test('refuses a destination in the Wilderness', async () => {
        const r = await simulate(travel, { params: { to: { x: 3100, z: 3700 } }, timeline: base.series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('preflight: (3100,3700) is in the Wilderness');
    });

    test('refuses a waypoint in the Wilderness', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 }, waypoints: [{ x: 3100, z: 3700 }] },
            timeline: base.series(1),
        });
        expect(r.result.reason).toBe('preflight: (3100,3700) is in the Wilderness');
    });
});

describe('travel: guards', () => {
    test('low HP mid-walk eats, then the walk goes on', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 } },
            timeline: base.inv('Shrimps', 2).series(30, (w, i) => w.player({ hp: i === 2 ? 3 : 10 })),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toContain('Eat Shrimps');
        expect(r.result.stepRuns['interrupt:low-hp']).toBe(1);
    });

    test('being attacked does not stop the walk', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 } },
            timeline: base.series(30, (w, i) => w.player({ inCombat: i >= 2 && i < 6, hp: 10 })),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns['interrupt:under-attack']).toBeUndefined();
    });

    test('a dialog in the way is cleared and the walk goes on', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 } },
            timeline: base.series(30, (w, i) => (i === 2 ? w.dialog() : w)),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
    });
});

describe('travel: guards without food', () => {
    test('low HP under attack with no food fails in the shared low-hp guard', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 } },
            timeline: base.series(30, (w, i) => attackedFrom(w, i, Infinity, 2).player({ hp: i >= 3 ? 4 : 10 })),
            react: walking(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('interrupt:low-hp: hp 4/10');
        expect(r.result.reason).toEndWith('no food');
    });
});

/** A fence round x 2400..2500, z 3390..3500: no step crosses its edge. */
const fenced = (x: number, z: number) => x >= 2400 && x <= 2500 && z >= 3390 && z <= 3500;

const fence = () =>
    fakePaths(
        (from, to) => ({ success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] }),
        [],
        () => false,
        (x, z, dx, dz) => fenced(x, z) !== fenced(x + dx, z + dz),
    );

describe('travel: the Gnome Stronghold', () => {
    const straightPaths = fence;
    const STAND = { x: 2461, z: 3381 };
    const THROUGH = { x: 2461, z: 3391 };
    const course = { x: 2474, z: 3436 };
    const outside = world()
        .player({ at: { x: 2480, z: 3380 } })
        .loc('Gate', 2459, 3383, { options: ['Open'] });
    const through: Effect = s => world(s).player({ at: THROUGH }).build();
    const gateWorld = () => {
        const walk = walking();
        return (a: BotAction, s: Parameters<typeof consume>[1]) =>
            a.type === 'interactLoc' && /Open/.test(a.reason) ? through : walk(a, s);
    };

    test('from outside, walks to the gate stand, opens the gate, then walks in', async () => {
        const r = await simulate(travel, {
            params: { to: course },
            timeline: outside.series(1),
            react: gateWorld(),
            pathfinder: fence(),
        });
        expect(r.result.status).toBe('done');
        expect(r.steps).toEqual(['walk', 'gnome-gate', 'walk', 'arrived']);
        expect(walks(r)[0]).toBe(`${STAND.x},${STAND.z}`);
        expect(r.sends).toContain('Open Gate');
        expect(walks(r).at(-1)).toBe(`${course.x},${course.z}`);
    });

    test('outside the fence is not arrived while the destination is inside it, even within tolerance', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 2450, z: 3392 }, tolerance: 6 },
            timeline: world()
                .player({ at: { x: 2450, z: 3388 } })
                .loc('Gate', 2459, 3383, { options: ['Open'] })
                .series(1),
            react: gateWorld(),
            pathfinder: fence(),
        });
        expect(r.result.status).toBe('done');
        expect(r.steps[0]).toBe('walk');
        expect(r.steps).toContain('gnome-gate');
        expect(r.sends).toContain('Open Gate');
    });

    test('a bot already inside the fence walks straight to the course', async () => {
        const r = await simulate(travel, {
            params: { to: course },
            timeline: world()
                .player({ at: { x: 2470, z: 3395 } })
                .series(1),
            react: walking(),
            pathfinder: fence(),
        });
        expect(r.result.status).toBe('done');
        expect(r.steps).toEqual(['walk', 'arrived']);
        expect(r.sends.includes('Open Gate')).toBe(false);
    });

    test('a bot on a raised floor inside the fence walks straight to the course', async () => {
        const r = await simulate(travel, {
            params: { to: course },
            timeline: world()
                .player({ at: { x: 2470, z: 3395, level: 1 } })
                .series(1),
            react: walking(),
            pathfinder: fence(),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.includes('Open Gate')).toBe(false);
        expect(r.steps).not.toContain('gnome-gate');
        expect(walks(r)[0]).toBe(`${course.x},${course.z}`);
    });

    test('a gate that stays shut fails after three tries with its reason', async () => {
        const r = await simulate(travel, {
            params: { to: course },
            timeline: outside.player({ at: STAND }).series(1),
            react: walking(),
            pathfinder: fence(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('gnome-gate: Gnome Stronghold gate:');
    });

    test('waypoints come before the gate', async () => {
        const r = await simulate(travel, {
            params: { to: course, waypoints: [{ x: 2520, z: 3385 }] },
            timeline: outside.series(1),
            react: gateWorld(),
            pathfinder: straightPaths(),
        });
        expect(r.result.status).toBe('done');
        expect(walks(r).slice(0, 2)).toEqual(['2520,3385', `${STAND.x},${STAND.z}`]);
    });
});
