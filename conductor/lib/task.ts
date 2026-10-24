// The task contract: a deterministic, LLM-free bot program the conductor can
// dispatch with params and stop conditions, and that always ends in one
// structured TaskResult.
//
// A task is an ordered list of steps; every loop the first step whose `when()`
// passes runs. Shared guards (lib/interrupts.ts) act before every step and at the
// waits of generator steps, so no task has to handle death, low HP, blocking
// dialogs or leftover modals itself; a task adds its own threats the same way
// with `guards`. A watchdog ends runs that stop making progress. A step's `run`
// is a generator op (core/op.ts), or a plain function that only decides. A task never reaches
// the SDK: it reads the state and acts through ops, which the engine's driver carries out.
import type { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import type { Pathfinder } from '../actions/paths';
import type { WalkWorld } from './walk-graph';
import type { Op, Outcome } from '../core/op';
import type { AllowableGuard, TaskGuard } from './interrupts';
import { TICK_MS } from './util';

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
    botName: string;
    params: P;
    /** Current world state (the driver's latest); throws if the client has published none. */
    state(): BotWorldState;
    log(msg: string, data?: Record<string, unknown>): void;
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
    /** Where the walkTo op gets its routes (ActionContext); unset, the SDK's collision data. */
    readonly pathfinder?: Pathfinder;
    /** Where the walkTo op plans its way (ActionContext); unset, the world index's. */
    readonly walkWorld?: WalkWorld;
    /**
     * The bank's count of an item by name as last seen open: the plan's record before this run, then what the run's
     * own states show (ActionContext); 0 for an item the record does not list. Unset when no plan has seen the bank
     * open.
     */
    bank?(item: string): number;
    /**
     * Ticks the running generator step (or guard op) has left of its budget (stepBudgetTicks): waiting
     * this many more is within it, one more ends the run `stuck`. Undefined outside one. An op that
     * waits long (walkTo) caps itself to it (ActionContext).
     */
    stepTicksLeft(): number | undefined;
}

