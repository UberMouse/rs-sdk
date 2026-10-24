import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Fremennik Trials' Sigli hunt (quests/quest_viking/scripts/viking_sigil.rs2): the Hunters' talisman's Locate
// spawns a butterfly at one of four spots in the forest between Rellekka and Seers' Village and prints a compass
// direction until the bot is within 3 tiles, then "The Draugen is here! Beware!". Varp 347 (viking) is 1 and
// varp 348 (viking_bits) holds the Sigli stage in bits 14-15 (1 = started). The forest is nobody else's ground.
const FOREST = { x: 2690, z: 3615 };
const TALISMAN = 3697;
const SIGLI_STARTED = 1 << 14;

test(
    'locate follows the talisman to the Draugen',
    async () => {
        await withFixtureBot(
            {
                position: FOREST,
                skills: { Attack: 70, Strength: 70, Defence: 70, Hitpoints: 70 },
                inventory: [{ id: TALISMAN, count: 1 }],
                varps: { 347: 1, 348: SIGLI_STARTED },
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'locate',
                    {
                        item: "^Hunters' talisman$",
                        option: '^Locate$',
                        stop: 'Draugen is here',
                        target: '^The Draugen$',
                        area: { x: 2695, z: 3620, radius: 75 },
                        maxHops: 60,
                    },
                    ['minutes:4'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toMatch(/Draugen is here|The Draugen is in view/);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
