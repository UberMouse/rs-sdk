import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { CLEANUP_CLOSE_WAIT_TICKS } from '../actions/modal';
import { buy, closeShop, OPEN_SHOP_WAIT_TICKS, pickShopkeeper, sell, withShop } from '../actions/shop';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, type Op } from '../core/op';
import { isInWilderness } from '../lib/wilderness';
import { defineTask, type TaskContext } from '../lib/task';
import { countItems, exactName, TICK_MS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

const COINS = /^coins$/i;
const WALK_TOLERANCE = 3;
/** How close bot.openShop walks to the shopkeeper before trading, as the walk after a cant-reach does. */
const KEEPER_WALK_TOLERANCE = 2;
/** Farther than this from `at` and the shopkeeper is probably not loaded or reachable. */
const AT_REACH = 8;
/**
 * Consecutive failures of one kind before the task fails, each its own streak: failed walks to the
 * shop (not one that ran out of ticks nearer it, timedOutAdvancing); failed closes of a shop left
 * open; trade step runs whose open failed; and trade step runs that ended with a trade cut off,
 * unfinished, by the shop closing under it (or by a sale the inventory did not show), which a
 * finished trade resets.
 */
const FAIL_LIMIT = 3;
/** Walks to a far shop outlast the engine's default step timeout. */
const STEP_TIMEOUT_MS = 300_000;
/**
 * One failed open changes nothing the watchdog sees: the open's wait, withShop's close (a late-open
 * wait and a second try), and for a can't-reach the walk to the keeper (walkToKeeper).
 */
const OPEN_SILENT_TICKS = OPEN_SHOP_WAIT_TICKS + 2 * CLEANUP_CLOSE_WAIT_TICKS + 1 + WALK_MAX_TICKS;
/**
 * The watchdog outlasts both fail streaks, so the task's own reason surfaces and not `stuck`: the walks
 * to the shop (FAIL_LIMIT of them, each up to WALK_MAX_TICKS without moving the bot) and the opens.
 */
export const SILENT_STREAK_TICKS = [
    failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS),
    failStreakTicks(FAIL_LIMIT, OPEN_SILENT_TICKS),
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
/**
 * The trade step starts no further trade once it has run this long, half its tick budget, and runs
 * again for the rest (closing and reopening the shop; the resume state is in memory). One trade can
 * take SHOP_DEADLINE_TICKS and more, so a long list of them would otherwise overrun the step.
 */
const TRADE_STEP_YIELD_TICKS = Math.floor(Math.ceil(STEP_TIMEOUT_MS / TICK_MS) / 2);

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
/** A trade's baseline: its index, and the coins and the item's count the inventory held before its first send. */
type Baseline = { tradeIndex: number; coins: number; held: number };
interface ShopMemory {
    /** How many of the task's trades (see `tradesOf`) have gone through, in order. */
    tradesMade: number;
    /** Coins gained by selling and lost to buying over the finished trades. */
    coinsReceived: number;
    coinsSpent: number;
    /**
     * The trade under way, by its baseline. An abort can land after packets did, so a resumed step
     * counts what moved since then and trades only the rest, and settles the coins against the same start.
     *
     * The baseline is the inventory count, so it is approximate when a guard's eat consumes the very item
     * being traded between the abort and the resume: a sale looks that much further along and
     * under-delivers by the eaten amount; a purchase of food looks that much less along and over-buys by
     * it (the inventory still ends at the requested count), and is price-checked again if the eat took
     * all of what it had bought. Neither exceeds the trade's amount.
     */
    inFlight: Baseline | null;
}
type Ctx = TaskContext<ShopParams, ShopMemory>;
type SellTrade = { kind: 'sell' } & ShopParams['sell'][number];
type BuyTrade = { kind: 'buy' } & ShopParams['buy'][number];
type Trade = SellTrade | BuyTrade;
/**
 * How the trades in the shop ended, if they did not all go through: a failure that ends the run, or a
 * trade cut off unfinished that the step's next run resumes.
 */
type Ending = { kind: 'fail'; message: string } | { kind: 'cut-off'; what: string; message: string };

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

/** Adds what the trade made or cost since its baseline to the run's coin totals. */
function settle(ctx: Ctx, t: Trade, start: Baseline): void {
    const coins = countItems(ctx.state(), COINS);
    if (t.kind === 'sell') ctx.memory.coinsReceived += Math.max(0, coins - start.coins);
    else ctx.memory.coinsSpent += Math.max(0, start.coins - coins);
}

/** The step's next run reopens the shop and resumes the trade; its coins are settled once it ends for good. */
const cutOff = (t: Trade, message: string): Ending => ({ kind: 'cut-off', what: `${t.kind} ${t.item}`, message });

/** Sells what of `t` has not left the inventory since `start`; `resumed` says an earlier run began it. */
function* performSell(ctx: Ctx, t: SellTrade, start: Baseline, resumed: boolean): Op<Ending | null> {
    const pattern = exactName(t.item);
    const sold = Math.max(0, start.held - countItems(ctx.state(), pattern));
    // A resumed sale of all is done once none is left, a counted one once its count has left.
    if (resumed && (t.count === undefined ? countItems(ctx.state(), pattern) === 0 : sold >= t.count)) {
        yield* log(`sell ${t.item}: ${sold} already sold before the step was cut off`);
        settle(ctx, t, start);
        return null;
    }
    const r = yield* sell(ctx, pattern, t.count === undefined ? 'all' : t.count - sold);
    const held = countItems(ctx.state(), pattern);
    yield* log(`sold ${t.item}: ${r.message}; coins +${countItems(ctx.state(), COINS) - start.coins}`);
    if (!r.ok && r.reason === 'shop-not-open') return cutOff(t, `${r.reason}: ${r.message}`);
    // The op counts from the shop's list of the inventory; the trade is made only once the inventory
    // agrees, else the step's next run sells what is still held.
    if (r.ok && (t.count === undefined ? held > 0 : start.held - held < t.count))
        return cutOff(t, `shop reported "${r.message}" but the inventory still holds ${held} ${t.item}`);
    settle(ctx, t, start);
    if (r.ok) return null;
    return {
        kind: 'fail',
        message: `sell ${t.item} failed (${r.reason}): ${r.message}; coins received so far ${ctx.memory.coinsReceived}`,
    };
}

/** Buys what of `t` has not arrived in the inventory since `start`. */
function* performBuy(ctx: Ctx, t: BuyTrade, start: Baseline): Op<Ending | null> {
    const pattern = exactName(t.item);
    const bought = Math.max(0, countItems(ctx.state(), pattern) - start.held);
    if (bought >= t.count) {
        yield* log(`buy ${t.item}: ${bought} already bought before the step was cut off`);
        settle(ctx, t, start);
        return null;
    }
    const r = yield* buy(ctx, pattern, t.count - bought);
    const coins = countItems(ctx.state(), COINS);
    yield* log(`bought ${t.item}: ${r.message}; coins ${start.coins} -> ${coins}`);
    if (!r.ok && r.reason === 'shop-not-open') return cutOff(t, `${r.reason}: ${r.message}`);
    settle(ctx, t, start);
    if (r.ok) return null;
    return {
        kind: 'fail',
        message: `buy ${t.item} x${t.count} failed (${r.reason}, got ${r.amountBought}): ${r.message}; ${coins} coins left`,
    };
}

/** Makes the next trade with the shop open; null when it went through. */
function* performTrade(ctx: Ctx, t: Trade): Op<Ending | null> {
    const state = ctx.state();
    const index = ctx.memory.tradesMade;
    const resumed = ctx.memory.inFlight?.tradeIndex === index ? ctx.memory.inFlight : null;
    const held = countItems(state, exactName(t.item));
    const start = resumed ?? { tradeIndex: index, coins: countItems(state, COINS), held };
    // The price is checked while nothing of the trade has moved: on its first run, or on a resume cut off
    // before its first packet landed. Once packets landed, the shop's prices have moved with its stock.
    const moved = t.kind === 'sell' ? start.held - held : held - start.held;
    if (moved <= 0) {
        const refusal = priceRefusal(state, t);
        if (refusal) return { kind: 'fail', message: refusal };
    }
    ctx.memory.inFlight = start;
    const ending =
        t.kind === 'sell' ? yield* performSell(ctx, t, start, resumed !== null) : yield* performBuy(ctx, t, start);
    if (ending) return ending;
    ctx.memory.tradesMade++;
    ctx.memory.inFlight = null;
    ctx.streak('cutOffs').reset();
    return null;
}

/**
 * The trades still to make, in order, with the shop open; the first that does not go through ends them.
 * Once the step has run TRADE_STEP_YIELD_TICKS since `stepStart`, it returns after the trade in hand,
 * and the step's next run makes the rest.
 */
function* performRemaining(ctx: Ctx, stepStart: number): Op<Ending | null> {
    for (let t = nextTrade(ctx); t; t = nextTrade(ctx)) {
        const ending = yield* performTrade(ctx, t);
        if (ending) return ending;
        if (nextTrade(ctx) && ctx.state().tick - stepStart >= TRADE_STEP_YIELD_TICKS) {
            yield* log(`${ctx.memory.tradesMade} trades made; the step runs again for the rest`);
            return null;
        }
    }
    return null;
}

/**
 * Stopgap until the openShop op walks to the shopkeeper itself, as bot.openShop does before trading:
 * walks (the walkTo op) to within KEEPER_WALK_TOLERANCE of the shopkeeper named `npc` that openShop
 * would trade with (pickShopkeeper), opening the doors on the way, which the client's pathing of the
 * op's Trade click does not.
 */
function* walkToKeeper(ctx: Ctx): Op<void> {
    const name = exactName(ctx.params.npc);
    const keeper = pickShopkeeper(ctx.state().nearbyNpcs, name);
    if (!keeper) {
        yield* log(`no ${ctx.params.npc} in view to walk to; the next open tries again from here`);
        return;
    }
    const r = yield* walkTo(ctx, keeper.x, keeper.z, KEEPER_WALK_TOLERANCE);
    yield* log(`walk to ${keeper.name} (${keeper.x},${keeper.z}) to open the shop: ${r.message}`);
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
    stuckAfterMs: STUCK_AFTER_MS,

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
            // The engine's run-start close takes one left by an earlier run; this step is for one left
            // open mid-run.
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
                const before = ctx.distanceTo(at.x, at.z);
                const r = yield* walkTo(ctx, at.x, at.z, WALK_TOLERANCE);
                const fails = ctx.streak('walkFails');
                if (r.ok) return fails.reset();
                // Out of ticks but nearer: the next run walks on, and it is no failure.
                if (timedOutAdvancing(r, before, ctx.distanceTo(at.x, at.z))) {
                    yield* log(`walk to shop (${at.x},${at.z}) not there yet: ${r.message}`);
                    return;
                }
                yield* log(`walk to shop (${at.x},${at.z}) failed: ${r.message}`);
                if (fails.add() >= FAIL_LIMIT) return { fail: `cannot walk to shop (${at.x},${at.z}): ${r.message}` };
            },
        },
        {
            // Open, the remaining trades and the close are one step, so whatever cancels it (a guard, a
            // stop, the step budget) closes the shop on the way out: an open shop hides the inventory the
            // low-HP guard would eat from. An aborted step resumes at the first trade not yet made, less
            // what of it already landed (`inFlight`); so does a run that stopped after
            // TRADE_STEP_YIELD_TICKS, or whose trade was cut off by the shop closing.
            name: 'trade',
            when: ctx => !!nextTrade(ctx),
            *run(ctx) {
                const stepStart = ctx.state().tick;
                const trip = yield* withShop(ctx, exactName(ctx.params.npc), performRemaining(ctx, stepStart));
                const openFails = ctx.streak('openFails');
                if (!trip.ok) {
                    yield* log(`open shop failed (${trip.reason}): ${trip.message}`);
                    if (!trip.closed.ok) yield* log(`a shop may be left open after it: ${trip.closed.message}`);
                    if (openFails.add() >= FAIL_LIMIT)
                        return { fail: `cannot open shop via "${ctx.params.npc}": ${trip.message}` };
                    // Stopgap until the openShop op walks itself: a shopkeeper behind a door is out of the
                    // client's reach.
                    if (trip.reason === 'cant-reach') yield* walkToKeeper(ctx);
                    return;
                }
                openFails.reset();
                const ending = trip.value;
                if (!trip.closed.ok) yield* log(`could not close the shop: ${trip.closed.message}`);
                if (ending?.kind === 'cut-off') {
                    if (ctx.streak('cutOffs').add() >= FAIL_LIMIT)
                        return { fail: `${ending.what} cut off ${FAIL_LIMIT} times in a row; last: ${ending.message}` };
                    return;
                }
                if (ending) return { fail: ending.message };
                // The shop modal hides the inventory, so a shop that stays open is a failure.
                if (!trip.closed.ok) return { fail: `cannot close the shop after trading: ${trip.closed.message}` };
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