export interface Step<P = unknown, M extends object = UntypedMemory> {
    name: string;
    /**
     * The first step whose `when` passes runs this loop. The engine checks every step's `when` on
     * each loop no guard takes, so it must be pure: count "N in a row" with `ctx.streak`, which the
     * engine resets when `when` is false.
     */
    when(ctx: TaskContext<P, M>): boolean;
    /**
     * Two shapes. `*run` (a generator) is the normal one: it is interpreted, so guards act at its waits,
     * and stops, the watchdog and the step timeout cancel it there. A plain `run` that returns an
     * Outcome (or nothing) is for a step that only decides: it runs to its end in one go and the
     * guards act before and after it.
     */
    run(ctx: TaskContext<P, M>): Op<Outcome> | Outcome;
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
     * whole run. The critical guards, `death` and `wilderness`, cannot be allowed here (`allowWilderness`
     * is the Wilderness opt-in).
     */
    allow?: readonly AllowableGuard[];
    /**
     * Guards this task handles itself only for some params, added to `allow` (combat with `stopOnDialog` leaves
     * a quest dialog open for the next phase, so the dialog guard must not answer it). Every other run keeps the guard.
     */
    allowGuards?(params: z.infer<S>): readonly AllowableGuard[];
    /**
     * This task's own guards (being attacked while skilling), checked after the shared ones in this
     * order, at the same points and with the same episodes. Names must differ from the shared guards'.
     */
    guards?: readonly TaskGuard[];
    /**
     * The engine refuses to start a run in combat. A task that is the way out of a fight (travel with
     * `flee`) opts in here, per its params and the state the run starts in (combat starts when its attacker
     * is one of its targets); every other task keeps the refusal.
     */
    startInCombat?(params: z.infer<S>, state: BotWorldState): boolean;
    /**
     * The Wilderness guard ends a run in the Wilderness. A task whose work is there (the Wilderness agility
     * course) opts out of it, per its params; every other task keeps the guard. `death` still ends the run.
     */
    allowWilderness?(params: z.infer<S>): boolean;
    /**
     * The low-hp guard eats held food as always, but in combat at low HP with none held it does not
     * end the run: for a task whose way of surviving low HP is to keep going (travel with `flee` walks
     * out of the fight). Out of combat the guard still rests to regenerate. Every other task keeps the
     * guard's fail. `death` still ends the run.
     */
    keepGoingWithoutFood?(params: z.infer<S>): boolean;
    /**
     * The state holds a dialog this task's run keeps open for the next phase (combat with `stopOnDialog`: Morgan
     * Le Faye's choice at Sir Mordred's death). While it holds, the low-hp guard does not eat (the eat would close
     * the dialog), and a `done` run ending on it skips the fight settle and the eat before leaving, so the next
     * `talk` finds the dialog open. Not a level-up page, which the task clicks away itself. The hold applies only to
     * a `done` end (the settle and eat before leaving) and only above the engine's HP floor
     * (`HOLD_HP_FLOOR_MIN` / `HOLD_HP_FLOOR_FRACTION`); at or below it the guard eats even if that closes the dialog.
     */
    holdsDialog?(params: z.infer<S>, state: BotWorldState): boolean;
    /**
     * Best-effort cleanup once as the run ends, whatever ended it (done, fail, a stop, the watchdog), after any
     * fight has settled and the low-HP eat before leaving has run: for state the task changed that would outlast
     * it (combat's prayers). An op like a step's, under no guards and no stops; it should cost a few ticks and
     * must be a no-op when there is nothing to undo.
     * Never fails the run: a throw is logged.
     */
    onEnd?(ctx: TaskContext<z.infer<S>, M>): Op<void>;
    /**
     * Counts and warnings for the result (`TaskResult.diagnostics` / `warnings`), read once as the run ends: what
     * the run saw that its decisions did not use (targets in view outside the area, lib/area-watch.ts). Never
     * changes the run's status; a throw is logged. Return empty parts when there is nothing to say.
     */
    diagnostics?(ctx: TaskContext<z.infer<S>, M>): { diagnostics?: Record<string, unknown>; warnings?: string[] };
    /** Checked once before the loop; return a reason to refuse to start. */
    preflight?(ctx: TaskContext<z.infer<S>, M>): string | null;
    steps: Step<z.infer<S>, M>[];
    /** Task-specific completion; return a reason when done. */
    isComplete?(ctx: TaskContext<z.infer<S>, M>): string | null;
    /** Watchdog: end as `stuck` when XP, position, inventory and HP are all unchanged this long. Default DEFAULT_STUCK_AFTER_MS (engine.ts). */
    stuckAfterMs?: number;
    /**
     * A single step.run() longer than this ends the run as `stuck`, enforced as a tick budget
     * (stepBudgetTicks). Default DEFAULT_STEP_TIMEOUT_MS (engine.ts); raise it for steps that walk far.
     */
    stepTimeoutMs?: number;
}

/** A generator step's tick budget: its `stepTimeoutMs` in ticks, rounded up, as the engine enforces it. */
export const stepBudgetTicks = (stepTimeoutMs: number): number => Math.ceil(stepTimeoutMs / TICK_MS);

export function defineTask<S extends z.ZodType, M extends object = UntypedMemory>(def: TaskDef<S, M>): TaskDef<S, M> {
    return def;
}

export type TaskStatus = 'done' | 'failed' | 'stuck' | 'error';

export interface TaskResult {
    task: string;
    bot: string;
    runId: string;
    /** The runId of the plan this run was a phase of; absent for a run of its own. */
    partOf?: string;
    status: TaskStatus;
    reason: string;
    /**
     * The step or guard whose outcome ended the run (`interrupt:death` for the death guard); absent when
     * the run ended some other way (a stop, the watchdog, the step budget, a preflight refusal).
     */
    endedBy?: string;
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
    /** Task-specific counts from the task's `diagnostics` hook (area tasks: idleTicks, seenOutsideAreaTicks, nearestOutsideArea); absent when empty. */
    diagnostics?: Record<string, unknown>;
    /** What a runner should act on though the run ended well (a matching target idled past outside the area); absent when none. */
    warnings?: string[];
    /** A nudge run-task adds for the runner reading the RESULT (a chain of plain runs); absent normally. */
    hint?: string;
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
