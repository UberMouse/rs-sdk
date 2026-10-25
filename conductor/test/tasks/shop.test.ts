import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { CLEANUP_CLOSE_WAIT_TICKS } from '../../actions/modal';
import { CLOSE_SHOP_WAIT_TICKS, OPEN_SHOP_WAIT_TICKS } from '../../actions/shop';
import { walkBudgetTicks } from '../../actions/walk';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { DEFAULT_STUCK_AFTER_MS } from '../../lib/engine';
import { TICK_MS } from '../../lib/util';
import shop from '../../tasks/shop';
import { door, fakePaths, noCrossings } from '../paths';
import { shopReact, walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const KEEPER = { x: 3212, z: 3247 };
const OPEN = 'Trade Shop keeper';
const CLOSE = 'close shop';
/** The close withShop sends after an open that timed out, in case it lands late. */
const CLOSE_UNCONFIRMED = 'close shop (open not confirmed)';
const LINES = [
    { name: 'Hammer', count: 5, buyPrice: 2 },
    { name: 'Tinderbox', count: 0, buyPrice: 1 },
    { name: 'Pot', count: 40, buyPrice: 1 },
];
const PAYS = { logs: 4, shrimps: 1 };
const react = shopReact(LINES, PAYS);
const standing = world()
    .player({ at: KEEPER })
    .npc('Shop keeper', KEEPER.x, KEEPER.z + 1, { index: 4, options: ['Talk-to', 'Trade'] });
const carrying = standing.inv('Coins', 100).inv('Logs', 3).inv('Shrimps', 1);
const NPC = { npc: 'Shop keeper' };
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
/** A shop that opens but whose items never move. */
const opensOnly: TimelineOptions['react'] = (action, state) =>
    action.type === 'interactNpc' || action.type === 'closeShop' ? react(action, state) : undefined;
/** A shop that opens and trades but ignores every close. */
const staysOpen: TimelineOptions['react'] = (action, state) =>
    action.type === 'closeShop' || action.type === 'closeModal' ? undefined : react(action, state);
/**
 * The shop opens on tick 1 and a packet sent then lands on tick 2, the tick HP drops: the low-HP guard
 * cancels the op's wait before it sees the items move, so the op never reports them.
 */
const hurtOnLanding = (w: World) => w.series(60, (x, i) => x.player({ hp: i >= 2 && i < 4 ? 3 : 10 }));
const sentAs = (r: Simulation, reason: string) =>
    r.commands.flatMap(c => (c.type === 'send' && c.action.reason === reason ? [c.action] : []));
const refusal = async (params: unknown, w: World = carrying) =>
    (await simulate(shop, { params, timeline: w.series(1) })).result;
/** A message the server answers a sell with, arriving from tick 2 on. */
const answers = (w: World, text: string) => w.series(60, (x, i) => (i >= 2 ? x.message(text) : x));

describe('shop: the trip', () => {
    test('opens the shop, sells, buys, closes, and is done reporting the coins', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs' }], buy: [{ item: 'Hammer', count: 2 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: all 2 trades made; coins received 12, spent 4');
        // Sell-all moves one slot a packet (each unstackable log is a slot), buys go 1, 1 for a count of 2.
        expect(r.sends).toEqual([OPEN, ...Array(3).fill('sell Logs'), ...Array(2).fill('buy Hammer'), CLOSE]);
        expect(r.steps).toEqual(['trade', 'finish']);
        expect(r.result.inventoryDelta).toEqual({ Logs: -3, Hammer: 2, Coins: 8 });
        expect(logged(r)).toEqual([
            'sold Logs: Sold Logs x3; coins +12',
            'bought Hammer: Bought Hammer x2; coins 112 -> 108',
        ]);
    });

    test('a count sells only that many', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 1 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.reason).toBe('finish: all 1 trades made; coins received 4, spent 0');
        expect(r.result.inventoryDelta).toEqual({ Logs: -1, Coins: 4 });
    });

    test('a buy-only run needs no selling', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Pot', count: 12 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.reason).toBe('finish: all 1 trades made; coins received 0, spent 12');
        expect(sentAs(r, 'buy Pot')).toMatchObject([{ amount: 10 }, { amount: 1 }, { amount: 1 }]);
    });

    test('a price within the guard goes through', async () => {
        const r = await simulate(shop, {
            params: {
                ...NPC,
                sell: [{ item: 'Logs', minUnitPrice: 4 }],
                buy: [{ item: 'Hammer', count: 1, maxUnitPrice: 2 }],
            },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
    });

    test('a shop left open before the run is closed at its start, and never traded with', async () => {
        const open = carrying.shop(LINES, PAYS, 'Aubury');
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: open.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
        // The engine's run-start close (its closeModal reads "close shop" too), not the task's own.
        expect(r.steps).toEqual(['close-leftover', 'trade', 'finish']);
        expect(r.sends).toEqual([CLOSE, OPEN, 'buy Hammer', CLOSE]);
    });

    test('a shop that will not close three times in a row fails the run', async () => {
        const open = carrying.shop(LINES, PAYS);
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: open.series(1),
            react: staysOpen,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'close-stale-shop: cannot close a shop left open: Shop close timeout - shop.isOpen=true, interface.isOpen=true',
        );
        // The engine's two run-start closes, then the task's three, each a close and a second attempt.
        const twice = [CLOSE, `${CLOSE} (second attempt)`];
        expect(r.sends).toEqual([...twice, ...twice, ...twice, ...twice]);
    });

    test('far from the shop it walks there first, then trades', async () => {
        const away = carrying.player({ at: { x: KEEPER.x, z: KEEPER.z + 40 } });
        const r = await simulate(shop, {
            params: { ...NPC, at: KEEPER, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: away.series(1),
            react: walking(react),
            // The test's open ground, not the farm fences and stile the world index has between here and the shop.
            walkWorld: noCrossings(),
        });
        expect(r.sends).toEqual([`walk to (${KEEPER.x}, ${KEEPER.z})`, OPEN, 'buy Hammer', CLOSE]);
        expect(r.steps).toEqual(['walk-to-shop', 'trade', 'finish']);
        expect(r.result.status).toBe('done');
    });

    test('within reach of the shop it does not walk', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, at: KEEPER, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.steps).toEqual(['trade', 'finish']);
    });

    test('three failed walks in a row fail the run', async () => {
        const away = carrying.player({ at: { x: KEEPER.x, z: KEEPER.z + 40 } });
        const r = await simulate(shop, {
            params: { ...NPC, at: KEEPER, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: away.series(1),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
            walkWorld: noCrossings(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            `walk-to-shop: cannot walk to shop (3212,3247): No path to (3212, 3247) from (3212, ${KEEPER.z + 40}): blocked`,
        );
        expect(r.sends).toEqual([]);
    });

    test('a far shop takes several walks: each that ran out of ticks nearer the shop is not a failure', async () => {
        // 1500 tiles east, running 2 a tick: each walk's 200 ticks cover 400 tiles, so three run out
        // (FAIL_LIMIT) and the fourth arrives.
        const away = carrying.player({ at: { x: KEEPER.x + 1500, z: KEEPER.z } });
        const r = await simulate(shop, {
            params: { ...NPC, at: KEEPER, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: away.series(1),
            react: walking(react),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns['walk-to-shop']).toBe(4);
        expect(logged(r).filter(m => String(m).startsWith('walk to shop'))).toEqual(
            [4312, 3912, 3512].map(
                x =>
                    `walk to shop (3212,3247) not there yet: Walk to (3212, 3247) ran out of its 200 ticks at (${x}, 3247)`,
            ),
        );
    });

    test('three walks that run out of ticks where they started fail the run with the last walk message', async () => {
        // A door between the bot and the shop that never opens, and a bot that cannot move.
        const from = { x: KEEPER.x, z: KEEPER.z - 15 };
        const shut = door(from.x, from.z + 5);
        const paths = fakePaths(
            () => ({
                success: true,
                reachedDestination: true,
                waypoints: [
                    { ...shut, level: 0 },
                    { ...KEEPER, level: 0 },
                ],
            }),
            [shut],
        );
        const behindDoor = carrying.player({ at: from }).loc('Door', shut.x, shut.z, { options: ['Open'] });
        // The watchdog's 90 s is shorter than three walks standing still: out of the way.
        const r = await simulate(
            { ...shop, stuckAfterMs: 10 * DEFAULT_STUCK_AFTER_MS },
            {
                params: { ...NPC, at: KEEPER, buy: [{ item: 'Hammer', count: 1 }] },
                timeline: behindDoor.series(1),
                pathfinder: paths,
                react: walking(react, () => true),
            },
        );
        const budget = walkBudgetTicks(15);
        const message = `Walk to (3212, 3247) ran out of its ${budget} ticks at (${from.x}, ${from.z})`;
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`walk-to-shop: cannot walk to shop (3212,3247): ${message}`);
        expect(logged(r).filter(m => String(m).startsWith('walk to shop'))).toEqual(
            Array.from({ length: 3 }, () => `walk to shop (3212,3247) failed: ${message}`),
        );
    });
});

describe('shop: failures', () => {
    test('no shopkeeper in view fails after three opens in a row, nothing sent', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: world().inv('Coins', 5).series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'trade: cannot open shop via "Shop keeper": Shopkeeper not found: /^Shop keeper$/i',
        );
        expect(logged(r)).toHaveLength(3);
        expect(r.sends).toEqual([]);
    });

    test('two same-named NPCs, only the farther one trades: it is opened', async () => {
        const dwarves = world()
            .player({ at: KEEPER })
            .inv('Coins', 5)
            .npc('Shop keeper', KEEPER.x, KEEPER.z + 1, { index: 3, options: ['Talk-to'] })
            .npc('Shop keeper', KEEPER.x, KEEPER.z + 3, { index: 4, options: ['Talk-to', 'Trade'] });
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: dwarves.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(
            r.commands.flatMap(c => (c.type === 'send' && c.action.type === 'interactNpc' ? [c.action.npcIndex] : [])),
        ).toEqual([4]);
    });

    test('same-named NPCs none of which trade fail clearly with no-trade-option', async () => {
        const w = world()
            .player({ at: KEEPER })
            .inv('Coins', 5)
            .npc('Shop keeper', KEEPER.x, KEEPER.z + 1, { index: 3, options: ['Talk-to'] })
            .npc('Shop keeper', KEEPER.x, KEEPER.z + 3, { index: 4, options: ['Talk-to'] });
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: w.series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('trade: cannot open shop via "Shop keeper": No trade option on NPC');
        expect(r.sends).toEqual([]);
    });

    test('three opens that time out fail the run before the watchdog', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: carrying.series(1),
        });
        expect(r.result.reason).toBe('trade: cannot open shop via "Shop keeper": Timed out waiting for shop to open');
        // Each timed-out open waits a while for a late open, then sends a close anyway.
        expect(r.sends).toEqual([OPEN, CLOSE_UNCONFIRMED, OPEN, CLOSE_UNCONFIRMED, OPEN, CLOSE_UNCONFIRMED]);
        const ticks = r.driver.state().tick;
        expect(ticks).toBe(3 * (OPEN_SHOP_WAIT_TICKS + CLEANUP_CLOSE_WAIT_TICKS));
        expect(ticks * TICK_MS).toBeLessThan(shop.stuckAfterMs ?? 0);
    });

    test('an open that fails twice and then goes through does not fail the run', async () => {
        let opens = 0;
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: carrying.series(1),
            react,
            respond: a =>
                a.reason === OPEN && ++opens <= 2 ? { success: false, message: 'not connected' } : undefined,
        });
        expect(r.result.status).toBe('done');
        expect(logged(r).slice(0, 2)).toEqual([
            'open shop failed (send-failed): not connected',
            'open shop failed (send-failed): not connected',
        ]);
    });

    test('a shop that does not buy the item fails the run naming the coins received so far, shop closed', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs' }] },
            timeline: answers(carrying, "You can't sell this item to this shop."),
            react: opensOnly,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            "trade: sell Logs failed (rejected): Shop doesn't buy Logs; coins received so far 0",
        );
        expect(r.sends).toEqual([OPEN, 'sell Logs', CLOSE]);
    });

    test('a sale that does not land fails the run', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs' }] },
            timeline: carrying.series(1),
            react: opensOnly,
        });
        expect(r.result.reason).toBe(
            'trade: sell Logs failed (timeout): Failed to sell Logs (timeout); coins received so far 0',
        );
    });

    test('coins received before a failing sale are reported', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 1 }, { item: 'Shrimps' }] },
            timeline: carrying.series(1),
            // The shop buys the logs, then answers the shrimps with a refusal.
            react: (a, s) =>
                a.type === 'shopSell' && a.reason === 'sell Shrimps'
                    ? t => world(t).message("You can't sell this item to this shop.").build()
                    : react(a, s),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            "trade: sell Shrimps failed (rejected): Shop doesn't buy Shrimps; coins received so far 4",
        );
    });

    test('a purchase that does not land fails the run with the coins left', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 2 }] },
            timeline: carrying.series(1),
            react: opensOnly,
        });
        expect(r.result.reason).toBe(
            'trade: buy Hammer x2 failed (timeout, got 0): Failed to buy Hammer (no coins, out of stock, or full inventory?); 100 coins left',
        );
        expect(r.sends).toEqual([OPEN, 'buy Hammer', CLOSE]);
    });

    test('an item out of stock, one not stocked, and a short fill each fail the run', async () => {
        const out = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Tinderbox', count: 1 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(out.result.reason).toBe(
            'trade: buy Tinderbox x1 failed (out-of-stock, got 0): Tinderbox is out of stock; 100 coins left',
        );
        const missing = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Gold', count: 1 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(missing.result.reason).toBe(
            'trade: buy Gold x1 failed (item-not-found, got 0): Item not found in shop: /^Gold$/i; 100 coins left',
        );
        const short = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 8 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(short.result.reason).toBe(
            'trade: buy Hammer x8 failed (partial-fill, got 5): Bought Hammer x5 of 8 requested; 90 coins left',
        );
        expect(short.sends.at(-1)).toBe(CLOSE);
    });

    test('a shop that will not close once the trades are made fails the run', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: carrying.series(1),
            react: staysOpen,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'trade: cannot close the shop after trading: Shop close timeout - shop.isOpen=true, interface.isOpen=true',
        );
        expect(r.driver.state().tick).toBeLessThan(60 + CLOSE_SHOP_WAIT_TICKS);
    });
});

