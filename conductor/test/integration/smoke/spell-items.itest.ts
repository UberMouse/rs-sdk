import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Varrock West bank: open ground; the task never moves.
const SPAWN = { x: 3185, z: 3436 };
const IRON_ORE = 440;
const STAFF_OF_FIRE = 1387;
const WEAPON_SLOT = 3;
const ORES = 5;

test(
    'spell-items superheats every iron ore with a worn Staff of fire, then ends done',
    async () => {
        await withFixtureBot(
            {
                position: SPAWN,
                skills: { Magic: 43, Smithing: 15 },
                inventory: [
                    ...Array.from({ length: ORES }, () => ({ id: IRON_ORE, count: 1 })),
                    { id: Items.NATURE_RUNE, count: 10 },
                ],
                equipment: [{ id: STAFF_OF_FIRE, count: 1, slot: WEAPON_SLOT }],
            },
            async ({ name }) => {
                const run = await runTask(name, 'spell-items', { spell: 'superheat', item: '^iron ore$' }, [
                    'minutes:2',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Iron bar'], detail).toBe(ORES);
                expect(run.result.inventoryDelta['Iron ore'], detail).toBe(-ORES);
                expect(run.result.xpGained.Smithing, detail).toBeGreaterThan(0);
                expect(run.result.xpGained.Magic, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);
