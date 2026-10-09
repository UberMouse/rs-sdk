import { describe, expect, test } from 'bun:test';
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../../sdk/types';
import { TimelineDriver } from '../../core/drivers/timeline';
import { CLEANUP_TICKS, type Guard, type GuardOutcome, interpret } from '../../core/interpret';
import {
    call,
    Cancelled,
    log,
    type Op,
    scan,
    screenshot,
    send,
    ticks,
    uninterruptible,
    wait,
    type WaitResult,
} from '../../core/op';
import { TICK_MS } from '../../lib/util';
import { timeline, worldState } from './states';

const act = (reason: string): BotAction => ({ type: 'none', reason });

/** The driver's command log as short strings, for order assertions. */
const trace = (d: TimelineDriver): string[] =>
    d.commands.map(c => {
        switch (c.type) {
            case 'send':
                return `send ${c.action.reason}`;
            case 'log':
                return `log ${c.msg}`;
            case 'call':
                return `call ${c.label}`;
            default:
                return c.type;
        }
    });

const guardLogs = (d: TimelineDriver): Record<string, unknown>[] =>
    d.commands.flatMap(c => (c.type === 'log' && c.msg.startsWith('guard ') ? [{ msg: c.msg, ...c.data }] : []));

/** A promise that onTick settles at `tick`, so a call stays pending across ticks. */
function gateAt<T>(tick: number, value: T) {
    let release!: (v: T) => void;
    const promise = new Promise<T>(r => {
        release = r;
    });
    const onTick = (s: BotWorldState): string | null => {
        if (s.tick === tick) release(value);
        return null;
    };
    return { promise, onTick };
}

// --- guards

const lowHp: Guard = {
    name: 'low-hp',
    policy: 'abort',
    when: s => (s.player?.hp ?? 0) < 5,
    *run() {
        yield* send(act('eat'));
    },
};

const death: Guard = {
    name: 'death',
    policy: 'abort',
    critical: true,
    when: s => (s.player?.hp ?? 0) <= 0,
    *run(): Op<GuardOutcome> {
        yield* log('died');
        return { fail: 'died' };
    },
};

const dialog: Guard = {
    name: 'dialog',
    policy: 'suspend',
    when: s => s.dialog.isOpen,
    *run() {
        yield* send(act('continue'));
    },
};

// --- ops under test

/** Sends, then waits for something that never comes; its finally sends a cleanup. */
function* busy(): Op<string> {
    try {
        yield* send(act('chop'));
        yield* wait('logs', () => false, 50);
        return 'unreachable';
    } finally {
        yield* send(act('cleanup'));
    }
}

/** `busy`, wrapped in a finally that itself waits. */
function* busyThenWaitsInFinally(): Op<string> {
    try {
        return yield* busy();
    } finally {
        yield* ticks(2);
        yield* log('cleaned');
    }
}

/** Waits forever; its finally sends `cleanup`, then runs `more`. */
function* waitsThenCleansUp(more: () => Op<void>): Op<void> {
    try {
        yield* wait('forever', () => false, 1000);
    } finally {
        yield* send(act('cleanup'));
        yield* more();
    }
}

function* waitsTooLong(): Op<void> {
    yield* wait('never', () => false, 1000);
    yield* send(act('after'));
}

// oxlint-disable-next-line require-yield -- throws before its first command, the case under test
function* throws(): Op<void> {
    throw new Error('oops');
}

/** A catch-all that swallows Cancelled, which ops must not do. */
function* swallowsCancel(): Op<string> {
    try {
        yield* wait('forever', () => false, 100);
        return 'waited';
    } catch {
        return 'caught';
    }
}

/** A catch that handles its own errors and rethrows Cancelled, as ops must. */
function* rethrowsCancel(): Op<string> {
    try {
        yield* wait('forever', () => false, 100);
        return 'waited';
    } catch (e) {
        if (e instanceof Cancelled) throw e;
        return 'caught';
    } finally {
        yield* send(act('cleanup'));
    }
}

function* sendsTwo(): Op<ActionResult[]> {
    const a = yield* send(act('a'));
    const b = yield* send(act('b'));
    return [a, b];
}

