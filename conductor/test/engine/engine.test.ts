import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { TimelineDriver } from '../../core/drivers/timeline';
import { TickStall } from '../../core/interpret';
import { type Op, send, uninterruptible, wait } from '../../core/op';
import { executeTask, MAX_STEP_COMMANDS } from '../../lib/engine';
import type { StopCondition } from '../../lib/stop';
import { defineTask, type Outcome, type Sinks, type Step } from '../../lib/task';
import { TICK_MS } from '../../lib/util';
import { act } from '../core/fixtures';
import { timeline } from '../core/states';

interface RunOptions {
    stops?: StopCondition[];
    stuckAfterMs?: number;
    stepTimeoutMs?: number;
    driver?: TimelineDriver;
}

/** Runs `steps` as a task on a scripted timeline, with in-memory sinks. */
async function runTask(steps: Step[], states: BotWorldState[], opts: RunOptions = {}) {
    const driver = opts.driver ?? new TimelineDriver(states);
    const events: Record<string, unknown>[] = [];
    const printed: string[] = [];
    const legacy: string[] = [];
    const sinks: Sinks = {
        event: e => events.push(e),
        print: line => printed.push(line),
        screenshot: async label => `/shots/${label}.png`,
    };
    // The interrupts still act through BotActions and the SDK. Only what they call is faked (hence
    // the casts), and each fake takes a tick, as the game would.
    const bot = {
        eatFood: async (food: InventoryItem) => {
            legacy.push(`eat ${food.name}`);
            await driver.nextTick();
            return { success: true, message: 'ate' };
        },
        dismissBlockingUI: async () => {
            legacy.push('dismiss');
            await driver.nextTick();
        },
    } as unknown as BotActions;
    const sdk = {
        waitForTicks: async (n: number) => {
            for (let i = 0; i < n; i++) await driver.nextTick();
            return driver.state();
        },
    } as unknown as BotSDK;
    const def = defineTask({
        name: 'test',
        description: 'engine test',
        params: z.object({}),
        steps,
        ...(opts.stuckAfterMs !== undefined && { stuckAfterMs: opts.stuckAfterMs }),
        ...(opts.stepTimeoutMs !== undefined && { stepTimeoutMs: opts.stepTimeoutMs }),
    });
    const result = await executeTask(def, {
        driver,
        sinks,
        bot,
        sdk,
        botName: 'tester',
        runId: 'run-1',
        logFile: '/logs/run-1.ndjson',
        rawParams: {},
        stops: opts.stops ?? [],
    });
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : []));
    return { result, events, printed, legacy, driver, sends };
}

const xpOf = (s: BotWorldState) => s.skills[0]?.experience ?? 0;

