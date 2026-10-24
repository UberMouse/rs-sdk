import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Camelot's magic symbol: Merlin's Crystal stage 4 (varp 14 = 4) with the Chaos altar words learned
// (varp 15 bit 0). A lit black candle held, Bat bones dropped on the symbol summon Thrantax
// (wiki/quests/merlins-crystal.md step 11); the bones stay in the pack.
const SYMBOL = { x: 2780, z: 3515 };
const BLACK_CANDLE = 38;
const BAT_BONES = 530;
const PHRASE = 'Snarthon Candtrick Termanto';

test(
    'items task lights the black candle, then drops bat bones on the magic symbol and answers Thrantax',
    async () => {
        await withFixtureBot(
            {
                position: SYMBOL,
                skills: { Attack: 33, Strength: 33, Defence: 33, Hitpoints: 33 },
                inventory: [
                    { id: BLACK_CANDLE, count: 1 },
                    { id: Items.TINDERBOX, count: 1 },
                    { id: BAT_BONES, count: 1 },
                ],
                varps: { 14: 4, 15: 1 },
            },
            async ({ name }) => {
                const lit = await runTask(
                    name,
                    'items',
                    { combine: { use: '^Tinderbox$', on: '^Black candle$', product: '^Lit black candle$' } },
                    ['minutes:2'],
                );
                const litDetail = `${JSON.stringify(lit.result)}\n${lit.stderr}`;
                expect(lit.result.status, litDetail).toBe('done');
                expect(lit.result.inventoryDelta['Lit black candle'], litDetail).toBe(1);

                const summon = await runTask(
                    name,
                    'items',
                    {
                        drop: [{ item: '^Bat bones$' }],
                        at: { ...SYMBOL, tolerance: 1 },
                        choices: [PHRASE],
                    },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(summon.result)}\n${summon.stderr}`;
                expect(summon.result.status, detail).toBe('done');
                expect(summon.result.reason, detail).toBe('finish: dropping opened a dialog (answered)');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }) * 2,
);

// Full adamant, a rune scimitar and an amulet of power worn (the Entrana boat and the Glarial tomb
// refuse worn gear), a rope and runes in the pack.
const WORN = [
    { id: 1161, count: 1, slot: 0 },
    { id: 1731, count: 1, slot: 2 },
    { id: 1333, count: 1, slot: 3 },
    { id: 1123, count: 1, slot: 4 },
    { id: 1199, count: 1, slot: 5 },
    { id: 1073, count: 1, slot: 7 },
];
const COURTYARD = { x: 3226, z: 3219 };

test(
    'items task takes every worn item off, then puts the weapon and helm back on',
    async () => {
        await withFixtureBot(
            {
                position: COURTYARD,
                skills: { Attack: 60, Strength: 60, Defence: 60, Hitpoints: 60 },
                equipment: WORN,
                inventory: [
                    { id: 954, count: 1 },
                    { id: Items.AIR_RUNE, count: 50 },
                ],
            },
            async ({ name }) => {
                const off = await runTask(name, 'items', { unequip: ['all'] }, ['minutes:2']);
                const offDetail = `${JSON.stringify(off.result)}\n${off.stderr}`;
                expect(off.result.status, offDetail).toBe('done');
                expect(off.result.inventoryDelta['Rune scimitar'], offDetail).toBe(1);
                expect(off.result.inventoryDelta['Adamant full helm'], offDetail).toBe(1);

                const on = await runTask(name, 'items', { equip: ['^Rune scimitar$', 'Adamant full helm'] }, [
                    'minutes:2',
                ]);
                const onDetail = `${JSON.stringify(on.result)}\n${on.stderr}`;
                expect(on.result.status, onDetail).toBe('done');
                expect(on.result.inventoryDelta['Rune scimitar'], onDetail).toBe(-1);
                expect(on.result.inventoryDelta['Adamant full helm'], onDetail).toBe(-1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }) * 2,
);

const PESTLE_AND_MORTAR = 233;
const CHARCOAL = 973;
const POT_OF_FLOUR = 1933;
const BUCKET_OF_WATER = 1929;

test(
    'items task grinds charcoal once, then answers the dough menu with `choice`',
    async () => {
        await withFixtureBot(
            {
                position: COURTYARD,
                skills: { Attack: 60, Strength: 60, Defence: 60, Hitpoints: 60 },
                inventory: [
                    { id: PESTLE_AND_MORTAR, count: 1 },
                    { id: CHARCOAL, count: 1 },
                    { id: POT_OF_FLOUR, count: 1 },
                    { id: BUCKET_OF_WATER, count: 1 },
                ],
            },
            async ({ name }) => {
                const grind = await runTask(
                    name,
                    'items',
                    { combine: { use: '^Pestle and mortar$', on: '^Charcoal$' } },
                    ['minutes:2'],
                );
                const grindDetail = `${JSON.stringify(grind.result)}\n${grind.stderr}`;
                expect(grind.result.status, grindDetail).toBe('done');
                expect(grind.result.inventoryDelta['Ground charcoal'], grindDetail).toBe(1);

                const dough = await runTask(
                    name,
                    'items',
                    { combine: { use: '^Pot of flour$', on: '^Bucket of water$', choice: '^Pastry dough' } },
                    ['minutes:2'],
                );
                const doughDetail = `${JSON.stringify(dough.result)}\n${dough.stderr}`;
                expect(dough.result.status, doughDetail).toBe('done');
                expect(dough.result.inventoryDelta['Pastry dough'], doughDetail).toBe(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }) * 2,
);
