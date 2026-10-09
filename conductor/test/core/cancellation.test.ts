import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { TimelineDriver } from '../../core/drivers/timeline';
import { CLEANUP_COMMANDS, CLEANUP_TICKS, type Guard, interpret } from '../../core/interpret';
import { log, type Op, rethrowIfCancelled, send, ticks, uninterruptible, wait } from '../../core/op';
import {
    act,
    busy,
    dialog,
    GatedSends,
    gateAt,
    lowHp,
    never,
    slowDialog,
    stopAt,
    trace,
    waitsThenCleansUp,
    walks,
} from './fixtures';
import { timeline } from '../world';

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

function* waitsTooLong(): Op<void> {
    yield* wait('never', () => false, 1000);
    yield* send(act('after'));
}

/** Sends `close`, which never settles on a driver that gates it with `never`. */
function* closesForever(): Op<void> {
    yield* send(act('close'));
}

// oxlint-disable-next-line require-yield -- throws before its first command, the case under test
function* throws(): Op<void> {
    throw new Error('oops');
}

/** A catch-all that swallows Cancelled and returns, which ops must not do. */
function* swallowsCancel(): Op<string> {
    try {
        yield* wait('forever', () => false, 100);
        return 'waited';
    } catch {
        return 'caught';
    }
}

/** Swallows Cancelled and keeps polling: bounded by the cleanup tick cap. */
function* swallowsAndPolls(): Op<void> {
    for (;;) {
        try {
            yield* wait('poll', () => false, 3);
        } catch {
            // swallows Cancelled: the bug under test
        }
    }
}

/** Swallows Cancelled and keeps yielding commands that take no tick: bounded by the command cap. */
function* swallowsAndSpins(): Op<void> {
    try {
        yield* wait('forever', () => false, 100);
    } catch {
        // swallows Cancelled: the bug under test
    }
    for (;;) yield* log('still going');
}