function* usesEveryCommand(): Op<[NearbyLoc[], number, string | null]> {
    const locs = yield* scan(15);
    const n = yield* call('legacy', async () => 42);
    yield* log('hello', { n });
    const shot = yield* screenshot('end');
    return [locs, n, shot];
}

function* catchesSendError(): Op<string> {
    try {
        yield* send(act('a'));
        return 'sent';
    } catch (e) {
        return `caught ${(e as Error).message}`;
    }
}

function* throwsAfterTwoTicks(): Op<void> {
    yield* ticks(2);
    throw new Error('boom');
}

function* typedHelpers(): Op<string> {
    // Compile-time check: no casts, and the annotations must match the helpers' result types.
    const w: WaitResult = yield* wait('now', () => true, 0);
    const s: BotWorldState = yield* ticks(1);
    const r: ActionResult = yield* send(act('a'));
    return `${w.kind} ${s.tick} ${r.success}`;
}

function* waitsAfterTwoTicks(): Op<WaitResult> {
    yield* ticks(2);
    return yield* wait('never', () => false, 3);
}

function* readsTicks(): Op<number[]> {
    const a = yield* ticks(0);
    const b = yield* ticks(4);
    return [a.tick, b.tick];
}

function* waitsForTick5(): Op<WaitResult> {
    yield* send(act('start'));
    return yield* wait('tick 5', s => s.tick >= 5, 20);
}

function* inner(): Op<void> {
    try {
        yield* wait('forever', () => false, 100);
    } finally {
        yield* send(act('inner cleanup'));
    }
}

function* middle(): Op<void> {
    try {
        yield* inner();
        yield* send(act('after inner'));
    } finally {
        yield* send(act('middle cleanup'));
    }
}

function* outer(): Op<void> {
    try {
        yield* middle();
    } finally {
        yield* send(act('outer cleanup'));
    }
}

function* withdraw(): Op<void> {
    try {
        yield* ticks(5);
    } finally {
        yield* send(act('close bank'));
    }
}

function* criticalThenWait(): Op<void> {
    yield* uninterruptible(ticks(3));
    yield* wait('after', () => false, 10);
}

/** An uninterruptible inner section (1 tick) followed by 3 more ticks, all inside an outer one. */
function* trade(): Op<void> {
    yield* uninterruptible(ticks(1));
    yield* ticks(3);
}

function* nestedCriticalThenWait(): Op<void> {
    yield* uninterruptible(trade());
    yield* wait('after', () => false, 10);
}

// --- tests

describe('commands', () => {
    test('send threads the driver result back into the op', async () => {
        const d = new TimelineDriver([worldState(0)], {
            respond: a => (a.reason === 'b' ? { success: false, message: 'nope' } : undefined),
        });
        expect(await interpret(sendsTwo(), { driver: d })).toEqual({
            kind: 'returned',
            value: [
                { success: true, message: 'ok' },
                { success: false, message: 'nope' },
            ],
        });
        expect(trace(d)).toEqual(['send a', 'send b']);
    });

    test('scan, call, log and screenshot forward to the driver and return its results', async () => {
        const loc: NearbyLoc = {
            id: 1,
            name: 'Tree',
            x: 1,
            z: 2,
            level: 0,
            distance: 3,
            optionsWithIndex: [],
            options: [],
        };
        const d = new TimelineDriver([worldState(0)], { scan: () => [loc] });
        const r = await interpret(usesEveryCommand(), { driver: d });
        expect(r).toEqual({ kind: 'returned', value: [[loc], 42, null] });
        expect(trace(d)).toEqual(['scan', 'call legacy', 'log hello', 'screenshot']);
    });

    test('a rejected send is thrown into the op, which can catch it', async () => {
        const d = new TimelineDriver([worldState(0)], {
            respond: () => {
                throw new Error('socket closed');
            },
        });
        const r = await interpret(catchesSendError(), { driver: d });
        expect(r).toEqual({ kind: 'returned', value: 'caught socket closed' });
    });

    test('an exception thrown by the op propagates out of interpret', async () => {
        const d = new TimelineDriver(timeline(5));
        await expect(interpret(throwsAfterTwoTicks(), { driver: d })).rejects.toThrow('boom');
    });

    test('helpers are typed at the call site', async () => {
        const d = new TimelineDriver(timeline(5));
        expect(await interpret(typedHelpers(), { driver: d })).toEqual({ kind: 'returned', value: 'met 1 true' });
    });
});

