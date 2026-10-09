// Runs one task to its TaskResult. Preflight runs first, then, before the first step, the close of a
// modal left open by an earlier run (closeLeftover), so a preflight sees that modal still open. Each loop the first guard (the shared ones in lib/interrupts.ts,
// then the task's own) whose `when()` holds runs, else the first of the task's steps whose `when()`
// passes. A generator step is interpreted (core/interpret.ts) with the same guards and the stops,
// watchdog and step budget as `onTick`, so they act at every tick of its waits; a wall-clock limit
// around it bounds a `call` that never settles. A legacy `async` step is one opaque call, checked
// only between steps, though a tick stall or a disconnect while it runs still ends the run and
// abandons it.
// I/O goes through the injected driver and sinks (plus the bot and SDK that legacy steps and the
// guards still use), so tests run a task on a TimelineDriver.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { type Driver, type Guard, guardsUnder, interpret, type Interpretation, TickStall } from '../core/interpret';
import type { ActionContext } from '../actions/context';
import { leftoverModal } from '../actions/dismiss';
import { closeModalUntil } from '../actions/modal';
import { call, type Command, log, type Op } from '../core/op';
import { sleep } from './env';
import { findFood, guardLabel, GUARDS } from './interrupts';
import { checkStops, describeStop, validateStops, type StopCondition } from './stop';
import type { Outcome, Sinks, Step, TaskContext, TaskDef, TaskResult, TaskStatus } from './task';
import { isLowHp } from './threat';
import { distance, errMessage, INVENTORY_SLOTS, mapCounter, TICK_MS, xpGainedSince } from './util';

/** The client must publish a new tick within this long, else the run is `stuck`. */
export const TICK_STALL_MS = 30_000;
/** Consecutive loops with no applicable step before the run fails (covers mid-animation gaps). */
const MAX_IDLE_LOOPS = 20;
export const DEFAULT_STUCK_AFTER_MS = 90_000;
export const DEFAULT_STEP_TIMEOUT_MS = 120_000;
const DEFAULT_PROGRESS_EVERY_MS = 30_000;
/**
 * Commands other than waits a generator step may yield within one tick before the run fails: it
 * bounds a loop of commands that settle without a tick passing, which guards and stops never see.
 */
export const MAX_STEP_COMMANDS = 1000;
/**
 * Wall-clock slack a generator step gets past its timeout, and to finish once a stop, the watchdog or
 * its tick budget has ended the run, before it is abandoned. Its tick budget and cleanup normally end
 * it well within this; it bounds a `call` that never settles, which the interpreter waits for.
 */
export const STEP_GRACE_MS = 30_000;

/** What the run-start close of a leftover modal is reported as, in `stepRuns` and the step events. */
export const LEFTOVER_STEP = 'close-leftover';
/** Ticks the run-start close waits for the first of its two closes (closeModalUntil). */
export const LEFTOVER_CLOSE_TICKS = 5;

/**
 * Closes `what` (leftoverModal), found open before the run's first step. A modal blocks loc and NPC
 * interaction, and no guard closes an op's own interface, a bank, a shop or a skill menu, so one left by
 * a killed run or a failed close would strand every later task. Bounded by closeModalUntil: two closes,
 * LEFTOVER_CLOSE_TICKS + 1 ticks. One that stays open is logged and the run goes on. It runs after
 * preflight, which therefore sees the modal still open, and under the critical guards only.
 */
function* closeLeftover(ctx: ActionContext, what: string): Op<Outcome> {
    yield* log(`${what} left open before the run: closing it`);
    const r = yield* closeModalUntil(ctx, what, s => !leftoverModal(s), LEFTOVER_CLOSE_TICKS);
    if (!r.ok) yield* log(`${what} left open before the run did not close: ${r.message}`);
}

/** A zero-tick wait: a point where the interpreter calls `onTick`, which then cancels the step. */
const CHECKPOINT: Command = { type: 'wait', label: 'command cap', until: () => false, ticks: 0 };

