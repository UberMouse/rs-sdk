import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// A pack of two grimy guam, two vials of water and two eyes of newt: no ground, no other bot's target.
const GUAM = 199;
const VIAL = 227;
const NEWT = 221;
const LUMBRIDGE = { x: 3222, z: 3218 };
const pack = [GUAM, GUAM, VIAL, VIAL, NEWT, NEWT].map(id => ({ id, count: 1 }));

test(
    'herblore task cleans, mixes and finishes attack potions from the pack',
    async () => {
        await withFixtureBot(
            { position: LUMBRIDGE, skills: { Herblore: 3 }, inventory: pack },
            async ({ name }) => {
                const run = await runTask(name, 'herblore', {}, ['minutes:2']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                // 2 x (clean 62.5 + attack potion 625), nothing for the unfinished potion.
                expect(run.result.xpGained.Herblore, detail).toBeGreaterThanOrEqual(1375);
                expect(run.result.inventoryDelta, detail).toEqual({
                    Herb: -2,
                    'Vial of water': -2,
                    'Eye of newt': -2,
                    'Attack potion(3)': 2,
                });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);
