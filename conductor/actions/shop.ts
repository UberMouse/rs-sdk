// Ported from sdk/actions.ts openShop, closeShop, buyFromShop, sellToShop @ 4c2069cc0
// Differences from the bot.* methods:
// - openShop does not walk to the shopkeeper first (upstream walks when over 2 tiles away, which opens
//   doors on the way): the client's own pathing covers the last tiles, and a task walks first when it
//   must. It does not dismiss a blocking dialog either: the dialog guard does. "I can't reach that!"
//   from the client or the server is `cant-reach`, a refused send `send-failed` (upstream passes the
//   refusal on as its result, and ignores the server's answer until the wait times out).
// - buy and sell take an amount of a positive integer (sell also 'all', not -1), and decide from the
//   state each wait ended on. A short fill is `partial-fill` when some arrived or left, `timeout` or
//   `send-failed` when none did; upstream's `rejected` flag is the `rejected` reason. A shop that
//   closes mid-trade is `shop-not-open` (upstream: a closed shop's empty list of the inventory reads
//   as everything sold, and a buy waits out its timeout).
// - sell 'all' is the counted sale with the amount the shop lists at the start: the same Sell-10/5/1
//   packets and refusal wording. Upstream's sellAllToShop sends min(10, count), which the client sends
//   as Sell 1 unless it is 5 or 10, and words its refusals its own way ("cannot be sold").
// - Waits and the 60 s deadline of a multi-packet buy or sell are counted in game ticks.
// - closeShop takes its per-attempt wait as a parameter (upstream: a fixed 5s), so withShop's close on
//   an abort fits the interpreter's cleanup cap.
// withShop has no upstream method: it is withModal (modal.ts) over openShop and closeShop, so an abort
// closes the shop before the guard's work runs.
import {
    classifyQuantity,
    MAX_SHOP_ACTION_PACKETS,
    MAX_SHOP_ACTION_QUANTITY,
    nextShopStep,
    SHOP_ACTION_DEADLINE_MS,
    shortestNameMatch,
    validateActionQuantity,
} from '../../sdk/action-quantity';
import type { BotWorldState, InventoryItem, NearbyNpc, ShopItem } from '../../sdk/types';
import type { Op } from '../core/op';
import { send, ticks, wait } from '../core/op';
import { countItemId, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { CANT_REACH, messageCursor, messageSince } from './messages';
import { type CloseModalResult, type ModalOps, type WithModalResult, withModal } from './modal';

/** bot.openShop's 10s timeout, in ticks. */
export const OPEN_SHOP_WAIT_TICKS = Math.ceil(10_000 / TICK_MS);
/** bot.closeShop's 5s wait for each close attempt, in ticks. */
export const CLOSE_SHOP_WAIT_TICKS = Math.ceil(5000 / TICK_MS);
/** buyFromShop's and a counted sellToShop's 5s wait for each packet to take effect, in ticks. */
export const SHOP_PACKET_WAIT_TICKS = Math.ceil(5000 / TICK_MS);
/** sellToShop('all')'s 3s wait for each packet to take effect, in ticks. */
export const SELL_ALL_PACKET_WAIT_TICKS = Math.ceil(3000 / TICK_MS);
/** The 60 s deadline of a multi-packet buy or sell, in ticks. */
export const SHOP_DEADLINE_TICKS = Math.ceil(SHOP_ACTION_DEADLINE_MS / TICK_MS);

const CANT_SELL = /can't sell this item/i;
const INVENTORY_SLOTS = 28;

type Failure<R extends string> = { ok: false; reason: R; message: string };

export type OpenShopResult =
    | { ok: true; message: string }
    | Failure<'npc-not-found' | 'no-trade-option' | 'cant-reach' | 'send-failed' | 'timeout'>;
export type CloseShopResult = CloseModalResult;

type TradeFailure = 'invalid-amount' | 'shop-not-open' | 'item-not-found' | 'partial-fill' | 'send-failed' | 'timeout';
export type BuyResult =
    | { ok: true; amountBought: number; item: InventoryItem | undefined; message: string }
    | (Failure<TradeFailure | 'out-of-stock' | 'no-inventory-space'> & { amountBought: number });
export type SellResult =
    | { ok: true; amountSold: number; message: string }
    | (Failure<TradeFailure | 'rejected'> & { amountSold: number });

/** A trade target as a message names it: an item by name, a pattern or name as written. */
const targetLabel = (target: RegExp | string | { name: string }) =>
    typeof target === 'string' || target instanceof RegExp ? String(target) : target.name;

export const offersTrade = (n: NearbyNpc) => n.optionsWithIndex.some(o => /trade/i.test(o.text));

/** Reachable NPCs first (`reachable` unknown counts as reachable), then nearest. */
const byReachThenDistance = (a: NearbyNpc, b: NearbyNpc) =>
    Number(a.reachable === false) - Number(b.reachable === false) || a.distance - b.distance;

/**
 * The NPC matching `pattern` that a shop should be opened with: among several of one name (Dwarf, Man)
 * one offering Trade, reachable before not, then nearest; only when none offers Trade, the best named one.
 * Shared by `openShop` and the shop task's walk to the keeper, so both pick the same NPC.
 */
export function pickShopkeeper(npcs: readonly NearbyNpc[], pattern: string | RegExp): NearbyNpc | null {
    const ranked = [...npcs].sort(byReachThenDistance);
    return shortestNameMatch(ranked.filter(offersTrade), pattern) ?? shortestNameMatch(ranked, pattern);
}

/** The shopkeeper `target` names, or with none the nearest "Shop keeper", else the best NPC offering Trade. */
function findShopkeeper(s: BotWorldState, target: NearbyNpc | string | RegExp | undefined): NearbyNpc | null {
    if (typeof target === 'object' && !(target instanceof RegExp)) return target;
    const named = pickShopkeeper(s.nearbyNpcs, target ?? /shop\s*keeper/i);
    if (named || target !== undefined) return named;
    return [...s.nearbyNpcs].sort(byReachThenDistance).find(offersTrade) ?? null;
}

/**
 * Opens the shop by trading with `target` (a nearby NPC, or a name or pattern for one; none = the
 * nearest shopkeeper, else the nearest NPC with a Trade option), and waits for the shop to open. A
 * named target that does not match stays `npc-not-found`: trading with someone else would be worse.
 * Among several NPCs of that name the reachable one offering Trade is used, nearest first; only when
 * none offers it is the nearest named one returned, and the open fails `no-trade-option`.
 * Any open shop counts as open, so a caller that must trade with a particular one checks `shop.title`.
 */
export function* openShop(ctx: ActionContext, target?: NearbyNpc | string | RegExp): Op<OpenShopResult> {
    const before = ctx.state();
    if (before.shop.isOpen) return { ok: true, message: `Shop already open: ${before.shop.title}` };
    const npc = findShopkeeper(before, target);
    if (!npc) {
        return {
            ok: false,
            reason: 'npc-not-found',
            message: target === undefined ? 'No nearby NPC with a Trade option' : `Shopkeeper not found: ${target}`,
        };
    }
    const tradeOption = npc.optionsWithIndex.find(o => /trade/i.test(o.text));
    if (!tradeOption) return { ok: false, reason: 'no-trade-option', message: 'No trade option on NPC' };

    const cursor = messageCursor(before);
    const sent = yield* send({
        type: 'interactNpc',
        npcIndex: npc.index,
        optionIndex: tradeOption.opIndex,
        reason: `${tradeOption.text} ${npc.name}`,
    });
    if (!sent.success) {
        const cant = sent.reason === 'cant_reach';
        return { ok: false, reason: cant ? 'cant-reach' : 'send-failed', message: sent.message };
    }

    const cantReach = (s: BotWorldState) => messageSince(s, cursor, CANT_REACH) !== null;
    const w = yield* wait('shop open', s => s.shop.isOpen || cantReach(s), OPEN_SHOP_WAIT_TICKS);
    // The shop may have opened on a retry even after a can't-reach message, so it is checked first.
    if (w.state.shop.isOpen) return { ok: true, message: `Opened shop: ${w.state.shop.title}` };
    if (cantReach(w.state)) return { ok: false, reason: 'cant-reach', message: `Cannot reach ${npc.name}` };
    return { ok: false, reason: 'timeout', message: 'Timed out waiting for shop to open' };
}

/** The shop flag and the interface flag drop on separate frames, so both must be clear. */
const shopClosed = (s: BotWorldState) => !s.shop.isOpen && !s.interface.isOpen;

/**
 * Closes the shop, with a second try if the first shows no effect within `waitTicks`; already closed
 * is success. The second try gets one tick, so the whole close takes at most `waitTicks + 1` ticks.
 */
export function* closeShop(ctx: ActionContext, waitTicks = CLOSE_SHOP_WAIT_TICKS): Op<CloseShopResult> {
    if (shopClosed(ctx.state())) return { ok: true, message: 'Shop already closed' };
    const sent = yield* send({ type: 'closeShop', reason: 'close shop' });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait('shop closed', shopClosed, waitTicks);
    if (w.kind === 'met') return { ok: true, message: 'Shop closed' };
    const again = yield* send({ type: 'closeShop', reason: 'close shop (second attempt)' });
    if (!again.success) return { ok: false, reason: 'send-failed', message: again.message };
    const last = yield* ticks(1);
    if (shopClosed(last)) return { ok: true, message: 'Shop closed (second attempt)' };
    return {
        ok: false,
        reason: 'timeout',
        message: `Shop close timeout - shop.isOpen=${last.shop.isOpen}, interface.isOpen=${last.interface.isOpen}`,
    };
}

export type WithShopResult<T> = WithModalResult<T, Extract<OpenShopResult, { ok: false }>>;

/** The shop `target` keeps (see openShop) as withModal opens and closes it. */
const shopModal = (
    ctx: ActionContext,
    target: NearbyNpc | string | RegExp | undefined,
): ModalOps<Extract<OpenShopResult, { ok: false }>> => ({
    name: 'shop',
    open: () => openShop(ctx, target),
    close: waitTicks => closeShop(ctx, waitTicks),
    isOpen: s => s.shop.isOpen,
    isClosed: shopClosed,
    closeAction: reason => ({ type: 'closeShop', reason }),
});

/**
 * Runs `body` with the shop open (via `target`, see openShop) and closes it afterwards, however `body`
 * ends (withModal: an abort closes the shop before the guard's work runs, as an open shop hides the
 * inventory the low-HP guard would eat from). `closed` is the normal path's closeShop result; a failed
 * open is returned as is.
 */
export function* withShop<T>(
    ctx: ActionContext,
    target: NearbyNpc | string | RegExp | undefined,
    body: Op<T>,
): Op<WithShopResult<T>> {
    return yield* withModal(ctx, shopModal(ctx, target), body);
}

/** What buy and sell answer when no shop is open: nothing is sent. */
const SHOP_NOT_OPEN = { reason: 'shop-not-open', message: 'Shop is not open' } as const;

/** The item of `items` (shop stock or the inventory as the shop lists it) that `target` names. */
const resolveShopItem = (target: ShopItem | InventoryItem | string | RegExp, items: readonly ShopItem[]) =>
    typeof target === 'object' && !(target instanceof RegExp)
        ? (items.find(i => i.id === target.id) ?? null)
        : shortestNameMatch(items, target);

/**
 * Buys `amount` of a shop item (a shop item, or the shortest-named match of a name or pattern) in
 * Buy-10/5/1 packets, each waiting for the inventory count to rise. Success needs the full amount: a
 * short fill (out of stock, out of coins, a full inventory) is `partial-fill`, or `timeout` when none
 * arrived; a shop that closes before the full amount arrived is `shop-not-open`, with what had. A line
 * with no stock on the shelf is `out-of-stock` and a full inventory with no stack of the item
 * `no-inventory-space`, both before any send.
 */
export function* buy(ctx: ActionContext, target: ShopItem | string | RegExp, amount = 1): Op<BuyResult> {
    const valid = validateActionQuantity(amount, { max: MAX_SHOP_ACTION_QUANTITY });
    if (!valid.valid) return { ok: false, reason: 'invalid-amount', amountBought: 0, message: valid.message };
    const requested = valid.amount;
    let s = ctx.state();
    if (!s.shop.isOpen) return { ok: false, ...SHOP_NOT_OPEN, amountBought: 0 };
    const shopItem = resolveShopItem(target, s.shop.shopItems);
    if (!shopItem) {
        return {
            ok: false,
            reason: 'item-not-found',
            amountBought: 0,
            message: `Item not found in shop: ${targetLabel(target)}`,
        };
    }
    // A shop lists every line it can ever sell; count is the live shelf stock.
    if (shopItem.count <= 0) {
        return { ok: false, reason: 'out-of-stock', amountBought: 0, message: `${shopItem.name} is out of stock` };
    }
    const { id, name } = shopItem;
    // The buy-wait times out identically for no coins, no stock and no free slot; a full inventory with
    // no stack of the item can never receive it, so that one is told apart up front.
    if (s.inventory.length >= INVENTORY_SLOTS && countItemId(s, id) === 0) {
        return {
            ok: false,
            reason: 'no-inventory-space',
            amountBought: 0,
            message: `No inventory space to buy ${name}`,
        };
    }

    // Counted from the inventory, which a closed shop still publishes.
    const totalBefore = countItemId(s, id);
    const deadline = s.tick + SHOP_DEADLINE_TICKS;
    // What the trade came to as of `st`; `idle` says why nothing arrived, if nothing did.
    const outcome = (st: BotWorldState, idle: { reason: 'send-failed' | 'timeout'; message: string }): BuyResult => {
        const amountBought = Math.max(0, countItemId(st, id) - totalBefore);
        const quantity = classifyQuantity(requested, amountBought);
        if (quantity.complete) {
            return {
                ok: true,
                amountBought,
                item: st.inventory.find(i => i.id === id),
                message: `Bought ${name} x${amountBought}`,
            };
        }
        if (!st.shop.isOpen) {
            const closed = `Shop closed with ${name} x${amountBought} of ${requested} bought`;
            return { ok: false, reason: 'shop-not-open', amountBought, message: closed };
        }
        const short = `Bought ${name} x${amountBought} of ${requested} requested`;
        if (quantity.partial) return { ok: false, reason: 'partial-fill', amountBought, message: short };
        return { ok: false, reason: idle.reason, amountBought, message: idle.message };
    };
    const noPackets = { reason: 'timeout', message: `Bought ${name} x0 of ${requested} requested` } as const;

    let remaining = requested;
    let packets = 0;
    while (remaining > 0 && packets < MAX_SHOP_ACTION_PACKETS && s.tick < deadline) {
        const step = nextShopStep(remaining);
        const countBefore = countItemId(s, id);
        const sent = yield* send({ type: 'shopBuy', slot: shopItem.slot, amount: step, reason: `buy ${name}` });
        if (!sent.success) return outcome(s, { reason: 'send-failed', message: sent.message });
        packets++;
        const w = yield* wait(
            `buy ${name}`,
            st => countItemId(st, id) > countBefore || !st.shop.isOpen,
            SHOP_PACKET_WAIT_TICKS,
        );
        s = w.state;
        if (!s.shop.isOpen) return outcome(s, noPackets);
        if (w.kind === 'timeout') {
            const why = `Failed to buy ${name} (no coins, out of stock, or full inventory?)`;
            return outcome(s, { reason: 'timeout', message: why });
        }
        remaining -= step;
    }
    return outcome(s, noPackets);
}

/** How a "can't sell" game message reads for an item, in upstream's (sellToShop's) wording. */
function sellRejection(text: string, name: string): string {
    if (/to this shop/i.test(text)) return `Shop doesn't buy ${name}`;
    if (/to a shop/i.test(text)) return `Cannot sell ${name} to any shop`;
    return `${name} is not tradeable`;
}

const playerCount = (s: BotWorldState, id: number) =>
    s.shop.playerItems.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);