describe('shop: price checks', () => {
    test('a sell price below minUnitPrice fails before any sale, shop closed', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', minUnitPrice: 5 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.reason).toBe('trade: shop pays 4 gp each for Logs, below minUnitPrice 5');
        expect(r.sends).toEqual([OPEN, CLOSE]);
    });

    test('a sell the shop does not quote cannot be checked', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Shrimps', minUnitPrice: 1 }] },
            timeline: carrying.series(1),
            react: shopReact(LINES, {}),
        });
        expect(r.result.reason).toBe('trade: shop does not quote Shrimps, cannot check minUnitPrice 1');
    });

    test('a buy price above maxUnitPrice fails, and an item not stocked cannot be checked', async () => {
        const dear = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1, maxUnitPrice: 1 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(dear.result.reason).toBe('trade: shop asks 2 gp each for Hammer, above maxUnitPrice 1');
        expect(dear.sends).toEqual([OPEN, CLOSE]);
        const missing = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Gold', count: 1, maxUnitPrice: 9 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(missing.result.reason).toBe('trade: shop does not stock Gold, cannot check maxUnitPrice 9');
    });
});

describe('shop: preflight', () => {
    test('refuses a task with nothing to do', async () => {
        const r = await refusal(NPC);
        expect(r.status).toBe('failed');
        expect(r.reason).toBe('preflight: nothing to sell or buy');
    });

    test('refuses a shop in the Wilderness', async () => {
        const r = await refusal({ ...NPC, at: { x: 3185, z: 3600 }, buy: [{ item: 'Hammer', count: 1 }] });
        expect(r.reason).toBe('preflight: shop location (3185,3600) is in the Wilderness');
    });

    test('refuses a purchase with no coins and nothing to sell', async () => {
        const r = await refusal({ ...NPC, buy: [{ item: 'Hammer', count: 1 }] }, standing);
        expect(r.reason).toBe('preflight: cannot buy: no coins in inventory');
    });

    test('refuses a sale of an item not carried', async () => {
        const r = await refusal({ ...NPC, sell: [{ item: 'Bones' }] });
        expect(r.reason).toBe('preflight: cannot sell Bones: not in inventory');
    });

    test('refuses an item listed twice when one entry means all', async () => {
        const r = await refusal({ ...NPC, sell: [{ item: 'Logs', count: 1 }, { item: 'logs' }] });
        expect(r.reason).toBe('preflight: cannot sell logs: listed more than once and an entry has no count (all)');
    });

    test('refuses sales that add up to more than carried', async () => {
        const r = await refusal({
            ...NPC,
            sell: [
                { item: 'Logs', count: 2 },
                { item: 'Logs', count: 2 },
            ],
        });
        expect(r.reason).toBe('preflight: cannot sell 4 Logs: only 3 in inventory');
    });
});

