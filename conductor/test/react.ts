// How a scripted world answers the bot's sends (TimelineOptions.react): the timeline says what the
// world does by itself, these what the bot does to it.
import type { BotAction, BotWorldState } from '../../sdk/types';
import { ITEM_COMPONENT, NOTE_COMPONENT } from '../actions/bank';
import type { Effect } from '../core/drivers/timeline';
import { type BankContents, type ShopContents, world } from './world';

/**
 * One fewer of item `id`, taken from `slot` when it holds it; other slots keep their places, as in the
 * game. Once the scripted inventory holds no such item it returns the state unchanged, which retires the
 * effect (see Effect): an item the script adds later is not the one that was eaten or dropped.
 */
const takeOne =
    (id: number, slot: number): Effect =>
    s => {
        const item = s.inventory.find(i => i.slot === slot && i.id === id) ?? s.inventory.find(i => i.id === id);
        if (!item) return s;
        const inventory =
            item.count > 1
                ? s.inventory.map(i => (i === item ? { ...i, count: i.count - 1 } : i))
                : s.inventory.filter(i => i !== item);
        return { ...s, inventory };
    };

/**
 * The default world reaction: an item eaten or drunk, or dropped, leaves the inventory on the next
 * tick. Everything else changes only as the timeline says.
 */
export function consume(action: BotAction, state: BotWorldState): Effect | undefined {
    if (action.type !== 'useInventoryItem' && action.type !== 'dropItem') return undefined;
    const item = state.inventory.find(i => i.slot === action.slot);
    if (!item) return undefined;
    if (action.type === 'useInventoryItem') {
        const option = item.optionsWithIndex.find(o => o.opIndex === action.optionIndex);
        if (!option || !/^(eat|drink)$/i.test(option.text)) return undefined;
    }
    return takeOne(item.id, item.slot);
}

/**
 * A bank scripted world: a close leaves the bank closed, deposits and withdrawals move items between
 * the inventory and the bank (a stack by its size, the rest a slot each), and the note toggle flips
 * `noteMode`. Like `consume` it applies on top of every scripted state until the script no longer
 * holds what it moves. Falls back to `consume`, so food still leaves the inventory.
 */
export function bankWorld(action: BotAction, state: BotWorldState): Effect | undefined {
    switch (action.type) {
        case 'closeModal':
            return s => (s.bank.isOpen || s.interface.isOpen ? world(s).bank(false).build() : s);
        case 'clickComponent': {
            const note = action.componentId === NOTE_COMPONENT;
            if (!note && action.componentId !== ITEM_COMPONENT) return undefined;
            return s => (s.bank.noteMode === note ? s : { ...s, bank: { ...s.bank, noteMode: note } });
        }
        case 'bankDeposit': {
            const item = state.inventory.find(i => i.slot === action.slot);
            if (!item) return undefined;
            return s => {
                const held = s.inventory.filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0);
                if (held === 0) return s;
                const moved = action.amount === -1 ? held : Math.min(action.amount, held);
                const banked = s.bank.items.find(b => b.id === item.id)?.count ?? 0;
                return restock(s, item, held - moved, banked + moved);
            };
        }
        case 'bankWithdraw': {
            const item = state.bank.items.find(b => b.slot === action.slot);
            if (!item) return undefined;
            return s => {
                const banked = s.bank.items.find(b => b.id === item.id)?.count ?? 0;
                if (banked === 0) return s;
                const moved = action.amount === -1 ? banked : Math.min(action.amount, banked);
                const held = s.inventory.filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0);
                return restock(s, item, held + moved, banked - moved);
            };
        }
        default:
            return consume(action, state);
    }
}

/** `s` holding `held` of `item` in the inventory and `banked` in the bank (the bank keeps its other slots). */
function restock(s: BotWorldState, item: { id: number; name: string }, held: number, banked: number): BotWorldState {
    const bank: BankContents = s.bank.items
        .filter(b => b.id !== item.id)
        .map(b => ({ name: b.name, count: b.count, id: b.id }));
    if (banked > 0) bank.push({ name: item.name, count: banked, id: item.id });
    return world(s).inv(item.name, held, { id: item.id }).bank(bank, s.bank.noteMode).build();
}

/**
 * `bankWorld` plus a bank that opens, holding `contents`, when the bot uses a bank booth or banker.
 * The opening reapplies on every scripted state, so a close is only seen while it is the later effect.
 */
export const bankReact =
    (contents: BankContents) =>
    (action: BotAction, state: BotWorldState): Effect | undefined => {
        if ((action.type === 'interactLoc' || action.type === 'interactNpc') && /bank/i.test(action.reason))
            return s => (s.bank.isOpen ? s : world(s).bank(contents).build());
        return bankWorld(action, state);
    };

const COINS = 'Coins';
const COINS_ID = 995;
const heldOf = (s: BotWorldState, id: number) => s.inventory.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);

/**
 * A shop scripted world: a close leaves the shop closed, a buy moves units from the shelf to the
 * inventory for coins (as many as the stock and the coins allow), a sell moves them back for the shop's
 * price. Like `bankWorld` it applies on top of every scripted state until nothing is left to move, and
 * falls back to `consume`.
 */
export function shopWorld(action: BotAction, state: BotWorldState): Effect | undefined {
    switch (action.type) {
        case 'closeShop':
            return s => (s.shop.isOpen || s.interface.isOpen ? world(s).shop(false).build() : s);
        case 'shopBuy': {
            const line = state.shop.shopItems.find(i => i.slot === action.slot);
            if (!line) return undefined;
            return s => {
                const stock = s.shop.shopItems.find(i => i.id === line.id);
                if (!stock || stock.count === 0) return s;
                const coins = heldOf(s, COINS_ID);
                const affordable = stock.buyPrice > 0 ? Math.floor(coins / stock.buyPrice) : action.amount;
                const moved = Math.min(action.amount, stock.count, affordable);
                if (moved <= 0) return s;
                const bought = world(s)
                    .inv(COINS, coins - stock.buyPrice * moved)
                    .inv(line.name, heldOf(s, line.id) + moved, { id: line.id })
                    .build();
                const shopItems = bought.shop.shopItems.map(i =>
                    i.id === line.id ? { ...i, count: i.count - moved } : i,
                );
                return { ...bought, shop: { ...bought.shop, shopItems } };
            };
        }
        case 'shopSell': {
            const line = state.shop.playerItems.find(i => i.slot === action.slot);
            if (!line) return undefined;
            return s => {
                const held = heldOf(s, line.id);
                if (held === 0) return s;
                const moved = Math.min(action.amount, held);
                const sold = world(s)
                    .inv(line.name, held - moved, { id: line.id })
                    .inv(COINS, heldOf(s, COINS_ID) + line.sellPrice * moved)
                    .build();
                const shopItems = sold.shop.shopItems.map(i =>
                    i.id === line.id ? { ...i, count: i.count + moved } : i,
                );
                return { ...sold, shop: { ...sold.shop, shopItems } };
            };
        }
        default:
            return consume(action, state);
    }
}

/** `shopWorld` plus a shop that opens, stocking `lines` and paying `buys` (see `World.shop`), when the bot trades with an NPC. */
export const shopReact =
    (lines: ShopContents, buys: Record<string, number> = {}) =>
    (action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type === 'interactNpc' && /trade/i.test(action.reason))
            return s => (s.shop.isOpen ? s : world(s).shop(lines, buys).build());
        return shopWorld(action, state);
    };
