import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { CLEANUP_CLOSE_WAIT_TICKS } from '../../actions/modal';
import {
    buy,
    CLOSE_SHOP_WAIT_TICKS,
    closeShop,
    OPEN_SHOP_WAIT_TICKS,
    openShop,
    SELL_ALL_PACKET_WAIT_TICKS,
    SHOP_PACKET_WAIT_TICKS,
    sell,
    withShop,
} from '../../actions/shop';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { CLEANUP_TICKS, type Guard, interpret } from '../../core/interpret';
import { send } from '../../core/op';
import { shopWorld } from '../react';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

const KEEPER = { x: 3212, z: 3247 };
const idle = world().npc('Shop keeper', KEEPER.x, KEEPER.z, { index: 4, options: ['Talk-to', 'Trade'] });
const LINES = [
    { name: 'Hammer', count: 5, buyPrice: 2 },
    { name: 'Tinderbox', count: 0, buyPrice: 1 },
    { name: 'Pot', count: 40, buyPrice: 1 },
];
const carrying = idle.inv('Coins', 100).inv('Logs', 3);
const opened = carrying.shop(LINES, { logs: 4 });
const cantReach = () => ({ success: false, message: 'no route', reason: 'cant_reach' });

const asDriver = (states: BotWorldState[]) => new TimelineDriver(states, { react: shopWorld });
const sendsOf = (d: TimelineDriver) => d.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : []));
const logsOf = (d: TimelineDriver) => d.commands.flatMap(c => (c.type === 'log' ? [c.msg] : []));
const hurt = (w: World) => w.player({ hp: 3 });
const countOf = (s: BotWorldState, name: string) =>
    s.inventory.filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
/** Fires below 5 HP: aborts the op, then sends a marker 'eat' (the eat it stands for needs the shop shut). */
const lowHp: Guard = {
    name: 'low-hp',
    policy: 'abort',
    when: s => (s.player?.hp ?? 10) < 5,
    *run() {
        yield* send({ type: 'none', reason: 'eat' });
        return { fail: 'ate' };
    },
};
/** The shop world, but a buy never lands: its wait is still running when an abort comes. */
const ignoresBuys: TimelineOptions['react'] = (a, s) => (a.type === 'shopBuy' ? undefined : shopWorld(a, s));
const sendsOfType = (sends: BotAction[], type: string) => sends.filter(s => s.type === type);

