import { describe, expect, test } from 'bun:test';
import { PICKUP_GRACE_TICKS, PICKUP_WAIT_TICKS, pickup } from '../../actions/pickup';
import { world } from '../world';
import { refuse, runOp } from './harness';

const at = { x: 3224, z: 3202 };
/** An old message, from before the pickup. */
const base = world().message("I can't reach that!").tick(1);
const lying = base.ground('Knife', at.x, at.z);
const knife = lying.build().groundItems[0]!;
const taken = base.inv('Knife', 1);
const gone = base;

describe('pickup', () => {
    test('sends the pickup and succeeds once the item is held', async () => {
        const { result, sends } = await runOp([lying.build(), lying.tick(2).build(), taken.tick(3).build()], ctx =>
            pickup(ctx, knife),
        );
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([{ type: 'pickupItem', x: at.x, z: at.z, itemId: knife.id, reason: 'take Knife' }]);
    });

    test('the item leaving the ground a tick before it shows in the inventory is still a pickup', async () => {
        const { result } = await runOp([lying.build(), gone.tick(2).build(), taken.tick(3).build()], ctx =>
            pickup(ctx, knife),
        );
        expect(result).toEqual({ ok: true });
    });

    test('the item gone and never gained was taken by someone else, after the grace', async () => {
        const { result, driver } = await runOp([lying.build(), gone.tick(2).build()], ctx => pickup(ctx, knife));
        expect(result).toEqual({ ok: false, reason: 'taken-by-other', message: 'Knife was taken by someone else' });
        expect(driver.state().tick).toBe(2 + PICKUP_GRACE_TICKS);
    });

    test("the game's refusals: can't reach, and no inventory space", async () => {
        const blocked = await runOp([lying.build(), lying.tick(2).message("I can't reach that!").build()], ctx =>
            pickup(ctx, knife),
        );
        expect(blocked.result).toEqual({
            ok: false,
            reason: 'cant-reach',
            message: 'Cannot reach Knife - path blocked',
        });

        const full = lying.tick(2).message("You don't have enough inventory space to hold that item.");
        const nospace = await runOp([lying.build(), full.build()], ctx => pickup(ctx, knife));
        expect(nospace.result).toEqual({ ok: false, reason: 'inventory-full', message: 'Inventory is full' });
    });

    test('a spawn that stays put while one is already held is a timeout, not a gain', async () => {
        const holding = lying.inv('Knife', 1);
        const { result, driver } = await runOp(holding.series(1), ctx => pickup(ctx, knife));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Timed out waiting for pickup' });
        expect(driver.state().tick).toBe(1 + PICKUP_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(lying.series(1), ctx => pickup(ctx, knife), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});
