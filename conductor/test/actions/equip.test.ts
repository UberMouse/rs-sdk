import { describe, expect, test } from 'bun:test';
import { EQUIP_WAIT_TICKS, equip } from '../../actions/equip';
import { world } from '../world';
import { refuse, runOp } from './harness';

const AXE = 'Bronze axe';
const carrying = world().inv('Logs', 1).inv(AXE, 1);
const axe = carrying.build().inventory.find(i => i.name === AXE)!;
const wielding = world().inv('Logs', 1).equipment({ name: AXE });

describe('equip', () => {
    test('sends Wield on the item and succeeds once it leaves the inventory for the equipment', async () => {
        const { result, sends } = await runOp(
            [carrying.build(), carrying.tick(1).build(), wielding.tick(2).build()],
            ctx => equip(ctx, axe),
        );
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([
            { type: 'useInventoryItem', slot: axe.slot, optionIndex: 2, reason: 'Wield Bronze axe' },
        ]);
    });

    test('showing as worn is enough, even before the inventory catches up', async () => {
        const { result } = await runOp([carrying.build(), carrying.equipment({ name: AXE }).tick(1).build()], ctx =>
            equip(ctx, axe),
        );
        expect(result).toEqual({ ok: true });
    });

    test('a copy already worn is no evidence: only the slot emptying counts', async () => {
        const spare = carrying.equipment({ name: AXE });
        const stays = await runOp(spare.series(1), ctx => equip(ctx, axe));
        expect(stays.result).toEqual({ ok: false, reason: 'timeout', message: 'Failed to equip Bronze axe' });
        expect(stays.driver.state().tick).toBe(EQUIP_WAIT_TICKS);

        const swapped = await runOp([spare.build(), spare.inv(AXE, 0).tick(1).build()], ctx => equip(ctx, axe));
        expect(swapped.result).toEqual({ ok: true });
    });

    test('an item with no equip option is refused before sending', async () => {
        const logs = carrying.build().inventory[0]!;
        const { result, sends } = await runOp(carrying.series(1), ctx => equip(ctx, logs));
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'No equip option on Logs' });
        expect(sends).toEqual([]);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(carrying.series(1), ctx => equip(ctx, axe), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});
