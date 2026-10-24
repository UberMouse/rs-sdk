import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Lumbridge furnace and Varrock West anvil: the known spots in the smithing task description.
const FURNACE = { x: 3225, z: 3256 };
const ANVIL = { x: 3188, z: 3421 };

test(
    'smithing task smelts copper and tin ore into bronze bars at the furnace',
    async () => {
        await withFixtureBot(
            {
                position: FURNACE,
                skills: { Smithing: 1 },
                inventory: [
                    { id: Items.COPPER_ORE, count: 1 },
                    { id: Items.COPPER_ORE, count: 1 },
                    { id: Items.TIN_ORE, count: 1 },
                    { id: Items.TIN_ORE, count: 1 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'smithing',
                    { mode: 'smelt', bar: 'bronze', area: { x: FURNACE.x, z: FURNACE.z, radius: 6 } },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Bronze bar'], detail).toBe(2);
                expect(run.result.inventoryDelta['Copper ore'], detail).toBe(-2);
                expect(run.result.inventoryDelta['Tin ore'], detail).toBe(-2);
                expect(run.result.xpGained.Smithing, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'smithing task forges a bronze dagger from a bar at the anvil',
    async () => {
        await withFixtureBot(
            {
                position: ANVIL,
                skills: { Smithing: 1 },
                inventory: [
                    { id: Items.HAMMER, count: 1 },
                    { id: Items.BRONZE_BAR, count: 1 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'smithing',
                    { mode: 'smith', bar: 'bronze', product: 'dagger', area: { x: ANVIL.x, z: ANVIL.z, radius: 6 } },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Bronze bar'], detail).toBe(-1);
                expect(run.result.inventoryDelta['Bronze dagger'], detail).toBe(1);
                expect(run.result.xpGained.Smithing, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'smithing task with onDone drop forges daggers and drops them, keeping the hammer',
    async () => {
        await withFixtureBot(
            {
                position: ANVIL,
                skills: { Smithing: 1 },
                inventory: [
                    { id: Items.HAMMER, count: 1 },
                    { id: Items.BRONZE_BAR, count: 1 },
                    { id: Items.BRONZE_BAR, count: 1 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'smithing',
                    {
                        mode: 'smith',
                        bar: 'bronze',
                        product: 'dagger',
                        onDone: 'drop',
                        area: { x: ANVIL.x, z: ANVIL.z, radius: 6 },
                    },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Bronze bar'], detail).toBe(-2);
                expect(run.result.inventoryDelta['Bronze dagger'] ?? 0, detail).toBe(0);
                expect(run.result.inventoryDelta['Hammer'] ?? 0, detail).toBe(0);
                expect(run.result.xpGained.Smithing, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

const IRON_ORE = 440;
// Al Kharid furnace (3272,3185): open from the east only. From the west wall side the old walk-to-within-2 stalled.
const AL_KHARID_FURNACE = { x: 3272, z: 3185 };

test(
    'smithing task smelts iron at the Al Kharid furnace from the wrong side of its wall',
    async () => {
        await withFixtureBot(
            {
                position: { x: 3270, z: 3184 },
                skills: { Smithing: 52 },
                inventory: Array.from({ length: 6 }, () => ({ id: IRON_ORE, count: 1 })),
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'smithing',
                    {
                        mode: 'smelt',
                        bar: 'iron',
                        area: { x: AL_KHARID_FURNACE.x, z: AL_KHARID_FURNACE.z, radius: 6 },
                    },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                // Iron has a 50% failure chance: assert some bars, not the count.
                expect(run.result.inventoryDelta['Iron bar'], detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
