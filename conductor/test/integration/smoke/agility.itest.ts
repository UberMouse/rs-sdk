import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Gnome Stronghold course start (server/content/maps/m38_53.jm2); no other test goes there.
const START = { x: 2474, z: 3436 };

test(
    'agility task runs one lap of the gnome course',
    async () => {
        await withFixtureBot(
            { position: START, skills: { Agility: 1 } },
            async ({ name }) => {
                const run = await runTask(name, 'agility', { course: 'gnome', laps: 1 }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('stop-laps: 1 laps');
                // 86.5 xp a lap at the local 25x.
                expect(run.result.xpGained.Agility, detail).toBeGreaterThanOrEqual(2162);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
