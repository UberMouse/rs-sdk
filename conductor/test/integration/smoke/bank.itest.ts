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

test(
    'bank task with no area walks to the nearest bank and deposits',
    async () => {
        await withFixtureBot(
            // 30 tiles from Varrock East's booths, none in view: only the bank table can find it.
            { position: { x: 3240, z: 3445 }, inventory: [{ id: Items.LOGS, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(name, 'bank', { deposit: [{ item: 'Logs' }] }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Logs, detail).toBe(-1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'bank task upTo withdraws a stackable past the free slot count',
    async () => {
        await withFixtureBot(
            // 155 Feather in the bank, 27 free slots: a stackable needs one slot, not one per feather.
            {
                position: { x: 3254, z: 3420 },
                inventory: [{ id: Items.BRONZE_AXE, count: 1 }],
                bank: [{ id: 314, count: 200 }],
            },
            async ({ name }) => {
                const run = await runTask(name, 'bank', { withdraw: [{ item: 'Feather', count: 155, upTo: true }] }, [
                    'minutes:3',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Feather, detail).toBe(155);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