/**
 * Sells `amount` of an inventory item (an item, or the shortest-named match of a name or pattern) to
 * the open shop, or all of it, in Sell-10/5/1 packets, each waiting for the shop's count of it to fall.
 * The shop's slot for the item is looked up again before every packet: selling a batch of unstackable
 * items removes the slot the first one sat in. A "can't sell this item" answer is `rejected` (the shop
 * does not buy it, or nobody does). Success needs the full amount: a short fill is `partial-fill`, or
 * `timeout` when none left. A shop that closes mid-sale is `shop-not-open`: a closed shop publishes no
 * list of the inventory, so `amountSold` is what had left as of the last state the shop showed open,
 * and a packet in flight as it closed may have sold more (the inventory tells).
 */
export function* sell(
    ctx: ActionContext,
    target: ShopItem | InventoryItem | string | RegExp,
    amount: number | 'all' = 1,
): Op<SellResult> {
    const valid = amount === 'all' ? null : validateActionQuantity(amount, { max: MAX_SHOP_ACTION_QUANTITY });
    if (valid && !valid.valid) return { ok: false, reason: 'invalid-amount', amountSold: 0, message: valid.message };
    let s = ctx.state();
    if (!s.shop.isOpen) return { ok: false, ...SHOP_NOT_OPEN, amountSold: 0 };
    const item = resolveShopItem(target, s.shop.playerItems);
    if (!item) {
        return {
            ok: false,
            reason: 'item-not-found',
            amountSold: 0,
            message: `Item not found to sell: ${targetLabel(target)}`,
        };
    }
    const { id, name } = item;
    const cursor = messageCursor(s);
    const countBefore = playerCount(s, id);
    const requested = amount === 'all' ? countBefore : amount;
    const packetWait = amount === 'all' ? SELL_ALL_PACKET_WAIT_TICKS : SHOP_PACKET_WAIT_TICKS;
    const deadline = s.tick + SHOP_DEADLINE_TICKS;
    const rejection = (st: BotWorldState) => messageSince(st, cursor, CANT_SELL);

    /** As of the last state the shop showed open. */
    let sold = 0;
    type Stop = { reason: 'rejected' | 'shop-not-open' | 'send-failed' | 'timeout'; message: string };
    // What the sale came to; `stop` says why the loop ended short, if it did. A refusal or a closed shop
    // is reported as such whatever sold before it.
    const outcome = (stop: Stop): SellResult => {
        if (stop.reason === 'rejected' || stop.reason === 'shop-not-open')
            return { ok: false, ...stop, amountSold: sold };
        const quantity = classifyQuantity(requested, sold);
        if (quantity.complete) return { ok: true, amountSold: sold, message: `Sold ${name} x${sold}` };
        if (quantity.partial) {
            const short = `Sold ${name} x${sold} of ${requested} requested`;
            return { ok: false, reason: 'partial-fill', amountSold: sold, message: short };
        }
        return { ok: false, ...stop, amountSold: sold };
    };
    const timedOut: Stop = { reason: 'timeout', message: `Failed to sell ${name} (timeout)` };

    let packets = 0;
    while (sold < requested && packets < MAX_SHOP_ACTION_PACKETS && s.tick < deadline) {
        const current = s.shop.playerItems.find(i => i.id === id);
        if (!current) break;
        const before = playerCount(s, id);
        const step = nextShopStep(requested - sold);
        const sent = yield* send({ type: 'shopSell', slot: current.slot, amount: step, reason: `sell ${name}` });
        if (!sent.success) return outcome({ reason: 'send-failed', message: sent.message });
        packets++;
        const w = yield* wait(
            `sell ${name}`,
            st => !st.shop.isOpen || rejection(st) !== null || playerCount(st, id) < before,
            packetWait,
        );
        s = w.state;
        if (s.shop.isOpen) sold = Math.max(0, countBefore - playerCount(s, id));
        const refused = rejection(s);
        if (refused) {
            const why = sellRejection(refused, name);
            return outcome({
                reason: 'rejected',
                message: sold > 0 ? `${why} (sold x${sold} of ${requested} first)` : why,
            });
        }
        if (!s.shop.isOpen) {
            return outcome({
                reason: 'shop-not-open',
                message: `Shop closed with ${name} x${sold} of ${requested} sold`,
            });
        }
        if (w.kind === 'timeout') return outcome(timedOut);
    }
    return outcome(timedOut);
}
