import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import { ticks } from '../../core/op';
import { failStreak, type FailStreak, type PhraseStreak } from '../../lib/streak';
import { type Counter, defineTask, type Step } from '../../lib/task';
import { TICK_MS } from '../../lib/util';
import { assertWindowCovers, failStreakTicks, stuckWindowMs, taskStuckWindowMs } from '../../lib/watchdog';
import { runDef } from '../engine/harness';
import { timeline } from '../world';

const fills = () => failStreak({ name: 'fillFails', limit: 3, worstTicks: 50, what: 'fills' });
const reasons = () => failStreak({ name: 'fillFails', limit: 3, worstTicks: 50 });

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

    test('missWith fails with the caller text as given', () => {
        const s = reasons();
        const ctx = ctxOf([s]);
        expect(s.missWith(ctx, 'unused')).toBeUndefined();
        expect(s.missWith(ctx, 'unused')).toBeUndefined();
        expect(s.missWith(ctx, 'out of buckets')).toEqual({ fail: 'out of buckets' });
    });

    test('a streak declared without a what has no miss, and one with a what has no missWith', () => {
        // @ts-expect-error miss needs the what that builds its sentence
        expect(reasons().miss).toBeUndefined();
        // @ts-expect-error a streak with a what fails with its sentence, not caller text
        expect(fills().missWith).toBeUndefined();
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
        const r = reasons();
        // Another streak of the same name is not this one.
        const ctx = ctxOf([fills(), 10]);
        const message = 'task "t" uses fail streak "fillFails" without listing it in its silent';
        expect(() => s.miss(ctx, 'a')).toThrow(message);
        expect(() => r.missWith(ctx, 'a')).toThrow(message);
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

    test('two distinct fail streaks of one name throw, naming the task and the streak', () => {
        expect(() => defineTask({ ...base, silent: [fills(), fills()] })).toThrow(
            'task "test": two fail streaks named "fillFails" in its silent',
        );
        const s = fills();
        expect(defineTask({ ...base, silent: [s, s] }).stuckAfterMs).toBe(stuckWindowMs(s));
    });

    test('a copy of a defined task keeps its window', () => {
        const def = defineTask({ ...base, silent: [fills()] });
        expect(taskStuckWindowMs({ ...def })).toBe(def.stuckAfterMs ?? 0);
    });
});

describe('a def built without defineTask', () => {
    const idle: Step = {
        name: 'idle',
        when: () => true,
        *run() {
            yield* ticks(1);
        },
    };
    const literal = { name: 'literal', description: 'window test', params: z.object({}), steps: [idle] };

    test('with silent, the engine sizes its window from it', async () => {
        // [1]: one tick plus the margin, about 60 s where the default is 90 s.
        const r = await runDef({ ...literal, silent: [1] }, timeline(1));
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe(
            `no XP, position, HP or inventory change for ${Math.round(stuckWindowMs(1) / 1000)}s (last step: idle)`,
        );
    });

    test('a bad silent errors the run, naming the task', async () => {
        const both = await runDef({ ...literal, silent: [1], stuckAfterMs: 1000 }, timeline(1));
        expect([both.result.status, both.result.reason]).toEqual([
            'error',
            'task "literal": give silent or stuckAfterMs, not both',
        ]);
        const empty = await runDef({ ...literal, silent: [] }, timeline(1));
        expect([empty.result.status, empty.result.reason]).toEqual(['error', 'task "literal": silent is empty']);
        expect(both.sends).toEqual([]);
    });
});

/** The context part assertWindowCovers reads, for a task named `t`. */
const task = (silent: number[] | undefined, stuckAfterMs: number) => ({
    task: { name: 't', ...(silent && { silent }), stuckAfterMs },
});

describe('assertWindowCovers', () => {
    test('throws when a task with silent has a window shorter than the stretch', () => {
        expect(() => assertWindowCovers(task([10], stuckWindowMs(10)), 'the walk', 11)).toThrow(
            `task "t": its stuck window (${stuckWindowMs(10)} ms) does not cover the walk (11 ticks); list it in silent`,
        );
        expect(() => assertWindowCovers(task([11], stuckWindowMs(11)), 'the walk', 11)).not.toThrow();
    });

    test('does not check a task without silent', () => {
        expect(() => assertWindowCovers(task(undefined, 1), 'the walk', 11)).not.toThrow();
    });
});

const zOf = (ctx: Parameters<Step['when']>[0]) => ctx.state().player?.worldZ ?? 0;

/** Misses `s` each tick while z is not 2; idles otherwise. */
const steps = (s: PhraseStreak): Step[] => [
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
