import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Field east of the Lumbridge General Store: the verified spot in the firemaking task description.
const FIELD = { x: 3230, z: 3240 };
const LOGS = 3;
// Fires last about a minute and refuse a second fire on their tile, so back-to-back runs starting on
// the exact centre can find it burning. Start on a random tile inside the area instead.
const START = { x: FIELD.x - 4 + Math.floor(Math.random() * 9), z: FIELD.z - 4 + Math.floor(Math.random() * 9) };

test(
    'firemaking task burns every log it was given',
    async () => {
        await withFixtureBot(
            {
                position: START,
                skills: { Firemaking: 1 },
                inventory: [
                    { id: Items.TINDERBOX, count: 1 },
                    ...Array.from({ length: LOGS }, () => ({ id: Items.LOGS, count: 1 })),
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'firemaking',
                    { logs: 'Logs', area: { x: FIELD.x, z: FIELD.z, radius: 6 } },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Logs, detail).toBe(-LOGS);
                expect(run.result.xpGained.Firemaking, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
