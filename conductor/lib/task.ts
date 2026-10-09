// The task contract: a deterministic, LLM-free bot program the conductor can
// dispatch with params and stop conditions, and that always ends in one
// structured TaskResult.
//
// Shape borrowed from UberUtils/ArteDungeon's Strategy pattern: a task is an
// ordered list of steps; every loop the FIRST step whose `when()` passes runs
// (ArteDungeon's `for (strategy : strategies) if (strategy.isValid()) return
// strategy.execute()`). Shared interrupt steps (MenuFailSafe's descendants) go
// in front of every task, and a watchdog (FailSafeThread) ends runs that stop
// making progress.
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
    /** Scratch shared between steps for one run (counters, remembered targets). */
    memory: Record<string, any>;
}

export interface Step<P = unknown> {
    name: string;
    /** Like Strategy.validate(): the first step whose `when` passes runs this loop. */
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
    /** Task-specific completion (AIOScript.isFinished()); return a reason when done. */
    isComplete?(ctx: TaskContext<z.infer<S>>): string | null;
    /** Watchdog: end as `stuck` when XP, position and inventory are all unchanged this long. Default 90s. */
    stuckAfterMs?: number;
    /** A single step.run() longer than this ends the run as `stuck`. Default 120s. */
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
    screenshots: string[];
    logFile: string;
}
