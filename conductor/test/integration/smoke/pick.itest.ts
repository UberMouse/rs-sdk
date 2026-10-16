import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Seers' Village flax field (x 2732-2755, z 3433-3456): the verified spot of the pick task.
const FIELD = { x: 2743, z: 3445, radius: 10 };

test(
    'pick task picks flax until the count is held',
    async () => {
        await withFixtureBot(
            { position: { x: FIELD.x, z: FIELD.z } },
            async ({ name }) => {
                const run = await runTask(name, 'pick', { loc: 'Flax', item: 'Flax', count: 6, area: FIELD }, [
                    'minutes:2',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('finish: picked 6 Flax');
                expect(run.result.inventoryDelta.Flax, detail).toBe(6);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);
