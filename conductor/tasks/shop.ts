import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { isInWilderness } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';

const COINS = /^coins$/i;
const WALK_TOLERANCE = 3;
/** Farther than this from `at` and the shopkeeper is probably not loaded or reachable. */
const AT_REACH = 8;
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
type Ctx = TaskContext<ShopParams>;
type SellTrade = { kind: 'sell' } & ShopParams['sell'][number];
type BuyTrade = { kind: 'buy' } & ShopParams['buy'][number];
type Trade = SellTrade | BuyTrade;

const exactName = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const countOf = (state: BotWorldState, pattern: RegExp) =>
    state.inventory.filter(i => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);

/** Sells first, then buys, so a run funds its own purchases. */
const tradesOf = (ctx: Ctx): Trade[] => [
    ...ctx.params.sell.map(t => ({ kind: 'sell' as const, ...t })),
    ...ctx.params.buy.map(t => ({ kind: 'buy' as const, ...t })),
];

/** The next trade to make, or undefined when all are made. */
const nextTrade = (ctx: Ctx): Trade | undefined => tradesOf(ctx)[ctx.counter('tradesMade').add(0)];

/** Prefix of a trade failure message meaning the shop modal closed mid-trade. */
const CLOSED = 'shop_not_open';

/** Closes the shop (best effort) so a failed run does not leave a modal hiding the inventory. */
const failClosing = async (ctx: Ctx, msg: string) => {
    await ctx.bot.closeShop();
    return { fail: msg };
};

/** Returns a failure message (prefixed CLOSED when the modal closed), or null when the sale went through. */
const sellOne = async (ctx: Ctx, t: SellTrade): Promise<string | null> => {
    const pattern = exactName(t.item);
    const quoted = ctx.state().shop.playerItems.find(i => pattern.test(i.name));
    if (t.minUnitPrice !== undefined) {
        if (!quoted) return `shop does not quote ${t.item}, cannot check minUnitPrice ${t.minUnitPrice}`;
        if (quoted.sellPrice < t.minUnitPrice)
            return `shop pays ${quoted.sellPrice} gp each for ${t.item}, below minUnitPrice ${t.minUnitPrice}`;
    }
    const coinsBefore = countOf(ctx.state(), COINS);
    const r = await ctx.bot.sellToShop(pattern, t.count ?? 'all');
    const gained = countOf(ctx.state(), COINS) - coinsBefore;
    if (gained > 0) ctx.counter('coinsReceived').add(gained);
    ctx.log(`sold ${t.item}: ${r.message}; coins +${gained}`);
    if (r.success) return null;
    if (r.reason === 'shop_not_open') return `${CLOSED}: ${r.message}`;
    return `sell ${t.item} failed (${r.reason ?? 'unknown'}): ${r.message}; coins received so far ${ctx.counter('coinsReceived').add(0)}`;
};

/** Returns a failure message (prefixed CLOSED when the modal closed), or null when the purchase went through. */
const buyOne = async (ctx: Ctx, t: BuyTrade): Promise<string | null> => {
    const pattern = exactName(t.item);
    const quoted = ctx.state().shop.shopItems.find(i => pattern.test(i.name));
    if (t.maxUnitPrice !== undefined) {
        if (!quoted) return `shop does not stock ${t.item}, cannot check maxUnitPrice ${t.maxUnitPrice}`;
        if (quoted.buyPrice > t.maxUnitPrice)
            return `shop asks ${quoted.buyPrice} gp each for ${t.item}, above maxUnitPrice ${t.maxUnitPrice}`;
    }
    const coinsBefore = countOf(ctx.state(), COINS);
    const r = await ctx.bot.buyFromShop(pattern, t.count);
    const after = countOf(ctx.state(), COINS);
    if (coinsBefore > after) ctx.counter('coinsSpent').add(coinsBefore - after);
    ctx.log(`bought ${t.item}: ${r.message}; coins ${coinsBefore} -> ${after}`);
    if (r.success) return null;
    if (r.reason === 'shop_not_open') return `${CLOSED}: ${r.message}`;
    return `buy ${t.item} x${t.count} failed (${r.reason ?? 'unknown'}, got ${r.amountBought ?? 0}): ${r.message}; ${after} coins left`;
};

