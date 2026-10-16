import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Seers' Village wheel (2711,3471) up the house's ladder, starting on the ground floor beside it
// (2714,3470): the task climbs, then spins. Crafting 70 so no level-up cuts the batch.
test(
    'spinning task climbs to the wheel and spins the flax into bow strings',
    async () => {
        await withFixtureBot(
            {
                position: { x: 2714, z: 3470 },
                skills: { Crafting: 70 },
                inventory: Array.from({ length: 5 }, () => ({ id: Items.FLAX, count: 1 })),
            },
            async ({ name }) => {
                const run = await runTask(name, 'spinning', { wheel: { x: 2711, z: 3471, level: 1 } }, ['minutes:2']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('finish: nothing left to spin');
                expect(run.result.inventoryDelta['Bow string'], detail).toBe(5);
                expect(run.result.xpGained.Crafting, detail).toBe(5 * 375);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);