describe('shop: guards', () => {
    test('low HP mid-trade closes the shop before eating, then the trip resumes where it stopped', async () => {
        // The shop must be closed by the time the guard eats, as the open shop hides the food.
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 2 }], buy: [{ item: 'Hammer', count: 1 }] },
            timeline: carrying.series(60, (w, i) => w.player({ hp: i >= 3 && i < 5 ? 3 : 10 })),
            react,
        });
        expect(r.result.status).toBe('done');
        const eat = r.sends.indexOf('Eat Shrimps');
        expect(r.sends.slice(0, eat).at(-1)).toBe(CLOSE);
        expect(r.sends.slice(eat)[1]).toBe(OPEN);
        expect(r.result.stepRuns).toMatchObject({ trade: 2, 'interrupt:low-hp': 1, finish: 1 });
    });

    test('a level-up dialog mid-trade is cleared and the trip carries on', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs' }] },
            timeline: carrying.series(30, (w, i) =>
                i >= 2 && i < 4 ? w.dialog({ options: ['Click here to continue'] }) : w,
            ),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toContain('continue dialog');
        expect(r.sends.at(-1)).toBe(CLOSE);
        expect(r.result.stepRuns).toEqual({ trade: 1, 'interrupt:dialog': 1, finish: 1 });
    });
});

