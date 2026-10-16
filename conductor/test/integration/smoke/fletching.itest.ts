import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Fletching works anywhere; Lumbridge castle is the save default.
const LOGS = 12;

test(
    'fletching task cuts every named log into arrow shafts in batches, leaving other logs alone',
    async () => {
        await withFixtureBot(
            {
                // Level 60: no level-up dialog breaks the batch.
                skills: { Fletching: 60 },
                inventory: [
                    { id: Items.KNIFE, count: 1 },
                    { id: Items.OAK_LOGS, count: 1 },
                    { id: Items.OAK_LOGS, count: 1 },
                    ...Array.from({ length: LOGS }, () => ({ id: Items.LOGS, count: 1 })),
                ],
            },
            async ({ name }) => {
                const run = await runTask(name, 'fletching', { product: 'arrow shaft', logs: 'Logs' }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Logs, detail).toBe(-LOGS);
                expect(run.result.inventoryDelta['Arrow shaft'], detail).toBe(15 * LOGS);
                expect(run.result.inventoryDelta['Oak logs'], detail).toBeUndefined();
                // One Make 10 click and one for the remaining two: well under a click per log.
                expect(run.result.stepRuns.cut, detail).toBeLessThanOrEqual(3);
                expect(run.result.xpGained.Fletching, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

const BOWS = 8;

test(
    'fletching task cuts oak logs into longbows (u) and strings every one',
    async () => {
        await withFixtureBot(
            {
                skills: { Fletching: 60 },
                inventory: [
                    { id: Items.KNIFE, count: 1 },
                    ...Array.from({ length: BOWS }, () => ({ id: Items.OAK_LOGS, count: 1 })),
                    ...Array.from({ length: BOWS }, () => ({ id: Items.BOW_STRING, count: 1 })),
                ],
            },
            async ({ name }) => {
                const run = await runTask(name, 'fletching', { product: 'long bow', logs: 'Oak logs', string: true }, [
                    'minutes:3',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Oak logs'], detail).toBe(-BOWS);
                expect(run.result.inventoryDelta['Bow string'], detail).toBe(-BOWS);
                // Cut XP 625 + string XP 625 per oak longbow at 25x.
                expect(run.result.xpGained.Fletching, detail).toBe(BOWS * 1250);
                // Strung and unstrung bows share a name; the XP above is the proof every one was strung too.
                expect(run.result.inventoryDelta['Oak longbow'], detail).toBe(BOWS);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
