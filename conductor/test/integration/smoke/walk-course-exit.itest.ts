import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Gnome Stronghold course start (server/content/maps/m38_53.jm2); the agility itest runs here too, on its own bot.
const START = { x: 2474, z: 3436 };
// South of the Stronghold's entrance gate (2459,3383), outside the fence.
const OUTSIDE = { x: 2461, z: 3372 };

test(
    'a walk from mid-course finishes the obstacles, leaves by the gate, and arrives outside the fence',
    async () => {
        await withFixtureBot(
            { position: START, skills: { Agility: 1 } },
            async ({ name }) => {
                // 480 xp (25x units) is the log, the net and the branch: the bot stops on the second plane.
                const lap = await runTask(name, 'agility', { course: 'gnome' }, ['xp:Agility:480', 'minutes:2']);
                expect(lap.result.finalPos.level, JSON.stringify(lap.result)).toBeGreaterThan(0);
                const run = await runTask(name, 'travel', { to: OUTSIDE }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos.level, detail).toBe(0);
                expect(run.result.finalPos.z, detail).toBeLessThan(3385);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 5 }),
);
