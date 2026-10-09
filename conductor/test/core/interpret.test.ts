import { describe, expect, test } from 'bun:test';
import type { ActionResult, BotWorldState, NearbyLoc } from '../../../sdk/types';
import { TimelineDriver } from '../../core/drivers/timeline';
import { type Guard, interpret, MAX_SUSPEND_STREAK } from '../../core/interpret';
import {
    call,
    type Command,
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
import { act, busy, death, dialog, gateAt, guardLogs, lowHp, slowDialog, trace } from './fixtures';
import { timeline, worldState } from './states';

/** A critical guard with nothing to do in game returns its outcome directly. */
const wilderness: Guard = {
    name: 'wilderness',
    policy: 'abort',
    critical: true,
    when: s => (s.player?.worldZ ?? 0) > 3520,
    run: s => ({ fail: `in the Wilderness at z ${s.player?.worldZ}` }),
};

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

function* busyThenWaitsInFinally(): Op<string> {
    try {
        return yield* busy();
    } finally {
        yield* ticks(2);
        yield* log('cleaned');
    }
}

function* waitsForTick(n: number, budget = 20): Op<WaitResult> {
    yield* send(act('start'));
    return yield* wait(`tick ${n}`, s => s.tick >= n, budget);
}

function* threeInstantWaits(): Op<void> {
    for (let i = 0; i < 3; i++) yield* wait('now', () => true, 0);
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

function* criticalThenWaitForTick5(): Op<WaitResult> {
    yield* uninterruptible(ticks(3));
    return yield* wait('tick 5', s => s.tick >= 5, 10);
}

function* forgesCritical(): Op<string> {
    try {
        // Only op.ts can make a marker; this forgery is the case under test.
        yield { type: 'critical' } as unknown as Command;
        return 'accepted';
    } catch (e) {
        return (e as Error).message;
    }
}

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

describe('abort guards', () => {
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

    test('a guard can return its outcome without an op', async () => {
        const d = new TimelineDriver(timeline(3, t => ({ z: t >= 1 ? 3600 : 3218 })));
        const r = await interpret(busy(), { driver: d, guards: [wilderness] });
        expect(r).toEqual({ kind: 'aborted', by: 'wilderness', outcome: { fail: 'in the Wilderness at z 3600' } });
        expect(trace(d)).toEqual(['send chop', 'log guard wilderness (abort)', 'send cleanup']);
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
});

describe('suspend guards', () => {
    test('the guard op runs, then the same wait resumes; at most once per tick', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ dialog: t === 2 || t === 3 })));
        const r = await interpret(waitsForTick(5), { driver: d, guards: [dialog] });
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

    test('once per tick holds across waits, and across interpret calls sharing firedAt', async () => {
        // A 0-tick handler leaves the dialog visible until the next tick.
        const d = new TimelineDriver(timeline(3, t => ({ dialog: t === 0 })));
        const firedAt = new Map<string, number>();
        await interpret(threeInstantWaits(), { driver: d, guards: [dialog], firedAt });
        await interpret(threeInstantWaits(), { driver: d, guards: [dialog], firedAt });
        expect(trace(d)).toEqual(['log guard dialog (suspend)', 'send continue']);
    });

    test('after a handler that waits, the wait sees until before the guard fires again', async () => {
        // The dialog never closes; each handler run takes a tick.
        const d = new TimelineDriver(timeline(10, () => ({ dialog: true })));
        const r = await interpret(waitsForTick(2, 5), { driver: d, guards: [slowDialog(1)] });
        expect(r.kind === 'returned' && r.value).toMatchObject({ kind: 'met', state: { tick: 2 } });
        expect(guardLogs(d).map(g => g.tick)).toEqual([0, 1]);
    });

    test("ticks a handler takes count against the wait's budget", async () => {
        const d = new TimelineDriver(timeline(10, () => ({ dialog: true })));
        const r = await interpret(waitsForTick(99, 3), { driver: d, guards: [slowDialog(1)] });
        expect(r.kind === 'returned' && r.value).toMatchObject({ kind: 'timeout', state: { tick: 3 } });
        expect(guardLogs(d).map(g => g.tick)).toEqual([0, 1, 2]);
    });

    test('several separate dialogs in one wait are each handled and the wait completes', async () => {
        // Seven one-tick dialogs (level-ups), each cleared by one continue.
        const d = new TimelineDriver(timeline(20, t => ({ dialog: t % 2 === 1 && t <= 13 })));
        const r = await interpret(waitsForTick(15), { driver: d, guards: [dialog] });
        expect(r.kind === 'returned' && r.value).toMatchObject({ kind: 'met', state: { tick: 15 } });
        expect(guardLogs(d).map(g => g.tick)).toEqual([1, 3, 5, 7, 9, 11, 13]);
    });

    test('a multi-page dialog, one page per handler run, completes', async () => {
        // Twelve pages on consecutive ticks: the guard holds twelve runs in a row.
        const d = new TimelineDriver(timeline(20, t => ({ dialog: t >= 1 && t <= 12 })));
        const r = await interpret(waitsForTick(14), { driver: d, guards: [dialog] });
        expect(r.kind === 'returned' && r.value).toMatchObject({ kind: 'met', state: { tick: 14 } });
        expect(trace(d).filter(c => c === 'send continue')).toHaveLength(12);
    });

    test(`a guard still held after ${MAX_SUSPEND_STREAK} handler runs in a row fails the run`, async () => {
        const d = new TimelineDriver(timeline(40, () => ({ dialog: true })));
        const r = await interpret(busy(), { driver: d, guards: [dialog] });
        expect(r).toEqual({
            kind: 'aborted',
            by: 'dialog',
            outcome: {
                fail: `dialog still held after ${MAX_SUSPEND_STREAK} handler runs in a row in wait "logs"`,
            },
        });
        expect(guardLogs(d)).toHaveLength(MAX_SUSPEND_STREAK);
        expect(trace(d).at(-1)).toBe('send cleanup');
    });

    test('guards are off inside a suspend handler and checked again once the wait resumes', async () => {
        // Dialog on tick 1; HP low from tick 2, while the handler waits.
        const d = new TimelineDriver(timeline(10, t => ({ dialog: t === 1, hp: t >= 2 ? 3 : 10 })));
        const r = await interpret(busy(), { driver: d, guards: [slowDialog(2), lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(guardLogs(d)).toEqual([
            { msg: 'guard dialog (suspend)', tick: 1 },
            { msg: 'guard low-hp (abort)', tick: 3 },
        ]);
    });

    test('a suspend guard returning fail ends the run as aborted after the op cleans up', async () => {
        const d = new TimelineDriver(timeline(5, t => ({ dialog: t === 1 })));
        const stuck: Guard = { ...dialog, run: () => ({ fail: 'dialog stuck' }) };
        const r = await interpret(busy(), { driver: d, guards: [stuck] });
        expect(r).toEqual({ kind: 'aborted', by: 'dialog', outcome: { fail: 'dialog stuck' } });
        expect(trace(d)).toEqual(['send chop', 'log guard dialog (suspend)', 'send cleanup']);
    });
});

describe('uninterruptible', () => {
    test('blocks non-critical guards until the section ends', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 1 ? 3 : 10 })));
        const r = await interpret(criticalThenWait(), { driver: d, guards: [lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(guardLogs(d)).toEqual([{ msg: 'guard low-hp (abort)', tick: 3 }]);
    });

    test('blocks a non-critical suspend guard until the section ends', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ dialog: t >= 1 && t <= 3 })));
        const r = await interpret(criticalThenWaitForTick5(), { driver: d, guards: [dialog] });
        expect(r.kind === 'returned' && r.value).toMatchObject({ kind: 'met', state: { tick: 5 } });
        expect(guardLogs(d)).toEqual([{ msg: 'guard dialog (suspend)', tick: 3 }]);
    });

    test('lets critical guards through: the section cleans up, then the guard runs', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 2 ? 0 : 10 })));
        const r = await interpret(uninterruptible(withdraw()), { driver: d, guards: [lowHp, death] });
        expect(r).toEqual({ kind: 'aborted', by: 'death', outcome: { fail: 'died' } });
        expect(trace(d)).toEqual(['log guard death (abort)', 'send close bank', 'log died']);
        expect(guardLogs(d)).toEqual([{ msg: 'guard death (abort)', tick: 2 }]);
    });

    test('nests: leaving an inner section keeps the outer one in force', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 1 ? 3 : 10 })));
        const r = await interpret(nestedCriticalThenWait(), { driver: d, guards: [lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(guardLogs(d)).toEqual([{ msg: 'guard low-hp (abort)', tick: 4 }]);
    });

    test('a forged critical marker is refused with an error thrown into the op', async () => {
        const r = await interpret(forgesCritical(), { driver: new TimelineDriver(timeline(2)) });
        expect(r).toEqual({ kind: 'returned', value: 'forged critical marker' });
    });
});