describe('shop: an abort on the tick the packet lands resumes without repeating it', () => {
    const RESUMED = [OPEN, CLOSE, 'Eat Shrimps', OPEN, CLOSE];

    test('a counted sale is not made again, and the coins are right', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 1 }] },
            timeline: hurtOnLanding(carrying),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(RESUMED.toSpliced(1, 0, 'sell Logs'));
        expect(r.result.reason).toBe('finish: all 1 trades made; coins received 4, spent 0');
        expect(logged(r)).toContain('sell Logs: 1 already sold before the step was cut off');
    });

    test('a sale of all that partly landed sells only the rest, and counts all the coins', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs' }] },
            timeline: hurtOnLanding(carrying),
            react,
        });
        expect(r.result.status).toBe('done');
        // One log left on the tick before the abort; the other two went in the resumed run.
        expect(sentAs(r, 'sell Logs')).toHaveLength(3);
        expect(r.result.inventoryDelta).toEqual({ Logs: -3, Shrimps: -1, Coins: 12 });
        expect(r.result.reason).toBe('finish: all 1 trades made; coins received 12, spent 0');
    });

    test('a counted sale that partly landed asks only for the rest', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 3 }] },
            timeline: hurtOnLanding(carrying),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(sentAs(r, 'sell Logs')).toHaveLength(3);
        expect(r.result.reason).toBe('finish: all 1 trades made; coins received 12, spent 0');
    });

    test('a purchase is not made again, and the coins spent are right', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] },
            timeline: hurtOnLanding(carrying),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(RESUMED.toSpliced(1, 0, 'buy Hammer'));
        expect(r.result.reason).toBe('finish: all 1 trades made; coins received 0, spent 2');
        expect(r.result.inventoryDelta).toEqual({ Hammer: 1, Shrimps: -1, Coins: -2 });
        expect(logged(r)).toContain('buy Hammer: 1 already bought before the step was cut off');
    });

    test('a resumed trade is not price-checked again against the prices its own packets moved', async () => {
        let opens = 0;
        // The shop pays 4 for logs when first opened and 1 after: a re-check against minUnitPrice 4 would refuse.
        const dearer: TimelineOptions['react'] = (a, s) =>
            a.type === 'interactNpc' ? shopReact(LINES, { logs: ++opens === 1 ? 4 : 1 })(a, s) : react(a, s);
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 3, minUnitPrice: 4 }] },
            timeline: hurtOnLanding(carrying),
            react: dearer,
        });
        expect(r.result.status).toBe('done');
        expect(opens).toBe(2);
    });
});

