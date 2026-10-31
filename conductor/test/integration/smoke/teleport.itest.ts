import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Falador east gate: open ground; the task casts in place and the bot lands near Lumbridge.
const FALADOR = { x: 3012, z: 3355 };
const LUMBRIDGE = { x: 3221, z: 3218 };

test(
    'teleport casts Lumbridge Teleport once and lands near Lumbridge',
    async () => {
        await withFixtureBot(
            {
                position: FALADOR,
                skills: { Magic: 31 },
                inventory: [
                    { id: Items.AIR_RUNE, count: 10 },
                    { id: Items.EARTH_RUNE, count: 5 },
                    { id: Items.LAW_RUNE, count: 5 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(name, 'teleport', { spell: 'lumbridge' }, ['minutes:1']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Magic, detail).toBeGreaterThan(0);
                expect(run.result.inventoryDelta['Law rune'], detail).toBe(-1);
                expect(run.result.inventoryDelta['Air rune'], detail).toBe(-3);
                expect(
                    Math.max(
                        Math.abs(run.result.finalPos.x - LUMBRIDGE.x),
                        Math.abs(run.result.finalPos.z - LUMBRIDGE.z),
                    ),
                ).toBeLessThanOrEqual(3);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 1 }),
);
