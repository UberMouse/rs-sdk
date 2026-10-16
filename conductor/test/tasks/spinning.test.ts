import { describe, expect, test } from 'bun:test';
import { SPIN_MENU_TICKS } from '../../actions/spin';
import { stepBudgetTicks } from '../../lib/task';
import spinning, { ATTEMPT_SILENT_TICKS, FAIL_LIMIT, SPIN_MAX_TICKS, WHEEL_WALK_TICKS } from '../../tasks/spinning';
import { fakePaths } from '../paths';
import { consume, walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { attackedFrom, type World, world } from '../world';

const WHEEL = { x: 2711, z: 3471 };
const PARAMS = { wheel: { ...WHEEL, level: 1 } };
/** Wool then flax, each Make X, Make 10, Make 5 and the product's own button. */
const MENU = ['Wool', 'Flax'].flatMap(p => ['Make X', 'Make 10', 'Make 5', `\\n\\n\\n\\n${p}`]);
const STRING_ID = 1777;
const SPIN = 'Spin Spinning wheel';
const MAKE_X = 'spin flax (Make X)';

/** The bot on the first floor beside the wheel, Crafting 35, `n` flax. */
const kit = (n: number, level = 35) =>
    world()
        .player({ at: { x: 2712, z: 3471, level: 1 } })
        .loc('Spinning wheel', WHEEL.x, WHEEL.z, { id: 2644, options: ['Spin', 'Examine'] })
        .skill('Crafting', level, 0)
        .inv('Flax', n);
const menu = (w: World) => w.dialog({ options: MENU });
const levelUp = (w: World) => w.dialog({ options: ['Click here to continue'] });
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

/**
 * `n` flax: the menu opens at ticks 2-3 and the queue spins one every 2 ticks from tick 6 (375 xp and a
 * bow string each), until `stopAt` (a level-up or an interruption) when it ends.
 */
const spun = (n: number, stopAt = Infinity, from = 0, extra: (w: World, i: number) => World = w => w) =>
    kit(n).series(80, (w, i) => {
        const t = i - from;
        const done = t < 6 ? 0 : Math.min(Math.floor((t - 6) / 2) + 1, n, Math.floor((stopAt - from - 6) / 2) + 1);
        const state = kit(n)
            .tick(i)
            .inv('Flax', n - done)
            .inv('Bow string', done, { id: STRING_ID })
            .skill('Crafting', 35, 375 * done);
        return extra(t === 2 || t === 3 ? menu(state) : state, i);
    });

describe('spinning: the success path', () => {
    test('spins everything held in one go with Make X, then ends done', async () => {
        const r = await simulate(spinning, { params: PARAMS, timeline: spun(10) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: nothing left to spin');
        expect(r.sends).toEqual([SPIN, MAKE_X, 'spin 10 flax']);
        expect(r.result.inventoryDelta).toEqual({ Flax: -10, 'Bow string': 10 });
        expect(r.steps).toEqual(['spin', 'finish']);
        expect(logged(r)).toEqual([]);
    });

    test('a batch cut short (a level-up) is followed by another over what is left', async () => {
        // The queue ends after 4 strings; the second menu opens at tick 20 and spins the other 6.
        // The fourth string levels the bot up to 36 and ends the queue.
        const first = spun(10, 12, 0, (w, i) => (i >= 12 ? w.skill('Crafting', 36, 1500) : w)).slice(0, 20);
        const rest = kit(6)
            .inv('Bow string', 4, { id: STRING_ID })
            .skill('Crafting', 36, 1500)
            .series(60, (w, i) => {
                const t = i;
                const done = t < 6 ? 0 : Math.min(Math.floor((t - 6) / 2) + 1, 6);
                const s = kit(6 - done)
                    .inv('Bow string', 4 + done, { id: STRING_ID })
                    .skill('Crafting', 36, 1500 + 375 * done)
                    .tick(20 + t);
                return t === 2 || t === 3 ? menu(s) : s;
            });
        const r = await simulate(spinning, { params: PARAMS, timeline: [...first, ...rest] });
        expect(r.result.reason).toBe('finish: nothing left to spin');
        expect(r.sends).toEqual([SPIN, MAKE_X, 'spin 10 flax', SPIN, MAKE_X, 'spin 6 flax']);
    });

    test('without `wheel` it uses a wheel in view', async () => {
        const r = await simulate(spinning, { timeline: spun(5) });
        expect(r.result.reason).toBe('finish: nothing left to spin');
        expect(r.steps).toEqual(['spin', 'finish']);
    });
});

describe('spinning: preflight', () => {
    test('refuses with nothing to spin, too low a level, or no wheel in view', async () => {
        const none = await simulate(spinning, { params: PARAMS, timeline: kit(0).series(1) });
        expect(none.result.reason).toBe('preflight: no flax in the inventory');
        const low = await simulate(spinning, { params: PARAMS, timeline: kit(5, 9).series(1) });
        expect(low.result.reason).toBe('preflight: flax needs crafting 10, bot has 9');
        const blind = await simulate(spinning, {
            timeline: world().skill('Crafting', 35, 0).inv('Flax', 3).series(1),
        });
        expect(blind.result.reason).toBe('preflight: no reachable spinning wheel in view (pass `wheel`)');
        expect(none.sends).toEqual([]);
    });

    test('refuses a wheel in the Wilderness', async () => {
        const r = await simulate(spinning, {
            params: { wheel: { x: 3000, z: 3600, level: 0 } },
            timeline: kit(3).series(1),
        });
        expect(r.result.reason).toBe('preflight: wheel (3000,3600) reaches the Wilderness');
    });

    test('wool needs no level and is spun with the Wool group', async () => {
        const woolKit = kit(0, 1).inv('Wool', 3);
        const r = await simulate(spinning, {
            params: { material: 'wool' },
            timeline: woolKit.series(4, (w, i) => (i === 2 ? menu(w) : w)),
        });
        expect(r.sends[0]).toBe(SPIN);
        expect(r.sends[1]).toBe('spin wool (Make X)');
    });
});

describe('spinning: failures', () => {
    test('the level box ends the run at once, naming it', async () => {
        const box = 'You need level 10 Crafting to make that.';
        const r = await simulate(spinning, {
            params: PARAMS,
            timeline: kit(5).series(30, (w, i) => (i === 2 ? menu(w) : i >= 4 ? w.recentDialog([box]) : w)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`spin: ${box}`);
    });

    test(`${FAIL_LIMIT} spins in a row that come to nothing fail the run; the walk to a wheel out of view too`, async () => {
        const stalled = await simulate(spinning, {
            params: PARAMS,
            timeline: kit(5).series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(stalled.result.reason).toBe(`spin: ${FAIL_LIMIT} spins in a row failed (last: not connected)`);
        const blind = world()
            .player({ at: { x: 2712, z: 3471, level: 1 } })
            .skill('Crafting', 35, 0)
            .inv('Flax', 3);
        const r = await simulate(spinning, { params: PARAMS, timeline: blind.series(1) });
        expect(r.result.reason).toBe('spin: no reachable spinning wheel nearby (pass `wheel`)');
    });
});

describe('spinning: walking to the wheel', () => {
    test('far from the wheel it walks first, on the wheel floor, then spins', async () => {
        const far = kit(5).player({ at: { x: 2700, z: 3475, level: 1 } });
        const r = await simulate(spinning, {
            params: PARAMS,
            timeline: far.series(80, (w, i) => (i === 40 || i === 41 ? menu(w) : i > 46 ? w.inv('Flax', 0) : w)),
            react: walking(consume),
            pathfinder: fakePaths((from, to) => ({
                success: true,
                reachedDestination: true,
                waypoints: [from, { ...from, x: to.x, z: to.z }],
            })),
        });
        expect(r.steps[0]).toBe('walk-to-wheel');
        expect(r.steps).toContain('spin');
    });

    test(`a walk with no route fails the run after ${FAIL_LIMIT} tries`, async () => {
        const far = kit(5).player({ at: { x: 2700, z: 3475, level: 1 } });
        const r = await simulate(spinning, {
            params: PARAMS,
            timeline: far.series(1),
            react: walking(consume),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^walk-to-wheel: can't reach the wheel/);
        expect(r.sends).toEqual([]);
    });

    test('the wrong floor counts as away from the wheel even when the tile is close', async () => {
        const below = kit(5).player({ at: { x: 2712, z: 3471, level: 0 } });
        const r = await simulate(spinning, {
            params: PARAMS,
            timeline: below.series(1),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(r.steps[0]).toBe('walk-to-wheel');
    });
});

describe('spinning: guards', () => {
    test('low HP mid-spin aborts, eats, and spinning resumes', async () => {
        const r = await simulate(spinning, {
            params: PARAMS,
            timeline: spun(5, Infinity, 0, (w, i) => w.inv('Shrimps', 1).player({ hp: i === 4 ? 4 : 10 })),
        });
        expect(r.result.stepRuns['interrupt:low-hp']).toBe(1);
        expect(r.result.status).toBe('done');
        expect(r.sends.slice(-2)).toEqual(['Eat Shrimps', SPIN]);
    });

    test('a level-up dialog mid-spin is cleared by the dialog guard and the spin carries on', async () => {
        const r = await simulate(spinning, {
            params: PARAMS,
            timeline: spun(10, Infinity, 0, (w, i) => (i === 10 ? levelUp(w) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns['interrupt:dialog']).toBeGreaterThan(0);
    });

    test('with auto-retaliate off, fails as soon as the bot is attacked', async () => {
        const r = await simulate(spinning, {
            params: PARAMS,
            timeline: kit(5)
                .autoRetaliate(false)
                .series(10, (w, i) => attackedFrom(w, i)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^interrupt:under-attack: attacked by Goblin/);
    });
});

describe('spinning: the step budget', () => {
    test('the budget covers the capped walk plus the longest spin after it', () => {
        expect(WHEEL_WALK_TICKS + SPIN_MAX_TICKS).toBeLessThanOrEqual(stepBudgetTicks(180_000));
        expect(ATTEMPT_SILENT_TICKS).toBe(WHEEL_WALK_TICKS + SPIN_MAX_TICKS);
        expect(SPIN_MAX_TICKS).toBeGreaterThan(SPIN_MENU_TICKS + 28 * 2);
    });
});