describe('wait', () => {
    test('met on the first tick the predicate holds', async () => {
        const d = new TimelineDriver(timeline(8, t => ({ dialog: t === 3 })));
        const r = await interpret(
            wait('dialog', s => s.dialog.isOpen, 10),
            { driver: d },
        );
        expect(r.kind === 'returned' && r.value).toMatchObject({ kind: 'met', state: { tick: 3 } });
    });

    test('checks the current state before waiting a tick', async () => {
        const d = new TimelineDriver(timeline(3));
        const r = await interpret(
            wait('now', () => true, 10),
            { driver: d },
        );
        expect(r.kind === 'returned' && r.value.kind).toBe('met');
        expect(d.ticksElapsed).toBe(0);
    });

    test("timeout when the budget, counted from the wait's first state, runs out", async () => {
        const r = await interpret(waitsAfterTwoTicks(), { driver: new TimelineDriver(timeline(10)) });
        expect(r.kind === 'returned' && r.value).toMatchObject({ kind: 'timeout', state: { tick: 5 } });
    });

    test('ticks(n) returns the state n ticks on; ticks(0) the current one', async () => {
        const r = await interpret(readsTicks(), { driver: new TimelineDriver(timeline(10)) });
        expect(r).toEqual({ kind: 'returned', value: [0, 4] });
    });
});

