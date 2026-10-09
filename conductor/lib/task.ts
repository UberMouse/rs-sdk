// The task contract: a deterministic, LLM-free bot program the conductor can
// dispatch with params and stop conditions, and that always ends in one
// structured TaskResult.
//
// A task is an ordered list of steps; every loop the first step whose `when()`
// passes runs. Shared interrupt steps go in front of every task so no task has
// to handle death, low HP or blocking dialogs itself, and a watchdog ends runs
// that stop making progress.
import type { z } from 'zod/v4';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';

/** What a step may report. Returning nothing means "keep looping". */
export type Outcome = void | { done: string } | { fail: string };

export interface TaskContext<P = unknown> {
    bot: BotActions;
    sdk: BotSDK;
    botName: string;
    params: P;
    /** Current world state; throws if the client has published none. */
    state(): BotWorldState;
    log(msg: string, data?: Record<string, unknown>): void;
    /** Best-effort PNG of the game canvas; null on clients that don't render (lite). */
    screenshot(label: string): Promise<string | null>;
    /** Game tick the run started at; messages from earlier ticks are not this run's. */
    readonly startTick: number;
    /** Scratch shared between steps for one run (counters, remembered targets). Narrow values on read. */
    memory: Record<string, unknown>;
    /** Where the bot stood at the start of the previous loop (the engine sets it); null without a player. */
    previousPos: { x: number; z: number } | null;
}

export interface Step<P = unknown> {
    name: string;
    /**
     * The first step whose `when` passes runs this loop. A predicate may reset its own
     * `ctx.memory` counters once the state it guards has ended; that is the documented pattern.
     */
    when(ctx: TaskContext<P>): boolean;
    run(ctx: TaskContext<P>): Promise<Outcome>;
}

export interface TaskDef<S extends z.ZodType = z.ZodType> {
    name: string;
    /** One or two lines for the conductor's catalog: what it trains/does and where. */
    description: string;
    params: S;
    /** Checked once before the loop; return a reason to refuse to start. */
    preflight?(ctx: TaskContext<z.infer<S>>): string | null | Promise<string | null>;
    steps: Step<z.infer<S>>[];
    /** Task-specific completion; return a reason when done. */
    isComplete?(ctx: TaskContext<z.infer<S>>): string | null;
    /** Watchdog: end as `stuck` when XP, position, inventory and HP are all unchanged this long. Default DEFAULT_STUCK_AFTER_MS (engine.ts). */
    stuckAfterMs?: number;
    /** A single step.run() longer than this ends the run as `stuck`. Default DEFAULT_STEP_TIMEOUT_MS (engine.ts); raise it for steps that walk far. */
    stepTimeoutMs?: number;
}

export function defineTask<S extends z.ZodType>(def: TaskDef<S>): TaskDef<S> {
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
