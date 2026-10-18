// The bank as last seen open (lib/bank-memory.ts): what a memory takes from the states it observes, and a driver
// whose every state passes through one.
import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { TimelineDriver } from '../../core/drivers/timeline';
import { bankMemory, watchBank } from '../../lib/bank-memory';
import { world } from '../world';

type Banked = { name: string; count: number }[];
/** The state of `tick`, with the bank open holding `items`, or closed (`false`). */
const at = (tick: number, items: Banked | false): BotWorldState => world().tick(tick).bank(items).build();
/** The counts after `memory` observes `states` in order. */
function seen(states: BotWorldState[], memory = bankMemory()) {
    for (const s of states) memory.observe(s);
    const counts = memory.counts();
    return counts && Object.fromEntries(counts);
}

describe('bankMemory', () => {
    test('no counts before the bank is seen open; the record given until then', () => {
        expect(seen([at(1, false), at(2, false)])).toBeNull();
        expect(seen([at(1, false)], bankMemory(new Map([['Air talisman', 1]])))).toEqual({ 'Air talisman': 1 });
    });

    test('the counts as seen open, over the record', () => {
        const record = bankMemory(new Map([['Air talisman', 1]]));
        const items = [
            { name: 'Logs', count: 5 },
            { name: 'Coins', count: 100 },
        ];
        expect(seen([at(1, items), at(2, false)], record)).toEqual({ Logs: 5, Coins: 100 });
    });

    test('a withdraw lowers the count, and one that takes a stack leaves it out', () => {
        const before = [
            { name: 'Air talisman', count: 3 },
            { name: 'Logs', count: 5 },
        ];
        expect(seen([at(1, before), at(2, [before[0]!, { name: 'Logs', count: 2 }]), at(3, false)])).toEqual({
            'Air talisman': 3,
            Logs: 2,
        });
        expect(seen([at(1, before), at(2, [before[1]!]), at(3, false)])).toEqual({ Logs: 5 });
    });

    describe('an empty list after a listed one', () => {
        const talisman = [{ name: 'Air talisman', count: 1 }];

        test('for the one tick before the bank closes, is not taken: the client empties it then', () => {
            expect(seen([at(1, talisman), at(2, []), at(3, false)])).toEqual({ 'Air talisman': 1 });
        });

        test('seen twice in one tick, is still one tick', () => {
            expect(seen([at(1, talisman), at(2, []), at(2, []), at(3, false)])).toEqual({ 'Air talisman': 1 });
        });

        test('open a second tick, is taken: the bank emptied', () => {
            expect(seen([at(1, talisman), at(2, []), at(3, []), at(4, false)])).toEqual({});
        });

        test('with nothing listed before it, is taken at once: an empty bank', () => {
            expect(seen([at(1, []), at(2, false)], bankMemory(new Map([['Air talisman', 1]])))).toEqual({});
        });
    });
});

describe('watchBank', () => {
    test('notes the states the driver hands out, now and on each tick', async () => {
        const memory = bankMemory();
        const driver = watchBank(
            new TimelineDriver([
                at(1, false),
                at(2, [{ name: 'Air talisman', count: 2 }]),
                at(3, [{ name: 'Air talisman', count: 1 }]),
            ]),
            memory,
        );
        driver.state();
        expect(memory.counts()).toBeNull();
        await driver.nextTick();
        expect(memory.counts()?.get('Air talisman')).toBe(2);
        await driver.nextTick();
        expect(memory.counts()?.get('Air talisman')).toBe(1);
    });
});
