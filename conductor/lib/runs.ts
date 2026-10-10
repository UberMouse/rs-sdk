import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './env';
import type { TaskResult } from './task';

export type TimedResult = TaskResult & { t: number };

/** The fields stats and the conductor read; anything else on a result line is trusted to follow the TaskResult shape. */
function isTimedResult(e: unknown): e is TimedResult {
    if (!e || typeof e !== 'object') return false;
    const r = e as Record<string, unknown>;
    return (
        typeof r.t === 'number' &&
        typeof r.task === 'string' &&
        typeof r.status === 'string' &&
        typeof r.reason === 'string' &&
        typeof r.durationMs === 'number' &&
        (r.xpGained === undefined || (!!r.xpGained && typeof r.xpGained === 'object'))
    );
}

/** Every `result` event in conductor/runs/<bot>/*.ndjson, oldest first; unparseable or malformed lines are counted, not fatal. */
export function loadResults(botName: string): { results: TimedResult[]; skipped: number } {
    const dir = join(REPO_ROOT, 'conductor/runs', botName);
    const results: TimedResult[] = [];
    let skipped = 0;
    if (!existsSync(dir)) return { results, skipped };
    for (const file of readdirSync(dir).filter(name => name.endsWith('.ndjson'))) {
        for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
            if (!line.includes('"type":"result"')) continue;
            try {
                const e = JSON.parse(line);
                if (e.type !== 'result') continue;
                if (isTimedResult(e)) results.push(e);
                else skipped++;
            } catch {
                skipped++;
            }
        }
    }
    return { results: results.sort((a, b) => a.t - b.t), skipped };
}

export interface ResultFilter {
    /** Only results logged at or after this time (ms since the epoch). */
    since?: number;
    /** Only this task's results; a plan's is `plan:<name>`. */
    task?: string;
    /** Include the phase runs of plans (results with `partOf`). */
    phases?: boolean;
}

/**
 * The results a reader counts. A plan's result already adds up its phases' runs, so by default its
 * phase runs (`partOf`) are left out and the plan counts once, as `plan:<name>`.
 */
export function selectResults(results: TimedResult[], f: ResultFilter = {}): TimedResult[] {
    return results.filter(
        r =>
            (f.phases || r.partOf === undefined) &&
            (f.since === undefined || r.t >= f.since) &&
            (f.task === undefined || r.task === f.task),
    );
}
