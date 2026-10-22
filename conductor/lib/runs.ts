import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { EmptyRecordingError, parseRecording, type Rec, recordingFile, StateDecoder } from '../core/drivers/recording';
import { REPO_ROOT } from './env';
import type { TaskResult } from './task';
import { errMessage } from './util';

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

/** The `result` events of one run log, in order; lines that do not parse are counted in `skipped`, not fatal. */
function readResultEvents(file: string): { events: Record<string, unknown>[]; skipped: number } {
    const events: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('"type":"result"')) continue;
        try {
            const e = JSON.parse(line);
            if (e && e.type === 'result') events.push(e);
        } catch {
            skipped++;
        }
    }
    return { events, skipped };
}

/** The first `result` event of a run log, or undefined when it has none (a run cut off before its result). */
export function readResultEvent(file: string): Record<string, unknown> | undefined {
    return readResultEvents(file).events[0];
}

/**
 * Every `result` event in <root>/conductor/runs/<bot>/*.ndjson (root: this checkout), oldest first; unparseable or
 * malformed lines are counted, not fatal.
 */
export function loadResults(botName: string, root: string = REPO_ROOT): { results: TimedResult[]; skipped: number } {
    const dir = join(root, 'conductor/runs', botName);
    const results: TimedResult[] = [];
    let skipped = 0;
    if (!existsSync(dir)) return { results, skipped };
    for (const file of readdirSync(dir).filter(name => name.endsWith('.ndjson'))) {
        const read = readResultEvents(join(dir, file));
        skipped += read.skipped;
        for (const e of read.events) {
            if (isTimedResult(e)) results.push(e);
            else skipped++;
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

/** Bytes of a recording read first for its opening state; doubled until the state is in them. */
const START_PREFIX_BYTES = 64 * 1024;

/**
 * The state a run started on: the first state its recording (next to its log) holds, or undefined when it has no
 * recording or the recording no state. Reads only as much of the file as that state needs (a cut gzip stream reads up
 * to its last whole line, as a killed run's recording does).
 */
export function readStartState(logFile: string): BotWorldState | undefined {
    const file = recordingFile(logFile);
    if (!existsSync(file)) return undefined;
    const fd = openSync(file, 'r');
    try {
        const size = fstatSync(fd).size;
        for (let n = START_PREFIX_BYTES; ; n *= 2) {
            const bytes = Buffer.alloc(Math.min(n, size));
            readSync(fd, bytes, 0, bytes.length, 0);
            const whole = bytes.length >= size;
            let records: Rec[];
            try {
                records = parseRecording(bytes).records;
            } catch (e) {
                // A prefix that ends inside the header line holds no whole line yet: read more. Any other error (an
                // empty file, another recording version) is the whole file's, so it is not read further.
                if (!whole && e instanceof EmptyRecordingError) continue;
                throw e;
            }
            const first = records.find(r => r.k === 'p');
            if (first) return new StateDecoder().decode(first.d, first.x);
            if (whole) return undefined;
        }
    } catch (e) {
        throw new Error(`can't read the start of ${file}: ${errMessage(e)}`, { cause: e });
    } finally {
        closeSync(fd);
    }
}
