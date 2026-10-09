import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The knife ground spawn SE of Lumbridge castle: the verified spot in the pickup task description.
const KNIFE_SPAWN = { x: 3224, z: 3202 };

test(
    'pickup task picks up the knife spawn',
    async () => {
        await withFixtureBot(
            { position: KNIFE_SPAWN },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'pickup',
                    { area: { x: KNIFE_SPAWN.x, z: KNIFE_SPAWN.z, radius: 4 }, items: [{ item: 'Knife', count: 1 }] },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Knife, detail).toBe(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
