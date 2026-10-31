import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Sheep Herder's pasture east of Ardougne: Diseased sheep 2 spawns about (2622,3367). A prod needs the quest
// started (varp 60 = 1), the plague suit worn (jacket 284, trousers 285) and the cattle prod wielded (278).
const SPAWN = { x: 2622, z: 3367 };
const GOAL = { x: 2616, z: 3367 };

test(
    'herd pushes one diseased sheep west along its row by repeated prods',
    async () => {
        await withFixtureBot(
            {
                position: { x: SPAWN.x + 6, z: SPAWN.z },
                varps: { 60: 1 },
                equipment: [
                    { id: 284, count: 1, slot: 4 },
                    { id: 285, count: 1, slot: 7 },
                    { id: 278, count: 1, slot: 3 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'herd',
                    {
                        name: '^Diseased sheep 2$',
                        from: SPAWN,
                        route: [GOAL],
                        tolerance: 1,
                        stop: { minX: GOAL.x - 2, maxX: GOAL.x + 1, minZ: GOAL.z - 1, maxZ: GOAL.z + 1 },
                    },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
