// Runs an op to completion against a Driver. Every wait is checked on every tick against the
// engine's stops/watchdog (`onTick`), then the guards, then the wait's own predicate and budget, so
// interrupts are handled here once instead of inside each op. Waiting is only `driver.nextTick()`:
// no timers, so a scripted driver runs a thousand ticks in microtasks.
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../sdk/types';
import { errMessage } from '../lib/util';
import { Cancelled, type Command, type Op, type WaitResult } from './op';

export interface Driver {
    /** The latest published state. */
    state(): BotWorldState;
    /** Resolves with the next published state. */
    nextTick(): Promise<BotWorldState>;
    send(action: BotAction): Promise<ActionResult>;
    scan(radius?: number): Promise<NearbyLoc[]>;
    call(label: string, run: () => Promise<unknown>): Promise<unknown>;
    log(msg: string, data?: Record<string, unknown>): void;
    screenshot(label: string): Promise<string | null>;
    /** Milliseconds, for the engine's watchdog and `minutes:` stops; ops use `state.tick`. */
    now(): number;
}

/** The task contract's Outcome: nothing to carry on, or `done`/`fail` to end the run. */
export type GuardOutcome = void | { done: string } | { fail: string };

export interface Guard {
    name: string;
    when(state: BotWorldState): boolean;
    /** `abort` cancels the running op, then runs `run`; `suspend` runs `run`, then resumes the same wait. */
    policy: 'abort' | 'suspend';
    /** Also fires inside `uninterruptible` sections (death, wilderness). */
    critical?: boolean;
    /** Given the state the guard fired on. */
    run(state: BotWorldState): Op<GuardOutcome>;
}

export type Interpretation<T> =
    | { kind: 'returned'; value: T }
    /** `outcome` is what the guard's op returned; a suspend guard only aborts with a `done`/`fail`. */
    | { kind: 'aborted'; by: string; outcome: GuardOutcome }
    | { kind: 'cancelled'; reason: string };

export interface InterpretOptions {
    driver: Driver;
    /** Priority order: the first whose `when` holds fires. */
    guards?: readonly Guard[];
    /**
     * The engine's stops and watchdog, called on every wait check (so possibly twice per tick) and every
     * tick of a `call`; a reason cancels, even inside `uninterruptible`.
     */
    onTick?: (state: BotWorldState) => string | null;
}

/** Ticks a cancelled op's `finally` blocks may wait in total; a wait past this abandons the rest of the cleanup. */
export const CLEANUP_TICKS = 10;

type Interrupt = { guard: Guard; state: BotWorldState } | { cancel: string };
type Resume = { value: unknown } | { error: unknown };
type Forwarded = Extract<Command, { type: 'send' | 'scan' | 'call' | 'log' | 'screenshot' }>;

const settle = (p: Promise<unknown>): Promise<Resume> =>
    p.then(
        value => ({ value }),
        error => ({ error }),
    );

