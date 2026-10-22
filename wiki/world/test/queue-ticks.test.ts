import { describe, expect, test } from 'bun:test';
import { queueTicks } from '../model/families/common';

describe('queueTicks: a weakqueue(d) cadence', () => {
    test('from a click or dialog it runs at d; from inside a queue script at d + 1', () => {
        expect(queueTicks(4, false)).toBe(4);
        expect(queueTicks(4, true)).toBe(5);
        expect(queueTicks(0, true)).toBe(1);
    });

    // Worked from the scripts (survey 1b, 1f, 1h): a steady batch is the sum of the queue hops of one cycle.
    test('smelting from the menu: 5 ticks a bar', () => {
        // smelting.rs2:137-188: smelting_ore (inside the queue) queues start_smelt_ore with delay 0 (1 tick), which
        // queues smelting_ore with delay 3 (4 ticks): 1 + 4 = 5. The first bar, queued from the click with delay 4, is at 4.
        expect(queueTicks(0, true) + queueTicks(3, true)).toBe(5);
        expect(queueTicks(4, false)).toBe(4);
    });

    test('spinning: 3 ticks a string', () => {
        // spinning.rs2:36-110: the first at weakqueue 3 from the dialog, then weakqueue 2 from inside the queue.
        expect(queueTicks(3, false)).toBe(3);
        expect(queueTicks(2, true)).toBe(3);
    });

    test('fletching cut: 3 ticks a log', () => {
        // cut_logs.rs2:80-104: weakqueue 2 from inside the queue.
        expect(queueTicks(2, true)).toBe(3);
    });
});
