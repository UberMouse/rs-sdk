import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Lumbridge trees: the verified training spot in wiki/skills/woodcutting.md.
const TREES = { x: 3195, z: 3220 };

test(
    'woodcutting task chops trees until the XP target',
    async () => {
        await withFixtureBot(
            { position: TREES, skills: { Woodcutting: 1 }, inventory: [{ id: Items.BRONZE_AXE, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'woodcutting',
                    { tree: 'tree', area: { x: TREES.x, z: TREES.z, radius: 12 }, onFull: 'drop' },
                    ['xp:Woodcutting:25', 'minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Woodcutting, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);