describe('shop: the shop closing between trades', () => {
    test('a shop that is gone when the next trade starts is reopened and the run resumes', async () => {
        // The first purchase lands on the tick the shop closes under the bot, so the second trade finds it shut.
        let buys = 0;
        const closesAfterFirstBuy: TimelineOptions['react'] = (a: BotAction, s) => {
            const effect = react(a, s);
            if (a.type !== 'shopBuy' || !effect || ++buys > 1) return effect;
            return t => {
                const bought = effect(t);
                return bought === t ? t : world(bought).shop(false).build();
            };
        };
        const r = await simulate(shop, {
            params: {
                ...NPC,
                buy: [
                    { item: 'Hammer', count: 1 },
                    { item: 'Pot', count: 1 },
                ],
            },
            timeline: carrying.series(60),
            react: closesAfterFirstBuy,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([OPEN, 'buy Hammer', OPEN, 'buy Pot', CLOSE]);
        expect(r.result.stepRuns).toEqual({ trade: 2, finish: 1 });
        expect(r.result.reason).toBe('finish: all 2 trades made; coins received 0, spent 3');
    });
});

/**
 * The shop closes under the bot with its first sale in flight; `lands` says whether that sale went
 * through as it closed. Later opens (queued after this) show the shop again.
 */
const closesOnFirstSale = (lands: boolean): TimelineOptions['react'] => {
    let sales = 0;
    return (a, s) => {
        const effect = react(a, s);
        if (a.type !== 'shopSell' || ++sales > 1) return effect;
        return t =>
            world(lands && effect ? effect(t) : t)
                .shop(false)
                .build();
    };
};

describe('shop: the shop closing mid-sale', () => {
    // A closed shop lists no inventory, which once read as every unit sold: the run was done with logs unsold.
    for (const lands of [true, false]) {
        const what = lands ? 'that went through' : 'that did not land';
        test(`a counted sale cut off by a close ${what} is not done: the reopened shop gets the rest`, async () => {
            const r = await simulate(shop, {
                params: { ...NPC, sell: [{ item: 'Logs', count: 3 }] },
                timeline: carrying.series(1),
                react: closesOnFirstSale(lands),
            });
            expect(r.result.status).toBe('done');
            expect(r.result.reason).toBe('finish: all 1 trades made; coins received 12, spent 0');
            expect(r.result.inventoryDelta).toEqual({ Logs: -3, Coins: 12 });
            expect(r.sends).toEqual([OPEN, 'sell Logs', OPEN, ...Array(lands ? 2 : 3).fill('sell Logs'), CLOSE]);
            expect(r.result.stepRuns).toEqual({ trade: 2, finish: 1 });
        });

        test(`a sale of all cut off by a close ${what} is not done: the reopened shop gets the rest`, async () => {
            const r = await simulate(shop, {
                params: { ...NPC, sell: [{ item: 'Logs' }] },
                timeline: carrying.series(1),
                react: closesOnFirstSale(lands),
            });
            expect(r.result.status).toBe('done');
            expect(r.result.inventoryDelta).toEqual({ Logs: -3, Coins: 12 });
            expect(sentAs(r, 'sell Logs')).toHaveLength(lands ? 3 : 4);
        });
    }
});

/** The task's logs of its walks to the shopkeeper. */
const walkLogs = (r: Simulation) => logged(r).filter(m => String(m).startsWith('walk to Shop keeper'));

describe('shop: a shopkeeper out of reach', () => {
    const noRoute = { success: false, message: 'no route', reason: 'cant_reach' };
    const WALK = `walk to (${KEEPER.x}, ${KEEPER.z + 1})`;
    /** Five tiles from the shopkeeper; the first `refusals` opens find no route. */
    const unreachable = (refusals: number) => {
        let opens = 0;
        return new TimelineDriver(carrying.player({ at: { x: KEEPER.x, z: KEEPER.z - 4 } }).series(1), {
            react: walking(react),
            respond: a => (a.reason === OPEN && ++opens <= refusals ? noRoute : undefined),
        });
    };

    test('an open that cannot reach the shopkeeper walks to it, then opens again', async () => {
        const driver = unreachable(1);
        const r = await simulate(shop, { params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] }, driver });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([OPEN, WALK, OPEN, 'buy Hammer', CLOSE]);
        expect(logged(r).slice(0, 2)).toEqual([
            'open shop failed (cant-reach): no route',
            'walk to Shop keeper (3212,3248) to open the shop: Arrived',
        ]);
    });

    test('the walk goes to the same-named NPC that trades, not a nearer one that does not', async () => {
        let opens = 0;
        const w = carrying
            .player({ at: { x: KEEPER.x, z: KEEPER.z - 4 } })
            .npc('Shop keeper', KEEPER.x, KEEPER.z - 3, { index: 3, options: ['Talk-to'] });
        const driver = new TimelineDriver(w.series(1), {
            react: walking(react),
            respond: a => (a.reason === OPEN && ++opens <= 1 ? noRoute : undefined),
        });
        const r = await simulate(shop, { params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] }, driver });
        expect(r.result.status).toBe('done');
        expect(walkLogs(r)[0]).toBe('walk to Shop keeper (3212,3248) to open the shop: Arrived');
        expect(r.sends[1]).toBe(WALK);
    });

    test('the walk goes to a reachable same-named trader, not a nearer unreachable one', async () => {
        let opens = 0;
        const w = carrying
            .player({ at: { x: KEEPER.x, z: KEEPER.z - 4 } })
            .npc('Shop keeper', KEEPER.x, KEEPER.z - 3, { index: 3, options: ['Talk-to', 'Trade'], reachable: false });
        const driver = new TimelineDriver(w.series(1), {
            react: walking(react),
            respond: a => (a.reason === OPEN && ++opens <= 1 ? noRoute : undefined),
        });
        const r = await simulate(shop, { params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] }, driver });
        expect(r.sends[1]).toBe(WALK);
        expect(walkLogs(r)[0]).toBe('walk to Shop keeper (3212,3248) to open the shop: Arrived');
    });

    test('three opens that cannot reach it fail the run, with a walk after each of the first two', async () => {
        const driver = unreachable(3);
        const r = await simulate(shop, { params: { ...NPC, buy: [{ item: 'Hammer', count: 1 }] }, driver });
        expect(r.result.reason).toBe('trade: cannot open shop via "Shop keeper": no route');
        // The second walk starts within reach of the first: nothing to send.
        expect(walkLogs(r)).toEqual([
            'walk to Shop keeper (3212,3248) to open the shop: Arrived',
            'walk to Shop keeper (3212,3248) to open the shop: Already at destination',
        ]);
        expect(r.sends).toEqual([OPEN, WALK, OPEN, OPEN]);
    });
});

