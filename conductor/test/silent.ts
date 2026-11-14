import type { TaskDef } from '../lib/task';

/**
 * The task with a silent stretch of `ticks` added, for a test that holds a migrated task still longer than its
 * window. Both fields are set because a task's window comes from `silent` and a task that lists `silent` refuses
 * a `stuckAfterMs` that differs from it: the copy keeps the window the spread brought along only if it is cleared,
 * so it is recomputed from the widened list.
 */
export const withSilentTicks = <T extends Pick<TaskDef, 'silent' | 'stuckAfterMs'>>(task: T, ticks: number): T => ({
    ...task,
    silent: [...(task.silent ?? []), ticks],
    stuckAfterMs: undefined,
});
