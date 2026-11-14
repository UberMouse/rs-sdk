import type { TaskDef } from '../lib/task';

/**
 * The task with a silent stretch of `ticks` added, for a test that holds a migrated task still longer than its
 * window. Clears stuckAfterMs: a task that lists silent refuses a stuckAfterMs that differs from its window, and the spread
 * would carry the old one.
 */
export const withSilentTicks = <T extends Pick<TaskDef, 'silent' | 'stuckAfterMs'>>(task: T, ticks: number): T => ({
    ...task,
    silent: [...(task.silent ?? []), ticks],
    stuckAfterMs: undefined,
});