/** Sends `chop`, waits for XP; its finally sends `cleanup`. */
function* chop(): Op<Outcome> {
    try {
        yield* send(act('chop'));
        const w = yield* wait('xp', s => xpOf(s) > 0, 50);
        return w.kind === 'met' ? { done: `xp at tick ${w.state.tick}` } : { fail: 'no xp' };
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Waits for something that never comes; its finally sends `cleanup`. */
function* idle(): Op<Outcome> {
    try {
        yield* send(act('start'));
        yield* wait('never', () => false, 1000);
        return { done: 'unreachable' };
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Opens the bank, then waits uninterruptibly; its finally closes the bank. */
function* banking(): Op<Outcome> {
    try {
        yield* send(act('open bank'));
        yield* uninterruptible(wait('never', () => false, 50));
        return { done: 'unreachable' };
    } finally {
        yield* send(act('close bank'));
    }
}

/** Sends forever without waiting; its finally sends `cleanup`. */
function* spam(): Op<Outcome> {
    try {
        for (;;) yield* send(act('spam'));
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Waits for XP, then fails. */
function* chopOnce(): Op<Outcome> {
    yield* wait('xp', s => xpOf(s) > 0, 50);
    return { fail: 'out of trees' };
}

const step = (name: string, run: Step['run']): Step => ({ name, when: () => true, run });

const guardLog = (events: Record<string, unknown>[], name: string) =>
    events.filter(e => e.type === 'log' && typeof e.msg === 'string' && e.msg.startsWith(`guard ${name} `));

describe('guards during a generator step', () => {
    test('low HP mid-wait aborts the step, runs its finally, eats, and the step runs again', async () => {
        const states = timeline(20, t => ({ hp: t === 3 || t === 4 ? 4 : 10, food: 2, xp: t >= 10 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('chop: xp at tick 10');
        // Aborted at tick 3, cleaned up, then chopped again once HP was back.
        expect(r.sends).toEqual(['chop', 'cleanup', 'chop', 'cleanup']);
        // The guard ate at tick 3 (taking a tick); HP was still low at tick 4, so the interrupt
        // ate again between steps, as it would for a legacy task.
        expect(r.legacy).toEqual(['eat Shrimps', 'eat Shrimps']);
        expect(guardLog(r.events, 'interrupt:low-hp')).toEqual([
            { type: 'log', msg: 'guard interrupt:low-hp (abort)', data: { tick: 3 } },
        ]);
        expect(r.result.stepRuns).toEqual({ chop: 2, 'interrupt:low-hp': 2 });
    });

    test('a level-up dialog mid-wait is dismissed and the same wait completes', async () => {
        const states = timeline(20, t => ({ dialog: t === 3, xp: t >= 8 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('chop: xp at tick 8');
        expect(r.sends).toEqual(['chop', 'cleanup']);
        expect(r.legacy).toEqual(['dismiss']);
        expect(r.result.stepRuns).toEqual({ chop: 1, 'interrupt:dialog': 1 });
    });

    test('death mid-wait fails the run, even inside an uninterruptible section', async () => {
        const r = await runTask(
            [step('bank', banking)],
            timeline(20, t => ({ dead: t === 4 })),
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('interrupt:death: died');
        expect(r.sends).toEqual(['open bank', 'close bank']);
        expect(r.result.lastStep).toBe('bank');
    });
});

describe('onTick during a generator step', () => {
    test('an xp stop ends the run mid-wait as done', async () => {
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ xp: t >= 5 ? 20 : 0 })),
            {
                stops: [{ kind: 'xp', skill: 'Woodcutting', amount: 10 }],
            },
        );
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +10 Woodcutting xp');
        expect(r.sends).toEqual(['start', 'cleanup']);
        expect(r.result.durationMs).toBe(5 * TICK_MS);
    });

    test('a minutes stop ends the run mid-wait as done', async () => {
        // 0.01 min = 600 ms: past it on the second tick.
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ z: 3200 + t })),
            {
                stops: [{ kind: 'minutes', minutes: 0.01 }],
            },
        );
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached 0.01 min');
        expect(r.result.durationMs).toBe(2 * TICK_MS);
        expect(r.sends).toEqual(['start', 'cleanup']);
    });

    test('the watchdog ends a run that changes nothing as stuck', async () => {
        const r = await runTask([step('idle', idle)], timeline(3), { stuckAfterMs: 5 * TICK_MS });
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('no XP, position, HP or inventory change for 2s (last step: idle)');
        expect(r.result.durationMs).toBe(6 * TICK_MS);
        expect(r.sends).toEqual(['start', 'cleanup']);
    });

    test('the step timeout cancels the step as a tick budget and runs its finally', async () => {
        // Moving every tick, so only the step budget can end it.
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ z: 3200 + t })),
            {
                stepTimeoutMs: 5 * TICK_MS,
            },
        );
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('step "idle" ran over 5 ticks (2s)');
        expect(r.sends).toEqual(['start', 'cleanup']);
        expect(r.events.some(e => e.type === 'abandoned-step-error')).toBe(false);
    });

    test('a step that sends forever without waiting fails at the command cap, running its finally', async () => {
        const r = await runTask([step('spam', spam)], timeline(3));
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain(`yielded over ${MAX_STEP_COMMANDS} commands`);
        expect(r.sends.length).toBe(MAX_STEP_COMMANDS + 1);
        expect(r.sends.at(-1)).toBe('cleanup');
    });

    test('a client that stops publishing ticks ends the run stuck', async () => {
        class Stalls extends TimelineDriver {
            override nextTick() {
                return this.ticksElapsed >= 3
                    ? Promise.reject(new TickStall('client stopped publishing ticks for 30s'))
                    : super.nextTick();
            }
        }
        const r = await runTask([step('chop', chop)], [], { driver: new Stalls(timeline(10)) });
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('client stopped publishing ticks for 30s');
        expect(r.sends).toEqual(['chop', 'cleanup']);
    });
});

describe('legacy steps', () => {
    test('an async step runs as one call, after the interrupts between steps', async () => {
        const legacyStep: Step = {
            name: 'legacy',
            when: () => true,
            run: async ctx => {
                await ctx.sdk.waitForTicks(2);
                return { done: `at tick ${ctx.state().tick}` };
            },
        };
        const r = await runTask(
            [legacyStep],
            timeline(10, t => ({ dialog: t === 0 })),
        );
        expect(r.result.status).toBe('done');
        // The dialog interrupt took tick 0 -> 1, then the step waited two ticks.
        expect(r.result.reason).toBe('legacy: at tick 3');
        expect(r.result.stepRuns).toEqual({ 'interrupt:dialog': 1, legacy: 1 });
        expect(r.driver.commands.flatMap(c => (c.type === 'call' ? [c.label] : []))).toEqual([
            'interrupt:dialog',
            'legacy',
        ]);
    });
});

describe('the result', () => {
    test('TaskResult fields are populated, with a screenshot on a non-done finish', async () => {
        const states = timeline(10, t => (t < 3 ? { food: 2 } : { food: 1, xp: 100, level: 2 }));
        const r = await runTask([step('chop', chopOnce)], states);
        expect(r.result).toEqual({
            task: 'test',
            bot: 'tester',
            runId: 'run-1',
            status: 'failed',
            reason: 'chop: out of trees',
            params: {},
            durationMs: 3 * TICK_MS,
            loops: 1,
            stepRuns: { chop: 1 },
            lastStep: 'chop',
            xpGained: { Woodcutting: 100 },
            levelsGained: { Woodcutting: { from: 1, to: 2 } },
            inventoryDelta: { Shrimps: -1 },
            finalPos: { x: 3222, z: 3218, level: 0 },
            hp: { current: 10, max: 10 },
            inCombat: false,
            screenshots: ['/shots/test-failed.png'],
            logFile: '/logs/run-1.ndjson',
        });
        expect(r.events.map(e => e.type)).toEqual(['start', 'step', 'screenshot', 'result']);
        expect(r.events.at(-1)).toEqual({ type: 'result', ...r.result });
        expect(r.printed.at(-1)).toBe('[task:test] failed: chop: out of trees');
    });
});
