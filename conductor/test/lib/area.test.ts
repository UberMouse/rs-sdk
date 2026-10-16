import { describe, expect, test } from 'bun:test';
import { walkBudgetTicks } from '../../actions/walk';
import { type Area, returnToAreaStep } from '../../lib/area';
import type { Step } from '../../lib/task';
import { TICK_MS } from '../../lib/util';
import { runTask } from '../engine/harness';
import { door, fakePaths } from '../paths';
import { walking } from '../react';
import type { Simulation } from '../simulate';
import { world } from '../world';

const START = { x: 3200, z: 3200 };
/** Ends the run once the bot is inside the area (returnToAreaStep no longer applies). */
const there: Step = { name: 'there', when: () => true, run: () => ({ done: 'in the area' }) };
const walkLogs = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && String(e.msg).startsWith('walk to area') ? [e.msg] : []));
/** A watchdog well out of the way: these walks can stand still longer than the default allows. */
const PATIENT = 3600_000;

describe('walkToArea: walks that run out of ticks', () => {
    test('a far area takes several walks: each that ran out of ticks nearer the area is not a failure', async () => {
        // 1500 tiles east, running 2 a tick: each walk's 200 ticks cover 400 tiles, so three run out
        // (the old count's limit) and the fourth arrives.
        const area: Area = { x: START.x + 1500, z: START.z, radius: 5 };
        const r = await runTask([returnToAreaStep(() => area), there], world().player({ at: START }).series(1), {
            react: walking(),
            stuckAfterMs: PATIENT,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('there: in the area');
        expect(r.result.stepRuns['return-to-area']).toBe(4);
        expect(walkLogs(r)).toEqual(
            [3600, 4000, 4400].map(
                x =>
                    `walk to area (${area.x},${area.z}) not there yet: Walk to (4700, 3200) ran out of its 200 ticks at (${x}, 3200)`,
            ),
        );
    });

    test('three walks that run out of ticks where they started fail the run with the last walk message', async () => {
        // A door between the bot and the area that never opens, and a bot that cannot move.
        const shut = door(START.x, START.z + 5);
        const area: Area = { x: START.x, z: START.z + 15, radius: 2 };
        const paths = fakePaths(
            () => ({
                success: true,
                reachedDestination: true,
                waypoints: [
                    { ...shut, level: 0 },
                    { x: area.x, z: area.z, level: 0 },
                ],
            }),
            [shut],
        );
        const w = world()
            .player({ at: START })
            .loc('Door', shut.x, shut.z, { options: ['Open'] });
        const r = await runTask([returnToAreaStep(() => area), there], w.series(1), {
            pathfinder: paths,
            react: walking(undefined, () => true),
            stuckAfterMs: PATIENT,
        });
        const budget = walkBudgetTicks(15);
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            `return-to-area: can't walk to area (Walk to (3200, 3215) ran out of its ${budget} ticks at (3200, 3200))`,
        );
        expect(r.result.stepRuns['return-to-area']).toBe(3);
        expect(r.result.durationMs).toBe(3 * budget * TICK_MS);
    });
});

describe('an area with a level', () => {
    const upstairs = world().player({ at: { ...START, level: 1 } });
    const noRoute = fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' }));

    test('a bot on another floor is away from the area even standing at its x, z', async () => {
        const area: Area = { x: START.x, z: START.z, radius: 5, level: 0 };
        const r = await runTask([returnToAreaStep(() => area), there], upstairs.series(1), {
            pathfinder: noRoute,
            react: walking(),
        });
        expect(r.result.stepRuns['return-to-area']).toBeGreaterThan(0);
    });

    test('an area with no level is on whatever floor the bot is on', async () => {
        const area: Area = { x: START.x, z: START.z, radius: 5 };
        const r = await runTask([returnToAreaStep(() => area), there], upstairs.series(1), { pathfinder: noRoute });
        expect(r.result.reason).toBe('there: in the area');
        expect(r.result.stepRuns['return-to-area']).toBeUndefined();
    });

    test('on the right floor and inside, nothing is walked', async () => {
        const area: Area = { x: START.x, z: START.z, radius: 5, level: 1 };
        const r = await runTask([returnToAreaStep(() => area), there], upstairs.series(1), { pathfinder: noRoute });
        expect(r.result.stepRuns['return-to-area']).toBeUndefined();
    });
});
