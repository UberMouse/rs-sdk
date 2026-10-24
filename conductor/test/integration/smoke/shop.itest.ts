import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Lumbridge General Store; the "Shop keeper" stands at (3212,3247) per the task brief.
const SHOP = { x: 3212, z: 3247 };
const COINS = 100;

test(
    'shop task buys a hammer with coins',
    async () => {
        await withFixtureBot(
            { position: SHOP, coins: COINS },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'shop',
                    { npc: 'Shop keeper', at: SHOP, buy: [{ item: 'Hammer', count: 1 }] },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Hammer, detail).toBe(1);
                expect(run.result.inventoryDelta.Coins, detail).toBeLessThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

// Dwarven Mine: several NPCs are named "Dwarf" and only some offer Trade.
const DWARF_SHOP = { x: 2993, z: 9828 };

test(
    'shop task trades with the Dwarf that offers Trade among same-named Dwarves',
    async () => {
        await withFixtureBot(
            { position: { x: 2995, z: 9826 }, coins: COINS },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'shop',
                    { npc: 'Dwarf', at: DWARF_SHOP, buy: [{ item: 'Hammer', count: 1, maxUnitPrice: 10 }] },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Hammer, detail).toBe(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