export default defineTask({
    name: 'shop',
    description:
        'Walk to a ground-floor shop (optional `at`), open it via the exact shopkeeper name `npc`, sell inventory items (`sell`, count omitted = all), ' +
        'then buy items (`buy`), close the shop; done when every trade is made. Sells first so a run funds its own purchases. ' +
        'Optional per-entry price guards: `minUnitPrice` on sells, `maxUnitPrice` on buys. Only trades with a shop this run opened. ' +
        'Fails (no looping) if the shop has no stock, coins run out, or it will not buy an item; the reason reports coins received. ' +
        'E.g. npc "Bob" at (3232,3203); shops and their npcs are in learnings/shops.md.',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,

    preflight(ctx) {
        const { sell, buy, at } = ctx.params;
        if (sell.length + buy.length === 0) return 'nothing to sell or buy';
        if (at && isInWilderness(0, at.x, at.z)) return `shop location (${at.x},${at.z}) is in the Wilderness`;
        const s = ctx.state();
        if (sell.length === 0 && countOf(s, COINS) === 0) return 'cannot buy: no coins in inventory';
        const requested = new Map<string, { entries: number; all: boolean; total: number }>();
        for (const t of sell) {
            const have = countOf(s, exactName(t.item));
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
            // bot.openShop accepts any open shop, so never trade with one this run did not open.
            name: 'close-stale-shop',
            when: ctx => ctx.state().shop.isOpen && ctx.memory.shopOpened !== true,
            async run(ctx) {
                const r = await ctx.bot.closeShop();
                const fails = ctx.counter('staleCloseFails');
                if (r.success) return fails.reset();
                if (fails.add() >= FAIL_LIMIT) return { fail: `cannot close a shop left open: ${r.message}` };
            },
        },
        {
            name: 'walk-to-shop',
            when: ctx => {
                const { at } = ctx.params;
                return !!at && !ctx.state().shop.isOpen && !!nextTrade(ctx) && ctx.distanceTo(at.x, at.z) > AT_REACH;
            },
            async run(ctx) {
                const { at } = ctx.params;
                // Narrowing only: when() guarantees it.
                if (!at) return;
                const r = await ctx.bot.walkTo(at.x, at.z, WALK_TOLERANCE);
                const fails = ctx.counter('walkFails');
                if (r.success) return fails.reset();
                if (fails.add() >= FAIL_LIMIT) return { fail: `cannot walk to shop (${at.x},${at.z}): ${r.message}` };
            },
        },
        {
            name: 'open-shop',
            when: ctx => !!nextTrade(ctx) && !ctx.state().shop.isOpen,
            async run(ctx) {
                const r = await ctx.bot.openShop(exactName(ctx.params.npc));
                const fails = ctx.counter('openFails');
                if (r.success) {
                    ctx.memory.shopOpened = true;
                    return fails.reset();
                }
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `cannot open shop via "${ctx.params.npc}": ${r.message}` };
            },
        },
        {
            name: 'trade',
            when: ctx => !!nextTrade(ctx),
            async run(ctx) {
                const t = nextTrade(ctx);
                // Narrowing only: when() guarantees it.
                if (!t) return;
                const failure = t.kind === 'sell' ? await sellOne(ctx, t) : await buyOne(ctx, t);
                const reopens = ctx.counter('reopenFails');
                if (failure?.startsWith(CLOSED)) {
                    // The modal closed mid-trade (interrupt, attack): let open-shop reopen it.
                    ctx.memory.shopOpened = false;
                    if (reopens.add() >= FAIL_LIMIT)
                        return failClosing(
                            ctx,
                            `shop closed ${FAIL_LIMIT} times during ${t.kind} ${t.item}; last: ${failure}`,
                        );
                    return;
                }
                if (failure) return failClosing(ctx, failure);
                reopens.reset();
                ctx.counter('tradesMade').add();
            },
        },
        {
            name: 'finish',
            when: ctx => !nextTrade(ctx),
            async run(ctx) {
                // The shop modal hides the inventory, so close it before ending.
                if (ctx.state().shop.isOpen) {
                    const c = await ctx.bot.closeShop();
                    if (!c.success) return { fail: `trades done but cannot close shop: ${c.message}` };
                }
                return {
                    done: `all ${tradesOf(ctx).length} trades made; coins received ${ctx.counter('coinsReceived').add(0)}, spent ${ctx.counter('coinsSpent').add(0)}`,
                };
            },
        },
    ],
});
