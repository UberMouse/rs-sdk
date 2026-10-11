// The plan viewer's side of the disk: which checkouts have run logs, the runs in them (plans, and
// task runs on their own) with whether each still runs, and tails of the logs that grow. Read-only.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readDurableState, REPO_ROOT } from '../../lib/env';
import {
    foldPhase,
    foldRun,
    type LogEvent,
    openRun,
    type PhaseLog,
    type PhaseRunEntry,
    type Run,
    type RunKind,
    type RunSummary,
    stampTime,
    summarize,
} from './model';

const PLAN_LOG = /^(.+-plan-[a-z0-9-]+)\.ndjson$/;
/** A task run's log, `<fileStamp>-<task>.ndjson`: a phase of a plan's, or a run of its own. */
const TASK_LOG = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[a-z0-9-]+)\.ndjson$/;

/** A runId the API takes: a log's basename, nothing that climbs out of a runs directory. */
export const RUN_ID = /^[\w-]+$/;
export const BOT_NAME = /^[A-Za-z0-9_-]{1,32}$/;
/** An integration test's throwaway bot: `it` and ten random characters (conductor/test/integration/harness.ts). */
export const isTestBot = (bot: string): boolean => /^it[a-z0-9]{10}$/.test(bot);
/**
 * A log from before the CLI stamped its pid counts as running while it (or a plan's open phase's
 * log) or its recording changed this recently. Task logs write a progress event at least this often.
 */
export const LOG_STALE_MS = 5 * 60_000;
/**
 * A run's process starts before its log does; a pid whose process started later than this after
 * it was reused. Wide, because /proc's start time moves with wall-clock steps (NTP, a VM resume).
 */
const PID_START_SLACK_MS = 60_000;

/** What a log file in a runs directory holds, and its runId; null for anything else. */
export function logOf(file: string): { kind: RunKind; runId: string } | null {
    const plan = PLAN_LOG.exec(file);
    if (plan) return { kind: 'plan', runId: plan[1]! };
    const task = TASK_LOG.exec(file);
    return task ? { kind: 'task', runId: task[1]! } : null;
}

/** Every checkout of this repo (the main one and its worktrees) with a conductor/runs directory. */
export function findRoots(): string[] {
    let paths = [REPO_ROOT];
    try {
        const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
        paths = out
            .split('\n')
            .filter(l => l.startsWith('worktree '))
            .map(l => l.slice('worktree '.length));
    } catch {
        // not a git checkout: this one only
    }
    return [...new Set(paths)].filter(p => existsSync(join(p, 'conductor/runs')));
}

export function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM: it exists, under another user.
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/**
 * When a process started, from Linux's /proc (its start in clock ticks after boot, plus the boot
 * time); null where /proc can't tell, which leaves liveness to the pid alone.
 */
export function processStartedAt(pid: number): number | null {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        // Fields after the command name, which may hold spaces and parentheses: starttime is field 22.
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const ticks = Number(fields[22 - 3]);
        const btime = Number(/^btime (\d+)$/m.exec(readFileSync('/proc/stat', 'utf8'))?.[1]);
        // USER_HZ, the unit of starttime, is 100 on every Linux the conductor runs on.
        return Number.isFinite(ticks) && btime ? btime * 1000 + ticks * 10 : null;
    } catch {
        return null;
    }
}

const mtime = (file: string): number => {
    try {
        return statSync(file).mtimeMs;
    } catch {
        return 0;
    }
};

/** Parses NDJSON, skipping blank and malformed lines (a line still being written among them). */
export function parseLines(text: string): LogEvent[] {
    const out: LogEvent[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const e: unknown = JSON.parse(line);
            if (e && typeof e === 'object' && typeof (e as LogEvent).type === 'string') out.push(e as LogEvent);
        } catch {
            // malformed: skipped
        }
    }
    return out;
}

/**
 * Reads the events appended to a log since the last read. A line without its newline yet is held
 * back until it has one, so an event is never parsed half-written; a file that shrank is re-read.
 */
export class Tail {
    private offset = 0;
    private partial: Buffer = Buffer.alloc(0);

    constructor(readonly file: string) {}

