import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Inside the Lumbridge chicken coop: the verified spot in the combat task description.
const COOP = { x: 3231, z: 3295 };
const AREA = { x: COOP.x, z: COOP.z, radius: 8 };

test(
    'combat task kills chickens until the Attack XP target',
    async () => {
        await withFixtureBot(
            { position: COOP },
            async ({ name }) => {
                const run = await runTask(name, 'combat', { target: 'Chicken', skill: 'Attack', area: AREA }, [
                    'xp:Attack:1',
                    'minutes:3',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Attack, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'combat task shoots chickens with a wielded bow and arrows until the Ranged XP target',
    async () => {
        await withFixtureBot(
            {
                position: COOP,
                inventory: [
                    { id: Items.SHORTBOW, count: 1 },
                    { id: Items.BRONZE_ARROW, count: 100 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    {
                        target: 'Chicken',
                        skill: 'Ranged',
                        area: AREA,
                        weapon: 'Shortbow',
                        ammo: 'Bronze arrow',
                        loot: ['Bronze arrow'],
                    },
                    ['xp:Ranged:1', 'minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Ranged, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'combat task casts Wind Strike at chickens with inventory runes until the Magic XP target',
    async () => {
        await withFixtureBot(
            {
                position: COOP,
                inventory: [
                    { id: Items.AIR_RUNE, count: 50 },
                    { id: Items.MIND_RUNE, count: 50 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    { target: 'Chicken', skill: 'Magic', spell: 'Wind Strike', area: AREA },
                    ['xp:Magic:1', 'minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Magic, detail).toBeGreaterThan(0);
                expect(run.result.inventoryDelta['Air rune'], detail).toBeLessThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
