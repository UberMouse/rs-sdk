// How long a task's progress watchdog (TaskDef.stuckAfterMs) must wait. The watchdog is wall-clock
// and resets on any XP, position, inventory or HP change, so it has to outlast every stretch the task
// can spend failing silently before its own fail reason fires; otherwise the run ends with the generic
// `stuck` instead of the specific reason. Tasks state those stretches in ticks and size the window here.
import type { FailStreak } from './streak';
import { TICK_MS } from './util';

/** Slack on a watchdog window: the sends between silent waits, slow ticks, the step's own bookkeeping. */
export const STUCK_MARGIN_MS = 60_000;

/**
 * The watchdog window for a task whose longest silent stretches are `silent` (ticks, or declared fail
 * streaks by their silentTicks): the longest of them, in wall-clock time, plus STUCK_MARGIN_MS.
 */
export const stuckWindowMs = (...silent: (FailStreak | number)[]): number =>
    Math.max(...silent.map(s => (typeof s === 'number' ? s : s.silentTicks))) * TICK_MS + STUCK_MARGIN_MS;

/** The window of a task that gives neither `silent` nor `stuckAfterMs`. */
export const DEFAULT_STUCK_AFTER_MS = 90_000;

interface WindowSpec {
    readonly name: string;
    readonly silent?: readonly (FailStreak | number)[];
    readonly stuckAfterMs?: number;
}

/**
 * A task's watchdog window: stuckWindowMs of its `silent` list, else its `stuckAfterMs`, else the default.
 * defineTask and the engine both size it here, so a def built without defineTask gets the same window.
 * Throws, naming the task, for an empty `silent`, two distinct fail streaks of one name in it (they would share
 * a count), or a `stuckAfterMs` alongside `silent`. That last is let through when it is the window `silent`
 * gives, which is what defineTask writes, so a copy of a defined task still runs.
 */
export function taskStuckWindowMs(def: WindowSpec): number {
    const { name, silent, stuckAfterMs } = def;
    if (!silent) return stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
    if (silent.length === 0) throw new Error(`task "${name}": silent is empty`);
    const streaks = [...new Set(silent.filter((s): s is FailStreak => typeof s !== 'number'))];
    const names = streaks.map(s => s.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup !== undefined) throw new Error(`task "${name}": two fail streaks named "${dup}" in its silent`);
    const window = stuckWindowMs(...silent);
    if (stuckAfterMs !== undefined && stuckAfterMs !== window)
        throw new Error(`task "${name}": give silent or stuckAfterMs, not both`);
    return window;
}

/**
 * Throws when a task that lists `silent` has a window too short for `what`, a shared step that can hold it
 * silent for `silentTicks`: that step's own failure would lose the race to `stuck`. A task without `silent`
 * (sized by hand) is not checked.
 */
export function assertWindowCovers(
    ctx: { readonly task: WindowSpec & { readonly stuckAfterMs: number } },
    what: string,
    silentTicks: number,
): void {
    const { name, silent, stuckAfterMs } = ctx.task;
    if (silent && stuckWindowMs(silentTicks) > stuckAfterMs)
        throw new Error(
            `task "${name}": its stuck window (${stuckAfterMs} ms) does not cover ${what} (${silentTicks} ticks); list it in silent`,
        );
}

/**
 * The silent ticks of an op failing `limit` times in a row, each taking up to `worstTicks`: the
 * attempts that fail, and one more, so the task's own failure surfaces before the watchdog's.
 */
export const failStreakTicks = (limit: number, worstTicks: number): number => (limit + 1) * worstTicks;
