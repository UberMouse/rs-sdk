// How long a task's progress watchdog (TaskDef.stuckAfterMs) must wait. The watchdog is wall-clock
// and resets on any XP, position, inventory or HP change, so it has to outlast every stretch the task
// can spend failing silently before its own fail reason fires; otherwise the run ends with the generic
// `stuck` instead of the specific reason. Tasks state those stretches in ticks and size the window here.
import { TICK_MS } from './util';

/** Slack on a watchdog window: the sends between silent waits, slow ticks, the step's own bookkeeping. */
export const STUCK_MARGIN_MS = 60_000;

/**
 * The watchdog window for a task whose longest silent stretches are `silentTicks`: the longest of
 * them, in wall-clock time, plus STUCK_MARGIN_MS.
 */
export const stuckWindowMs = (...silentTicks: number[]): number => Math.max(...silentTicks) * TICK_MS + STUCK_MARGIN_MS;

/**
 * The silent ticks of an op failing `limit` times in a row, each taking up to `worstTicks`: the
 * attempts that fail, and one more, so the task's own failure surfaces before the watchdog's.
 */
export const failStreakTicks = (limit: number, worstTicks: number): number => (limit + 1) * worstTicks;
