import { describe, expect, test } from 'bun:test';
import pick from '../../tasks/pick';
import { fakePaths } from '../paths';
import { walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { attackedFrom, world } from '../world';

const FLAX = { x: 2740, z: 3440 };
const PARAMS = { loc: 'Flax', item: 'Flax' };
const AREA = { x: 2743, z: 3445, radius: 10 };
const base = world().player({ at: { x: 2741, z: 3441 } });
const field = base.loc('Flax', FLAX.x, FLAX.z, { id: 2646, options: ['Pick'] });
/** The plant is gone (the engine deletes a picked flax 3 times in 16 for 10 ticks). */
const bare = base;
const PICK = 'Pick Flax';
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

describe('pick: picking', () => {
    test('picks the nearest plant and again after each flax, until count is held', async () => {
        const two = field.loc('Flax', 2745, 3440, { id: 2646, options: ['Pick'] });
        const r = await simulate(pick, {
            params: { ...PARAMS, count: 2 },
            timeline: two.series(20, (w, i) => w.inv('Flax', i >= 8 ? 2 : i >= 4 ? 1 : 0)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: picked 2 Flax');
        expect(r.sends).toEqual([PICK, PICK]);
        expect(r.result.inventoryDelta).toEqual({ Flax: 2 });
        expect(logged(r)).toEqual([]);
    });

    test('without count it picks until the inventory is full, then ends done', async () => {
        const r = await simulate(pick, {
            params: PARAMS,
            timeline: field.inv('Coins', 1).series(10, (w, i) => (i >= 4 ? w.inv('Flax', 27) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: inventory full: 27 Flax');
        expect(r.sends).toEqual([PICK]);
    });

    test('a plant that vanishes with the flax picked is a success; one that vanishes unpicked just goes on', async () => {
        const r = await simulate(pick, {
            params: { ...PARAMS, count: 1 },
            timeline: field.series(30, (w, i) =>
                i >= 3 && i < 10 ? bare.tick(i) : i >= 14 ? field.tick(i).inv('Flax', 1) : field.tick(i),
            ),
        });
        expect(r.result.reason).toBe('finish: picked 1 Flax');
        // The first pick finds the plant gone (picked by someone else): no failure is logged, the bot waits for the respawn.
        expect(logged(r)).toEqual(['no Flax to pick, waiting for a respawn']);
        expect(r.sends).toEqual([PICK, PICK]);
    });

    test('only plants of the named loc with a Pick option count', async () => {
        const r = await simulate(pick, {
            params: { ...PARAMS, area: AREA },
            timeline: base
                .loc('Cabbage', 2740, 3441, { options: ['Pick'] })
                .loc('Flax', 2741, 3440, { id: 2647, options: ['Examine'] })
                .loc('Flax', 2742, 3440, { id: 2646, options: ['Pick'], reachable: false })
                .series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.sends).toEqual([]);
    });

    test('eight picks failing in a row fail the run with the last reason', async () => {
        const r = await simulate(pick, {
            params: PARAMS,
            timeline: field.series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('pick: 8 picks in a row failed (last: not connected)');
        expect(r.sends).toHaveLength(8);
    });
});

describe('pick: finishing', () => {
    test('a full inventory with no flax fails; one short of count fails naming the count', async () => {
        const none = await simulate(pick, { params: PARAMS, timeline: field.inv('Tinderbox', 28).series(1) });
        expect(none.result.reason).toBe('finish: inventory full with no Flax');
        const short = await simulate(pick, {
            params: { ...PARAMS, count: 20 },
            timeline: field.inv('Flax', 5).inv('Tinderbox', 23).series(1),
        });
        expect(short.result.reason).toBe('full-short: inventory full with 5 of 20 Flax');
        expect(short.sends).toEqual([]);
    });

    test('already holding count ends done at once, picking nothing', async () => {
        const r = await simulate(pick, { params: { ...PARAMS, count: 3 }, timeline: field.inv('Flax', 3).series(1) });
        expect(r.result.reason).toBe('finish: picked 3 Flax');
        expect(r.sends).toEqual([]);
    });
});

describe('pick: no plant', () => {
    test('with an area, fails "area depleted" once the give-up budget is spent; plants outside do not count', async () => {
        const r = await simulate(pick, {
            params: { ...PARAMS, area: { x: 2743, z: 3445, radius: 5 } },
            timeline: base.loc('Flax', 2760, 3445, { options: ['Pick'] }).series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('pick: area depleted: no reachable Flax in radius 5 for 40s');
        expect(r.driver.state().tick).toBe(100);
        expect(r.sends).toEqual([]);
    });

    test('without an area the reason says nearby', async () => {
        const r = await simulate(pick, { params: PARAMS, timeline: bare.series(1) });
        expect(r.result.reason).toBe('pick: no reachable Flax nearby for 40s');
    });
});

describe('pick: area and guards', () => {
    test('far from the area it walks back first, then picks', async () => {
        const far = world().player({ at: { x: 2700, z: 3445 } });
        const r = await simulate(pick, {
            params: { ...PARAMS, count: 1, area: AREA },
            timeline: far.series(60),
            pathfinder: fakePaths((from, to) => ({
                success: true,
                reachedDestination: true,
                waypoints: [{ ...to, level: from.level }],
            })),
            react: walking(),
        });
        expect(r.steps[0]).toBe('return-to-area');
    });

    test('an area reaching the Wilderness is refused', async () => {
        const r = await simulate(pick, {
            params: { ...PARAMS, area: { x: 3000, z: 3600, radius: 10 } },
            timeline: field.series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/Wilderness/);
    });

    test('low HP mid-pick aborts the pick and eats, then picking resumes', async () => {
        const r = await simulate(pick, {
            params: { ...PARAMS, count: 1 },
            timeline: field
                .inv('Shrimps', 1)
                .series(20, (w, i) => (i >= 8 ? w.inv('Flax', 1) : w).player({ hp: i === 3 ? 4 : 10 })),
        });
        expect(r.result.reason).toBe('finish: picked 1 Flax');
        expect(r.sends).toEqual([PICK, 'Eat Shrimps', PICK]);
    });

    test('with auto-retaliate off, fails as soon as the bot is attacked; with it on, waits the fight out', async () => {
        const off = await simulate(pick, {
            params: PARAMS,
            timeline: field.autoRetaliate(false).series(10, (w, i) => attackedFrom(w, i)),
        });
        expect(off.result.status).toBe('failed');
        expect(off.result.reason).toMatch(/^interrupt:under-attack: attacked by Goblin/);
        const on = await simulate(pick, {
            params: { ...PARAMS, count: 1 },
            timeline: field
                .autoRetaliate(true)
                .series(30, (w, i) => (i >= 15 ? attackedFrom(w, i, 10).inv('Flax', 1) : attackedFrom(w, i, 10))),
        });
        expect(on.result.reason).toBe('finish: picked 1 Flax');
        expect(on.result.stepRuns['interrupt:under-attack']).toBe(7);
    });
});

describe('pick: seenOutsideArea diagnostic', () => {
    const params = { ...PARAMS, area: { x: 2743, z: 3445, radius: 5 } };

    test('a plant in view outside the area while waiting warns, naming its tile', async () => {
        const r = await simulate(pick, {
            params,
            timeline: base.loc('Flax', 2760, 3445, { options: ['Pick'] }).series(1),
        });
        expect(r.result.diagnostics).toMatchObject({ idleTicks: 100, seenOutsideAreaTicks: 100 });
        expect(r.result.warnings?.[0]).toContain('seenOutsideArea');
        expect(r.result.warnings?.[0]).toContain('(2760,3445)');
    });

    test('nothing in view: idle ticks, no warning', async () => {
        const r = await simulate(pick, { params, timeline: base.series(1) });
        expect(r.result.diagnostics).toEqual({ idleTicks: 100, seenOutsideAreaTicks: 0 });
        expect(r.result.warnings).toBeUndefined();
    });
});
