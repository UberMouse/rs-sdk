// Re-runs task code against a recorded run (core/drivers/recording.ts) with the run's own inputs,
// and reports the first command that differs from the recording.
import { type Divergence, ReplayDriver } from '../core/drivers/replay';
import type { Recording } from '../core/drivers/recording';
import { executeTask } from './engine';
import type { TaskResult } from './task';

export interface ReplayReport {
    divergence: Divergence | null;
    /** Commands sent as the recording sent them, before any divergence. */
    matched: number;
    /** The tick the replay reached. */
    tick: number;
    /** The recording ended without a result (killed or crashed) and the replay ran to its end. */
    exhausted: boolean;
    /** How the recorded run ended; null for a recording without a result. */
    recorded: { status: string; reason: string } | null;
    /** The replayed run's result; only meaningful up to a divergence. */
    replayed: TaskResult;
}

/** Runs `def` (the current code of the recorded task, or a variant) on `recording`. */
export async function replayRun(
    recording: Recording,
    def: Parameters<typeof executeTask>[0],
    opts: { print?: (line: string) => void } = {},
): Promise<ReplayReport> {
    const { run } = recording.header;
    const driver = new ReplayDriver(recording);
    // A run an external stop ended (a plan phase's `until`) stops again on the same tick, rather than
    // running on past the end of its recording.
    const stop = recording.records.find(r => r.k === 'stop');
    let replayed: TaskResult;
    try {
        replayed = await executeTask(def, {
            driver,
            sinks: driver.sinks(opts.print),
            botName: run.bot,
            runId: run.runId,
            logFile: run.logFile,
            rawParams: run.params,
            stops: run.stops,
            ...(run.progressEveryMs !== undefined && { progressEveryMs: run.progressEveryMs }),
            ...(stop && { externalStop: s => (s.tick >= stop.tick ? stop.reason : null) }),
        });
    } finally {
        driver.close();
    }
    const end = recording.records.findLast(r => r.k === 'end');
    return {
        divergence: driver.divergence,
        matched: driver.matched,
        tick: driver.tick,
        exhausted: driver.exhausted,
        recorded: end ? { status: end.status, reason: end.reason } : null,
        replayed,
    };
}
