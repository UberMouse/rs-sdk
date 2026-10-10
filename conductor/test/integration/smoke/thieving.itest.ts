import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Men around Lumbridge castle: the verified spot in the thieving task description.
const CASTLE = { x: 3222, z: 3218 };

test(
    'thieving task pickpockets Men until the Thieving XP target',
    async () => {
        await withFixtureBot(
            { position: CASTLE },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'thieving',
                    { npc: 'Man', area: { x: CASTLE.x, z: CASTLE.z, radius: 6 } },
                    ['xp:Thieving:400', 'minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Thieving, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