describe('call', () => {
    test('an instant call consumes no tick; a slow one consumes ticks until it settles', async () => {
        const instant = new TimelineDriver(timeline(10));
        expect(
            await interpret(
                call('instant', async () => 1),
                { driver: instant },
            ),
        ).toEqual({
            kind: 'returned',
            value: 1,
        });
        expect(instant.ticksElapsed).toBe(0);

        const slow = new TimelineDriver(timeline(10));
        const gate = gateAt(3, 'arrived');
        const r = await interpret(
            call('slow', () => gate.promise),
            { driver: slow, onTick: gate.onTick },
        );
        expect(r).toEqual({ kind: 'returned', value: 'arrived' });
        expect(slow.ticksElapsed).toBe(3);
    });

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
            'log guard low-hp waits for call "legacy walk" to settle',
            'log settled',
            'log guard low-hp (abort)',
            'send cleanup',
            'send eat',
        ]);
        expect(guardLogs(d)).toEqual([{ msg: 'guard low-hp (abort)', tick: 2, during: 'call "legacy walk"' }]);
        // Once the guard fires the interpreter stops taking ticks and only waits for the call.
        expect(d.ticksElapsed).toBe(2);
    });

    test('a call that fails after an abort guard fired is logged', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 2 ? 3 : 10 })));
        const gate = gateAt(2, 'arrived');
        const failingWalk = async () => {
            await gate.promise;
            throw new Error('walk failed');
        };
        const r = await interpret(call('legacy walk', failingWalk), {
            driver: d,
            guards: [lowHp],
            onTick: gate.onTick,
        });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(trace(d)).toContain('log call "legacy walk" failed after guard low-hp: walk failed');
    });

    test('after a suspend guard during a call, the op gets the call result', async () => {
        const d = new TimelineDriver(timeline(10, t => ({ dialog: t === 1 })));
        const gate = gateAt(1, 'arrived');
        const r = await interpret(
            call('legacy walk', () => gate.promise),
            { driver: d, guards: [dialog], onTick: gate.onTick },
        );
        expect(r).toEqual({ kind: 'returned', value: 'arrived' });
        expect(trace(d)).toEqual([
            'call legacy walk',
            'log guard dialog waits for call "legacy walk" to settle',
            'log guard dialog (suspend)',
            'send continue',
        ]);
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

    test('overlapping nextTick requests share one tick', async () => {
        const d = new TimelineDriver(timeline(5));
        const [a, b] = await Promise.all([d.nextTick(), d.nextTick()]);
        expect(a).toBe(b);
        expect(d.ticksElapsed).toBe(1);
        expect((await d.nextTick()).tick).toBe(2);
    });

    test('every tick a call takes is seen by onTick, however long the call takes to settle', async () => {
        // Sweeps settle times across the interpreter's microtask grace, where a tick request
        // could otherwise be dropped unseen.
        for (let hops = 0; hops < 80; hops++) {
            const d = new TimelineDriver(timeline(10));
            const seen: number[] = [];
            const settlesAfterHops = async () => {
                for (let i = 0; i < hops; i++) await Promise.resolve();
                return hops;
            };
            const onTick = (s: BotWorldState) => {
                seen.push(s.tick);
                return null;
            };
            await interpret(call('settles', settlesAfterHops), { driver: d, onTick });
            expect({ hops, seen: seen.length }).toEqual({ hops, seen: d.ticksElapsed });
        }
    });
});
