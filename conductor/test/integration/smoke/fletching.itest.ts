import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Fletching works anywhere; Lumbridge castle is the save default.
const LOGS = 2;

test(
    'fletching task cuts every log into arrow shafts',
    async () => {
        await withFixtureBot(
            {
                skills: { Fletching: 1 },
                inventory: [
                    { id: Items.KNIFE, count: 1 },
                    ...Array.from({ length: LOGS }, () => ({ id: Items.LOGS, count: 1 })),
                ],
            },
            async ({ name }) => {
                const run = await runTask(name, 'fletching', { product: 'arrow shaft', logs: 'Logs' }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Logs, detail).toBe(-LOGS);
                expect(run.result.inventoryDelta['Arrow shaft'], detail).toBeGreaterThan(0);
                expect(run.result.xpGained.Fletching, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
