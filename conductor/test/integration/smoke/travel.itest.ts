import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Open ground south-east of the Lumbridge cow field gate; a short walk with a waypoint.
const LUMBRIDGE = { x: 3225, z: 3230 };
const WAYPOINT = { x: 3240, z: 3262 };
const GOAL = { x: 3262, z: 3285 };
// East of the Gnome Stronghold gate (2459,3383), outside its fence; the course start (2474,3436) is inside.
const OUTSIDE_GATE = { x: 2506, z: 3390 };
const COURSE = { x: 2474, z: 3436 };

test(
    'travel walks a short leg through a waypoint',
    async () => {
        await withFixtureBot(
            { position: LUMBRIDGE },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: GOAL, waypoints: [WAYPOINT] }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos, detail).not.toBeNull();
                const p = run.result.finalPos!;
                expect(Math.max(Math.abs(p.x - GOAL.x), Math.abs(p.z - GOAL.z)), detail).toBeLessThanOrEqual(3);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'travel passes the Gnome Stronghold gate (and Femi at it) into the course',
    async () => {
        await withFixtureBot(
            { position: OUTSIDE_GATE },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: COURSE, tolerance: 4 }, ['minutes:4']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.stepRuns['gnome-gate'], detail).toBe(1);
                const p = run.result.finalPos!;
                expect(Math.max(Math.abs(p.x - COURSE.x), Math.abs(p.z - COURSE.z)), detail).toBeLessThanOrEqual(4);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
