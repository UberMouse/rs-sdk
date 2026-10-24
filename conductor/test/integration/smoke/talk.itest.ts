import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Lumbridge castle: from the courtyard, up the stairs to Duke Horacio on the first floor, the start of
// Rune Mysteries (he hands over an air talisman). Items prove the dialog was answered.
const COURTYARD = { x: 3222, z: 3218 };

test(
    'talk task walks upstairs to Duke Horacio and answers his dialog',
    async () => {
        await withFixtureBot(
            { position: COURTYARD },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'talk',
                    {
                        npc: 'Duke Horacio',
                        at: { x: 3211, z: 3221, level: 1 },
                        choices: ['quests for me', 'Sure, no problem'],
                    },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('talk: talked to Duke Horacio, 2 choices made');
                expect(run.result.inventoryDelta['Air talisman'], detail).toBe(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

// A use by loc tile and item id (waterfall_pillars.rs2): the Waterfall dungeon's pillars at x 2562 and 2569.
test(
    'talk uses a rune (by id) on the pillar picked by tile',
    async () => {
        await withFixtureBot(
            {
                position: { x: 2563, z: 9914 },
                skills: { Attack: 60, Strength: 60, Defence: 60, Hitpoints: 70 },
                inventory: [{ id: 557, count: 6 }],
                varps: { 65: 6 },
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'talk',
                    {
                        use: { items: [{ id: 557 }], onLoc: '^Pillar$', tile: { x: 2562, z: 9914 } },
                        at: { x: 2563, z: 9914, tolerance: 1 },
                    },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Earth rune'], detail).toBe(-1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

// Merlin's Crystal stage 3: the Catherby crate (quest_arthur.rs2) opens a dialog `interact` leaves open;
// `talk` with `continue` answers "Yes." twice and the ride ends on the Keep Le Faye jetty.
test(
    'talk continues the dialog the Catherby crate opened',
    async () => {
        await withFixtureBot(
            { position: { x: 2801, z: 3443 }, varps: { 14: 3 } },
            async ({ name }) => {
                const hide = await runTask(
                    name,
                    'interact',
                    { target: 'loc', name: '^Crate$', option: '^Hide-in$', at: { x: 2801, z: 3443, tolerance: 1 } },
                    ['minutes:1'],
                );
                expect(hide.result.status, `${JSON.stringify(hide.result)}\n${hide.stderr}`).toBe('done');
                const run = await runTask(name, 'talk', { continue: true, choices: ['^Yes\\.$', '^Yes\\.$'] }, [
                    'minutes:3',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('continue-dialog: continued the open dialog, 2 choices made');
                expect(run.result.finalPos, detail).toMatchObject({ x: 2778, z: 3401 });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);

// Glarial's pebble on her tombstone (quest_waterfall.rs2) teleports the bot into the tomb with no inventory change
// and no animation: the position jump is the use's effect, not a timeout.
test(
    'talk counts the teleport of a use (Glarial pebble on the tombstone) as its effect',
    async () => {
        await withFixtureBot(
            {
                position: { x: 2560, z: 3444 },
                skills: { Attack: 45, Strength: 45, Defence: 45, Hitpoints: 50 },
                inventory: [{ id: 294, count: 1 }],
                varps: { 65: 3 },
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'talk',
                    { use: { items: ["^Glarial's pebble$"], onLoc: 'tombstone' } },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos, detail).toMatchObject({ x: 2554, z: 9844 });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);
