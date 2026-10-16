import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Lumbridge chapel graveyard (The Restless Ghost): the closed coffin at (3249,3192) has an Open option
// whose script answers "You open the coffin." (quests/quest_priest/scripts/quest_priest.rs2). The only
// integration test that touches the coffin, as opening it spawns a ghost for 100 ticks.
const COURTYARD = { x: 3222, z: 3218 };

test(
    'interact task walks to the graveyard and opens the coffin',
    async () => {
        await withFixtureBot(
            { position: COURTYARD },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    { target: 'loc', name: '^coffin$', option: '^open$', at: { x: 3248, z: 3195, tolerance: 2 } },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                // The first state change seen: the opening animation, the loc turning open, or the message.
                expect(run.result.reason, detail).toMatch(
                    /^interact: \^open\$ on \^coffin\$: (an animation started|the loc changed|game message "You open the coffin\.")$/,
                );
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
