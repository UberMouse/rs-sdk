// A nudge for a runner that chains plain task runs: work that repeats belongs in a plan.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readResultEvent } from './runs';

export const CHAINED_PLAIN_HINT = '2nd plain task run in a row: work that repeats belongs in a plan (--plan)';

/** How close in time the earlier plain run must have started for the two to count as a chain. */
export const CHAIN_WINDOW_MS = 30 * 60_000;

const PLAN_LOG = /Z-plan-[^.]*\.ndjson$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/;

/** The UTC time a run id or log name starts with (`YYYY-MM-DDTHH-MM-SS-mmmZ-...`), or NaN. */
function stampMs(name: string): number {
    const m = STAMP.exec(name);
    return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

/**
 * Whether the log's result says the run was a phase of a plan (a plan's phase logs look like plain
 * runs by name). A log with no result event (a run cut off) counts as plain.
 */
function isPhaseLog(file: string): boolean {
    return readResultEvent(file)?.partOf !== undefined;
}

/**
 * The hint for a plain task run `ownRunId` that just ended in `runsDir`, or undefined: set when the
 * newest earlier run log there (by name, which starts with its UTC stamp) is also a plain task run
 * that started within `CHAIN_WINDOW_MS` of this one. A plan's log (`<stamp>-plan-<name>.ndjson`) and its
 * phase runs do not count as plain, so a plain run after a plan carries none. Pass only plain runs'
 * ids; a plan never gets the hint.
 */
export function chainedPlainHint(runsDir: string, ownRunId: string): string | undefined {
    if (!ownRunId || !existsSync(runsDir)) return undefined;
    const earlier = readdirSync(runsDir)
        .filter(f => f.endsWith('.ndjson') && !f.endsWith('.ticks.ndjson') && f < `${ownRunId}.ndjson`)
        .sort();
    // Phase runs of a plan are skipped over: the plan's own log, older than them, is what precedes.
    const newest = earlier.findLast(f => PLAN_LOG.test(f) || !isPhaseLog(join(runsDir, f)));
    if (newest === undefined || PLAN_LOG.test(newest)) return undefined;
    const gap = stampMs(ownRunId) - stampMs(newest);
    return gap >= 0 && gap <= CHAIN_WINDOW_MS ? CHAINED_PLAIN_HINT : undefined;
}