describe('shop: a price check on a resume', () => {
    test('a trade cut off before its first packet landed is checked at the price the shop quotes now', async () => {
        let opens = 0;
        let sales = 0;
        // The first sale never lands; the shop pays 4 for logs when first opened and 1 after.
        const cheaper: TimelineOptions['react'] = (a, s) => {
            if (a.type === 'interactNpc') return shopReact(LINES, { ...PAYS, logs: ++opens === 1 ? 4 : 1 })(a, s);
            if (a.type === 'shopSell' && ++sales === 1) return undefined;
            return react(a, s);
        };
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 3, minUnitPrice: 4 }] },
            timeline: hurtOnLanding(carrying),
            react: cheaper,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('trade: shop pays 1 gp each for Logs, below minUnitPrice 4');
        expect(r.sends).toEqual([OPEN, 'sell Logs', CLOSE, 'Eat Shrimps', OPEN, CLOSE]);
        expect(r.result.inventoryDelta).toEqual({ Shrimps: -1 });
    });
});

/** Each sale whose number (from 1) is in `cut` closes the shop under the bot without landing; the rest go through. */
const closesOnSales = (cut: number[]): TimelineOptions['react'] => {
    let sales = 0;
    return (a, s) => (a.type === 'shopSell' && cut.includes(++sales) ? t => world(t).shop(false).build() : react(a, s));
};

