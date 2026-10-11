import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// South-east Varrock mine: the copper/tin spot in wiki/skills/mining.md.
const MINE = { x: 3285, z: 3365 };

test(
    'mining task mines copper or tin until the XP target',
    async () => {
        await withFixtureBot(
            { position: MINE, skills: { Mining: 1 }, inventory: [{ id: Items.BRONZE_PICKAXE, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'mining',
                    { rock: ['copper', 'tin'], area: { x: MINE.x, z: MINE.z, radius: 8 }, onFull: 'stop' },
                    ['xp:Mining:1', 'minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Mining, detail).toBeGreaterThan(0);
                const ore =
                    (run.result.inventoryDelta['Copper ore'] ?? 0) + (run.result.inventoryDelta['Tin ore'] ?? 0);
                expect(ore, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'mining task drops each ore as it goes, so none piles up',
    async () => {
        await withFixtureBot(
            { position: MINE, skills: { Mining: 1 }, inventory: [{ id: Items.BRONZE_PICKAXE, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'mining',
                    { rock: ['copper', 'tin'], area: { x: MINE.x, z: MINE.z, radius: 8 } },
                    ['xp:Mining:2000', 'minutes:4'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Mining, detail).toBeGreaterThanOrEqual(2000);
                // 2000 xp is a handful of ores, so the inventory never fills and drop-ores never runs; ore left in the inventory means drop-as-you-go failed.
                expect(run.result.stepRuns['drop-ores'] ?? 0, detail).toBe(0);
                const held =
                    (run.result.inventoryDelta['Copper ore'] ?? 0) + (run.result.inventoryDelta['Tin ore'] ?? 0);
                expect(held, detail).toBeLessThanOrEqual(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
