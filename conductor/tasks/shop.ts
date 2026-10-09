import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { buy, closeShop, sell, withShop } from '../actions/shop';
import { call, log, type Op } from '../core/op';
import { isInWilderness } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { countItems, exactName } from '../lib/util';

const COINS = /^coins$/i;
const WALK_TOLERANCE = 3;
/** Farther than this from `at` and the shopkeeper is probably not loaded or reachable. */
const AT_REACH = 8;
/**
 * Consecutive failures of a kind (walks, stale closes, opens, mid-trade closes) before the task fails.
 * Three timed-out opens, each with withShop's wait for a late open, are about 35 s of nothing changing,
 * inside the engine's default stuck window (90 s), so the failure is reported instead of the watchdog.
 */
const FAIL_LIMIT = 3;
/** Walks to a far shop outlast the engine's default step timeout. */
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    /** Exact shopkeeper name (case-insensitive, not a regex): "Shop keeper", "Bob". */
    npc: z.string().min(1),
    /** Walk here first (the shop's coordinates). Omit when already standing in the shop. */
    at: z.object({ x: z.number(), z: z.number() }).optional(),
    /** Inventory items to sell, by exact name. Omit `count` to sell all of that item. `minUnitPrice` checks the shop's current (opening) unit price and fails the run if it is lower or the item is not quoted; prices shift with stock over a multi-unit trade. */
    sell: z
        .array(
            z.object({
                item: z.string().min(1),
                count: z.number().int().positive().optional(),
                minUnitPrice: z.number().int().nonnegative().optional(),
            }),
        )
        .default([]),
    /** Shop items to buy, by exact name. `maxUnitPrice` checks the shop's current (opening) unit price and fails the run if it is higher or the item is not stocked; prices shift with stock over a multi-unit trade. */
    buy: z
        .array(
            z.object({
                item: z.string().min(1),
                count: z.number().int().positive(),
                maxUnitPrice: z.number().int().nonnegative().optional(),
            }),
        )
        .default([]),
});

type ShopParams = z.infer<typeof Params>;
interface ShopMemory {
    /** How many of the task's trades (see `tradesOf`) have gone through, in order. */
    tradesMade: number;
    /** Coins gained by selling and lost to buying over the finished trades. */
    coinsReceived: number;
    coinsSpent: number;
    /**
     * The trade under way: its index, and the coins and the item's count the inventory held before its
     * first send. An abort can land after packets did, so a resumed step counts what moved since then and
     * trades only the rest, and settles the coins against the same start.
     *
     * The baseline is the inventory count, so it is approximate when a guard's eat consumes the very item
     * being traded between the abort and the resume: a sale looks that much further along and
     * under-delivers by the eaten amount; a purchase of food looks that much less along and over-buys by
     * it (the inventory still ends at the requested count). Neither exceeds the trade's amount.
     */
    inFlight: { tradeIndex: number; coins: number; held: number } | null;
}
type Ctx = TaskContext<ShopParams, ShopMemory>;
type SellTrade = { kind: 'sell' } & ShopParams['sell'][number];
type BuyTrade = { kind: 'buy' } & ShopParams['buy'][number];
type Trade = SellTrade | BuyTrade;
/** How the trades in the shop ended, if they did not all go through. */
type Ending = { kind: 'fail'; message: string } | { kind: 'closed'; what: string; message: string };

/** Sells first, then buys, so a run funds its own purchases. */
const tradesOf = (params: ShopParams): Trade[] => [
    ...params.sell.map(t => ({ kind: 'sell' as const, ...t })),
    ...params.buy.map(t => ({ kind: 'buy' as const, ...t })),
];

/** The next trade to make, or undefined when all are made. */
const nextTrade = (ctx: Ctx): Trade | undefined => tradesOf(ctx.params)[ctx.memory.tradesMade];

/** The reason the shop's current (opening) price rules the trade out, or null. */
function priceRefusal(state: BotWorldState, t: Trade): string | null {
    const pattern = exactName(t.item);
    if (t.kind === 'sell') {
        if (t.minUnitPrice === undefined) return null;
        const quoted = state.shop.playerItems.find(i => pattern.test(i.name));
        if (!quoted) return `shop does not quote ${t.item}, cannot check minUnitPrice ${t.minUnitPrice}`;
        if (quoted.sellPrice < t.minUnitPrice)
            return `shop pays ${quoted.sellPrice} gp each for ${t.item}, below minUnitPrice ${t.minUnitPrice}`;
        return null;
    }
    if (t.maxUnitPrice === undefined) return null;
    const quoted = state.shop.shopItems.find(i => pattern.test(i.name));
    if (!quoted) return `shop does not stock ${t.item}, cannot check maxUnitPrice ${t.maxUnitPrice}`;
    if (quoted.buyPrice > t.maxUnitPrice)
        return `shop asks ${quoted.buyPrice} gp each for ${t.item}, above maxUnitPrice ${t.maxUnitPrice}`;
    return null;
}

