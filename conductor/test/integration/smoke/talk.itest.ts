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
