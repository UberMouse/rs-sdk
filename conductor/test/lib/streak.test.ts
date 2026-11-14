import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import { ticks } from '../../core/op';
import { failStreak, type FailStreak } from '../../lib/streak';
import { type Counter, defineTask, type Step } from '../../lib/task';
import { TICK_MS } from '../../lib/util';
import { failStreakTicks, stuckWindowMs } from '../../lib/watchdog';
import { runDef } from '../engine/harness';
import { timeline } from '../world';

const fills = () => failStreak({ name: 'fillFails', limit: 3, worstTicks: 50, what: 'fills' });

/** The two context parts a streak reads, for a task named `t` listing `silent`; one count per name. */
function ctxOf(silent: (FailStreak | number)[]) {
    const counts = new Map<string, number>();
    const streak = (name: string): Counter => ({
        add: (by = 1) => {
            counts.set(name, (counts.get(name) ?? 0) + by);
            return counts.get(name) ?? 0;
        },
        reset: () => void counts.delete(name),
    });
    return { task: { name: 't', silent }, streak, counts };
}

describe('failStreak', () => {
    test('carries its name, limit and the silent ticks of its failures', () => {
        const s = fills();
        expect([s.name, s.limit, s.silentTicks]).toEqual(['fillFails', 3, failStreakTicks(3, 50)]);
    });

    test('a miss counts one, and the limit-th in a row fails with the standard sentence', () => {
        const s = fills();
        const ctx = ctxOf([s]);
        expect(s.miss(ctx, 'a')).toBeUndefined();
        expect(s.miss(ctx, 'b')).toBeUndefined();
        expect(s.miss(ctx, 'c')).toEqual({ fail: '3 fills in a row failed (last: c)' });
        expect(ctx.counts.get('fillFails')).toBe(3);
    });

    test('without a last message the sentence has no parenthesis', () => {
        const s = failStreak({ name: 'looks', limit: 1, worstTicks: 2, what: 'looks' });
        expect(s.miss(ctxOf([s]))).toEqual({ fail: '1 looks in a row failed' });
    });

    test('missWith fails with the caller text as given, or as a function of the limit', () => {
        const s = fills();
        const ctx = ctxOf([s]);
        s.missWith(ctx, 'unused');
        s.missWith(ctx, 'unused');
        expect(s.missWith(ctx, 'out of buckets')).toEqual({ fail: 'out of buckets' });
        const t = fills();
        const ctx2 = ctxOf([t]);
        t.miss(ctx2, 'x');
        t.miss(ctx2, 'x');
        expect(t.missWith(ctx2, limit => `gave up after ${limit}`)).toEqual({ fail: 'gave up after 3' });
    });

    test('clear resets the count, so the limit counts misses in a row', () => {
        const s = fills();
        const ctx = ctxOf([s]);
        s.miss(ctx, 'a');
        s.miss(ctx, 'b');
        s.clear(ctx);
        expect(s.miss(ctx, 'c')).toBeUndefined();
        expect(s.miss(ctx, 'd')).toBeUndefined();
        expect(s.miss(ctx, 'e')).toEqual({ fail: '3 fills in a row failed (last: e)' });
    });

    test('miss, missWith and clear throw for a streak the task does not list in its silent', () => {
        const s = fills();
        // Another streak of the same name is not this one.
        const ctx = ctxOf([fills(), 10]);
        const message = 'task "t" uses fail streak "fillFails" without listing it in its silent';
        expect(() => s.miss(ctx, 'a')).toThrow(message);
        expect(() => s.missWith(ctx, 'a')).toThrow(message);
        expect(() => s.clear(ctx)).toThrow(message);
        expect(ctx.counts.get('fillFails')).toBeUndefined();
    });
});

describe('TaskDef.silent', () => {
    const base = { name: 'test', description: 'streak test', params: z.object({}), steps: [] };

    test('defineTask sizes stuckAfterMs from it', () => {
        const s = fills();
        const def = defineTask({ ...base, silent: [s, 400] });
        expect(def.stuckAfterMs).toBe(stuckWindowMs(s, 400));
        expect(def.stuckAfterMs).toBe(400 * TICK_MS + 60_000);
        expect(defineTask({ ...base, silent: [s, 10] }).stuckAfterMs).toBe(stuckWindowMs(s.silentTicks));
    });

    test('a def with neither keeps the engine default', () => {
        expect(defineTask(base).stuckAfterMs).toBeUndefined();
    });

    test('a def giving both silent and stuckAfterMs throws, naming the task', () => {
        expect(() => defineTask({ ...base, silent: [fills()], stuckAfterMs: 1000 })).toThrow(
            'task "test": give silent or stuckAfterMs, not both',
        );
    });

    test('an empty silent throws, naming the task', () => {
        expect(() => defineTask({ ...base, silent: [] })).toThrow('task "test": silent is empty');
    });
});

const zOf = (ctx: Parameters<Step['when']>[0]) => ctx.state().player?.worldZ ?? 0;

/** Misses `s` each tick while z is not 2; idles otherwise. */
const steps = (s: FailStreak): Step[] => [
    {
        name: 'miss',
        when: ctx => zOf(ctx) !== 2,
        *run(ctx) {
            yield* ticks(1);
            return s.miss(ctx, `at tick ${ctx.state().tick}`);
        },
    },
    {
        name: 'idle',
        when: () => true,
        *run() {
            yield* ticks(1);
        },
    },
];

describe('a declared streak in a running task', () => {
    test('the engine resets it when its step stops applying', async () => {
        const s = fills();
        const def = defineTask({
            name: 'test',
            description: 'streak test',
            params: z.object({}),
            silent: [s],
            steps: steps(s),
        });
        // Two misses, a tick where the step does not apply, then three more: the third of those fails.
        const zs = [0, 0, 2, 0, 0, 0, 0, 0, 0];
        const r = await runDef(
            def,
            timeline(zs.length, t => ({ z: zs[t] })),
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('miss: 3 fills in a row failed (last: at tick 6)');
    });

    test('a task that does not list it errors naming the task and the streak', async () => {
        const s = fills();
        const def = defineTask({ name: 'test', description: 'streak test', params: z.object({}), steps: steps(s) });
        const r = await runDef(
            def,
            timeline(4, () => ({ z: 0 })),
        );
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('task "test" uses fail streak "fillFails" without listing it in its silent');
    });
});