describe('shop: trades cut off', () => {
    test('a trade cut off by the shop closing three times in a row fails the run', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 3 }] },
            timeline: carrying.series(1),
            react: closesOnSales([1, 2, 3]),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'trade: sell Logs cut off 3 times in a row; last: shop-not-open: Shop closed with Logs x0 of 3 sold',
        );
        expect(r.sends).toEqual([OPEN, 'sell Logs', OPEN, 'sell Logs', OPEN, 'sell Logs']);
    });

    test('a trade made in between starts the count again', async () => {
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs', count: 1 }, { item: 'Shrimps' }] },
            timeline: carrying.series(1),
            react: closesOnSales([1, 2, 4, 5]),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: all 2 trades made; coins received 5, spent 0');
        expect(sentAs(r, 'sell Logs')).toHaveLength(3);
        expect(sentAs(r, 'sell Shrimps')).toHaveLength(3);
    });

    test('a sale the inventory does not show is not made: the step runs again and sells what is held', async () => {
        let sales = 0;
        // The first sale empties the shop's list of the logs, but no log leaves the inventory.
        const unseen: TimelineOptions['react'] = (a, s) =>
            a.type === 'shopSell' && ++sales === 1
                ? t => ({ ...t, shop: { ...t.shop, playerItems: t.shop.playerItems.filter(i => i.name !== 'Logs') } })
                : react(a, s);
        const r = await simulate(shop, {
            params: { ...NPC, sell: [{ item: 'Logs' }] },
            timeline: carrying.series(1),
            react: unseen,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([OPEN, 'sell Logs', CLOSE, OPEN, ...Array(3).fill('sell Logs'), CLOSE]);
        expect(r.result.inventoryDelta).toEqual({ Logs: -3, Coins: 12 });
        expect(logged(r)).toContain('sold Logs: Sold Logs x3; coins +0');
        expect(r.result.stepRuns).toEqual({ trade: 2, finish: 1 });
    });
});