describe('openShop', () => {
    test('trades with the shopkeeper and succeeds once the shop is open', async () => {
        const { result, sends } = await runOp([idle.build(), idle.tick(1).build(), opened.tick(2).build()], openShop);
        expect(result).toEqual({ ok: true, message: 'Opened shop: General Store' });
        expect(sends).toEqual([{ type: 'interactNpc', npcIndex: 4, optionIndex: 2, reason: 'Trade Shop keeper' }]);
    });

    test('an open shop is success without sending anything', async () => {
        const { result, sends, driver } = await runOp(opened.series(1), openShop);
        expect(result).toEqual({ ok: true, message: 'Shop already open: General Store' });
        expect(sends).toEqual([]);
        expect(driver.ticksElapsed).toBe(0);
    });

    test('a name, a pattern or an NPC picks the shopkeeper; a name that matches nobody is npc-not-found', async () => {
        const two = idle.npc('Bob', KEEPER.x + 1, KEEPER.z, { index: 9, options: ['Talk-to', 'Trade'] });
        const states = [two.build(), opened.tick(1).build()];
        expect((await runOp(states, ctx => openShop(ctx, 'bob'))).sends[0]).toMatchObject({ npcIndex: 9 });
        expect((await runOp(states, ctx => openShop(ctx, /^bob$/i))).sends[0]).toMatchObject({ npcIndex: 9 });
        const bob = two.build().nearbyNpcs[1]!;
        expect((await runOp(states, ctx => openShop(ctx, bob))).sends[0]).toMatchObject({ npcIndex: 9 });
        const missing = await runOp(states, ctx => openShop(ctx, 'Aubury'));
        expect(missing.result).toEqual({ ok: false, reason: 'npc-not-found', message: 'Shopkeeper not found: Aubury' });
        expect(missing.sends).toEqual([]);
    });

    test('with no target the nearest NPC offering Trade is used when no shop keeper stands there', async () => {
        const w = world()
            .player({ at: KEEPER })
            .npc('Man', KEEPER.x, KEEPER.z, { index: 1, options: ['Talk-to'] })
            .npc('Bob', KEEPER.x + 5, KEEPER.z, { index: 2, options: ['Talk-to', 'Trade'] })
            .npc('Aubury', KEEPER.x + 1, KEEPER.z, { index: 3, options: ['Talk-to', 'Trade'] });
        const { sends } = await runOp([w.build(), opened.tick(1).build()], openShop);
        expect(sends[0]).toMatchObject({ npcIndex: 3, reason: 'Trade Aubury' });
        const none = await runOp(world().series(1), openShop);
        expect(none.result).toEqual({
            ok: false,
            reason: 'npc-not-found',
            message: 'No nearby NPC with a Trade option',
        });
    });

    test('among same-named NPCs the one offering Trade is used, even when farther', async () => {
        const w = world()
            .player({ at: KEEPER })
            .npc('Dwarf', KEEPER.x + 1, KEEPER.z, { index: 7, options: ['Talk-to'] })
            .npc('Dwarf', KEEPER.x + 3, KEEPER.z, { index: 8, options: ['Talk-to', 'Trade'] });
        const { sends } = await runOp([w.build(), opened.tick(1).build()], ctx => openShop(ctx, 'Dwarf'));
        expect(sends[0]).toMatchObject({ npcIndex: 8, reason: 'Trade Dwarf' });
    });

    test('among same-named traders a reachable one is used, even when an unreachable one is nearer', async () => {
        const w = world()
            .player({ at: KEEPER })
            .npc('Dwarf', KEEPER.x + 1, KEEPER.z, { index: 7, options: ['Talk-to', 'Trade'], reachable: false })
            .npc('Dwarf', KEEPER.x + 3, KEEPER.z, { index: 8, options: ['Talk-to', 'Trade'] });
        const { sends } = await runOp([w.build(), opened.tick(1).build()], ctx => openShop(ctx, 'Dwarf'));
        expect(sends[0]).toMatchObject({ npcIndex: 8 });
    });

    test('an unreachable trader is still used when it is the only one', async () => {
        const w = world()
            .player({ at: KEEPER })
            .npc('Dwarf', KEEPER.x + 1, KEEPER.z, { index: 7, options: ['Talk-to', 'Trade'], reachable: false });
        const { sends } = await runOp([w.build(), opened.tick(1).build()], ctx => openShop(ctx, 'Dwarf'));
        expect(sends[0]).toMatchObject({ npcIndex: 7 });
    });

    test('with no target, a reachable trading NPC beats a nearer unreachable one', async () => {
        const w = world()
            .player({ at: KEEPER })
            .npc('Bob', KEEPER.x + 1, KEEPER.z, { index: 7, options: ['Trade'], reachable: false })
            .npc('Aubury', KEEPER.x + 3, KEEPER.z, { index: 8, options: ['Trade'] });
        const { sends } = await runOp([w.build(), opened.tick(1).build()], ctx => openShop(ctx));
        expect(sends[0]).toMatchObject({ npcIndex: 8 });
    });

    test('same-named NPCs with no Trade option among them are no-trade-option, nothing sent', async () => {
        const w = world()
            .player({ at: KEEPER })
            .npc('Dwarf', KEEPER.x + 1, KEEPER.z, { index: 7, options: ['Talk-to'] })
            .npc('Dwarf', KEEPER.x + 3, KEEPER.z, { index: 8, options: ['Talk-to'] });
        const { result, sends } = await runOp(w.series(1), ctx => openShop(ctx, 'Dwarf'));
        expect(result).toEqual({ ok: false, reason: 'no-trade-option', message: 'No trade option on NPC' });
        expect(sends).toEqual([]);
    });

    test('a shopkeeper with no Trade option is no-trade-option and nothing is sent', async () => {
        const talkOnly = world().npc('Shop keeper', KEEPER.x, KEEPER.z, { options: ['Talk-to'] });
        const { result, sends } = await runOp(talkOnly.series(1), openShop);
        expect(result).toEqual({ ok: false, reason: 'no-trade-option', message: 'No trade option on NPC' });
        expect(sends).toEqual([]);
    });

    test("the client finding no route, and the server's can't reach, are cant-reach", async () => {
        const client = await runOp(idle.series(1), openShop, { respond: cantReach });
        expect(client.result).toEqual({ ok: false, reason: 'cant-reach', message: 'no route' });
        expect(client.driver.ticksElapsed).toBe(0);

        const server = await runOp([idle.build(), idle.tick(1).message("I can't reach that!").build()], openShop);
        expect(server.result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Shop keeper' });
    });

    test("a can't-reach message from before the send is not an answer to it", async () => {
        const old = idle.message("I can't reach that!");
        const { result, driver } = await runOp(old.series(1), openShop);
        expect(result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(driver.state().tick).toBe(OPEN_SHOP_WAIT_TICKS);
    });

    test("the shop opening on the tick of a can't-reach message wins", async () => {
        const both = opened.tick(1).message("I can't reach that!");
        const { result } = await runOp([idle.build(), both.build()], openShop);
        expect(result.ok).toBe(true);
    });

    test('a shop that never opens is a timeout after OPEN_SHOP_WAIT_TICKS', async () => {
        const { result, driver } = await runOp(idle.series(1), openShop);
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Timed out waiting for shop to open' });
        expect(driver.state().tick).toBe(OPEN_SHOP_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(idle.series(1), openShop, { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

describe('closeShop', () => {
    test('sends a close and succeeds once the interface and shop are both closed', async () => {
        const { result, sends } = await runOp(
            [opened.build(), opened.tick(1).build(), carrying.tick(2).build()],
            closeShop,
        );
        expect(result).toEqual({ ok: true, message: 'Shop closed' });
        expect(sends).toEqual([{ type: 'closeShop', reason: 'close shop' }]);
    });

    test('shop.isOpen outlasting interface.isOpen by a frame is not closed yet', async () => {
        const lagging = { ...carrying.tick(1).build(), shop: opened.build().shop } satisfies BotWorldState;
        const { result, driver } = await runOp([opened.build(), lagging, carrying.tick(2).build()], closeShop);
        expect(result.ok).toBe(true);
        expect(driver.state().tick).toBe(2);
    });

    test('already closed is success without sending', async () => {
        const { result, sends } = await runOp(carrying.series(1), closeShop);
        expect(result).toEqual({ ok: true, message: 'Shop already closed' });
        expect(sends).toEqual([]);
    });

    test('a close that shows no effect is sent again once, and counts if the second takes', async () => {
        const states = opened.series(CLOSE_SHOP_WAIT_TICKS + 2, (w, i) =>
            i > CLOSE_SHOP_WAIT_TICKS ? w.shop(false) : w,
        );
        const { result, sends } = await runOp(states, closeShop);
        expect(result).toEqual({ ok: true, message: 'Shop closed (second attempt)' });
        expect(sends.map(s => s.reason)).toEqual(['close shop', 'close shop (second attempt)']);
    });

    test('a shop that stays open is a timeout naming both flags', async () => {
        const { result, sends } = await runOp(opened.series(1), closeShop);
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Shop close timeout - shop.isOpen=true, interface.isOpen=true',
        });
        expect(sends).toHaveLength(2);
    });

    test('a refused send is send-failed, first or second', async () => {
        const first = await runOp(opened.series(1), closeShop, { respond: refuse });
        expect(first.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        let n = 0;
        const second = await runOp(opened.series(1), closeShop, { respond: () => (++n > 1 ? refuse() : undefined) });
        expect(second.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

/** The opened shop with `n` more unstackable items held (it holds coins and 3 logs already: 4 of the 28 slots). */
const filler = (n: number) =>
    Array.from({ length: n }, (_, i) => i).reduce((w, i) => w.inv(`Oak logs ${i}`, 1, { id: 2000 + i }), opened);

const HAMMER = /^hammer$/i;
const LOGS = /^logs$/i;
const HAMMER_SLOT = 0;

describe('buy', () => {
    test('sends the shelf slot and succeeds once the item arrives', async () => {
        const { result, sends, driver } = await runOp(
            [opened.build(), opened.tick(1).build()],
            ctx => buy(ctx, HAMMER, 2),
            { react: shopWorld },
        );
        expect(result).toMatchObject({ ok: true, amountBought: 2, message: 'Bought Hammer x2' });
        expect(result.ok && result.item?.name).toBe('Hammer');
        const packet = { type: 'shopBuy', slot: HAMMER_SLOT, amount: 1, reason: 'buy Hammer' } as const;
        expect(sends).toEqual([packet, packet]);
        expect(countOf(driver.state(), 'Coins')).toBe(96);
    });

    test('streams Buy-10/5/1 packets, each waiting for its items', async () => {
        const { result, sends } = await runOp(opened.series(1), ctx => buy(ctx, 'pot', 17), { react: shopWorld });
        expect(result).toMatchObject({ ok: true, amountBought: 17 });
        expect(sends.map(s => s.type === 'shopBuy' && s.amount)).toEqual([10, 5, 1, 1]);
    });

    test('a shop item is bought as given', async () => {
        const pot = opened.build().shop.shopItems[2]!;
        const { sends } = await runOp(opened.series(1), ctx => buy(ctx, pot, 1), { react: shopWorld });
        expect(sends[0]).toMatchObject({ type: 'shopBuy', slot: 2 });
    });

    test('fewer than asked arriving is partial-fill with what did arrive', async () => {
        const { result } = await runOp(opened.series(1), ctx => buy(ctx, HAMMER, 8), { react: shopWorld });
        expect(result).toEqual({
            ok: false,
            reason: 'partial-fill',
            amountBought: 5,
            message: 'Bought Hammer x5 of 8 requested',
        });
    });

    test('an item that never arrives is a timeout after the wait', async () => {
        const { result, driver } = await runOp(opened.series(1), ctx => buy(ctx, HAMMER));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            amountBought: 0,
            message: 'Failed to buy Hammer (no coins, out of stock, or full inventory?)',
        });
        expect(driver.state().tick).toBe(SHOP_PACKET_WAIT_TICKS);
    });

    test('a later packet that never lands leaves a partial-fill, not a timeout', async () => {
        let packets = 0;
        const { result } = await runOp(opened.series(1), ctx => buy(ctx, 'pot', 12), {
            react: (a, s) => (a.type === 'shopBuy' && ++packets > 1 ? undefined : shopWorld(a, s)),
        });
        expect(result).toMatchObject({ ok: false, reason: 'partial-fill', amountBought: 10 });
    });

    test('a shop that closes before the full amount arrived is shop-not-open with what did', async () => {
        const tenIn = opened.inv('Pot', 10).tick(1);
        const closed = carrying.inv('Pot', 10).tick(2);
        const { result, sends } = await runOp([opened.build(), tenIn.build(), closed.build()], ctx =>
            buy(ctx, 'pot', 12),
        );
        expect(result).toEqual({
            ok: false,
            reason: 'shop-not-open',
            amountBought: 10,
            message: 'Shop closed with Pot x10 of 12 bought',
        });
        // The close ends the wait at once instead of waiting it out.
        expect(sends).toHaveLength(2);
    });

    test('a shop that closes as the last packet lands is still a full purchase', async () => {
        const { result } = await runOp([opened.build(), carrying.inv('Pot', 1).tick(1).build()], ctx =>
            buy(ctx, 'pot', 1),
        );
        expect(result).toMatchObject({ ok: true, amountBought: 1 });
    });

    test('a line with nothing on the shelf is out-of-stock, before any send', async () => {
        const { result, sends } = await runOp(opened.series(1), ctx => buy(ctx, /tinderbox/i));
        expect(result).toEqual({
            ok: false,
            reason: 'out-of-stock',
            amountBought: 0,
            message: 'Tinderbox is out of stock',
        });
        expect(sends).toEqual([]);
    });

    test('a full inventory with no stack of the item is no-inventory-space; a stack still buys', async () => {
        const full = filler(24);
        const none = await runOp(full.series(1), ctx => buy(ctx, HAMMER));
        expect(none.result).toEqual({
            ok: false,
            reason: 'no-inventory-space',
            amountBought: 0,
            message: 'No inventory space to buy Hammer',
        });
        expect(none.sends).toEqual([]);
        const stacked = await runOp(
            // Holding one is what lets the buy through to a send: the server stacks or refuses.
            filler(23).inv('Hammer', 1).series(1),
            ctx => buy(ctx, HAMMER),
        );
        expect(stacked.sends).toHaveLength(1);
    });

    test('no match, a bad amount and a closed shop fail before any send', async () => {
        const none = await runOp(opened.series(1), ctx => buy(ctx, /gold/i));
        expect(none.result).toEqual({
            ok: false,
            reason: 'item-not-found',
            amountBought: 0,
            message: 'Item not found in shop: /gold/i',
        });
        for (const amount of [0, -1, 1.5, 1001]) {
            const bad = await runOp(opened.series(1), ctx => buy(ctx, HAMMER, amount));
            expect(bad.result).toMatchObject({ reason: 'invalid-amount', amountBought: 0 });
        }
        const closed = await runOp(carrying.series(1), ctx => buy(ctx, HAMMER));
        expect(closed.result).toEqual({
            ok: false,
            reason: 'shop-not-open',
            amountBought: 0,
            message: 'Shop is not open',
        });
        expect(none.sends.concat(closed.sends)).toEqual([]);
    });

    test('a refused send is send-failed; refused after some arrived it is partial-fill', async () => {
        const first = await runOp(opened.series(1), ctx => buy(ctx, HAMMER), { respond: refuse });
        expect(first.result).toEqual({ ok: false, reason: 'send-failed', amountBought: 0, message: 'not connected' });
        expect(first.driver.ticksElapsed).toBe(0);
        let n = 0;
        const later = await runOp(opened.series(1), ctx => buy(ctx, 'pot', 12), {
            react: shopWorld,
            respond: () => (++n > 1 ? refuse() : undefined),
        });
        expect(later.result).toMatchObject({ ok: false, reason: 'partial-fill', amountBought: 10 });
    });
});

describe('sell', () => {
    test('sells that many one packet at a time, re-resolving the shop slot before each', async () => {
        const { result, sends, driver } = await runOp(opened.series(1), ctx => sell(ctx, LOGS, 3), {
            react: shopWorld,
        });
        expect(result).toEqual({ ok: true, amountSold: 3, message: 'Sold Logs x3' });
        expect(sendsOfType(sends, 'shopSell')).toHaveLength(3);
        // Coins move to the back of the inventory as logs leave, so the logs' slot changes under the sender.
        expect(sends.map(s => s.type === 'shopSell' && s.slot)).toEqual([1, 0, 0]);
        expect(countOf(driver.state(), 'Coins')).toBe(112);
    });

    test("'all' sells every unit and reports the total", async () => {
        const { result, sends } = await runOp(opened.series(1), ctx => sell(ctx, LOGS, 'all'), { react: shopWorld });
        expect(result).toEqual({ ok: true, amountSold: 3, message: 'Sold Logs x3' });
        expect(sends).toHaveLength(3);
    });

    test('a stack sells up to 10 a packet', async () => {
        const stack = idle.inv('Coins', 100).inv('Bronze arrow', 25, { id: 882 }).shop([], { 'bronze arrow': 1 });
        const { result, sends } = await runOp(stack.series(1), ctx => sell(ctx, /bronze arrow/i, 'all'), {
            react: shopWorld,
        });
        expect(result).toMatchObject({ ok: true, amountSold: 25 });
        expect(sends.map(s => s.type === 'shopSell' && s.amount)).toEqual([10, 10, 5]);
    });

    test('fewer than asked leaving is partial-fill', async () => {
        const { result } = await runOp(opened.series(1), ctx => sell(ctx, LOGS, 5), { react: shopWorld });
        expect(result).toEqual({
            ok: false,
            reason: 'partial-fill',
            amountSold: 3,
            message: 'Sold Logs x3 of 5 requested',
        });
    });

    test('an item that never leaves is a timeout after the wait', async () => {
        const counted = await runOp(opened.series(1), ctx => sell(ctx, LOGS, 2));
        expect(counted.result).toEqual({
            ok: false,
            reason: 'timeout',
            amountSold: 0,
            message: 'Failed to sell Logs (timeout)',
        });
        expect(counted.driver.state().tick).toBe(SHOP_PACKET_WAIT_TICKS);
        const all = await runOp(opened.series(1), ctx => sell(ctx, LOGS, 'all'));
        expect(all.result).toEqual({
            ok: false,
            reason: 'timeout',
            amountSold: 0,
            message: 'Failed to sell Logs (timeout)',
        });
        expect(all.driver.state().tick).toBe(SELL_ALL_PACKET_WAIT_TICKS);
    });

    test("a can't-sell answer is rejected, worded by which refusal it is, counted or all", async () => {
        const cases = [
            ["You can't sell this item to this shop.", "Shop doesn't buy Logs"],
            ["You can't sell this item to a shop.", 'Cannot sell Logs to any shop'],
            ["You can't sell this item.", 'Logs is not tradeable'],
        ] as const;
        for (const [text, message] of cases) {
            const refusal = [opened.build(), opened.tick(1).message(text).build()];
            for (const amount of [1, 'all'] as const) {
                const { result } = await runOp(refusal, ctx => sell(ctx, LOGS, amount));
                expect(result).toEqual({ ok: false, reason: 'rejected', amountSold: 0, message });
            }
        }
    });

    test('a refusal after some sold says how many went first, counted or all', async () => {
        const sold = carrying.inv('Logs', 2).shop(LINES, { logs: 4 });
        const refusal = sold.tick(2).message("You can't sell this item to this shop.");
        for (const amount of [3, 'all'] as const) {
            const { result } = await runOp([opened.build(), sold.tick(1).build(), refusal.build()], ctx =>
                sell(ctx, LOGS, amount),
            );
            expect(result).toEqual({
                ok: false,
                reason: 'rejected',
                amountSold: 1,
                message: "Shop doesn't buy Logs (sold x1 of 3 first)",
            });
        }
    });

    test('a shop that closes with a packet in flight is shop-not-open, not sold, counted or all', async () => {
        // A closed shop lists no inventory, which once read as every unit sold. Here nothing left while
        // the shop showed open, so nothing counts as sold, whatever the inventory shows after.
        const closed = carrying.inv('Logs', 2).tick(1);
        for (const amount of [2, 'all'] as const) {
            const { result, sends, driver } = await runOp([opened.build(), closed.build()], ctx =>
                sell(ctx, LOGS, amount),
            );
            const requested = amount === 'all' ? 3 : amount;
            expect(result).toEqual({
                ok: false,
                reason: 'shop-not-open',
                amountSold: 0,
                message: `Shop closed with Logs x0 of ${requested} sold`,
            });
            expect(sends).toHaveLength(1);
            expect(driver.state().tick).toBe(1);
        }
    });

    test('a shop that closes after some sold reports what left while it was open, counted or all', async () => {
        const one = carrying.inv('Logs', 2).shop(LINES, { logs: 4 }).tick(1);
        const closed = carrying.inv('Logs', 1).tick(2);
        for (const amount of [3, 'all'] as const) {
            const { result, sends } = await runOp([opened.build(), one.build(), closed.build()], ctx =>
                sell(ctx, LOGS, amount),
            );
            expect(result).toEqual({
                ok: false,
                reason: 'shop-not-open',
                amountSold: 1,
                message: 'Shop closed with Logs x1 of 3 sold',
            });
            expect(sends).toHaveLength(2);
        }
    });

    test("a can't-sell message from before the send is not an answer to it", async () => {
        const old = opened.message("You can't sell this item.");
        const { result } = await runOp(old.series(1), ctx => sell(ctx, LOGS, 1), { react: shopWorld });
        expect(result).toMatchObject({ ok: true });
    });

    test('an item the shop does not list, a bad amount and a closed shop fail before any send', async () => {
        const none = await runOp(opened.series(1), ctx => sell(ctx, /gold/i));
        expect(none.result).toEqual({
            ok: false,
            reason: 'item-not-found',
            amountSold: 0,
            message: 'Item not found to sell: /gold/i',
        });
        // Coins are held but the shop pays nothing for them, so they are not in the list.
        expect((await runOp(opened.series(1), ctx => sell(ctx, /coins/i))).result).toMatchObject({
            reason: 'item-not-found',
        });
        for (const amount of [0, -1, 1.5, 1001]) {
            const bad = await runOp(opened.series(1), ctx => sell(ctx, LOGS, amount));
            expect(bad.result).toMatchObject({ reason: 'invalid-amount', amountSold: 0 });
        }
        const closed = await runOp(carrying.series(1), ctx => sell(ctx, LOGS));
        expect(closed.result).toEqual({
            ok: false,
            reason: 'shop-not-open',
            amountSold: 0,
            message: 'Shop is not open',
        });
        expect(none.sends.concat(closed.sends)).toEqual([]);
    });

    test('a refused send is send-failed, counted or all', async () => {
        for (const amount of [1, 'all'] as const) {
            const { result, driver } = await runOp(opened.series(1), ctx => sell(ctx, LOGS, amount), {
                respond: refuse,
            });
            expect(result).toEqual({ ok: false, reason: 'send-failed', amountSold: 0, message: 'not connected' });
            expect(driver.ticksElapsed).toBe(0);
        }
    });
});

describe('withShop', () => {
    test('opens, runs the body with the shop open, then closes and reports the close', async () => {
        const driver = asDriver([idle.build(), opened.tick(1).build()]);
        const r = await interpret(
            withShop(
                driver,
                undefined,
                (function* () {
                    yield* send({ type: 'none', reason: 'body' });
                    return 7;
                })(),
            ),
            { driver },
        );
        expect(r).toEqual({
            kind: 'returned',
            value: { ok: true, value: 7, closed: { ok: true, message: 'Shop closed' } },
        });
        expect(sendsOf(driver)).toEqual(['Trade Shop keeper', 'body', 'close shop']);
    });

    test('a failed open skips the body and returns the failure', async () => {
        const driver = asDriver(world().series(1));
        const body = (function* () {
            yield* send({ type: 'none', reason: 'body' });
        })();
        const r = await interpret(withShop(driver, undefined, body), { driver });
        expect(r).toMatchObject({ kind: 'returned', value: { ok: false, reason: 'npc-not-found' } });
        expect(sendsOf(driver)).toEqual([]);
    });

    test('an abort while the buy is still waiting closes the shop first, then the guard runs', async () => {
        // The buy never lands, so HP drops while its wait is mid-flight: only withShop's finally can
        // close the shop. The guard's work (an eat, here a marker send) must come after the close, as the
        // open shop hides the inventory it would eat from.
        const driver = new TimelineDriver([opened.build(), opened.tick(1).build(), hurt(opened).tick(2).build()], {
            react: ignoresBuys,
        });
        const r = await interpret(withShop(driver, undefined, buy(driver, HAMMER)), { driver, guards: [lowHp] });
        expect(r).toEqual({ kind: 'aborted', by: 'low-hp', outcome: { fail: 'ate' } });
        expect(sendsOf(driver)).toEqual(['buy Hammer', 'close shop', 'eat']);
        expect(driver.state().shop.isOpen).toBe(false);
        expect(countOf(driver.state(), 'Hammer')).toBe(0);
    });

    test('a stop while the buy is still waiting closes the shop too', async () => {
        const driver = new TimelineDriver([opened.build()], { react: ignoresBuys });
        const r = await interpret(withShop(driver, undefined, buy(driver, HAMMER)), {
            driver,
            onTick: s => (s.tick >= 2 ? 'time up' : null),
        });
        expect(r).toEqual({ kind: 'cancelled', reason: 'time up' });
        expect(sendsOf(driver)).toEqual(['buy Hammer', 'close shop']);
        expect(driver.state().shop.isOpen).toBe(false);
    });

    test('cancelled, a first close with no effect is sent again and lands inside the cleanup cap', async () => {
        expect(2 * CLEANUP_CLOSE_WAIT_TICKS + 1).toBeLessThanOrEqual(CLEANUP_TICKS);
        let closes = 0;
        const sentAt: [string, number][] = [];
        const driver: TimelineDriver = new TimelineDriver(
            [opened.build(), opened.tick(1).build(), hurt(opened).tick(2).build()],
            {
                react: (a, s) =>
                    a.type === 'shopBuy' || (a.type === 'closeShop' && ++closes === 1) ? undefined : shopWorld(a, s),
                respond: a => {
                    sentAt.push([a.reason, driver.state().tick]);
                    return undefined;
                },
            },
        );
        const r = await interpret(withShop(driver, undefined, buy(driver, HAMMER)), { driver, guards: [lowHp] });
        expect(r).toMatchObject({ kind: 'aborted', by: 'low-hp' });
        expect(sentAt).toEqual([
            ['buy Hammer', 0],
            ['close shop', 2],
            ['close shop (second attempt)', 2 + CLEANUP_CLOSE_WAIT_TICKS],
            ['eat', 3 + CLEANUP_CLOSE_WAIT_TICKS],
        ]);
        expect(driver.state().shop.isOpen).toBe(false);
        expect(logsOf(driver).filter(m => m.startsWith('cleanup'))).toEqual([]);
    });

    test('cancelled mid-open, a shop that opens late is closed before the guard runs', async () => {
        const states = idle.series(6, (w, i) => (i >= 3 ? hurt(w).shop([]) : i >= 1 ? hurt(w) : w));
        const driver = asDriver(states);
        const r = await interpret(withShop(driver, undefined, buy(driver, HAMMER)), { driver, guards: [lowHp] });
        expect(r).toMatchObject({ kind: 'aborted', by: 'low-hp' });
        expect(sendsOf(driver)).toEqual(['Trade Shop keeper', 'close shop', 'eat']);
        expect(driver.state().shop.isOpen).toBe(false);
    });

    test('cancelled mid-open with no shop showing, one close is still sent', async () => {
        const driver = asDriver([idle.build(), hurt(idle).tick(1).build()]);
        const r = await interpret(withShop(driver, undefined, buy(driver, HAMMER)), { driver, guards: [lowHp] });
        expect(r).toMatchObject({ kind: 'aborted', by: 'low-hp' });
        expect(sendsOf(driver)).toEqual(['Trade Shop keeper', 'close shop (open not confirmed)', 'eat']);
        expect(driver.state().tick).toBe(1 + CLEANUP_CLOSE_WAIT_TICKS);
    });

    test('a body that throws still closes the shop, and the error propagates', async () => {
        const driver = asDriver([opened.build()]);
        const body = (function* () {
            yield* send({ type: 'none', reason: 'body' });
            throw new Error('boom');
        })();
        await expect(interpret(withShop(driver, undefined, body), { driver })).rejects.toThrow('boom');
        expect(sendsOf(driver)).toEqual(['body', 'close shop']);
    });

    test('an open that timed out but landed late is still closed', async () => {
        // The shop shows two ticks after openShop gave up, inside the wait for a late open.
        const late = idle.series(OPEN_SHOP_WAIT_TICKS + 3, (w, i) => (i > OPEN_SHOP_WAIT_TICKS + 1 ? w.shop([]) : w));
        const driver = asDriver(late);
        const r = await interpret(withShop(driver, undefined, (function* () {})()), { driver });
        expect(r).toMatchObject({ kind: 'returned', value: { ok: false, reason: 'timeout' } });
        expect(sendsOf(driver)).toEqual(['Trade Shop keeper', 'close shop']);
        expect(driver.state().shop.isOpen).toBe(false);
    });
});