export interface ExecuteOptions {
    driver: Driver;
    sinks: Sinks;
    /** Wall-clock milliseconds for the watchdog, `minutes:` stops and progress lines. Default `driver.now()`. */
    now?: () => number;
    /** For legacy steps and the guards, which still act through BotActions and the SDK. */
    bot: BotActions;
    sdk: BotSDK;
    botName: string;
    runId: string;
    /** Where the event sink writes; reported in the result. */
    logFile: string;
    rawParams: unknown;
    stops: StopCondition[];
    /** Print a progress line this often. Default DEFAULT_PROGRESS_EVERY_MS. */
    progressEveryMs?: number;
    /** A generator step's wall-clock grace; see STEP_GRACE_MS, the default. */
    stepGraceMs?: number;
}

type End = { status: TaskStatus; reason: string };

function inventoryCounts(s: BotWorldState): Record<string, number> {
    const out: Record<string, number> = {};
    for (const i of s.inventory) out[i.name] = (out[i.name] ?? 0) + i.count;
    return out;
}

/** What the watchdog compares: any change in XP, position, inventory counts or HP (regeneration) counts as progress. */
function progressSignature(s: BotWorldState): string {
    const xp = s.skills.reduce((n, k) => n + k.experience, 0);
    const p = s.player;
    const inv = s.inventory.map(i => `${i.id}x${i.count}`).join(',');
    return `${xp}|${p?.worldX},${p?.worldZ},${p?.level}|${inv}|${p?.hp}`;
}

const posOf = (s: BotWorldState) => (s.player ? { x: s.player.worldX, z: s.player.worldZ } : null);

const isOp = (x: unknown): x is Op<Outcome> => typeof x === 'object' && x !== null && 'next' in x;
const isPromise = (x: unknown): x is Promise<Outcome> => x instanceof Promise;

function ended(name: string, outcome: Outcome): End | null {
    if (outcome && 'fail' in outcome) return { status: 'failed', reason: `${name}: ${outcome.fail}` };
    if (outcome && 'done' in outcome) return { status: 'done', reason: `${name}: ${outcome.done}` };
    return null;
}

const unexpected = (name: string, r: Interpretation<Outcome>): End => ({
    status: 'error',
    reason: `step "${name}" ended unexpectedly: ${JSON.stringify(r)}`,
});

/**
 * Delegates to `op`, counting each command other than a wait with `count`. When `count` reports the
 * cap just passed, it yields a zero-tick wait in place of that command, where `onTick` reports the
 * overrun and the interpreter cancels the step, running its `finally` blocks. Hand-rolled because
 * `yield*` can't count.
 */
function* capped<T>(op: Op<T>, count: () => boolean): Op<T> {
    let resume: { value: unknown } | { error: unknown } = { value: undefined };
    for (;;) {
        const r: IteratorResult<Command, T> = 'error' in resume ? op.throw(resume.error) : op.next(resume.value);
        if (r.done) return r.value;
        const cmd: Command = r.value;
        if (cmd.type !== 'wait' && cmd.type !== 'critical' && count()) {
            try {
                yield CHECKPOINT;
            } catch (error) {
                resume = { error };
                continue;
            }
        }
        try {
            resume = { value: yield cmd };
        } catch (error) {
            resume = { error };
        }
    }
}

/** Any task, whatever its memory type: the engine only creates its memory and hands it to the steps. */
type AnyTaskDef = TaskDef<TaskDef['params'], object>;

