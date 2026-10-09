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
