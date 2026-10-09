// The task contract: a deterministic, LLM-free bot program the conductor can
// dispatch with params and stop conditions, and that always ends in one
// structured TaskResult.
//
// A task is an ordered list of steps; every loop the first step whose `when()`
// passes runs. Shared guards (lib/interrupts.ts) act before every step and at the
// waits of generator steps, so no task has to handle death, low HP or blocking
// dialogs itself; a task adds its own threats the same way with `guards`. A
// watchdog ends runs that stop making progress. A step's
// `run` is either legacy `async` code or a generator op (core/op.ts).
import type { z } from 'zod/v4';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import type { Op, Outcome } from '../core/op';
import type { AllowableGuard, TaskGuard } from './interrupts';

/** What a step may report. Returning nothing means "keep looping". */
export type { Outcome };

/** Memory of a task that declares no `memory` factory: untyped scratch, narrowed on read. */
export type UntypedMemory = Record<string, unknown>;

/** A named count, for "N failures" style limits. */
export interface Counter {
    /** Add `by` (default 1) and return the new value. */
    add(by?: number): number;
    reset(): void;
}

export interface TaskContext<P = unknown, M extends object = UntypedMemory> {
    bot: BotActions;
    sdk: BotSDK;
    botName: string;
    params: P;
    /** Current world state (the driver's latest); throws if the client has published none. */
    state(): BotWorldState;
    log(msg: string, data?: Record<string, unknown>): void;
    /** Best-effort PNG of the game canvas; null on clients that don't render (lite). */
    screenshot(label: string): Promise<string | null>;
    /** Game tick the run started at; messages from earlier ticks are not this run's. */
    readonly startTick: number;
    /** State shared between steps for one run (remembered targets), from the task's `memory` factory. */
    memory: M;
    /**
     * A run-scoped count; the same name returns the same count. Names starting `area.` belong to
     * lib/area.ts. For "N in a row" counts that should end when a step stops applying, use `streak`.
     */
    counter(name: string): Counter;
    /**
     * A count owned by the step now running: the engine resets a step's streaks whenever it checks
     * that step's `when` and gets false, so it counts runs in a row while the step keeps applying.
     * Throws outside a step's `run`.
     */
    streak(name: string): Counter;
    /** Every inventory slot is used. */
    inventoryFull(): boolean;
    /** Straight-line tiles from the bot to (x, z); Infinity when there is no player. */
    distanceTo(x: number, z: number): number;
    /** Where the bot stood at the start of the previous loop (the engine sets it); null without a player. */
    previousPos: { x: number; z: number } | null;
}

export interface Step<P = unknown, M extends object = UntypedMemory> {
    name: string;
    /**
     * The first step whose `when` passes runs this loop. The engine checks every step's `when` on
     * each loop no guard takes, so it must be pure: count "N in a row" with `ctx.streak`, which the
     * engine resets when `when` is false. Legacy tasks that reset a `ctx.counter` here still work
     * until ported.
     */
    when(ctx: TaskContext<P, M>): boolean;
    /**
     * `*run` (an op) is interpreted: guards act at its waits, and stops, the watchdog and the
     * step timeout cancel it there. Legacy `async run` is one opaque call: guards and stops act
     * only between steps, and a timeout abandons it still running.
     */
    run(ctx: TaskContext<P, M>): Promise<Outcome> | Op<Outcome>;
}

export interface TaskDef<S extends z.ZodType = z.ZodType, M extends object = UntypedMemory> {
    name: string;
    /** One or two lines for the conductor's catalog: what it trains/does and where. */
    description: string;
    params: S;
    /** A fresh `ctx.memory` for each run; its return type types `ctx.memory`. Default `{}`, untyped. */
    memory?(): M;
    /**
     * Guards this task handles itself (e.g. `dialog` for a task that drives dialogs); off for the
     * whole run. The critical guards, `death` and `wilderness`, cannot be allowed.
     */
    allow?: readonly AllowableGuard[];
    /**
     * This task's own guards (being attacked while skilling), checked after the shared ones in this
     * order, at the same points and with the same episodes. Names must differ from the shared guards'.
     */
    guards?: readonly TaskGuard[];
    /** Checked once before the loop; return a reason to refuse to start. */
    preflight?(ctx: TaskContext<z.infer<S>, M>): string | null | Promise<string | null>;
    steps: Step<z.infer<S>, M>[];
    /** Task-specific completion; return a reason when done. */
    isComplete?(ctx: TaskContext<z.infer<S>, M>): string | null;
    /** Watchdog: end as `stuck` when XP, position, inventory and HP are all unchanged this long. Default DEFAULT_STUCK_AFTER_MS (engine.ts). */
    stuckAfterMs?: number;
    /**
     * A single step.run() longer than this ends the run as `stuck`. Default DEFAULT_STEP_TIMEOUT_MS
     * (engine.ts); raise it for steps that walk far. A generator step gets it as a tick budget.
     */
    stepTimeoutMs?: number;
}

export function defineTask<S extends z.ZodType, M extends object = UntypedMemory>(def: TaskDef<S, M>): TaskDef<S, M> {
    return def;
}

export type TaskStatus = 'done' | 'failed' | 'stuck' | 'error';

export interface TaskResult {
    task: string;
    bot: string;
    runId: string;
    status: TaskStatus;
    reason: string;
    params: unknown;
    durationMs: number;
    loops: number;
    /** Step name -> times it ran. Shows what the run actually spent its time on. */
    stepRuns: Record<string, number>;
    lastStep: string | null;
    xpGained: Record<string, number>;
    levelsGained: Record<string, { from: number; to: number }>;
    /** Item name -> net change in inventory count over the run. */
    inventoryDelta: Record<string, number>;
    finalPos: { x: number; z: number; level: number } | null;
    hp: { current: number; max: number } | null;
    /** In combat when the run ended, an unsafe state to leave the bot in; null when unknown. */
    inCombat: boolean | null;
    screenshots: string[];
    logFile: string;
}

/** Where a run's output goes: its NDJSON log, the console and screenshots. Tests pass in-memory ones. */
export interface Sinks {
    /** Appends one event to the run's log; the sink stamps the time. */
    event(event: Record<string, unknown>): void;
    /** One line of human-readable output. */
    print(line: string): void;
    /** A PNG of the game canvas; resolves to its path, or null on clients that don't render. May throw. */
    screenshot(label: string): Promise<string | null>;
}
