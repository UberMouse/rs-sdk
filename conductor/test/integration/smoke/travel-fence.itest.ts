import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Varrock lumber yard: the Broken fence (gertrudefence, 3305,3493) is its south entrance and exit, a loc op that
// puts the player across (its landings include the stand itself, which is not an arrival); six blockwalk "Crate"
// NPCs stand in the yard, one on the way to the ladder.
const INSIDE = { x: 3305, z: 3497 };
const OUTSIDE = { x: 3305, z: 3488 };

test(
    'travel climbs out over the Broken fence in one crossing',
    async () => {
        await withFixtureBot(
            { position: INSIDE },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: OUTSIDE }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                const p = run.result.finalPos!;
                expect(Math.max(Math.abs(p.x - OUTSIDE.x), Math.abs(p.z - OUTSIDE.z)), detail).toBeLessThanOrEqual(3);
                expect(p.z, detail).toBeLessThan(3493);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
