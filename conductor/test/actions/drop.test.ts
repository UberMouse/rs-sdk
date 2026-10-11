import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { DROP_ORES_PER_TICK, DROP_WAIT_TICKS, drop, dropOres } from '../../actions/drop';
import { consume } from '../react';
import { world } from '../world';
import { refuse, runOp } from './harness';

const LOGS = /logs/i;
const axe = world().inv('Bronze axe', 1);
/** Normal logs first, then oak: both match /logs/i. */
const mixed = axe.inv('Logs', 3).inv('Oak logs', 1);
const dropOf = (slot: number): BotAction => ({ type: 'dropItem', slot, reason: 'drop Logs' });

describe('drop', () => {
    test("'all' drops every slot of the first matching item, one at a time, and leaves the others", async () => {
        const { result, sends, driver } = await runOp(mixed.series(1), ctx => drop(ctx, LOGS), { react: consume });
        expect(result).toEqual({ ok: true, slotsDropped: 3 });
        expect(sends).toEqual([dropOf(1), dropOf(2), dropOf(3)]);
        expect(driver.state().inventory.map(i => i.name)).toEqual(['Bronze axe', 'Oak logs']);
    });

    test('a number drops that many slots', async () => {
        const { result, sends } = await runOp(mixed.series(1), ctx => drop(ctx, LOGS, 2), { react: consume });
        expect(result).toEqual({ ok: true, slotsDropped: 2 });
        expect(sends).toHaveLength(2);
    });

    test('fewer slots than asked is too-few, after dropping them all', async () => {
        const { result } = await runOp(mixed.series(1), ctx => drop(ctx, LOGS, 5), { react: consume });
        expect(result).toEqual({
            ok: false,
            reason: 'too-few',
            slotsDropped: 3,
            message: 'Dropped Logs x3 slots of 5',
        });
    });

    test('a drop that never leaves the inventory is a timeout', async () => {
        const { result, driver } = await runOp(mixed.series(1), ctx => drop(ctx, LOGS));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            slotsDropped: 0,
            message: 'Drop of Logs (slot 1) was not observed',
        });
        expect(driver.state().tick).toBe(DROP_WAIT_TICKS);
    });

    test('nothing matching, a bad amount and a refused send fail before any wait', async () => {
        const none = await runOp(axe.series(1), ctx => drop(ctx, LOGS));
        expect(none.result).toEqual({
            ok: false,
            reason: 'no-item',
            slotsDropped: 0,
            message: 'Item not found in inventory: /logs/i',
        });
        for (const amount of [0, 29, 1.5]) {
            const bad = await runOp(mixed.series(1), ctx => drop(ctx, LOGS, amount));
            expect(bad.result.ok === false && bad.result.reason).toBe('invalid-amount');
            expect(bad.sends).toEqual([]);
        }
        const refused = await runOp(mixed.series(1), ctx => drop(ctx, LOGS), { respond: refuse });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', slotsDropped: 0, message: 'not connected' });
        expect(refused.driver.ticksElapsed).toBe(0);
    });
});

describe('dropOres', () => {
    test('sends a drop for each matching slot without waiting, up to the per-tick cap', async () => {
        const many = axe.inv('Logs', 5);
        const { result, sends, driver } = await runOp(many.series(1), ctx => dropOres(ctx, LOGS));
        expect(result).toBe(DROP_ORES_PER_TICK);
        expect(sends).toEqual([dropOf(1), dropOf(2), dropOf(3)]);
        expect(driver.ticksElapsed).toBe(0);
    });

    test('nothing matching sends nothing', async () => {
        const { result, sends } = await runOp(axe.series(1), ctx => dropOres(ctx, LOGS));
        expect(result).toBe(0);
        expect(sends).toEqual([]);
    });

    test('stops at the first refused send', async () => {
        const { result } = await runOp(mixed.series(1), ctx => dropOres(ctx, LOGS), { respond: refuse });
        expect(result).toBe(0);
    });
});