describe('guards', () => {
    test("abort runs the op's finally (including a cleanup send), then the guard's op", async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t === 2 ? 3 : 10 })));
        const r = await interpret(busyThenWaitsInFinally(), { driver: d, guards: [lowHp] });
        expect(r).toEqual({ kind: 'aborted', by: 'low-hp', outcome: undefined });
        expect(trace(d)).toEqual(['send chop', 'log guard low-hp (abort)', 'send cleanup', 'log cleaned', 'send eat']);
        expect(guardLogs(d)).toEqual([{ msg: 'guard low-hp (abort)', tick: 2 }]);
        // Fired on tick 2; the finally waited 2 more.
        expect(d.ticksElapsed).toBe(4);
    });

    test('a guard can fire on the first check, before any tick', async () => {
        const d = new TimelineDriver(timeline(5, () => ({ hp: 3 })));
        const r = await interpret(busy(), { driver: d, guards: [lowHp] });
        expect(r.kind).toBe('aborted');
        expect(trace(d)).toEqual(['send chop', 'log guard low-hp (abort)', 'send cleanup', 'send eat']);
        expect(d.ticksElapsed).toBe(0);
    });

    test("the guard op's done/fail is carried in the result", async () => {
        const d = new TimelineDriver(timeline(5, t => ({ hp: t >= 1 ? 0 : 10 })));
        const r = await interpret(busy(), { driver: d, guards: [death] });
        expect(r).toEqual({ kind: 'aborted', by: 'death', outcome: { fail: 'died' } });
    });

    test('the first guard in priority order wins when several hold', async () => {
        const d = new TimelineDriver(timeline(5, () => ({ hp: 0 })));
        const r = await interpret(busy(), { driver: d, guards: [death, lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('death');
    });

    test("inside an abort guard's op the guard does not re-enter, other guards still fire", async () => {
        // Low HP from tick 1; the bot dies on tick 4 while the low-hp op waits to regenerate.
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 4 ? 0 : t >= 1 ? 3 : 10 })));
        const regen: Guard = {
            ...lowHp,
            *run() {
                yield* ticks(5);
                yield* send(act('regenerated'));
            },
        };
        const r = await interpret(busy(), { driver: d, guards: [regen, death] });
        expect(r).toEqual({ kind: 'aborted', by: 'death', outcome: { fail: 'died' } });
        expect(guardLogs(d)).toEqual([
            { msg: 'guard low-hp (abort)', tick: 1 },
            { msg: 'guard death (abort)', tick: 4 },
        ]);
        expect(trace(d)).not.toContain('send regenerated');
    });

    test('suspend runs the guard op, then the same wait resumes; at most once per tick', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ dialog: t === 2 || t === 3 })));
        const r = await interpret(waitsForTick5(), { driver: d, guards: [dialog] });
        expect(r.kind === 'returned' && r.value).toMatchObject({ kind: 'met', state: { tick: 5 } });
        // The handler doesn't close the dialog, so it runs again on tick 3 rather than looping on tick 2.
        expect(trace(d)).toEqual([
            'send start',
            'log guard dialog (suspend)',
            'send continue',
            'log guard dialog (suspend)',
            'send continue',
        ]);
        expect(guardLogs(d).map(g => g.tick)).toEqual([2, 3]);
    });

    test('guards are off inside a suspend handler and checked again once the wait resumes', async () => {
        // Dialog on tick 1; HP low from tick 2, while the handler waits.
        const d = new TimelineDriver(timeline(10, t => ({ dialog: t === 1, hp: t >= 2 ? 3 : 10 })));
        const slowDialog: Guard = {
            ...dialog,
            *run() {
                yield* ticks(2);
                yield* send(act('continue'));
            },
        };
        const r = await interpret(busy(), { driver: d, guards: [slowDialog, lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(guardLogs(d)).toEqual([
            { msg: 'guard dialog (suspend)', tick: 1 },
            { msg: 'guard low-hp (abort)', tick: 3 },
        ]);
    });

    test('a suspend guard returning fail ends the run as aborted after the op cleans up', async () => {
        const d = new TimelineDriver(timeline(5, t => ({ dialog: t === 1 })));
        const stuck: Guard = {
            ...dialog,
            *run(): Op<GuardOutcome> {
                yield* send(act('continue'));
                return { fail: 'dialog stuck' };
            },
        };
        const r = await interpret(busy(), { driver: d, guards: [stuck] });
        expect(r).toEqual({ kind: 'aborted', by: 'dialog', outcome: { fail: 'dialog stuck' } });
        expect(trace(d)).toEqual(['send chop', 'log guard dialog (suspend)', 'send continue', 'send cleanup']);
    });
});

describe('cancellation', () => {
    test('onTick returning a reason cancels the op and runs its finally', async () => {
        const seen: number[] = [];
        const onTick = (s: BotWorldState) => {
            seen.push(s.tick);
            return s.tick === 3 ? 'minutes:1 reached' : null;
        };
        const d = new TimelineDriver(timeline(10));
        const r = await interpret(busy(), { driver: d, onTick });
        expect(r).toEqual({ kind: 'cancelled', reason: 'minutes:1 reached' });
        expect(trace(d)).toEqual(['send chop', 'send cleanup']);
        expect(seen).toEqual([0, 1, 2, 3]);
    });

    test('onTick is checked before guards', async () => {
        const d = new TimelineDriver(timeline(5, () => ({ hp: 3 })));
        const r = await interpret(busy(), { driver: d, guards: [lowHp], onTick: () => 'stop' });
        expect(r.kind).toBe('cancelled');
        expect(trace(d)).not.toContain('send eat');
    });

    test('nested yield* ops are cancelled through the whole stack, innermost finally first', async () => {
        const d = new TimelineDriver(timeline(10));
        const r = await interpret(outer(), { driver: d, onTick: s => (s.tick === 2 ? 'stop' : null) });
        expect(r.kind).toBe('cancelled');
        expect(trace(d)).toEqual(['send inner cleanup', 'send middle cleanup', 'send outer cleanup']);
    });

    test('a finally that waits past the cleanup cap is abandoned and logged', async () => {
        const d = new TimelineDriver(timeline(5, t => ({ hp: t === 1 ? 3 : 10 })));
        const r = await interpret(waitsThenCleansUp(waitsTooLong), { driver: d, guards: [lowHp] });
        expect(r).toEqual({ kind: 'aborted', by: 'low-hp', outcome: undefined });
        expect(trace(d)).toEqual([
            'log guard low-hp (abort)',
            'send cleanup',
            `log cleanup abandoned: wait "never" past the ${CLEANUP_TICKS}-tick cap`,
            'send eat',
        ]);
        expect(d.ticksElapsed).toBe(1 + CLEANUP_TICKS);
    });

    test('a finally that throws is logged and the guard still acts', async () => {
        const d = new TimelineDriver(timeline(5, t => ({ hp: t === 1 ? 3 : 10 })));
        const r = await interpret(waitsThenCleansUp(throws), { driver: d, guards: [lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(trace(d)).toEqual(['log guard low-hp (abort)', 'send cleanup', 'log cleanup threw: oops', 'send eat']);
    });

    test('an op that swallows Cancelled is logged, and the cancellation still stands', async () => {
        const d = new TimelineDriver(timeline(5));
        const r = await interpret(swallowsCancel(), { driver: d, onTick: s => (s.tick === 1 ? 'stop' : null) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual(['log cleanup: the op caught Cancelled and returned instead of rethrowing it']);
    });

    test('an op that rethrows Cancelled from its catch cleans up quietly', async () => {
        const d = new TimelineDriver(timeline(5));
        const r = await interpret(rethrowsCancel(), { driver: d, onTick: s => (s.tick === 1 ? 'stop' : null) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual(['send cleanup']);
    });
});

describe('uninterruptible', () => {
    test('blocks non-critical guards until the section ends', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 1 ? 3 : 10 })));
        const r = await interpret(criticalThenWait(), { driver: d, guards: [lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(guardLogs(d)).toEqual([{ msg: 'guard low-hp (abort)', tick: 3 }]);
    });

    test('lets critical guards through, cancelling the section', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 2 ? 0 : 10 })));
        const r = await interpret(uninterruptible(withdraw()), { driver: d, guards: [lowHp, death] });
        expect(r).toEqual({ kind: 'aborted', by: 'death', outcome: { fail: 'died' } });
        expect(guardLogs(d)).toEqual([{ msg: 'guard death (abort)', tick: 2 }]);
        expect(trace(d)).toContain('send close bank');
    });

    test('nests: leaving an inner section keeps the outer one in force', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 1 ? 3 : 10 })));
        const r = await interpret(nestedCriticalThenWait(), { driver: d, guards: [lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(guardLogs(d)).toEqual([{ msg: 'guard low-hp (abort)', tick: 4 }]);
    });
});

