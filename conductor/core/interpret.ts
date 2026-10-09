// Runs an op to completion against a Driver. Every wait is checked on every tick against the
// engine's stops/watchdog (`onTick`), then the guards, then the wait's own predicate and budget, so
// interrupts are handled here once instead of inside each op. Waiting is only `driver.nextTick()`:
// no timers, so a scripted driver runs a thousand ticks in microtasks.
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../sdk/types';
import { errMessage } from '../lib/util';
import { Cancelled, type Command, criticalDelta, type Op, type Outcome, type WaitResult } from './op';

export interface Driver {
    /** The latest published state. */
    state(): BotWorldState;
    /**
     * Resolves with the next published state. The interpreter races commands against ticks and drops
     * the loser, so a driver must accept a call while an earlier one is pending and resolve every
     * pending caller with the next state.
     */
    nextTick(): Promise<BotWorldState>;
    send(action: BotAction): Promise<ActionResult>;
    scan(radius?: number): Promise<NearbyLoc[]>;
    /** A legacy call can't be cancelled: interrupts that come up while it runs wait for it to settle. */
    call(label: string, run: () => Promise<unknown>): Promise<unknown>;
    log(msg: string, data?: Record<string, unknown>): void;
    screenshot(label: string): Promise<string | null>;
    /** Milliseconds, for the engine's watchdog and `minutes:` stops; ops use `state.tick`. */
    now(): number;
}

export type GuardOutcome = Outcome;

export interface Guard {
    name: string;
    when(state: BotWorldState): boolean;
    /** `abort` cancels the running op, then runs `run`; `suspend` runs `run`, then resumes the same wait. */
    policy: 'abort' | 'suspend';
    /** Also fires inside `uninterruptible` sections (death, wilderness). */
    critical?: boolean;
    /** Given the state the guard fired on. Return the outcome directly when nothing needs doing in game. */
    run(state: BotWorldState): GuardOutcome | Op<GuardOutcome>;
}

export type Interpretation<T> =
    | { kind: 'returned'; value: T }
    /**
     * `outcome` is what the guard returned (a suspend guard only aborts with a `done`/`fail`), or a
     * `fail` when a suspend guard still held after MAX_SUSPENDS_PER_WAIT handler runs.
     */
    | { kind: 'aborted'; by: string; outcome: GuardOutcome }
    | { kind: 'cancelled'; reason: string };

export interface InterpretOptions {
    driver: Driver;
    /** Priority order: the first whose `when` holds fires. */
    guards?: readonly Guard[];
    /**
     * The engine's stops and watchdog. Called on every check of every wait, so often several times
     * per tick (keep it idempotent; dedupe on `state.tick`), and on each tick while a command is
     * pending. A reason cancels the op, even inside `uninterruptible`. During a `call` it acts only
     * once the call settles, so a hung call is bounded only by the engine's own wall-clock timeout.
     */
    onTick?: (state: BotWorldState) => string | null;
    /**
     * Guard name -> the tick a suspend guard last fired on, so it fires at most once per tick even
     * across waits. Pass one map per task run to carry it across steps.
     */
    firedAt?: Map<string, number>;
}

/** Ticks a cancelled op's cleanup may take; a command still pending past this abandons the rest. */
export const CLEANUP_TICKS = 10;
/** Commands a cancelled op's cleanup may yield; more most likely means a `catch` swallowed Cancelled. */
export const CLEANUP_COMMANDS = 20;
/** Handler runs a suspend guard gets within one wait before the run fails: the handler isn't clearing it. */
export const MAX_SUSPENDS_PER_WAIT = 5;
/**
 * Microtasks a forwarded command gets to settle before the interpreter asks for a tick, so an
 * already-resolved promise (an instant `call`, a scripted send) consumes no tick.
 */
const SETTLE_HOPS = 20;

type Interrupt = { guard: Guard; state: BotWorldState } | { cancel: string };
type Resume = { value: unknown } | { error: unknown };
type Wait = Extract<Command, { type: 'wait' }>;
type Forwarded = Extract<Command, { type: 'send' | 'scan' | 'call' | 'log' | 'screenshot' }>;
/** Looks at each state while a command runs; non-null stops watching. */
type Watch<S> = (state: BotWorldState) => S | null;
/** A forwarded command settled, or a watch stopped it while still pending. */
type Forwarding<S> = { resume: Resume } | { stop: S; settled: Promise<Resume> };

const settle = (p: Promise<unknown>): Promise<Resume> =>
    p.then(
        value => ({ value }),
        error => ({ error }),
    );

const PENDING = Symbol('pending');
/** Resolves with PENDING after roughly `n` microtasks: no timer, so still instant in tests. */
const microtasks = (n: number): Promise<typeof PENDING> =>
    n > 0 ? Promise.resolve().then(() => microtasks(n - 1)) : Promise.resolve(PENDING);

