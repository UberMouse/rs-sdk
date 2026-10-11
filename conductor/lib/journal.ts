// The conductor's journal (.durable-state/journal.jsonl): the line shape, the UTC stamp and the
// newline-safe append, shared by conductor/tools/journal.ts (a hand-written line) and run-task.ts
// (the mechanical line of a run it just finished, `--objective` with `--journal`).
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { formatStop, type StopCondition } from './stop';
import type { TaskResult } from './task';

export const JOURNAL_KINDS = ['run', 'author', 'review', 'curate', 'retro'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export interface JournalLine {
    at: string;
    kind: JournalKind;
    objective: string;
    task?: string;
    command?: string;
    result?: string;
    verdict: string;
    commit?: string;
    [extra: string]: string | number | undefined;
}

/** The current time as the journal writes it: UTC, to the second. */
export function journalStamp(now: Date = new Date()): string {
    return now.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** Appends `line` to `file` (created with its directory), first ending a last line that lacks its newline. */
export function appendJournalLine(file: string, line: JournalLine): string {
    const out = JSON.stringify(line);
    mkdirSync(dirname(file), { recursive: true });
    let prefix = '';
    const size = existsSync(file) ? statSync(file).size : 0;
    if (size > 0) {
        const fd = openSync(file, 'r');
        const last = Buffer.alloc(1);
        try {
            readSync(fd, last, 0, 1, size - 1);
        } finally {
            closeSync(fd);
        }
        if (last[0] !== 0x0a) prefix = '\n';
    }
    appendFileSync(file, prefix + out + '\n');
    return out;
}

/** `86s` under two minutes, else whole minutes (`3min`), as the runners' result strings have it. */
export function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    return s < 120 ? `${s}s` : `${Math.round(s / 60)}min`;
}

/** `+4375 Smithing 22->31, +120 Mining`, or `0xp` when the run gained none. */
export function formatXp(result: Pick<TaskResult, 'xpGained' | 'levelsGained'>): string {
    const parts = Object.entries(result.xpGained)
        .filter(([, xp]) => xp > 0)
        .map(([skill, xp]) => {
            const lv = result.levelsGained[skill];
            return `+${xp} ${skill}${lv ? ` ${lv.from}->${lv.to}` : ''}`;
        });
    return parts.length ? parts.join(', ') : '0xp';
}

/** What was run, as the journal's `command` field reads: the task and params, or the plan file, then the stops. */
export function describeCommand(run: {
    bot: string;
    task: string;
    plan: string | null;
    params: unknown;
    stops: StopCondition[];
}): string {
    const what =
        run.plan !== null
            ? `--plan ${run.plan}`
            : `${run.task}${JSON.stringify(run.params) === '{}' ? '' : ` --params '${JSON.stringify(run.params)}'`}`;
    return [`run-task ${run.bot} ${what}`, ...run.stops.map(s => `--until ${formatStop(s)}`)].join(' ');
}

/**
 * The line for a run that ended, or null when it never ran (no runId: a usage error, a refused
 * controller). The verdict is only mechanical (`<status>: <reason>`); the runner journals its own
 * reading of the run separately.
 */
export function runJournalLine(
    result: TaskResult,
    o: { objective: string; command: string; now?: Date },
): JournalLine | null {
    if (!result.runId) return null;
    return {
        at: journalStamp(o.now),
        kind: 'run',
        objective: o.objective,
        verdict: `${result.status}: ${result.reason}`,
        task: result.task,
        command: o.command,
        result: `${result.runId} ${result.status}: ${result.reason}; ${formatXp(result)}; ${formatDuration(result.durationMs)}`,
    };
}
