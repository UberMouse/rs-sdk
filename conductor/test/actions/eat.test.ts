import { describe, expect, test } from 'bun:test';
import { EAT_ATTEMPT_TICKS, EAT_WAIT_TICKS, eat } from '../../actions/eat';
import { world } from '../world';
import { refuse, runOp } from './harness';

const hurt = world().player({ hp: 4 }).inv('Bread', 1).inv('Shrimps', 2);
const shrimps = hurt.build().inventory.find(i => i.name === 'Shrimps')!;

describe('eat', () => {
    test('sends Eat on the food and reports the HP it gained', async () => {
        const { result, sends } = await runOp(
            [hurt.build(), hurt.inv('Shrimps', 1).player({ hp: 7 }).tick(1).build()],
            ctx => eat(ctx, shrimps),
        );
        expect(result).toEqual({ ok: true, hpGained: 3 });
        expect(sends).toEqual([
            { type: 'useInventoryItem', slot: shrimps.slot, optionIndex: 1, reason: 'Eat Shrimps' },
        ]);
    });

    test('one used up is enough at full HP: nothing to gain', async () => {
        const full = world().inv('Shrimps', 2);
        const food = full.build().inventory[0]!;
        const { result } = await runOp([full.build(), full.inv('Shrimps', 1).tick(1).build()], ctx => eat(ctx, food));
        expect(result).toEqual({ ok: true, hpGained: 0 });
    });

    test('a drink counts as food', async () => {
        const beer = world()
            .player({ hp: 4 })
            .inv('Beer', 1, { id: 1917, options: [{ text: 'Drink', opIndex: 1 }] });
        const item = beer.build().inventory[0]!;
        const { result, sends } = await runOp(
            [beer.build(), beer.player({ hp: 5 }).inv('Beer', 0).tick(1).build()],
            ctx => eat(ctx, item),
        );
        expect(result).toEqual({ ok: true, hpGained: 1 });
        expect(sends[0]).toMatchObject({ reason: 'Drink Beer' });
    });

    test('an item with no Eat or Drink option is refused before sending', async () => {
        const logs = world().inv('Logs', 1);
        const { result, sends } = await runOp(logs.series(1), ctx => eat(ctx, logs.build().inventory[0]!));
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'No eat/drink option on Logs' });
        expect(sends).toEqual([]);
    });

    test('nothing changing within the wait is a timeout', async () => {
        const { result, driver } = await runOp(hurt.series(1), ctx => eat(ctx, shrimps));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Failed to eat Shrimps' });
        expect(driver.state().tick).toBe(EAT_WAIT_TICKS);
    });

    test('a shorter wait is a timeout after that many ticks', async () => {
        const { result, driver } = await runOp(hurt.series(1), ctx => eat(ctx, shrimps, EAT_ATTEMPT_TICKS));
        expect(result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(driver.state().tick).toBeLessThan(EAT_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result, driver } = await runOp(hurt.series(1), ctx => eat(ctx, shrimps), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });
});
