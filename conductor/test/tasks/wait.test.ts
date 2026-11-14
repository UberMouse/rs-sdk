import { describe, expect, test } from 'bun:test';
import { TICK_MS } from '../../lib/util';
import wait, { MAX_WAIT_TICKS } from '../../tasks/wait';
import { simulate } from '../simulate';
import { world } from '../world';

/** The bot standing still with nothing going on. */
const still = world().player({ hp: 10 });

describe('wait', () => {
    test('ends done after exactly `ticks` ticks, sending nothing', async () => {
        const r = await simulate(wait, { params: { ticks: 7 }, timeline: still.series(1) });
        expect(r.result).toMatchObject({ status: 'done', reason: 'wait: waited 7 ticks', endedBy: 'wait' });
        expect(r.result.durationMs).toBe(7 * TICK_MS);
        expect(r.sends).toEqual([]);
    });

    test('orFail ends it failed with the same reason', async () => {
        const r = await simulate(wait, { params: { ticks: 3, orFail: true }, timeline: still.series(1) });
        expect(r.result).toMatchObject({ status: 'failed', reason: 'wait: waited 3 ticks' });
        expect(r.result.durationMs).toBe(3 * TICK_MS);
    });

    test('params outside 1 to MAX_WAIT_TICKS, or a fraction, are refused', () => {
        for (const ticks of [0, MAX_WAIT_TICKS + 1, 2.5])
            expect(wait.params.safeParse({ ticks }).success, `ticks ${ticks}`).toBe(false);
        expect(wait.params.safeParse({}).success).toBe(false);
        expect(wait.params.parse({ ticks: MAX_WAIT_TICKS })).toEqual({ ticks: MAX_WAIT_TICKS, orFail: false });
    });

    test('the low-HP guard still ends a wait: falling HP with no food fails it', async () => {
        const r = await simulate(wait, {
            params: { ticks: 100 },
            timeline: still.series(20, (w, i) => (i >= 3 ? w.player({ hp: Math.max(1, 6 - i) }) : w)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.endedBy).toBe('interrupt:low-hp');
        expect(r.result.reason).toEndWith('no food');
        expect(r.result.durationMs).toBeLessThan(100 * TICK_MS);
    });

    test('the death guard still ends a wait', async () => {
        const r = await simulate(wait, {
            params: { ticks: 100 },
            timeline: still.series(10, (w, i) => (i === 5 ? w.player({ hp: 0 }).message('Oh dear, you are dead!') : w)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.endedBy).toBe('interrupt:death');
        expect(r.result.durationMs).toBe(5 * TICK_MS);
    });

    test('a stop ends it done mid-wait', async () => {
        const r = await simulate(wait, {
            params: { ticks: 500 },
            timeline: still.series(1),
            stops: [{ kind: 'minutes', minutes: 0.1 }],
        });
        expect(r.result).toMatchObject({ status: 'done', reason: 'reached 0.1 min' });
        expect(r.result.durationMs).toBeLessThan(500 * TICK_MS);
    });

    test('neither the watchdog nor the step budget ends a MAX_WAIT_TICKS wait in which nothing changes', async () => {
        const r = await simulate(wait, { params: { ticks: MAX_WAIT_TICKS }, timeline: still.series(1) });
        expect(r.result).toMatchObject({ status: 'done', reason: `wait: waited ${MAX_WAIT_TICKS} ticks` });
        expect(r.result.durationMs).toBe(MAX_WAIT_TICKS * TICK_MS);
    });
});