    read(): LogEvent[] {
        let size: number;
        try {
            size = statSync(this.file).size;
        } catch {
            return [];
        }
        if (size < this.offset) {
            this.offset = 0;
            this.partial = Buffer.alloc(0);
        }
        if (size === this.offset) return [];
        const chunk = Buffer.alloc(size - this.offset);
        try {
            const fd = openSync(this.file, 'r');
            try {
                readSync(fd, chunk, 0, chunk.length, this.offset);
            } finally {
                closeSync(fd);
            }
        } catch {
            // Removed since the stat: nothing more to read.
            return [];
        }
        this.offset = size;
        const bytes = Buffer.concat([this.partial, chunk]);
        const end = bytes.lastIndexOf(0x0a);
        this.partial = end < 0 ? bytes : bytes.subarray(end + 1);
        return end < 0 ? [] : parseLines(bytes.subarray(0, end).toString('utf8'));
    }
}

/** A run on disk: its folded log and where it lives. */
export interface RunOnDisk {
    run: Run;
    dir: string;
    file: string;
}

/** The conductor that owns a session, from a checkout's durable state. */
export interface SessionOwner {
    session: string;
    root: string;
    bot: string | null;
    goal: string | null;
}

export class RunsStore {
    private cache = new Map<string, { mtimeMs: number; size: number; run: Run }>();

    constructor(readonly roots: string[]) {}

    /** Each bot's run directories, across the roots: those with a plan or task log. */
    botDirs(): Map<string, string[]> {
        const bots = new Map<string, string[]>();
        for (const root of this.roots) {
            const runs = join(root, 'conductor/runs');
            for (const bot of listDir(runs)) {
                if (!BOT_NAME.test(bot)) continue;
                const dir = join(runs, bot);
                if (!listDir(dir).some(f => logOf(f))) continue;
                bots.set(bot, [...(bots.get(bot) ?? []), dir]);
            }
        }
        return bots;
    }

