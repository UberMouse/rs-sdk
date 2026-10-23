import { describe, expect, test } from 'bun:test';
import { UNEQUIP_WAIT_TICKS, unequip } from '../../actions/unequip';
import { world } from '../world';
import { refuse, runOp } from './harness';

const SCIM = { name: 'Rune scimitar', id: 1333 };
const wielding = world().equipment(SCIM);
const worn = wielding.build().equipment[0]!;
const carried = world().inv('Rune scimitar', 1, { id: 1333 });

describe('unequip', () => {
    test('sends the remove option for the worn slot and succeeds once the slot is empty', async () => {
        const { result, sends } = await runOp(
            [wielding.build(), wielding.tick(1).build(), carried.tick(2).build()],
            ctx => unequip(ctx, worn),
        );
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([
            { type: 'useEquipmentItem', slot: worn.slot, optionIndex: 1, reason: 'remove Rune scimitar' },
        ]);
    });

    test('a slot that stays worn is a timeout', async () => {
        const { result, driver } = await runOp(wielding.series(1), ctx => unequip(ctx, worn));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Failed to take off Rune scimitar' });
        expect(driver.state().tick).toBe(UNEQUIP_WAIT_TICKS);
    });

    test('a full pack is refused before sending', async () => {
        const full = wielding.inv('Logs', 28, { id: 1511 });
        const { result, sends } = await runOp(full.series(1), ctx => unequip(ctx, worn));
        expect(result).toMatchObject({ ok: false, reason: 'no-room' });
        expect(sends).toEqual([]);
    });

    test("the server's no-room message ends the wait early", async () => {
        const { result, driver } = await runOp(
            [wielding.build(), wielding.tick(1).message('You do not have enough inventory space.').build()],
            ctx => unequip(ctx, worn),
        );
        expect(result).toMatchObject({ ok: false, reason: 'no-room' });
        expect(driver.state().tick).toBeLessThan(UNEQUIP_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(wielding.series(1), ctx => unequip(ctx, worn), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});