export async function executeTask(def: AnyTaskDef, opts: ExecuteOptions): Promise<TaskResult> {
    const { driver, sinks, bot, sdk, botName, runId, logFile, stops } = opts;
    const now = opts.now ?? (() => driver.now());
    const startedAt = now();
    const screenshots: string[] = [];

    const emit = (event: Record<string, unknown>) => sinks.event(event);
    const say = (msg: string) => sinks.print(`[task:${def.name}] ${msg}`);

    const parsed = def.params.safeParse(opts.rawParams ?? {});
    const initial = driver.state();
    const xpBefore: Record<string, number> = {};
    const levelBefore: Record<string, number> = {};
    for (const k of initial.skills) {
        xpBefore[k.name] = k.experience;
        levelBefore[k.name] = k.baseLevel;
    }
    const invBefore = inventoryCounts(initial);

    const counters = new Map<string, number>();
    /** Each step's streak counts, dropped when its `when` is checked false. */
    const streaks = new Map<Step<unknown, object>, Map<string, number>>();
    /** The step whose `run` is in progress; it owns the streaks `ctx.streak` returns. */
    let running: Step<unknown, object> | null = null;
    const ctx: TaskContext<unknown, object> = {
        bot,
        sdk,
        botName,
        params: parsed.success ? parsed.data : undefined,
        state: () => driver.state(),
        log: (msg, data) => {
            say(msg);
            emit({ type: 'log', msg, data });
        },
        screenshot: async label => {
            try {
                const path = await sinks.screenshot(`${def.name}-${label}`);
                if (!path) return null;
                screenshots.push(path);
                emit({ type: 'screenshot', label, path });
                return path;
            } catch {
                return null;
            }
        },
        startTick: initial.tick,
        memory: def.memory?.() ?? {},
        previousPos: null,
        counter: name => mapCounter(counters, name),
        streak: name => {
            if (!running) throw new Error(`ctx.streak("${name}") called outside a step's run`);
            let counts = streaks.get(running);
            if (!counts) {
                counts = new Map();
                streaks.set(running, counts);
            }
            return mapCounter(counts, name);
        },
        inventoryFull: () => driver.state().inventory.length >= INVENTORY_SLOTS,
        distanceTo: (x, z) => {
            const p = driver.state().player;
            return p ? distance({ x: p.worldX, z: p.worldZ }, { x, z }) : Infinity;
        },
    };
    let currentPos = posOf(initial);

    // Ops' log and screenshot commands land in this run's log and result like the context's own.
    const view: Driver = {
        state: () => driver.state(),
        nextTick: () => driver.nextTick(),
        send: action => driver.send(action),
        scan: radius => driver.scan(radius),
        call: (label, run) => driver.call(label, run),
        log: ctx.log,
        screenshot: ctx.screenshot,
        now: () => driver.now(),
    };

    const stepRuns: Record<string, number> = {};
    let loops = 0;
    let lastStep: string | null = null;

    const stateOrNull = (): BotWorldState | null => {
        try {
            return driver.state();
        } catch {
            return null;
        }
    };

    /** Best effort, once: leave the bot above the low-HP line when food is at hand. Never throws. */
    const eatIfHurt = async () => {
        try {
            const s = stateOrNull();
            const food = s && isLowHp(s) ? findFood(s) : undefined;
            if (food) await bot.eatFood(food);
        } catch {
            // The result still reports the HP and combat state the bot was left in.
        }
    };

    const finish = async (status: TaskStatus, reason: string): Promise<TaskResult> => {
        if (status !== 'done') await ctx.screenshot(status);
        await eatIfHurt();
        const s = stateOrNull();
        const xpGained = s ? xpGainedSince(s, xpBefore) : {};
        const levelsGained: Record<string, { from: number; to: number }> = {};
        const inventoryDelta: Record<string, number> = {};
        if (s) {
            for (const k of s.skills) {
                if (k.baseLevel > (levelBefore[k.name] ?? k.baseLevel)) {
                    levelsGained[k.name] = { from: levelBefore[k.name] ?? k.baseLevel, to: k.baseLevel };
                }
            }
            const invAfter = inventoryCounts(s);
            for (const name of new Set([...Object.keys(invBefore), ...Object.keys(invAfter)])) {
                const d = (invAfter[name] ?? 0) - (invBefore[name] ?? 0);
                if (d !== 0) inventoryDelta[name] = d;
            }
        }
        const p = s?.player;
        const result: TaskResult = {
            task: def.name,
            bot: botName,
            runId,
            status,
            reason,
            params: ctx.params ?? opts.rawParams,
            durationMs: now() - startedAt,
            loops,
            stepRuns,
            lastStep,
            xpGained,
            levelsGained,
            inventoryDelta,
            finalPos: p ? { x: p.worldX, z: p.worldZ, level: p.level } : null,
            hp: p ? { current: p.hp, max: p.maxHp } : null,
            inCombat: p ? p.combat.inCombat : null,
            screenshots,
            logFile,
        };
        emit({ type: 'result', ...result });
        say(`${status}: ${reason}`);
        return result;
    };

    emit({ type: 'start', task: def.name, bot: botName, params: opts.rawParams, stops });

    if (!parsed.success) {
        return finish(
            'error',
            `invalid params: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
        );
    }
    try {
        validateStops(stops, initial);
    } catch (e) {
        return finish('error', errMessage(e));
    }
    // A task built without defineTask (a cast, JSON) bypasses the AllowableGuard type.
    const critical = GUARDS.filter(g => g.critical && def.allow?.includes(g.name as never)).map(g => g.name);
    if (critical.length) return finish('error', `task allows critical guard(s): ${critical.join(', ')}`);
    // Guards share episodes, step counts and the suspend bookkeeping by name.
    const names = [...GUARDS, ...(def.guards ?? [])].map(g => g.name);
    const clashes = names.filter((n, i) => names.indexOf(n) !== i);
    if (clashes.length) return finish('error', `task guard name(s) taken: ${[...new Set(clashes)].join(', ')}`);
    say(`start ${JSON.stringify(ctx.params)}${stops.length ? ` until ${stops.map(describeStop).join(' | ')}` : ''}`);

    const start = initial.player;
    if (start?.combat.inCombat)
        return finish('failed', `in combat at (${start.worldX},${start.worldZ}); handle the attacker first`);
    try {
        const refused = await def.preflight?.(ctx);
        if (refused) return finish('failed', `preflight: ${refused}`);
    } catch (e) {
        emit({ type: 'exception', message: errMessage(e), stack: e instanceof Error ? e.stack : undefined });
        return finish('error', `preflight threw: ${errMessage(e)}`);
    }

    const stuckAfterMs = def.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
    const stepTimeoutMs = def.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const stepBudgetTicks = Math.ceil(stepTimeoutMs / TICK_MS);
    const progressEveryMs = opts.progressEveryMs ?? DEFAULT_PROGRESS_EVERY_MS;
    const graceMs = opts.stepGraceMs ?? STEP_GRACE_MS;

    // Each guard's episode state, from when it first runs until its `when` is next checked false.
    const episodes = new Map<string, object>();
    const allowed: readonly string[] = def.allow ?? [];
    const enabled = [...GUARDS.filter(g => !allowed.includes(g.name)), ...(def.guards ?? [])];
    const guards: Guard[] = enabled.map(g => ({
        name: guardLabel(g.name),
        policy: g.policy,
        critical: g.critical,
        when: s => g.when(s, ctx),
        cleared: () => episodes.delete(g.name),
        run: s => {
            const label = guardLabel(g.name);
            stepRuns[label] = (stepRuns[label] ?? 0) + 1;
            let episode = episodes.get(g.name);
            if (!episode) {
                episode = g.episode();
                episodes.set(g.name, episode);
            }
            return g.run(s, ctx, episode);
        },
    }));
    // One per run, so the dialog guard fires at most once a tick even across consecutive steps.
    const firedAt = new Map<string, number>();

    let signature = progressSignature(initial);
    let lastProgressAt = now();
    let lastTick = initial.tick;
    let lastTickAt = now();
    let lastReportAt = now();
    let idleLoops = 0;

    /**
     * Watchdog, stops and progress lines. Runs between steps and on every check of a generator
     * step's waits, often several times a tick: everything here compares against the last change,
     * so a repeat call on the same state changes nothing.
     */
    const checkRun = (s: BotWorldState): End | null => {
        const t = now();
        // Watchdog: the client must keep ticking, and the bot must keep changing something.
        if (s.tick !== lastTick) {
            lastTick = s.tick;
            lastTickAt = t;
        } else if (t - lastTickAt > TICK_STALL_MS) {
            return { status: 'stuck', reason: `client stopped publishing ticks for ${TICK_STALL_MS / 1000}s` };
        }
        const sig = progressSignature(s);
        if (sig !== signature) {
            signature = sig;
            lastProgressAt = t;
        } else if (t - lastProgressAt > stuckAfterMs) {
            return {
                status: 'stuck',
                reason: `no XP, position, HP or inventory change for ${Math.round(stuckAfterMs / 1000)}s (last step: ${lastStep})`,
            };
        }
        const stop = checkStops(stops, s, xpBefore, t - startedAt);
        if (stop) return { status: 'done', reason: stop };
        if (t - lastReportAt >= progressEveryMs) {
            lastReportAt = t;
            const gained = Object.entries(xpGainedSince(s, xpBefore))
                .map(([n, d]) => `${n} +${d}`)
                .join(', ');
            say(
                `progress ${Math.round((t - startedAt) / 1000)}s: ${gained || 'no xp yet'}; steps ${JSON.stringify(stepRuns)}`,
            );
            emit({ type: 'progress', stepRuns, gained });
        }
        return null;
    };

    /** Emits a step's late failure instead of leaving it unhandled once the run has moved on without it. */
    const abandon = (name: string, pending: Promise<unknown>) => {
        pending.catch(e => emit({ type: 'abandoned-step-error', step: name, message: errMessage(e) }));
    };

    /**
     * A legacy step runs with no guards or `onTick`, so guards and stops act only between steps.
     * It can't be cancelled: past its wall-clock timeout it is abandoned, still running. So it is when
     * the interpreter's tick requests around it fail, which ends the run `stuck` when the client stops
     * publishing ticks for TICK_STALL_MS and `error` when the SDK disconnects.
     */
    const runLegacy = async (name: string, pending: Promise<Outcome>): Promise<End | null> => {
        let stepSettled = false;
        const settled = () => {
            stepSettled = true;
        };
        // Registered before the interpreter's own handlers, so it is set by the time the interpreter rejects.
        pending.then(settled, settled);
        const interpreted = interpret(
            call(name, () => pending),
            { driver: view },
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const r = await Promise.race([
            interpreted,
            new Promise<'timeout'>(res => {
                timer = setTimeout(() => res('timeout'), stepTimeoutMs);
            }),
        ])
            .catch((e: unknown) => {
                // The step's own throw rejects the interpreter too; only a driver failure leaves it running.
                if (!stepSettled) abandon(name, pending);
                throw e;
            })
            .finally(() => clearTimeout(timer));
        if (r === 'timeout') {
            // The interpreter around the step also rejects once the driver closes, which says nothing about the step.
            abandon(name, pending);
            interpreted.catch(() => {});
            return { status: 'stuck', reason: `step "${name}" ran over ${stepTimeoutMs / 1000}s` };
        }
        return r.kind === 'returned' ? ended(name, r.value) : unexpected(name, r);
    };

    /**
     * The interpreter waits for a pending `call` to settle before it acts on a stop or guard, and has
     * no timers, so a generator step gets a wall-clock limit: its timeout plus the grace from its
     * start. Past it, as when `onTick` ends the run, the op is cancelled at its next check, where
     * `onTick` reports the end; only if it is still running a grace later is it abandoned and the run
     * ends `stuck`.
     */
    const runOp = async (name: string, op: Op<Outcome>, active: readonly Guard[]): Promise<End | null> => {
        const startTick = driver.state().tick;
        let ending: End | null = null;
        let overrun: End | null = null;
        let countedTick = startTick;
        let commandsThisTick = 0;

        let expire!: (end: End) => void;
        const expired = new Promise<End>(res => {
            expire = res;
        });
        const timers: ReturnType<typeof setTimeout>[] = [];
        /** Sets `ending` (the op is cancelled at its next check) and abandons the op a grace later. */
        const end = (e: End) => {
            if (ending) return;
            ending = e;
            timers.push(
                setTimeout(
                    () =>
                        expire({
                            status: 'stuck',
                            reason: `step "${name}" still running ${graceMs / 1000}s after "${e.reason}"`,
                        }),
                    graceMs,
                ),
            );
        };
        const limitMs = stepTimeoutMs + graceMs;
        timers.push(
            setTimeout(
                () => end({ status: 'stuck', reason: `step "${name}" ran over ${limitMs / 1000}s of wall time` }),
                limitMs,
            ),
        );

        const onTick = (s: BotWorldState): string | null => {
            if (s.tick !== countedTick) {
                countedTick = s.tick;
                commandsThisTick = 0;
            }
            if (!ending) {
                const e =
                    checkRun(s) ??
                    overrun ??
                    (s.tick - startTick > stepBudgetTicks
                        ? {
                              status: 'stuck' as const,
                              reason: `step "${name}" ran over ${stepBudgetTicks} ticks (${stepTimeoutMs / 1000}s)`,
                          }
                        : null);
                if (e) end(e);
            }
            return ending?.reason ?? null;
        };
        /** Counts one command; true for the first past the cap this tick. */
        const count = () => {
            if (++commandsThisTick !== MAX_STEP_COMMANDS + 1) return false;
            overrun = {
                status: 'failed',
                reason: `step "${name}" yielded over ${MAX_STEP_COMMANDS} commands in one tick (a loop that never waits?)`,
            };
            return true;
        };

        const interpreted = interpret(capped(op, count), { driver: view, guards: active, onTick, firedAt });
        const r = await Promise.race([interpreted, expired]).finally(() => {
            for (const t of timers) clearTimeout(t);
        });
        if (!('kind' in r)) {
            abandon(name, interpreted);
            return r;
        }
        switch (r.kind) {
            case 'returned':
                return ended(name, r.value);
            case 'aborted':
                return ended(r.by, r.outcome);
            case 'cancelled':
                return ending ?? unexpected(name, r);
        }
    };

    /** A guard or step starts this loop: logged when it differs from the last. */
    const begin = (name: string) => {
        idleLoops = 0;
        if (name !== lastStep) emit({ type: 'step', step: name });
        lastStep = name;
    };

    try {
        // After preflight, so a preflight still sees a modal a previous run left open.
        const leftover = leftoverModal(driver.state());
        if (leftover) {
            begin(LEFTOVER_STEP);
            stepRuns[LEFTOVER_STEP] = 1;
            // Only the critical guards (death, the Wilderness, and any task guard marked critical): the
            // others act through the game, which the open modal blocks (the low-HP guard's eat is refused
            // under it, the interface guard would race this close), and they get their turn at the first
            // loop, at most LEFTOVER_CLOSE_TICKS + 1 ticks later.
            const criticalGuards = guards.filter(g => g.critical);
            const end = await runOp(LEFTOVER_STEP, closeLeftover(ctx, leftover), criticalGuards);
            if (end) return finish(end.status, end.reason);
        }
        for (;;) {
            loops++;
            const s = driver.state();
            ctx.previousPos = currentPos;
            currentPos = posOf(s);

            const end = checkRun(s);
            if (end) return finish(end.status, end.reason);
            const complete = def.isComplete?.(ctx);
            if (complete) return finish('done', complete);

            let stepEnd: End | null;
            const guard = guards.find(g => {
                if (g.when(s)) return true;
                g.cleared?.();
                return false;
            });
            if (guard) {
                begin(guard.name);
                const out = guard.run(s);
                stepEnd = isOp(out) ? await runOp(guard.name, out, guardsUnder(guards, guard)) : ended(guard.name, out);
            } else {
                // Every step's `when`, so a step that stopped applying loses its streaks even in a loop
                // where an earlier step runs.
                const applies = def.steps.map(st => st.when(ctx));
                for (const [i, st] of def.steps.entries()) if (!applies[i]) streaks.delete(st);
                const step = def.steps[applies.indexOf(true)];
                if (!step) {
                    // Nothing applicable can be a transient state (mid-animation); give it a few ticks.
                    if (++idleLoops > MAX_IDLE_LOOPS) return finish('failed', 'no step applies to the current state');
                    await driver.nextTick();
                    continue;
                }
                begin(step.name);
                stepRuns[step.name] = (stepRuns[step.name] ?? 0) + 1;
                running = step;
                try {
                    const out = step.run(ctx);
                    // A generator is an op, a promise is legacy async code, anything else is the outcome of a
                    // step that only decided. That value is trusted to be an Outcome: an object without
                    // fail/done is read as no outcome, and a string or number makes `'fail' in x` throw,
                    // which surfaces as the step having thrown.
                    stepEnd = isOp(out)
                        ? await runOp(step.name, out, guards)
                        : isPromise(out)
                          ? await runLegacy(step.name, out)
                          : ended(step.name, out);
                } finally {
                    running = null;
                }
            }

            // Yield to the macrotask queue: a step that returns without awaiting I/O (e.g. a
            // dialog guard that stays applicable) would otherwise loop on microtasks only
            // and starve the step timeout, watchdog and websocket frames.
            await sleep(0);

            if (stepEnd) return finish(stepEnd.status, stepEnd.reason);
        }
    } catch (e) {
        if (e instanceof TickStall) return finish('stuck', e.message);
        emit({ type: 'exception', message: errMessage(e), stack: e instanceof Error ? e.stack : undefined });
        return finish('error', `${lastStep ?? 'setup'} threw: ${errMessage(e)}`);
    }
}
