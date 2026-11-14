// "N in a row failed, then fail the run", declared once per streak. The count is `ctx.streak(name)`, so the
// engine still resets it when the step stops applying. A task lists each streak it uses in `TaskDef.silent`,
// which sizes its stuck window; using one it did not list throws, so a streak cannot outlast the window unseen.
import type { TaskContext } from './task';
import { failStreakTicks } from './watchdog';

type StreakContext = Pick<TaskContext, 'streak'> & { readonly task: Pick<TaskContext['task'], 'name' | 'silent'> };

export interface FailStreak {
    /** The `ctx.streak` name it counts under. */
    readonly name: string;
    readonly limit: number;
    /** What the streak can hold the task silent for: failStreakTicks(limit, worstTicks). */
    readonly silentTicks: number;
    /** Resets the count (a success). */
    clear(ctx: StreakContext): void;
}

/** A streak declared with a `what`: its failure is the standard sentence. */
export interface PhraseStreak extends FailStreak {
    /**
     * Counts one failure; at `limit`, the run's failure "<limit> <what> in a row failed (last: <last>)". The result
     * must be returned from the step: dropped, the streak counts but never fails the run.
     */
    miss(ctx: StreakContext, last?: string): { fail: string } | undefined;
}

/** A streak declared without a `what`: the caller writes the failure text each time. */
export interface ReasonStreak extends FailStreak {
    /**
     * Counts one failure; at `limit`, the run fails with `reason` as written. The result must be returned from the
     * step: dropped, the streak counts but never fails the run.
     */
    missWith(ctx: StreakContext, reason: string): { fail: string } | undefined;
}

interface StreakSpec {
    name: string;
    limit: number;
    worstTicks: number;
}

export function failStreak(spec: StreakSpec & { what: string }): PhraseStreak;
export function failStreak(spec: StreakSpec): ReasonStreak;
export function failStreak(spec: StreakSpec & { what?: string }): PhraseStreak | ReasonStreak {
    const { name, limit, worstTicks, what } = spec;
    const count = (ctx: StreakContext) => {
        if (!ctx.task.silent?.includes(streak))
            throw new Error(`task "${ctx.task.name}" uses fail streak "${name}" without listing it in its silent`);
        return ctx.streak(name);
    };
    const fails = (ctx: StreakContext, reason: string) => (count(ctx).add() >= limit ? { fail: reason } : undefined);
    const base: FailStreak = {
        name,
        limit,
        silentTicks: failStreakTicks(limit, worstTicks),
        clear: ctx => count(ctx).reset(),
    };
    const streak: PhraseStreak | ReasonStreak =
        what === undefined
            ? { ...base, missWith: fails }
            : {
                  ...base,
                  miss: (ctx, last) =>
                      fails(ctx, `${limit} ${what} in a row failed${last === undefined ? '' : ` (last: ${last})`}`),
              };
    return streak;
}

/** Looks (a wait of MISSING_WAIT_TICKS between each) a target may stay out of sight before the task fails. */
export const MISSING_LIMIT = 3;
export const MISSING_WAIT_TICKS = 2;

/** The streak of looks that found no target: a task wraps it with its own failure text and its own wait. */
export const missingTargetStreak = (name: string): ReasonStreak =>
    failStreak({ name, limit: MISSING_LIMIT, worstTicks: MISSING_WAIT_TICKS });
