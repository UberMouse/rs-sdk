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
    /**
     * Counts one failure; at `limit`, the run's failure "<limit> <what> in a row failed (last: <last>)". The result
     * must be returned from the step: dropped, the streak counts but never fails the run.
     */
    miss(ctx: StreakContext, last?: string): { fail: string } | undefined;
    /**
     * Counts one failure; at `limit`, the run fails with `reason` as written. The result must be returned from the
     * step: dropped, the streak counts but never fails the run.
     */
    missWith(ctx: StreakContext, reason: string): { fail: string } | undefined;
    /** Resets the count (a success). */
    clear(ctx: StreakContext): void;
}

export function failStreak(spec: { name: string; limit: number; worstTicks: number; what: string }): FailStreak {
    const { name, limit, worstTicks, what } = spec;
    const count = (ctx: StreakContext) => {
        if (!ctx.task.silent?.includes(streak))
            throw new Error(`task "${ctx.task.name}" uses fail streak "${name}" without listing it in its silent`);
        return ctx.streak(name);
    };
    const streak: FailStreak = {
        name,
        limit,
        silentTicks: failStreakTicks(limit, worstTicks),
        miss: (ctx, last) =>
            streak.missWith(ctx, `${limit} ${what} in a row failed${last === undefined ? '' : ` (last: ${last})`}`),
        missWith: (ctx, reason) => (count(ctx).add() >= limit ? { fail: reason } : undefined),
        clear: ctx => count(ctx).reset(),
    };
    return streak;
}
