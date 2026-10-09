// How a scripted world answers the bot's sends (TimelineOptions.react): the timeline says what the
// world does by itself, these what the bot does to it.
import type { BotAction, BotWorldState } from '../../sdk/types';
import { ITEM_COMPONENT, NOTE_COMPONENT } from '../actions/bank';
import { SMITHING_INTERFACE } from '../actions/dismiss';
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

/** What one smithing action takes from the inventory and gives back, with the Smithing XP it pays. */
export interface SmithyWork {
    takes: { name: string; count: number }[];
    gives: { name: string; id: number };
    xp: number;
}

/**
 * A furnace and an anvil as the game runs them: a bar used on an anvil opens the smithing interface, the
 * furnace's Smelt option opens the smelting menu (`menu`, its option labels), a click in either closes
 * it and makes one `work` (its inputs leave the inventory, the product and the XP arrive), and a
 * closeModal takes either away, all from the next tick. Unlike the other worlds it counts what it made
 * and lays that over every scripted state, so a script needs no inventory or XP changes. A fresh one per
 * run: it keeps its count across sends. With `work` null a click closes what it answers and makes
 * nothing (the game ignoring it). Falls back to `consume`.
 */
export function smithyReact(work: SmithyWork | null, menu: string[] = []) {
    let open: 'anvil' | 'menu' | null = null;
    let made = 0;
    let projecting = false;
    const project: Effect = s => {
        let w = world(s);
        if (open === 'anvil') w = w.modal(SMITHING_INTERFACE);
        if (open === 'menu') w = w.dialog({ options: menu });
        if (!work || made === 0) return w.build();
        for (const t of work.takes) {
            const item = s.inventory.find(i => i.name.toLowerCase() === t.name.toLowerCase());
            if (item) w = w.inv(t.name, Math.max(0, heldOf(s, item.id) - t.count * made), { id: item.id });
        }
        w = w.inv(work.gives.name, heldOf(s, work.gives.id) + made, { id: work.gives.id });
        const skill = s.skills.find(k => k.name === 'Smithing');
        return w.skill('Smithing', skill?.baseLevel ?? 1, (skill?.experience ?? 0) + work.xp * made).build();
    };
    return (action: BotAction, state: BotWorldState): Effect | undefined => {
        switch (action.type) {
            case 'useItemOnLoc':
                if (/ on anvil$/i.test(action.reason)) open = 'anvil';
                break;
            case 'interactLoc':
                if (/^smelt /i.test(action.reason)) open = 'menu';
                break;
            case 'clickComponentWithOption':
            case 'clickDialogOption': {
                const answered = action.type === 'clickComponentWithOption' ? 'anvil' : 'menu';
                if (open !== answered) return undefined;
                open = null;
                made++;
                break;
            }
            case 'closeModal':
                open = null;
                break;
            default:
                return consume(action, state);
        }
        // One projection over every later state; the sends after the first only move the count.
        if (projecting) return undefined;
        projecting = true;
        return project;
    };
}
