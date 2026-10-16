import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Gnome Stronghold course start (server/content/maps/m38_53.jm2); no other test goes there.
const START = { x: 2474, z: 3436 };
// The Barbarian Outpost, north of the pipe into the training yard; and the Wilderness course's door, south of it.
const BARBARIAN_START = { x: 2552, z: 3562 };
const WILDERNESS_START = { x: 2998, z: 3915 };
/** Salmon (item 329), one a slot: cooked fish do not stack. */
const salmon = (n: number) => Array.from({ length: n }, () => ({ id: 329, count: 1 }));

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

test(
    'agility task runs one lap of the barbarian course from the pipe',
    async () => {
        await withFixtureBot(
            {
                position: BARBARIAN_START,
                skills: { Agility: 35, Attack: 45, Strength: 45, Defence: 45, Hitpoints: 50 },
                inventory: salmon(5),
            },
            async ({ name }) => {
                const run = await runTask(name, 'agility', { course: 'barbarian', laps: 1 }, ['minutes:4']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('stop-laps: 1 laps');
                // The pipe (10) and the lap (139.5) at the local 25x; falls cost XP, never the lap's bonus.
                expect(run.result.xpGained.Agility, detail).toBeGreaterThanOrEqual(3487);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);

test(
    'agility task runs one lap of the wilderness course with the Wilderness guard off',
    async () => {
        await withFixtureBot(
            {
                position: WILDERNESS_START,
                skills: { Agility: 52, Attack: 45, Strength: 45, Defence: 45, Hitpoints: 50 },
                inventory: salmon(5),
            },
            async ({ name }) => {
                const run = await runTask(name, 'agility', { course: 'wilderness', laps: 1 }, ['minutes:5']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('stop-laps: 1 laps (still in the Wilderness: travel out now)');
                // Both ridges, the pipe, rope, stones, log and the 498.9 bonus: 601.4 base xp a lap, 25x.
                expect(run.result.xpGained.Agility, detail).toBeGreaterThanOrEqual(15000);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 5 }),
);