/** Makes the next trade with the shop open; null when it went through. */
function* performTrade(ctx: Ctx, t: Trade): Op<Ending | null> {
    const pattern = exactName(t.item);
    const at = ctx.memory.tradesMade;
    const resumed = ctx.memory.inFlight?.tradeIndex === at ? ctx.memory.inFlight : null;
    let start: NonNullable<ShopMemory['inFlight']>;
    if (resumed) {
        start = resumed;
    } else {
        // Only a trade's first run checks the price: after packets landed the shop's prices have moved.
        const refusal = priceRefusal(ctx.state(), t);
        if (refusal) return { kind: 'fail', message: refusal };
        start = { tradeIndex: at, coins: countItems(ctx.state(), COINS), held: countItems(ctx.state(), pattern) };
        ctx.memory.inFlight = start;
    }
    const held = countItems(ctx.state(), pattern);
    const moved = Math.max(0, t.kind === 'sell' ? start.held - held : held - start.held);

    // A resumed trade whose packets all landed is done; otherwise only the rest is asked for.
    const remaining = t.kind === 'sell' && t.count === undefined ? 'all' : (t.count ?? 0) - moved;
    const landed = resumed !== null && (remaining === 'all' ? held === 0 : remaining <= 0);
    let failure: { reason: string; message: string; got: number } | null = null;
    if (landed) {
        const verb = t.kind === 'sell' ? 'sold' : 'bought';
        yield* log(`${t.kind} ${t.item}: ${moved} already ${verb} before the step was cut off`);
    } else if (t.kind === 'sell') {
        const r = yield* sell(ctx, pattern, remaining);
        const gained = countItems(ctx.state(), COINS) - start.coins;
        yield* log(`sold ${t.item}: ${r.message}; coins +${gained}`);
        if (!r.ok) failure = { reason: r.reason, message: r.message, got: r.amountSold };
    } else {
        // A purchase always has a count, so `remaining` is the number left to buy.
        const r = yield* buy(ctx, pattern, remaining === 'all' ? t.count : remaining);
        yield* log(`bought ${t.item}: ${r.message}; coins ${start.coins} -> ${countItems(ctx.state(), COINS)}`);
        if (!r.ok) failure = { reason: r.reason, message: r.message, got: r.amountBought };
    }

    // The shop modal closed under the trade (an interrupt, an attack): the step reopens it and resumes,
    // so the coins are settled once the trade ends for good, against the same start.
    if (failure?.reason === 'shop-not-open')
        return { kind: 'closed', what: `${t.kind} ${t.item}`, message: `${failure.reason}: ${failure.message}` };

    const coins = countItems(ctx.state(), COINS);
    if (t.kind === 'sell') ctx.memory.coinsReceived += Math.max(0, coins - start.coins);
    else ctx.memory.coinsSpent += Math.max(0, start.coins - coins);
    if (failure && t.kind === 'sell') {
        const message = `sell ${t.item} failed (${failure.reason}): ${failure.message}; coins received so far ${ctx.memory.coinsReceived}`;
        return { kind: 'fail', message };
    }
    if (failure) {
        const message = `buy ${t.item} x${t.count} failed (${failure.reason}, got ${failure.got}): ${failure.message}; ${coins} coins left`;
        return { kind: 'fail', message };
    }
    ctx.memory.tradesMade++;
    ctx.memory.inFlight = null;
    ctx.streak('reopenFails').reset();
    return null;
}

/** The trades still to make, in order, with the shop open; the first that does not go through ends them. */
function* performRemaining(ctx: Ctx): Op<Ending | null> {
    for (let t = nextTrade(ctx); t; t = nextTrade(ctx)) {
        const ending = yield* performTrade(ctx, t);
        if (ending) return ending;
    }
    return null;
}

