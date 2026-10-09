import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState } from '../../../../sdk/types';
import { withFixtureBot } from '../harness';

// The field east of the Lumbridge General Store. Other runs leave logs and fires around, so the
// test counts logs on its own tile relative to what it found.
const FIELD = { x: 3226 + Math.floor(Math.random() * 10), z: 3236 + Math.floor(Math.random() * 9) };
const LOGS = /^logs$/i;

const countLogs = (items: { name: string }[]) => items.filter(i => LOGS.test(i.name)).length;
const logsHere = (s: BotWorldState) =>
    countLogs(s.groundItems.filter(i => i.x === s.player?.worldX && i.z === s.player?.worldZ));

test('bot.dropItem removes the item from the inventory and puts it on the ground', async () => {
    await withFixtureBot(
        {
            position: FIELD,
            inventory: [
                { id: Items.LOGS, count: 1 },
                { id: Items.LOGS, count: 1 },
                { id: Items.LOGS, count: 1 },
            ],
        },
        async ({ sdk, bot }) => {
            expect(countLogs(sdk.getInventory())).toBe(3);
            const onGround = logsHere(sdk.getState()!);

            const one = await bot.dropItem(LOGS, 1);
            expect(one.success, one.message).toBe(true);
            expect(one.slotsDropped).toBe(1);
            expect(countLogs(sdk.getInventory())).toBe(2);
            await sdk.waitForCondition(s => logsHere(s) === onGround + 1, 5000);

            const rest = await bot.dropItem(LOGS, 'all');
            expect(rest.success, rest.message).toBe(true);
            expect(rest.slotsDropped).toBe(2);
            expect(countLogs(sdk.getInventory())).toBe(0);
            await sdk.waitForCondition(s => logsHere(s) === onGround + 3, 5000);
        },
    );
}, 120_000);
