import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Lumbridge Range in the cooking task description; any number of players can use it at once.
const RANGE = { x: 3230, z: 3196 };
const RAW = 4;
const ANCHOVIES = 321;

test(
    'cooking task cooks every raw shrimp, leaves the anchovies, and counts cooked and burnt',
    async () => {
        await withFixtureBot(
            {
                position: { x: 3225, z: 3205 },
                inventory: [
                    ...Array.from({ length: RAW }, () => ({ id: Items.RAW_SHRIMPS, count: 1 })),
                    { id: ANCHOVIES, count: 1 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'cooking',
                    { food: 'Raw shrimps', area: { ...RANGE, radius: 6 }, dropBurnt: true },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Raw shrimps'], detail).toBe(-RAW);
                expect(run.result.inventoryDelta['Raw anchovies'], detail).toBeUndefined();
                expect(run.result.reason, detail).toMatch(new RegExp(`\\d+ cooked, \\d+ burnt`));
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

// The Range is reachable only from its east side: a bot arriving from the west walks round to it.
test(
    'cooking task walks round to the Range when it starts on its unreachable west side',
    async () => {
        await withFixtureBot(
            {
                position: { x: 3225, z: 3196 },
                inventory: Array.from({ length: RAW }, () => ({ id: Items.RAW_SHRIMPS, count: 1 })),
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'cooking',
                    { food: 'Raw shrimps', area: { ...RANGE, radius: 6 }, dropBurnt: true },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Raw shrimps'], detail).toBe(-RAW);
                expect(run.stdout + run.stderr, detail).toContain('is not reachable from here');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