export function interpret<T>(op: Op<T>, opts: InterpretOptions): Promise<Interpretation<T>> {
    const { driver } = opts;
    const onTick = opts.onTick ?? (() => null);

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
        }
    };

    /**
     * Cancels `target` and drives its `finally` blocks with guards and onTick off. An error other than
     * the cancellation thrown out of the op is logged, not rethrown: the interrupt's outcome stands.
     */
    const cleanup = async (target: Op<unknown>, why: string): Promise<void> => {
        let ticksLeft = CLEANUP_TICKS;
        let resume: Resume = { error: new Cancelled(why) };
        for (;;) {
            let step: IteratorResult<Command, unknown>;
            try {
                step = 'error' in resume ? target.throw(resume.error) : target.next(resume.value);
            } catch (e) {
                if (!(e instanceof Cancelled)) driver.log(`cleanup threw: ${errMessage(e)}`);
                return;
            }
            if (step.done) {
                driver.log('cleanup: the op caught Cancelled and returned instead of rethrowing it');
                return;
            }
            const cmd: Command = step.value;
            if (cmd.type === 'critical') resume = { value: undefined };
            else if (cmd.type !== 'wait') resume = await settle(exec(cmd));
            else {
                let s = driver.state();
                const start = s.tick;
                let met: boolean = cmd.until(s);
                while (!met && s.tick - start < cmd.ticks) {
                    if (s.tick - start >= ticksLeft) {
                        driver.log(`cleanup abandoned: wait "${cmd.label}" past the ${CLEANUP_TICKS}-tick cap`);
                        return;
                    }
                    s = await driver.nextTick();
                    met = cmd.until(s);
                }
                ticksLeft -= s.tick - start;
                resume = { value: { kind: met ? 'met' : 'timeout', state: s } satisfies WaitResult };
            }
        }
    };

    const run = async <R>(target: Op<R>, guards: readonly Guard[]): Promise<Interpretation<R>> => {
        /** `uninterruptible` nesting depth; above 0 only critical guards fire. */
        let depth = 0;

        /** `handled` holds suspend guards already run on a tick, so each fires at most once per tick. */
        const check = (s: BotWorldState, handled?: Map<string, number>): Interrupt | null => {
            const reason = onTick(s);
            if (reason) return { cancel: reason };
            for (const g of guards) {
                if (depth > 0 && !g.critical) continue;
                if (handled?.get(g.name) === s.tick) continue;
                if (g.when(s)) return { guard: g, state: s };
            }
            return null;
        };

        const asAborted = (guard: Guard, r: Interpretation<GuardOutcome>): Interpretation<R> =>
            r.kind === 'returned' ? { kind: 'aborted', by: guard.name, outcome: r.value } : r;

        /** Acts on an interrupt; null when a suspend guard handled it and `target` carries on. */
        const react = async (i: Interrupt, during?: string): Promise<Interpretation<R> | null> => {
            if ('cancel' in i) {
                await cleanup(target, i.cancel);
                return { kind: 'cancelled', reason: i.cancel };
            }
            const { guard, state } = i;
            driver.log(`guard ${guard.name} (${guard.policy})`, { tick: state.tick, ...(during && { during }) });
            if (guard.policy === 'abort') {
                await cleanup(target, `guard ${guard.name}`);
                // Other guards stay on (death while regenerating HP); this one never re-enters itself.
                const others = guards.filter(g => g !== guard);
                return asAborted(guard, await run(guard.run(state), others));
            }
            const r = await run(guard.run(state), []);
            if (r.kind === 'returned' && !r.value) return null;
            await cleanup(target, `guard ${guard.name}`);
            return asAborted(guard, r);
        };

        const waitFor = async (cmd: Extract<Command, { type: 'wait' }>): Promise<Resume | Interpretation<R>> => {
            let s = driver.state();
            const start = s.tick;
            const handled = new Map<string, number>();
            for (;;) {
                const i = check(s, handled);
                if (i) {
                    if ('guard' in i) handled.set(i.guard.name, s.tick);
                    const end = await react(i);
                    if (end) return end;
                    s = driver.state();
                    continue;
                }
                if (cmd.until(s)) return { value: { kind: 'met', state: s } satisfies WaitResult };
                if (s.tick - start >= cmd.ticks) return { value: { kind: 'timeout', state: s } satisfies WaitResult };
                s = await driver.nextTick();
            }
        };

        // A call is an opaque promise: ticks are still checked while it runs, but the first interrupt
        // can only act once it settles.
        const callFor = async (cmd: Extract<Command, { type: 'call' }>): Promise<Resume | Interpretation<R>> => {
            const settled = settle(exec(cmd));
            let fired: Interrupt | null = null;
            while (!fired) {
                const r = await Promise.race([settled, driver.nextTick().then(tick => ({ tick }))]);
                if (!('tick' in r)) return r;
                fired = check(r.tick);
            }
            const result = await settled;
            return (await react(fired, cmd.label)) ?? result;
        };

        let resume: Resume = { value: undefined };
        for (;;) {
            const step = 'error' in resume ? target.throw(resume.error) : target.next(resume.value);
            if (step.done) return { kind: 'returned', value: step.value };
            const cmd = step.value;
            let next: Resume | Interpretation<R>;
            if (cmd.type === 'critical') {
                depth += cmd.enter ? 1 : -1;
                next = { value: undefined };
            } else if (cmd.type === 'wait') next = await waitFor(cmd);
            else if (cmd.type === 'call') next = await callFor(cmd);
            else next = await settle(exec(cmd));
            if ('kind' in next) return next;
            resume = next;
        }
    };

    return run(op, opts.guards ?? []);
}