describe('call', () => {
    test('a guard firing during a call acts once the call settles, and is logged', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 2 ? 3 : 10 })));
        // The call settles only after tick 2, when the guard fires, has been checked.
        const gate = gateAt(2, 'arrived');
        const legacyWalk = async () => {
            const v = await gate.promise;
            d.log('settled');
            return v;
        };
        function* op(): Op<string> {
            try {
                return yield* call('legacy walk', legacyWalk);
            } finally {
                yield* send(act('cleanup'));
            }
        }
        const r = await interpret(op(), { driver: d, guards: [lowHp], onTick: gate.onTick });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(trace(d)).toEqual([
            'call legacy walk',
            'log settled',
            'log guard low-hp (abort)',
            'send cleanup',
            'send eat',
        ]);
        expect(guardLogs(d)).toEqual([{ msg: 'guard low-hp (abort)', tick: 2, during: 'legacy walk' }]);
        // Once the guard fires the interpreter stops taking ticks and only waits for the call.
        expect(d.ticksElapsed).toBe(2);
    });

    test('after a suspend guard during a call, the op gets the call result', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ dialog: t === 1 })));
        const gate = gateAt(1, 'arrived');
        const r = await interpret(
            call('legacy walk', () => gate.promise),
            { driver: d, guards: [dialog], onTick: gate.onTick },
        );
        expect(r).toEqual({ kind: 'returned', value: 'arrived' });
        expect(trace(d)).toEqual(['call legacy walk', 'log guard dialog (suspend)', 'send continue']);
    });
});

describe('TimelineDriver', () => {
    test('repeats the last state with the tick advanced, or rejects when strict', async () => {
        const loose = new TimelineDriver(timeline(2));
        await loose.nextTick();
        expect((await loose.nextTick()).tick).toBe(2);
        expect(loose.now()).toBe(2 * TICK_MS);

        const strict = new TimelineDriver(timeline(2), { strict: true });
        await expect(interpret(ticks(5), { driver: strict })).rejects.toThrow('timeline ended at tick 1');
    });
});
