import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Logging in beside Aubury puts the client scene's north edge at z 3455. The plain walk to King Roald then sent
// one long leg up the Varrock west square alley through its closed double door at (3212..3213, 3470): the client
// found no route behind the door and the bot sat at (3213, 3438) (`Stuck at (3213, 3438)`).
const AUBURY = { x: 3253, z: 3401 };
const ROALD = { x: 3222, z: 3476 };

test(
    'travel walks from the Varrock rune shop to the palace through the alley and its double door',
    async () => {
        await withFixtureBot(
            { position: AUBURY, skills: { Attack: 40, Strength: 47, Defence: 40, Hitpoints: 48 } },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: ROALD, tolerance: 2 }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos.z, detail).toBeGreaterThanOrEqual(3470);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