describe('shop: a long trip', () => {
    test('trades that outlast the step budget finish over several runs of the step, none overrunning', async () => {
        const stock = [{ name: 'Air rune', count: 1000, buyPrice: 0 }];
        const opens = shopReact(stock);
        // Each Buy-10 lands 11 ticks after it is sent, inside the op's wait: a trade of 100 takes ~110 ticks.
        const slow: TimelineOptions['react'] = (a, s) => {
            const effect = opens(a, s);
            if (a.type !== 'shopBuy' || !effect) return effect;
            let waited = 0;
            return t => (++waited <= 10 ? { ...t } : effect(t));
        };
        const r = await simulate(shop, {
            params: { ...NPC, buy: Array.from({ length: 8 }, () => ({ item: 'Air rune', count: 100 })) },
            timeline: carrying.series(1),
            react: slow,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.inventoryDelta).toEqual({ 'Air rune': 800 });
        // One run of the step could not have held the trip: it took longer than the step's budget.
        expect(r.driver.state().tick).toBeGreaterThan(Math.ceil((shop.stepTimeoutMs ?? 0) / TICK_MS));
        expect(r.result.stepRuns).toEqual({ trade: 2, finish: 1 });
        expect(logged(r)).toContain('4 trades made; the step runs again for the rest');
        // About 900 scripted ticks under ~80 effect overlays: ~1.5 s, which a loaded machine can push past bun's 5 s.
    }, 20_000);
});
