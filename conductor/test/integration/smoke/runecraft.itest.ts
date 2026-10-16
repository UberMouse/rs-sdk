import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Rune Mysteries varp (63) at its "complete" value: the essence mine teleports are unlocked.
const RUNE_MYSTERIES = { 63: 6 };
// Beside the Air ruins south of Falador (2984,3291), and inside the essence mine (map square 45_75).
const AIR_RUINS = { x: 2985, z: 3288 };
// Inside the air temple (map square 44_75).
const AIR_TEMPLE = { x: 2841, z: 4830 };
const AUBURY = { x: 3253, z: 3403 };

test(
    'runecraft task enters the air ruins, binds the essence and leaves by the portal',
    async () => {
        await withFixtureBot(
            {
                position: AIR_RUINS,
                skills: { Runecraft: 1 },
                inventory: [
                    { id: Items.AIR_TALISMAN, count: 1 },
                    ...Array.from({ length: 4 }, () => ({ id: Items.RUNE_ESSENCE, count: 1 })),
                ],
            },
            async ({ name }) => {
                const run = await runTask(name, 'runecraft', { altar: 'air' }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Runecraft, detail).toBeGreaterThan(0);
                expect(run.result.inventoryDelta['Rune essence'], detail).toBe(-4);
                expect(run.result.inventoryDelta['Air rune'], detail).toBe(4);
                expect(run.result.finalPos.z, detail).toBeLessThan(4000);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'runecraft task started inside the air temple with no essence leaves and is done',
    async () => {
        await withFixtureBot(
            {
                position: AIR_TEMPLE,
                skills: { Runecraft: 1 },
                inventory: [{ id: Items.AIR_TALISMAN, count: 1 }],
            },
            async ({ name }) => {
                const run = await runTask(name, 'runecraft', { altar: 'air' }, ['minutes:2']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos.z, detail).toBeLessThan(4000);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

test(
    'essence-mine task enters through Aubury, mining finds essence, and the portal leads back',
    async () => {
        await withFixtureBot(
            {
                position: AUBURY,
                varps: RUNE_MYSTERIES,
                skills: { Mining: 1 },
                inventory: [{ id: Items.BRONZE_PICKAXE, count: 1 }],
            },
            async ({ name }) => {
                const enter = await runTask(name, 'essence-mine', { action: 'enter' }, ['minutes:2']);
                expect(enter.result.status, JSON.stringify(enter.result)).toBe('done');
                expect(enter.result.finalPos.z, JSON.stringify(enter.result)).toBeGreaterThan(4000);
                const mine = await runTask(name, 'mining', { rock: 'essence', onFull: 'stop' }, [
                    'xp:Mining:1',
                    'minutes:2',
                ]);
                expect(mine.result.status, JSON.stringify(mine.result)).toBe('done');
                expect(mine.result.inventoryDelta['Rune essence'], JSON.stringify(mine.result)).toBeGreaterThan(0);
                const leave = await runTask(name, 'essence-mine', { action: 'leave' }, ['minutes:2']);
                expect(leave.result.status, JSON.stringify(leave.result)).toBe('done');
                expect(leave.result.finalPos.z, JSON.stringify(leave.result)).toBeLessThan(4000);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 6 }),
);
