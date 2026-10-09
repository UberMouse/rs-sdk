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

/** JSON with sorted keys, so the same params always group together. */
export function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        return `{${Object.keys(obj)
            .sort()
            .map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(v);
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
