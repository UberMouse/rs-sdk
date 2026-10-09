// How a scripted world answers the bot's sends (TimelineOptions.react): the timeline says what the
// world does by itself, these what the bot does to it.
import type { BotAction, BotWorldState } from '../../sdk/types';
import type { Effect } from '../core/drivers/timeline';

/** One fewer of item `id`, taken from `slot` when it holds it; other slots keep their places, as in the game. */
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
