import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Inside the Lumbridge chicken coop: the verified spot in the combat task description.
const COOP = { x: 3231, z: 3295 };

test(
    'combat task kills chickens until the Attack XP target',
    async () => {
        await withFixtureBot(
            { position: COOP },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    { target: 'Chicken', skill: 'Attack', area: { x: COOP.x, z: COOP.z, radius: 8 } },
                    ['xp:Attack:1', 'minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Attack, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