const advance = <R>(op: Op<R>, r: Resume) => ('error' in r ? op.throw(r.error) : op.next(r.value));

const isOp = (x: GuardOutcome | Op<GuardOutcome>): x is Op<GuardOutcome> =>
    typeof x === 'object' && x !== null && 'next' in x;

const describe = (i: Interrupt) => ('cancel' in i ? `stop "${i.cancel}"` : `guard ${i.guard.name}`);
const what = (cmd: Forwarded) => (cmd.type === 'call' ? `call "${cmd.label}"` : cmd.type);

/** The wait's result on `s`, or null to keep waiting. An `until` that throws is thrown into the op. */
function waitResult(cmd: Wait, s: BotWorldState, from: number): Resume | null {
    try {
        if (cmd.until(s)) return { value: { kind: 'met', state: s } satisfies WaitResult };
    } catch (error) {
        return { error };
    }
    return s.tick - from >= cmd.ticks ? { value: { kind: 'timeout', state: s } satisfies WaitResult } : null;
}

export function interpret<T>(op: Op<T>, opts: InterpretOptions): Promise<Interpretation<T>> {
    const { driver } = opts;
    const onTick = opts.onTick ?? (() => null);
    const firedAt = opts.firedAt ?? new Map<string, number>();

    // async, so a driver method that throws synchronously still becomes a rejection.
    const exec = async (cmd: Forwarded): Promise<unknown> => {
        switch (cmd.type) {
            case 'send':
                return driver.send(cmd.action);
            case 'scan':
                return driver.scan(cmd.radius);
            case 'call':
                return driver.call(cmd.label, cmd.run);
            case 'log':
                return driver.log(cmd.msg, cmd.data);
            case 'screenshot':
                return driver.screenshot(cmd.label);
            default:
                throw new Error(`unknown command ${JSON.stringify((cmd as { type: unknown }).type)}`);
        }
    };

    /**
     * Waits for `cmd`, watching its first state and every tick after; its budget counts from tick
     * `from`. `resumed` (after a suspend handler) checks `until` and the budget before watching again.
     */
    const waitFor = async <S>(cmd: Wait, watch: Watch<S>, from: number, resumed = false) => {
        let s = driver.state();
        const first = resumed ? waitResult(cmd, s, from) : null;
        if (first) return first;
        for (;;) {
            const stop = watch(s);
            if (stop) return { stop };
            const r = waitResult(cmd, s, from);
            if (r) return r;
            s = await driver.nextTick();
        }
    };

    /** Runs a forwarded command, watching each tick that passes before it settles. */
    const forward = async <S>(cmd: Forwarded, watch: Watch<S>): Promise<Forwarding<S>> => {
        const settled = settle(exec(cmd));
        for (;;) {
            // Before each tick request, so a command that settles mid-tick doesn't also take the next one.
            const soon = await Promise.race([settled, microtasks(SETTLE_HOPS)]);
            if (soon !== PENDING) return { resume: soon };
            const r = await Promise.race([settled, driver.nextTick().then(tick => ({ tick }))]);
            if (!('tick' in r)) return { resume: r };
            const stop = watch(r.tick);
            if (stop) return { stop, settled };
        }
    };

    /**
     * Cancels `target` and drives its `finally` blocks with guards and onTick off, within
     * CLEANUP_TICKS and CLEANUP_COMMANDS. Never throws: what goes wrong is logged and the
     * interrupt's outcome stands.
     */
    const cleanup = async (target: Op<unknown>, why: string): Promise<void> => {
        const deadline = driver.state().tick + CLEANUP_TICKS;
        const watch: Watch<string> = s => (s.tick > deadline ? `past the ${CLEANUP_TICKS}-tick cap` : null);
        let resume: Resume = { error: new Cancelled(why) };
        for (let commands = 0; ; commands++) {
            let step: IteratorResult<Command, unknown>;
            try {
                step = advance(target, resume);
            } catch (e) {
                if (!(e instanceof Cancelled)) driver.log(`cleanup threw: ${errMessage(e)}`);
                return;
            }
            if (step.done) {
                driver.log('cleanup: the op caught Cancelled and returned instead of rethrowing it');
                return;
            }
            const cmd: Command = step.value;
            if (commands === CLEANUP_COMMANDS) {
                driver.log(`cleanup abandoned: over ${CLEANUP_COMMANDS} commands (does a catch swallow Cancelled?)`);
                return;
            }
            let r: Resume | { stop: string };
            let label: string = cmd.type;
            try {
                if (cmd.type === 'critical') r = { value: undefined };
                else if (cmd.type === 'wait') {
                    label = `wait "${cmd.label}"`;
                    r = await waitFor(cmd, watch, driver.state().tick);
                } else {
                    label = what(cmd);
                    const f: Forwarding<string> = await forward(cmd, watch);
                    r = 'stop' in f ? f : f.resume;
                }
            } catch (e) {
                driver.log(`cleanup abandoned: ${errMessage(e)}`);
                return;
            }
            if ('stop' in r) {
                driver.log(`cleanup abandoned: ${label} ${r.stop}`);
                return;
            }
            resume = r;
        }
    };

    const run = async <R>(target: Op<R>, guards: readonly Guard[]): Promise<Interpretation<R>> => {
        /** `uninterruptible` nesting depth; above 0 only critical guards fire. */
        let depth = 0;
        let cancelled = false;
        const cancel = async (why: string) => {
            if (cancelled) return;
            cancelled = true;
            await cleanup(target, why);
        };

        const check: Watch<Interrupt> = s => {
            const reason = onTick(s);
            if (reason) return { cancel: reason };
            for (const g of guards) {
                if (depth > 0 && !g.critical) continue;
                if (g.policy === 'suspend' && firedAt.get(g.name) === s.tick) continue;
                if (!g.when(s)) continue;
                if (g.policy === 'suspend') firedAt.set(g.name, s.tick);
                return { guard: g, state: s };
            }
            return null;
        };

        const runGuard = (g: Guard, s: BotWorldState, active: readonly Guard[]) => {
            const out = g.run(s);
            return isOp(out) ? run(out, active) : Promise.resolve({ kind: 'returned' as const, value: out });
        };

        const asAborted = (guard: Guard, r: Interpretation<GuardOutcome>): Interpretation<R> =>
            r.kind === 'returned' ? { kind: 'aborted', by: guard.name, outcome: r.value } : r;

        /** Acts on an interrupt; null when a suspend guard handled it and `target` carries on. */
        const react = async (i: Interrupt, during?: string): Promise<Interpretation<R> | null> => {
            if ('cancel' in i) {
                await cancel(i.cancel);
                return { kind: 'cancelled', reason: i.cancel };
            }
            const { guard, state } = i;
            driver.log(`guard ${guard.name} (${guard.policy})`, { tick: state.tick, ...(during && { during }) });
            if (guard.policy === 'abort') {
                await cancel(`guard ${guard.name}`);
                // Other guards stay on (death while regenerating HP); this one never re-enters itself.
                const others = guards.filter(g => g !== guard);
                return asAborted(guard, await runGuard(guard, state, others));
            }
            const r = await runGuard(guard, state, []);
            if (r.kind === 'returned' && !r.value) return null;
            await cancel(r.kind === 'cancelled' ? r.reason : `guard ${guard.name}`);
            return asAborted(guard, r);
        };

        const runWait = async (cmd: Wait): Promise<Resume | Interpretation<R>> => {
            const from = driver.state().tick;
            let suspends = 0;
            for (let resumed = false; ; resumed = true) {
                const r = await waitFor(cmd, check, from, resumed);
                if (!('stop' in r)) return r;
                const i = r.stop;
                if ('guard' in i && i.guard.policy === 'suspend' && ++suspends > MAX_SUSPENDS_PER_WAIT) {
                    const fail = `${i.guard.name} still holds after ${MAX_SUSPENDS_PER_WAIT} handler runs in wait "${cmd.label}"`;
                    await cancel(`guard ${i.guard.name}`);
                    return { kind: 'aborted', by: i.guard.name, outcome: { fail } };
                }
                const end = await react(i);
                if (end) return end;
            }
        };

        const runForward = async (cmd: Forwarded): Promise<Resume | Interpretation<R>> => {
            const f = await forward(cmd, s => {
                const i = check(s);
                if (i) driver.log(`${describe(i)} waits for ${what(cmd)} to settle`);
                return i;
            });
            if ('resume' in f) return f.resume;
            const resume = await f.settled;
            const end = await react(f.stop, what(cmd));
            if (!end) return resume;
            if ('error' in resume)
                driver.log(`${what(cmd)} failed after ${describe(f.stop)}: ${errMessage(resume.error)}`);
            return end;
        };

        let resume: Resume = { value: undefined };
        for (;;) {
            // An exception the op throws propagates as is: its own finally blocks have already run.
            const step = advance(target, resume);
            if (step.done) return { kind: 'returned', value: step.value };
            const cmd = step.value;
            let next: Resume | Interpretation<R>;
            try {
                if (cmd.type === 'critical') {
                    const delta = criticalDelta(cmd);
                    depth += delta;
                    next = delta ? { value: undefined } : { error: new Error('forged critical marker') };
                } else if (cmd.type === 'wait') next = await runWait(cmd);
                else next = await runForward(cmd);
            } catch (e) {
                // A guard, onTick or the driver threw: the op still gets its cleanup before the error propagates.
                await cancel(`error: ${errMessage(e)}`);
                throw e;
            }
            if ('kind' in next) return next;
            resume = next;
        }
    };

    return run(op, opts.guards ?? []);
}
