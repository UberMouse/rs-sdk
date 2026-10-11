import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import type { Effect } from '../../core/drivers/timeline';
import { FILL_WAIT_TICKS } from '../../actions/fill';
import { stepBudgetTicks } from '../../lib/task';
import fill, { ATTEMPT_SILENT_TICKS, FAIL_LIMIT, SOURCE_WALK_TICKS } from '../../tasks/fill';
import { fakePaths, straightPaths } from '../paths';
import { consume, walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { attackedFrom, type World, world } from '../world';

const ID: Record<string, number> = {
    Bucket: 1925,
    'Bucket of water': 1929,
    Jug: 1935,
    'Jug of water': 1937,
    Bowl: 1923,
    'Bowl of water': 1921,
    Vial: 229,
    'Vial of water': 227,
};
const FOUNTAIN = { x: 3221, z: 3210 };
const base = world().player({ at: { x: 3220, z: 3212 } });
const count = (s: BotWorldState, name: string) =>
    s.inventory.filter(i => i.name.toLowerCase() === name.toLowerCase()).reduce((n, i) => n + i.count, 0);
/** `s` with `delta` more of `name`, as a new object so the effect never retires. */
const bump = (s: BotWorldState, name: string, delta: number) =>
    world(s)
        .inv(name, Math.max(0, count(s, name) + delta), { id: ID[name] })
        .build();
const FULL: Record<string, string> = {
    Bucket: 'Bucket of water',
    Jug: 'Jug of water',
    Bowl: 'Bowl of water',
    Vial: 'Vial of water',
};

/** The engine's water source: one use swaps one empty container for a full one. */
function filling(action: BotAction, state: BotWorldState): Effect | undefined {
    if (action.type !== 'useItemOnLoc') return consume(action, state);
    const name = state.inventory.find(i => i.slot === action.itemSlot)?.name ?? '';
    const full = FULL[name];
    if (!full) return undefined;
    return s => bump(bump(s, name, -1), full, 1);
}

const empties = (name: string, n: number, w: World = base) => w.inv(name, n, { id: ID[name] });
const fountain = (w: World = base) => w.loc('Fountain', FOUNTAIN.x, FOUNTAIN.z, { options: ['Use'] });
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const USE = (what: string, at = 'Fountain') => `use ${what} on ${at}`;

describe('fill', () => {
    test('fills each empty bucket in turn at the fountain, then finishes', async () => {
        const r = await simulate(fill, { timeline: fountain(empties('Bucket', 3)).series(1), react: filling });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no empty Bucket left; 3 full');
        expect(r.sends).toEqual([USE('Bucket'), USE('Bucket'), USE('Bucket')]);
        expect(r.result.inventoryDelta).toEqual({ Bucket: -3, 'Bucket of water': 3 });
        expect(logged(r)).toEqual([]);
    });

    test.each(['Jug', 'Bowl', 'Vial'] as const)('fills a %s', async container => {
        const r = await simulate(fill, {
            params: { container },
            timeline: fountain(empties(container, 2)).series(1),
            react: filling,
        });
        expect(r.result.reason).toBe(`finish: no empty ${container} left; 2 full`);
        expect(r.sends).toEqual([USE(container), USE(container)]);
    });

    test('only the chosen container is filled', async () => {
        const w = empties('Jug', 1, empties('Bucket', 1));
        const r = await simulate(fill, { timeline: fountain(w).series(1), react: filling });
        expect(r.sends).toEqual([USE('Bucket')]);
        expect(r.result.inventoryDelta).toEqual({ Bucket: -1, 'Bucket of water': 1 });
    });

    test('a well fills a bucket, and a sink counts as a fountain', async () => {
        const well = await simulate(fill, {
            timeline: empties('Bucket', 1, base.loc('Well', 3221, 3211)).series(1),
            react: filling,
        });
        expect(well.sends).toEqual([USE('Bucket', 'Well')]);
        const sink = await simulate(fill, {
            timeline: empties('Bucket', 1, base.loc('Sink', 3221, 3211)).series(1),
            react: filling,
        });
        expect(sink.sends).toEqual([USE('Bucket', 'Sink')]);
    });

    test('uses the nearest source', async () => {
        const w = empties('Bucket', 1, base.loc('Sink', 3221, 3214).loc('Fountain', 3221, 3211));
        const r = await simulate(fill, { timeline: w.series(1), react: filling });
        expect(r.sends).toEqual([USE('Bucket')]);
    });

    test('a well does not fill a jug', async () => {
        const r = await simulate(fill, {
            params: { container: 'Jug' },
            timeline: empties('Jug', 1, base.loc('Well', 3221, 3210)).series(1),
            react: filling,
        });
        expect(r.result.status).toBe('failed');
        expect(r.sends).toEqual([]);
    });

    test('ignores an unreachable fountain', async () => {
        const w = empties('Bucket', 1, base.loc('Fountain', FOUNTAIN.x, FOUNTAIN.z, { reachable: false }));
        const r = await simulate(fill, { timeline: w.series(1), react: filling });
        expect(r.result.status).toBe('failed');
        expect(r.sends).toEqual([]);
    });

    test('a decoy Fountain that does nothing is skipped for the rest of the run', async () => {
        const decoy = { x: 3221, z: 3211 };
        const w = empties('Bucket', 2, base.loc('Fountain', decoy.x, decoy.z).loc('Fountain', 3221, 3214));
        const r = await simulate(fill, {
            timeline: w.series(1),
            react: (action, state) =>
                action.type === 'useItemOnLoc' && action.x === decoy.x && action.z === decoy.z
                    ? s => ({
                          ...s,
                          gameMessages: [
                              ...s.gameMessages,
                              {
                                  type: 0,
                                  text: 'Nothing interesting happens.',
                                  sender: '',
                                  tick: s.tick,
                                  fromSelf: false,
                              },
                          ],
                      })
                    : filling(action, state),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.inventoryDelta).toEqual({ Bucket: -2, 'Bucket of water': 2 });
        expect(r.sends.filter(x => x === USE('Bucket'))).toHaveLength(3);
        expect(logged(r).some(m => String(m).startsWith('skipping the Fountain at 3221,3211'))).toBe(true);
    });
});

describe('fill: refusals and failures', () => {
    test('preflight refuses with no empty container', async () => {
        const r = await simulate(fill, {
            timeline: fountain(base.inv('Bucket of water', 2, { id: ID['Bucket of water'] })).series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('preflight: no empty Bucket in inventory');
    });

    test('preflight refuses an area in the Wilderness', async () => {
        const r = await simulate(fill, {
            params: { area: { x: 3000, z: 3700, radius: 5 } },
            timeline: empties('Bucket', 1).series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/wilderness/i);
    });

    test('no water source in view fails after FAIL_LIMIT tries', async () => {
        const r = await simulate(fill, { timeline: empties('Bucket', 1).series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            `fill: ${FAIL_LIMIT} fills in a row failed (last: no water source in view (pass \`area\` at one))`,
        );
    });

    test('FAIL_LIMIT refused sends in a row fail the run', async () => {
        const r = await simulate(fill, {
            timeline: fountain(empties('Bucket', 1)).series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.reason).toBe(`fill: ${FAIL_LIMIT} fills in a row failed (last: not connected)`);
        expect(r.sends).toHaveLength(FAIL_LIMIT);
    });

    test('an unanswered fill times out after the wait budget and counts as a failure', async () => {
        const r = await simulate(fill, { timeline: fountain(empties('Bucket', 1)).series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.sends).toHaveLength(FAIL_LIMIT);
        expect(logged(r)[0]).toBe('fill failed: Timeout filling Bucket at Fountain');
    });
});

const far = (n = 2) => empties('Bucket', n, base.player({ at: { x: 3230, z: 3225 } })).loc('Fountain', 3221, 3210);

describe('fill: walking', () => {
    test('walks to a distant source before using the bucket', async () => {
        const r = await simulate(fill, {
            timeline: far().series(1),
            react: walking(filling),
            pathfinder: straightPaths(),
        });
        expect(r.result.reason).toBe('finish: no empty Bucket left; 2 full');
        expect(r.sends[0]).toMatch(/^walk/);
        expect(r.sends.filter(s => s === USE('Bucket'))).toHaveLength(2);
    });

    test('a source out of reach of any route fails the walk', async () => {
        const r = await simulate(fill, {
            timeline: far(1).series(1),
            react: walking(filling),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'no path' })),
        });
        expect(r.result.status).toBe('failed');
    });

    test('with an area, walks back when pushed out of it, then fills', async () => {
        const r = await simulate(fill, {
            params: { area: { x: FOUNTAIN.x, z: FOUNTAIN.z, radius: 4 } },
            timeline: far(1).series(1),
            react: walking(filling),
            pathfinder: straightPaths(),
        });
        expect(r.result.reason).toBe('finish: no empty Bucket left; 1 full');
        expect(r.result.stepRuns['return-to-area']).toBeGreaterThan(0);
    });
});

describe('fill: guards', () => {
    test('low HP mid-fill eats, then filling resumes', async () => {
        const w = fountain(empties('Bucket', 2).inv('Shrimps', 1));
        const r = await simulate(fill, {
            timeline: w.series(30, (s, i) => s.player({ hp: i === 1 ? 4 : 10 })),
            react: filling,
        });
        expect(r.result.reason).toBe('finish: no empty Bucket left; 2 full');
        expect(r.sends).toContain('Eat Shrimps');
    });

    test('a level-up dialog mid-wait is cleared and the fill carries on', async () => {
        const w = fountain(empties('Bucket', 1));
        const r = await simulate(fill, {
            timeline: w.series(30, (s, i) => (i === 1 ? s.dialog({ options: [] }) : s)),
            react: filling,
        });
        expect(r.result.status).toBe('done');
    });

    test('being attacked holds the fill off while the fight lasts', async () => {
        const w = fountain(empties('Bucket', 1));
        const r = await simulate(fill, {
            timeline: w.series(40, (s, i) => attackedFrom(s, i, 10)),
            react: filling,
        });
        expect(r.result.status).toBe('done');
    });
});

describe('fill: step budget', () => {
    test('the capped walk plus the fill fits the step budget and the watchdog window', () => {
        expect(SOURCE_WALK_TICKS + FILL_WAIT_TICKS).toBeLessThanOrEqual(stepBudgetTicks(90_000));
        expect(ATTEMPT_SILENT_TICKS).toBe(SOURCE_WALK_TICKS + FILL_WAIT_TICKS);
    });
});