    /** Folds a run's log, re-reading it only when it changed, and decides whether it still runs. */
    private load(bot: string, dir: string, file: string): RunOnDisk | null {
        const log = logOf(file);
        if (!log) return null;
        const path = join(dir, file);
        let st;
        try {
            st = statSync(path);
        } catch {
            return null;
        }
        let hit = this.cache.get(path);
        if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
            let text: string;
            try {
                text = readFileSync(path, 'utf8');
            } catch {
                return null; // removed since the stat
            }
            const run = foldRun(log.kind, log.runId, bot, parseLines(text));
            hit = { mtimeMs: st.mtimeMs, size: st.size, run };
            this.cache.set(path, hit);
        }
        const run = hit.run;
        if (!run.result) run.state = this.alive(run, dir, path, st.mtimeMs) ? 'running' : 'killed';
        return { run, dir, file: path };
    }

    private alive(run: Run, dir: string, file: string, logMtime: number): boolean {
        if (run.pid !== null) {
            if (!pidAlive(run.pid)) return false;
            // A pid alive under a process that started after the run is another process's.
            const started = processStartedAt(run.pid);
            return started === null || started <= run.startedAt + PID_START_SLACK_MS;
        }
        // A task run's log is its phase's; a plan's open phase has a log of its own.
        const open = openRun(run);
        const phase = run.kind === 'task' ? file : open && this.phaseFile(run, open, dir);
        let latest = logMtime;
        if (phase) latest = Math.max(latest, mtime(phase), mtime(phase.replace(/\.ndjson$/, '.ticks.ndjson.gz')));
        return Date.now() - latest < LOG_STALE_MS;
    }

    /**
     * Every run of `bot`, or of every bot, newest first: its plans, and its task runs that are not a
     * phase of one. A task log is a phase when its result names the plan (partOf) or a plan log names
     * it (phase-start, phase-end, the result's recent runs, or the open phase of a log from before
     * phase-start). The task logs are read before the plan logs: runPlan logs phase-start before the
     * phase's own log exists, so a phase log read is always named by the plan log read after it.
     */
    runs(bot?: string): RunSummary[] {
        const out: RunSummary[] = [];
        const listed = new Set<string>();
        const seen = new Set<string>();
        for (const [b, dirs] of this.botDirs()) {
            if (bot && b !== bot) continue;
            const tasks: RunOnDisk[] = [];
            const plans: RunOnDisk[] = [];
            for (const dir of dirs) {
                listed.add(dir);
                const logs = listDir(dir).flatMap(f => {
                    const log = logOf(f);
                    return log ? [{ f, kind: log.kind }] : [];
                });
                // Task logs first (see above).
                logs.sort((x, y) => Number(x.kind === 'plan') - Number(y.kind === 'plan'));
                for (const { f, kind } of logs) {
                    const r = this.load(b, dir, f);
                    if (!r) continue;
                    seen.add(r.file);
                    (kind === 'task' ? tasks : plans).push(r);
                }
            }
            const phases = new Set<string>();
            for (const p of plans) for (const id of this.phaseRunIds(p)) phases.add(id);
            for (const p of plans) out.push(summarize(p.run));
            for (const t of tasks) if (!t.run.partOf && !phases.has(t.run.runId)) out.push(summarize(t.run));
        }
        // Forget the folds of logs gone: from anywhere on a full listing, else from the directories listed.
        for (const path of this.cache.keys())
            if (!seen.has(path) && (!bot || listed.has(dirname(path)))) this.cache.delete(path);
        // RunIds start with a fixed-width UTC stamp, so they order by start without reading a clock.
        return out.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
    }

    /** The runIds of the task logs a plan's log names as its phases. */
    private phaseRunIds(p: RunOnDisk): string[] {
        const ids = p.run.runs.flatMap(r => (r.runId ? [r.runId] : []));
        for (const r of p.run.result?.recent ?? []) ids.push(r.runId);
        const open = openRun(p.run);
        const file = open && !open.runId ? this.phaseFile(p.run, open, p.dir) : null;
        if (file) ids.push(basename(file, '.ndjson'));
        return ids;
    }

    /** A plan run, or a task run (of its own or a phase), by its runId. */
    run(bot: string, runId: string): RunOnDisk | null {
        if (!RUN_ID.test(runId)) return null;
        for (const dir of this.botDirs().get(bot) ?? []) {
            const r = this.load(bot, dir, `${runId}.ndjson`);
            if (r) return r;
        }
        return null;
    }

    /** The copy of a plan's source that ran, beside its log; null for a task run. */
    source(p: RunOnDisk): string | null {
        if (p.run.kind !== 'plan') return null;
        const copy = join(p.dir, `${p.run.runId}.plan.ts`);
        try {
            return readFileSync(copy, 'utf8');
        } catch {
            return null;
        }
    }

    /**
     * A phase run's log. Plan logs from before phase-start name a run only when it ends, so the
     * open one is the first log of its task stamped at or after its selection.
     */
    phaseFile(run: Run, entry: PhaseRunEntry, dir: string): string | null {
        if (entry.runId) {
            const f = join(dir, `${entry.runId}.ndjson`);
            return existsSync(f) ? f : null;
        }
        const task = run.phases.find(p => p.phase === entry.phase)?.task;
        if (!task) return null;
        let best: { t: number; f: string } | null = null;
        for (const f of listDir(dir)) {
            if (!f.endsWith(`-${task}.ndjson`)) continue;
            const t = stampTime(f);
            if (t === null || t < entry.startedAt - 1000) continue;
            if (!best || t < best.t) best = { t, f };
        }
        return best && join(dir, best.f);
    }

    phase(bot: string, runId: string): PhaseLog | null {
        if (!RUN_ID.test(runId)) return null;
        for (const dir of this.botDirs().get(bot) ?? []) {
            const f = join(dir, `${runId}.ndjson`);
            try {
                return foldPhase(runId, parseLines(readFileSync(f, 'utf8')));
            } catch {
                // not in this directory
            }
        }
        return null;
    }

    /** The root whose bots/<bot>/bot.env exists, for the observer. */
    botRoot(bot: string): string | null {
        return this.roots.find(r => existsSync(join(r, 'bots', bot, 'bot.env'))) ?? null;
    }

    /** The conductor sessions the roots' durable state names. */
    owners(): SessionOwner[] {
        const out: SessionOwner[] = [];
        for (const root of this.roots) {
            const s = readDurableState(root);
            if (!s?.sessionId) continue;
            out.push({
                session: s.sessionId,
                root,
                bot: typeof s.bot === 'string' ? s.bot : null,
                goal: typeof s.goal === 'string' ? s.goal : null,
            });
        }
        return out;
    }
}

/** A directory's entries; none when it is gone or unreadable. */
function listDir(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}
