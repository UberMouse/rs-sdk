import { describe, expect, test } from 'bun:test';
import type { BotAction, NearbyLoc } from '../../../sdk/types';
import { COOK_WAIT_TICKS, cook } from '../../actions/cook';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

const SHRIMPS = /^raw shrimps$/i;
const kit = world().skill('Cooking', 1, 0).inv('Raw shrimps', 3).loc('Range', 3230, 3196).tick(1);
const range = (w: World): NearbyLoc => w.build().nearbyLocs[0]!;
const useOnRange = (w: World): BotAction => ({
    type: 'useItemOnLoc',
    itemSlot: 0,
    x: range(w).x,
    z: range(w).z,
    locId: range(w).id,
    reason: 'cook Raw shrimps on Range',
});
/** One shrimp gone, and a cooked one with 30 xp (or none, burnt). */
const result = (w: World, burnt: boolean) =>
    w
        .inv('Raw shrimps', 2)
        .inv('Shrimps', 1)
        .skill('Cooking', 1, burnt ? 0 : 30);

describe('cook', () => {
    test('uses the raw food on the source and reports a cooked one with its xp', async () => {
        const { result: r, sends } = await runOp([kit.build(), result(kit.tick(3), false).build()], ctx =>
            cook(ctx, SHRIMPS, range(kit)),
        );
        expect(r).toEqual({ ok: true, burnt: false, xpGained: 30 });
        expect(sends).toEqual([useOnRange(kit)]);
    });

    test('a raw item that is gone with no xp is burnt, and still ok', async () => {
        const { result: r } = await runOp([kit.build(), result(kit.tick(3), true).build()], ctx =>
            cook(ctx, SHRIMPS, range(kit)),
        );
        expect(r).toEqual({ ok: true, burnt: true, xpGained: 0 });
    });

    test('unrelated messages are not the result: it waits for the item to change', async () => {
        const { result: r, driver } = await runOp(
            [
                kit.build(),
                kit.tick(2).message('You put the shrimps on the stove.').build(),
                result(kit.tick(4), false).build(),
            ],
            ctx => cook(ctx, SHRIMPS, range(kit)),
        );
        expect(r.ok).toBe(true);
        expect(driver.state().tick).toBe(4);
    });

    test.each([
        ['level-too-low', 'You need a Cooking level of 15 to cook trout.'],
        ['members', "You can only make that on a members' server."],
        ['cant-cook', "You can't cook that."],
        ['not-allowed', 'Who said you could use that?'],
        ['not-allowed', 'Only members of the Fremennik may use this fire.'],
        ['cant-reach', "I can't reach that!"],
    ] as const)('a %s refusal ends the wait with the game text', async (reason, text) => {
        const w = kit.tick(3);
        const states = [kit.build(), (reason === 'level-too-low' ? w.recentDialog([text]) : w.message(text)).build()];
        const { result: r, driver } = await runOp(states, ctx => cook(ctx, SHRIMPS, range(kit)));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe(reason);
        expect(driver.state().tick).toBe(3);
    });

    test('a refusal from before the send does not count', async () => {
        const old = kit.message("You can't cook that.");
        const { result: r } = await runOp([old.build(), result(old.tick(3), false).build()], ctx =>
            cook(ctx, SHRIMPS, range(kit)),
        );
        expect(r.ok).toBe(true);
    });

    test('nothing happening is a timeout', async () => {
        const { result: r, driver } = await runOp(kit.series(1), ctx => cook(ctx, SHRIMPS, range(kit)));
        expect(r).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Timed out cooking Raw shrimps on Range',
        });
        expect(driver.state().tick).toBe(1 + COOK_WAIT_TICKS);
    });

    test('no raw food, and a refused send, fail before any wait', async () => {
        const none = await runOp(world().inv('Logs', 1).series(1), ctx => cook(ctx, SHRIMPS, range(kit)));
        expect(none.result).toEqual({ ok: false, reason: 'no-raw', message: 'No raw food in inventory' });
        expect(none.sends).toEqual([]);
        const refused = await runOp(kit.series(1), ctx => cook(ctx, SHRIMPS, range(kit)), { respond: refuse });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});
