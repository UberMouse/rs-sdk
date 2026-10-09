import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Varrock West bank: the example in the bank task description.
const BANK = { x: 3185, z: 3436 };

test(
    'bank task deposits an inventory item and withdraws a banked one',
    async () => {
        await withFixtureBot(
            {
                position: BANK,
                inventory: [
                    { id: Items.LOGS, count: 1 },
                    { id: Items.LOGS, count: 1 },
                ],
                bank: [{ id: Items.BONES, count: 5 }],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'bank',
                    {
                        area: { x: BANK.x, z: BANK.z, radius: 6 },
                        deposit: [{ item: 'Logs' }],
                        withdraw: [{ item: 'Bones', count: 3 }],
                    },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Logs, detail).toBe(-2);
                expect(run.result.inventoryDelta.Bones, detail).toBe(3);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