/** Handles its own errors and rethrows Cancelled, as ops must. */
function* rethrowsCancel(): Op<string> {
    try {
        yield* wait('forever', () => false, 100);
        return 'waited';
    } catch (e) {
        rethrowIfCancelled(e);
        return 'caught';
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Logs the cancellation's message before rethrowing it. */
function* reportsCancel(): Op<void> {
    try {
        yield* wait('forever', () => false, 100);
    } catch (e) {
        yield* log(`cancelled: ${(e as Error).message}`);
        throw e;
    }
}

function* waitsOnBadPredicate(): Op<void> {
    try {
        yield* wait(
            'bad',
            () => {
                throw new Error('bad predicate');
            },
            10,
        );
    } finally {
        yield* send(act('cleanup'));
    }
}

function* catchesBadPredicate(): Op<string> {
    try {
        yield* wait(
            'bad',
            () => {
                throw new Error('bad predicate');
            },
            10,
        );
        return 'waited';
    } catch (e) {
        return `caught ${(e as Error).message}`;
    }
}

function throwsAtTick2(s: BotWorldState): string | null {
    if (s.tick === 2) throw new Error('watchdog bug');
    return null;
}

/** Sends `hang`, which never settles on a driver that gates it with `never`; its finally sends `cleanup`. */
function* hangingSend(): Op<void> {
    try {
        yield* send(act('hang'));
    } finally {
        yield* send(act('cleanup'));
    }
}

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
        const r = await interpret(outer(), { driver: d, onTick: stopAt(2) });
        expect(r.kind).toBe('cancelled');
        expect(trace(d)).toEqual(['send inner cleanup', 'send middle cleanup', 'send outer cleanup']);
    });

    test('onTick cancels inside uninterruptible', async () => {
        const d = new TimelineDriver(timeline(10));
        const r = await interpret(uninterruptible(withdraw()), { driver: d, onTick: stopAt(2) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual(['send close bank']);
    });

    test('onTick while a send is pending cancels once the send settles', async () => {
        const gate = gateAt(2, 'arrived');
        const d = new GatedSends(timeline(10), { walk: () => gate.promise });
        const onTick = (s: BotWorldState) => gate.onTick(s) ?? stopAt(2)(s);
        const r = await interpret(walks(), { driver: d, onTick });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual(['send walk', 'log stop "stop" waits for send to settle', 'send cleanup']);
    });

    test("onTick cancels a guard's op, after the target's cleanup and with the guard op's own", async () => {
        const d = new TimelineDriver(timeline(10, t => ({ hp: t >= 1 ? 3 : 10 })));
        const regen: Guard = {
            ...lowHp,
            *run() {
                try {
                    yield* ticks(5);
                    yield* send(act('regenerated'));
                } finally {
                    yield* send(act('stop regen'));
                }
            },
        };
        const r = await interpret(busy(), { driver: d, guards: [regen], onTick: stopAt(3) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual(['send chop', 'log guard low-hp (abort)', 'send cleanup', 'send stop regen']);
    });

    test("onTick cancelling a suspend handler cancels the op with onTick's reason", async () => {
        const d = new TimelineDriver(timeline(10, t => ({ dialog: t === 1 })));
        const r = await interpret(reportsCancel(), { driver: d, guards: [slowDialog(2)], onTick: stopAt(2) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual(['log guard dialog (suspend)', 'send continue', 'log cancelled: stop']);
    });
});

describe('cleanup bounds', () => {
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
        // Fired on tick 1; cleanup may run to tick 1 + CLEANUP_TICKS and is abandoned on the tick after.
        expect(d.ticksElapsed).toBe(1 + CLEANUP_TICKS + 1);
    });

    test('a send in a finally that never settles is abandoned at the cap', async () => {
        const d = new GatedSends(
            timeline(5, t => ({ hp: t === 1 ? 3 : 10 })),
            { close: never },
        );
        const r = await interpret(waitsThenCleansUp(closesForever), { driver: d, guards: [lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(trace(d)).toEqual([
            'log guard low-hp (abort)',
            'send cleanup',
            'send close',
            `log cleanup abandoned: send past the ${CLEANUP_TICKS}-tick cap (still running)`,
            'send eat',
        ]);
    });

    test('a finally that throws is logged and the guard still acts', async () => {
        const d = new TimelineDriver(timeline(5, t => ({ hp: t === 1 ? 3 : 10 })));
        const r = await interpret(waitsThenCleansUp(throws), { driver: d, guards: [lowHp] });
        expect(r.kind === 'aborted' && r.by).toBe('low-hp');
        expect(trace(d)).toEqual(['log guard low-hp (abort)', 'send cleanup', 'log cleanup threw: oops', 'send eat']);
    });

    test('an op that swallows Cancelled and returns is logged, and the cancellation still stands', async () => {
        const d = new TimelineDriver(timeline(5));
        const r = await interpret(swallowsCancel(), { driver: d, onTick: stopAt(1) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual(['log cleanup: the op caught Cancelled and returned instead of rethrowing it']);
    });

    test('an op that swallows Cancelled and keeps waiting is stopped by the tick cap', async () => {
        const d = new TimelineDriver(timeline(5));
        const r = await interpret(swallowsAndPolls(), { driver: d, onTick: stopAt(1) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual([`log cleanup abandoned: wait "poll" past the ${CLEANUP_TICKS}-tick cap`]);
    });

    test('an op that swallows Cancelled and keeps going without ticks is stopped by the command cap', async () => {
        const d = new TimelineDriver(timeline(5));
        const r = await interpret(swallowsAndSpins(), { driver: d, onTick: stopAt(1) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual([
            ...Array<string>(CLEANUP_COMMANDS).fill('log still going'),
            `log cleanup abandoned: over ${CLEANUP_COMMANDS} commands (does a catch swallow Cancelled?)`,
        ]);
        expect(d.ticksElapsed).toBe(1);
    });

    test('an op whose catch uses rethrowIfCancelled cleans up quietly', async () => {
        const d = new TimelineDriver(timeline(5));
        const r = await interpret(rethrowsCancel(), { driver: d, onTick: stopAt(1) });
        expect(r).toEqual({ kind: 'cancelled', reason: 'stop' });
        expect(trace(d)).toEqual(['send cleanup']);
    });
});

describe('errors outside the op', () => {
    test('an until that throws is thrown into the op at its wait, so finally runs or catch handles it', async () => {
        const d = new TimelineDriver(timeline(5));
        await expect(interpret(waitsOnBadPredicate(), { driver: d })).rejects.toThrow('bad predicate');
        expect(trace(d)).toEqual(['send cleanup']);

        const r = await interpret(catchesBadPredicate(), { driver: new TimelineDriver(timeline(5)) });
        expect(r).toEqual({ kind: 'returned', value: 'caught bad predicate' });
    });

    test('a guard op that throws cleans the target up, then the error propagates', async () => {
        const d = new TimelineDriver(timeline(5, t => ({ dialog: t === 1 })));
        const broken: Guard = {
            ...dialog,
            *run() {
                yield* send(act('continue'));
                throw new Error('handler bug');
            },
        };
        await expect(interpret(busy(), { driver: d, guards: [broken] })).rejects.toThrow('handler bug');
        expect(trace(d)).toEqual(['send chop', 'log guard dialog (suspend)', 'send continue', 'send cleanup']);
    });

    test('an onTick that throws cleans the op up, then the error propagates', async () => {
        const d = new TimelineDriver(timeline(5));
        await expect(interpret(busy(), { driver: d, onTick: throwsAtTick2 })).rejects.toThrow('watchdog bug');
        expect(trace(d)).toEqual(['send chop', 'send cleanup']);
    });

    test('the driver failing while a send is pending cleans the op up, then the error propagates', async () => {
        const d = new GatedSends(timeline(2), { hang: never }, { strict: true });
        await expect(interpret(hangingSend(), { driver: d })).rejects.toThrow('timeline ended at tick 1');
        expect(trace(d)).toEqual(['send hang', 'send cleanup']);
    });
});
