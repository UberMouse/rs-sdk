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

    test('a diagonal-ish target exactly at the tolerance (Chebyshev 3, Euclidean 3.16) is arrived at once', async () => {
        const r = await simulate(travel, {
            params: { to: { x: START.x - 1, z: START.z + 3 }, tolerance: 3 },
            timeline: base.series(1),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toMatch(/^arrived: arrived within 3 tiles/);
        expect(r.steps).toEqual(['arrived']);
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
        expect(r.result.reason).toBe('preflight: (3100,3700) is in the Wilderness (set wilderness: true)');
    });

    test('refuses a waypoint in the Wilderness', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3300, z: 3250 }, waypoints: [{ x: 3100, z: 3700 }] },
            timeline: base.series(1),
        });
        expect(r.result.reason).toBe('preflight: (3100,3700) is in the Wilderness (set wilderness: true)');
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

/** In combat for the first `until` ticks, holding two shrimps. */
const inFight = (until: number, hp = 10) =>
    base
        .inv('Shrimps', 2)
        .series(60, (w, i) => w.player({ inCombat: i < until, hp, lastDamageTick: i < until ? i : -1 }));

describe('travel: flee', () => {
    const to = { x: 3300, z: 3250 };

    test('without the flag a run that starts in combat is refused', async () => {
        const r = await simulate(travel, { params: { to }, timeline: inFight(8), react: walking() });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('in combat at');
        expect(r.sends).toEqual([]);
    });

    test('with the flag it starts in combat, walks on, and is done once out of combat at the destination', async () => {
        const r = await simulate(travel, { params: { to, flee: true }, timeline: inFight(8), react: walking() });
        expect(r.result.status).toBe('done');
        expect(r.result.finalPos).toMatchObject({ x: 3298, z: 3250 });
        expect(walks(r).length).toBeGreaterThan(0);
        expect(r.result.stepRuns['interrupt:under-attack']).toBeUndefined();
    });

    test('low HP while fleeing eats held food, then the walk goes on', async () => {
        const r = await simulate(travel, {
            params: { to, flee: true },
            timeline: base.inv('Shrimps', 2).series(60, (w, i) => w.player({ inCombat: i < 8, hp: i === 2 ? 3 : 10 })),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toContain('Eat Shrimps');
    });

    test('still in combat at the destination fails after the settle loops', async () => {
        const r = await simulate(travel, {
            params: { to, flee: true },
            timeline: base.series(80, w => w.player({ inCombat: true })),
            react: walking(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('fight-at-destination: still in combat at (3300,3250) after fleeing there');
    });

    test('fleeing with low HP, an attacker and no food keeps walking and arrives', async () => {
        const r = await simulate(travel, {
            params: { to, flee: true },
            timeline: base.series(60, (w, i) => w.player({ inCombat: i < 8, hp: i < 8 ? 4 : 10 })),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.finalPos).toMatchObject({ x: 3298, z: 3250 });
        expect(r.result.stepRuns['interrupt:low-hp']).toBeUndefined();
    });

    test('fleeing at low HP with no food, out of combat, still rests to regenerate', async () => {
        const r = await simulate(travel, {
            params: { to, flee: true },
            timeline: base.series(80, (w, i) => w.player({ inCombat: i === 0, hp: i < 6 ? 4 : 10 })),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
    });

    test('fleeing at low HP with no food still ends on a death', async () => {
        const r = await simulate(travel, {
            params: { to, flee: true },
            timeline: base.series(60, (w, i) => {
                const hurt = w.player({ inCombat: i < 20, hp: 4 });
                return i === 4 ? hurt.message('Oh dear, you are dead!') : hurt;
            }),
            react: walking(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('interrupt:death: died');
    });
});

describe('travel: wilderness opt-in', () => {
    const EDGEVILLE = { x: 3094, z: 3492 };
    const DOOR = { x: 2998, z: 3915 };
    const edge = world().player({ at: EDGEVILLE });
    const wild = (z: number) => edge.player({ at: { x: 3000, z } });

    test('with the flag a destination and waypoint in the Wilderness are accepted and walked', async () => {
        const r = await simulate(travel, {
            params: { to: DOOR, waypoints: [{ x: 3050, z: 3700 }], wilderness: true },
            timeline: edge.inv('Shrimps', 3).series(1),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(walks(r)[0]).toBe('3050,3700');
        expect(r.result.finalPos).toMatchObject({ x: 2998, z: 3914 });
    });

    test('the Wilderness guard stands down on the way, and a hit does not fail the run', async () => {
        const r = await simulate(travel, {
            params: { to: DOOR, wilderness: true },
            timeline: edge.inv('Shrimps', 3).series(40, (w, i) => w.player({ inCombat: i >= 3 && i < 8, hp: 45 })),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
    });

    test('the guard still ends a Wilderness run without the flag', async () => {
        const r = await simulate(travel, {
            params: { to: { x: 3000, z: 3500 } },
            timeline: wild(3600).series(5),
            react: walking(),
        });
        expect(r.result.status).toBe('failed');
    });

    test('refuses to start with too little food', async () => {
        const r = await simulate(travel, {
            params: { to: DOOR, wilderness: true },
            timeline: edge.inv('Shrimps', 2).series(1),
        });
        expect(r.result.reason).toBe('preflight: a Wilderness trip needs 3 food (minFood), bot has 2');
    });

    test('minFood 0 is clamped to one food: a foodless bot is refused, one with a bite starts', async () => {
        const none = await simulate(travel, {
            params: { to: DOOR, wilderness: true, minFood: 0 },
            timeline: edge.series(1),
            react: walking(),
        });
        expect(none.result.reason).toBe('preflight: a Wilderness trip needs 1 food (minFood), bot has 0');
        const one = await simulate(travel, {
            params: { to: DOOR, wilderness: true, minFood: 0 },
            timeline: edge.inv('Shrimps', 1).series(1),
            react: walking(),
        });
        expect(one.result.status).toBe('done');
    });

    test('low HP in the Wilderness eats, then the walk goes on', async () => {
        const r = await simulate(travel, {
            params: { to: DOOR, wilderness: true },
            timeline: edge.inv('Shrimps', 3).series(60, (w, i) => w.player({ hp: i === 3 ? 10 : 50, maxHp: 50 })),
            react: walking(),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toContain('Eat Shrimps');
    });

    test('low HP under attack with no food left fails safely', async () => {
        const r = await simulate(travel, {
            params: { to: DOOR, wilderness: true },
            timeline: edge
                .inv('Shrimps', 3)
                .series(60, (w, i) => attackedFrom(w, i, Infinity, 2).player({ hp: i >= 3 ? 8 : 50, maxHp: 50 })),
            react: walking(),
        });
        expect(r.result.status).toBe('failed');
    });

    test('HP still falling out of combat once the food is gone fails the trip rather than walking on', async () => {
        const r = await simulate(travel, {
            params: { to: DOOR, wilderness: true, minFood: 1 },
            timeline: edge.inv('Shrimps', 1).series(80, (w, i) => w.player({ hp: Math.max(5, 30 - i), maxHp: 50 })),
            react: walking(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.sends).toContain('Eat Shrimps');
    });
});
