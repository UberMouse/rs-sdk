// Ops are generators that yield commands to an interpreter (interpret.ts) instead of touching the
// SDK, so every wait is a point where guards, stops and cancellation can act, and an op runs the same
// against the live game or a scripted timeline. Compose ops with `yield*`; the helpers below give
// each command a typed result.
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../sdk/types';

export type Pred = (state: BotWorldState) => boolean;

/** What a task step or guard reports: nothing to carry on, or `done`/`fail` to end the run. */
export type Outcome = void | { done: string } | { fail: string };

const critical = Symbol('critical');

/** Brackets an `uninterruptible` section. Only this module can make one; the interpreter checks identity. */
export interface CriticalMarker {
    readonly type: 'critical';
    readonly [critical]: 1 | -1;
}

const ENTER: CriticalMarker = { type: 'critical', [critical]: 1 };
const EXIT: CriticalMarker = { type: 'critical', [critical]: -1 };

/** +1 entering an `uninterruptible` section, -1 leaving one, 0 for a marker not made here. */
export const criticalDelta = (m: CriticalMarker): number => (m === ENTER || m === EXIT ? m[critical] : 0);

export type Command =
    | { type: 'send'; action: BotAction }
    | { type: 'wait'; label: string; until: Pred; ticks: number }
    | { type: 'scan'; radius?: number }
    /** Escape hatch for legacy `bot.*` calls; interrupts wait for it to settle. */
    | { type: 'call'; label: string; run: () => Promise<unknown> }
    | { type: 'log'; msg: string; data?: Record<string, unknown> }
    | { type: 'screenshot'; label: string }
    | CriticalMarker;

export type Op<T> = Generator<Command, T, unknown>;

/** `met` when `until` held, `timeout` when the tick budget ran out first; `state` is the deciding tick. */
export type WaitResult = { kind: 'met' | 'timeout'; state: BotWorldState };

/**
 * Thrown into an op at its current command to cancel it, so every `finally` up the `yield*` stack
 * runs and may itself yield commands. (`gen.return()` can't do this: once an inner `finally` yields,
 * the frames above resume as if the inner op had returned normally.) A `catch` in an op must
 * rethrow it: start the catch with `rethrowIfCancelled(e)`.
 */
export class Cancelled extends Error {
    override name = 'Cancelled';
}

export function rethrowIfCancelled(e: unknown): void {
    if (e instanceof Cancelled) throw e;
}

// Each helper narrows the interpreter's untyped resume value once, so call sites need no casts.

export function* send(action: BotAction): Op<ActionResult> {
    return (yield { type: 'send', action }) as ActionResult;
}

/**
 * Wait until `until` holds, for at most `maxTicks` game ticks from now. Checks the current state
 * first. Ticks a suspend guard's handler spends inside the wait count against `maxTicks`.
 */
export function* wait(label: string, until: Pred, maxTicks: number): Op<WaitResult> {
    return (yield { type: 'wait', label, until, ticks: maxTicks }) as WaitResult;
}

/** Let `n` game ticks pass and return the state then; `ticks(0)` returns the current state. */
export function* ticks(n: number): Op<BotWorldState> {
    return (yield* wait(`ticks:${n}`, () => false, n)).state;
}

/** The SDK's extended-range loc scan. */
export function* scan(radius?: number): Op<NearbyLoc[]> {
    return (yield { type: 'scan', radius }) as NearbyLoc[];
}

export function* call<T>(label: string, run: () => Promise<T>): Op<T> {
    return (yield { type: 'call', label, run }) as T;
}

export function* log(msg: string, data?: Record<string, unknown>): Op<void> {
    yield { type: 'log', msg, data };
}

/** Best-effort PNG path; null on clients that don't render. */
export function* screenshot(label: string): Op<string | null> {
    return (yield { type: 'screenshot', label }) as string | null;
}

/**
 * Runs `op` with only `critical` guards able to fire (mid-withdraw, mid-trade). Nests. The engine's
 * stops and watchdog (`onTick`) still cancel it.
 */
export function* uninterruptible<T>(op: Op<T>): Op<T> {
    yield ENTER;
    try {
        return yield* op;
    } finally {
        yield EXIT;
    }
}
