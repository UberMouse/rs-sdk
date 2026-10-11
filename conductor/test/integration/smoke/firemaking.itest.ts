import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Field east of the Lumbridge General Store: the verified spot in the firemaking task description.
const FIELD = { x: 3230, z: 3240 };
// Enough logs that the lines meet the wall edges around the field (x 3229..3230, z 3236..3241).
const LOGS = 8;
// A recently lit tile can refuse another fire (wiki/skills/firemaking.md), so back-to-back runs on the
// exact centre can fail. Start on a random tile inside the area instead. No other integration test
// uses this area (the action tests moved to x 3248..3258, z 3258..3262), so their fires cannot block it.
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