export default defineTask({
    name: 'shop',
    description:
        'Walk to a ground-floor shop (optional `at`), open it via the exact shopkeeper name `npc`, sell inventory items (`sell`, count omitted = all), ' +
        'then buy items (`buy`), close the shop; done when every trade is made. Sells first so a run funds its own purchases. ' +
        'Optional per-entry price guards: `minUnitPrice` on sells, `maxUnitPrice` on buys. Only trades with a shop this run opened. ' +
        'Fails (no looping) if the shop has no stock, coins run out, or it will not buy an item; the reason reports coins received. ' +
        'E.g. npc "Bob" at (3232,3203); shops and their npcs are in learnings/shops.md.',
    params: Params,
    memory: (): ShopMemory => ({ tradesMade: 0, coinsReceived: 0, coinsSpent: 0, inFlight: null }),
    stepTimeoutMs: STEP_TIMEOUT_MS,

    preflight(ctx) {
        const { sell: sells, buy: buys, at } = ctx.params;
        if (sells.length + buys.length === 0) return 'nothing to sell or buy';
        if (at && isInWilderness(0, at.x, at.z)) return `shop location (${at.x},${at.z}) is in the Wilderness`;
        const s = ctx.state();
        if (sells.length === 0 && countItems(s, COINS) === 0) return 'cannot buy: no coins in inventory';
        const requested = new Map<string, { entries: number; all: boolean; total: number }>();
        for (const t of sells) {
            const have = countItems(s, exactName(t.item));
            if (have === 0) return `cannot sell ${t.item}: not in inventory`;
            const key = t.item.toLowerCase();
            const acc = requested.get(key) ?? { entries: 0, all: false, total: 0 };
            acc.entries++;
            acc.all ||= !t.count;
            acc.total += t.count ?? 0;
            requested.set(key, acc);
            if (acc.entries > 1 && acc.all)
                return `cannot sell ${t.item}: listed more than once and an entry has no count (all)`;
            if (acc.total > have) return `cannot sell ${acc.total} ${t.item}: only ${have} in inventory`;
        }
        return null;
    },

    steps: [
        {
            // openShop accepts any open shop, so never trade with one this run did not open: between
            // steps a shop is open only when it was left so (a close that failed, or one from before).
            name: 'close-stale-shop',
            when: ctx => ctx.state().shop.isOpen,
            *run(ctx) {
                const r = yield* closeShop(ctx);
                const fails = ctx.streak('staleCloseFails');
                if (r.ok) return fails.reset();
                if (fails.add() >= FAIL_LIMIT) return { fail: `cannot close a shop left open: ${r.message}` };
            },
        },
        {
            name: 'walk-to-shop',
            when: ctx => {
                const { at } = ctx.params;
                return !!at && !ctx.state().shop.isOpen && !!nextTrade(ctx) && ctx.distanceTo(at.x, at.z) > AT_REACH;
            },
            *run(ctx) {
                const { at } = ctx.params;
                // Narrowing only: when() guarantees it.
                if (!at) return;
                const r = yield* call('bot.walkTo', () => ctx.bot.walkTo(at.x, at.z, WALK_TOLERANCE));
                const fails = ctx.streak('walkFails');
                if (r.success) return fails.reset();
                if (fails.add() >= FAIL_LIMIT) return { fail: `cannot walk to shop (${at.x},${at.z}): ${r.message}` };
            },
        },
        {
            // Open, every remaining trade and the close are one step, so whatever cancels it (a guard, a
            // stop, the step budget) closes the shop on the way out: an open shop hides the inventory the
            // low-HP guard would eat from. An aborted step resumes at the first trade not yet made, less
            // what of it already landed (`inFlight`). It stands for the legacy `open-shop`, `trade` and
            // `finish`'s close, so their failures carry this step's name as the prefix.
            name: 'trade',
            when: ctx => !!nextTrade(ctx),
            *run(ctx) {
                const trip = yield* withShop(ctx, exactName(ctx.params.npc), performRemaining(ctx));
                const openFails = ctx.streak('openFails');
                if (!trip.ok) {
                    yield* log(`open shop failed (${trip.reason}): ${trip.message}`);
                    if (openFails.add() >= FAIL_LIMIT)
                        return { fail: `cannot open shop via "${ctx.params.npc}": ${trip.message}` };
                    return;
                }
                openFails.reset();
                const ending = trip.value;
                if (!trip.closed.ok) yield* log(`could not close the shop: ${trip.closed.message}`);
                if (ending?.kind === 'closed') {
                    const reopens = ctx.streak('reopenFails');
                    if (reopens.add() >= FAIL_LIMIT)
                        return {
                            fail: `shop closed ${FAIL_LIMIT} times during ${ending.what}; last: ${ending.message}`,
                        };
                    return;
                }
                if (ending) return { fail: ending.message };
                // The shop modal hides the inventory, so a shop that stays open is a failure.
                if (!trip.closed.ok) return { fail: `trades done but cannot close shop: ${trip.closed.message}` };
            },
        },
        {
            name: 'finish',
            when: ctx => !nextTrade(ctx),
            run: ctx => ({
                done: `all ${tradesOf(ctx.params).length} trades made; coins received ${ctx.memory.coinsReceived}, spent ${ctx.memory.coinsSpent}`,
            }),
        },
    ],
});
