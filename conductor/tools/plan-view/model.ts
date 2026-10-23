// What the plan viewer shows, folded from a plan's NDJSON log and the logs of its phase runs, or from
// the log of a task run on its own (event shapes: conductor/docs/plans.md, "Results, logs and stats").
// Pure and free of Node imports: the server folds whole logs with it, and the page folds the events
// the server streams with the same functions, so a live view and a reload agree.
import type { PlanParams, PlanResult } from '../../lib/plan';
import type { TaskResult, TaskStatus } from '../../lib/task';
import { stampTime } from '../../lib/stamp';

export { stampTime };

/** One NDJSON log line: every event is stamped with its wall-clock `t`. */
export type LogEvent = Record<string, unknown> & { t: number; type: string };

/** Running: a result is still to come. Killed: no result and its process is gone. */
export type RunState = 'running' | 'ended' | 'killed';

/** A plan's log, or the log of a task run on its own (not a phase of a plan). */
export type RunKind = 'plan' | 'task';

/** One phase choice: what each phase answered, and the inventory and bank it was made on. */
export interface Selection {
    t: number;
    /** The phase chosen; null when none applied (the plan then fails). */
    phase: string | null;
    checks: Record<string, string>;
    /** What each phase's predicates read, by phase (`inv('Logs')` -> 3); empty in logs from before it was logged. */
    reads: Record<string, Record<string, unknown>>;
    /** What the plan's own until read; null for a plan without one, or a log from before it was logged. */
    planReads: Record<string, unknown> | null;
    last: { phase: string; status: TaskStatus; reason: string } | null;
    inventory: Record<string, number>;
    free: number;
    bank: Record<string, number> | null;
}

/** One phase run as the plan log tells it; a task run's one entry is the run itself. */
export interface PhaseRunEntry {
    /** Counts the plan's phase runs from 0. */
    index: number;
    phase: string;
    /** Null until the plan log names it: at phase-start, or at phase-end in logs that predate it. */
    runId: string | null;
    logFile: string | null;
    startedAt: number;
    endedAt: number | null;
    /** Null while it runs. */
    status: TaskStatus | null;
    reason: string | null;
    /** The selection that started it, an index into `Run.selections`; -1 for a task run's. */
    selection: number;
    /** The engine's own time and XP for it, from phase-end; null while it runs, or in logs from before them. */
    durationMs: number | null;
    xpGained: Record<string, number> | null;
}

/**
 * A plan run, or a task run on its own folded as a plan of one phase: the task, run once, its own
 * log the phase run's (so the page shows both with one set of panels).
 */
export interface Run {
    kind: RunKind;
    runId: string;
    bot: string;
    /** The plan's or task's name; from the runId until the start event. */
    name: string;
    startedAt: number;
    endedAt: number | null;
    state: RunState;
    /** The Claude Code session that ran it (conductorSession); null for logs without one. */
    session: string | null;
    pid: number | null;
    /** A plan's file as given, and the copy of it that ran; null for a task run. */
    sourceFile: string | null;
    sourceCopy: string | null;
    phases: PlanParams['phases'];
    requires: string[];
    stops: unknown[];
    selections: Selection[];
    runs: PhaseRunEntry[];
    /** The result event, with the time it was logged; a task run's has no phase totals. */
    result: (TaskResult & Partial<Pick<PlanResult, 'phases' | 'recent' | 'bankDelta'>> & { t: number }) | null;
    /** The plan a task log names itself a phase of (its result's partOf); null for a plan or a run of its own. */
    partOf: string | null;
    /** close-error and exception events, in order. */
    errors: { t: number; message: string }[];
}

/** `<stamp>-plan-<name>` -> `<name>`, `<stamp>-<task>` -> `<task>`. */
export const nameOf = (kind: RunKind, runId: string): string =>
    (kind === 'plan' ? /-plan-([a-z0-9-]+)$/ : /Z-([a-z0-9-]+)$/).exec(runId)?.[1] ?? runId;

export function newRun(kind: RunKind, runId: string, bot: string): Run {
    return {
        kind,
        runId,
        bot,
        name: nameOf(kind, runId),
        startedAt: stampTime(runId) ?? 0,
        endedAt: null,
        state: 'running',
        session: null,
        pid: null,
        sourceFile: null,
        sourceCopy: null,
        phases: [],
        requires: [],
        stops: [],
        selections: [],
        runs: [],
        result: null,
        partOf: null,
        errors: [],
    };
}

const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const record = <T>(x: unknown): Record<string, T> | null =>
    x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, T>) : null;
const STATUSES: readonly string[] = ['done', 'failed', 'stuck', 'error'];
const status = (x: unknown): TaskStatus | null =>
    typeof x === 'string' && STATUSES.includes(x) ? (x as TaskStatus) : null;

/** A start event's phases, keeping the entries that name a phase and its task. */
function phasesOf(x: unknown): PlanParams['phases'] {
    if (!Array.isArray(x)) return [];
    return x.flatMap(p => {
        const o = record(p);
        const phase = str(o?.phase);
        const task = str(o?.task);
        return o && phase && task ? [{ phase, task, params: o.params ?? null }] : [];
    });
}

/** A select event's `last`: the previous phase run's end, or null. */
function lastOf(x: unknown): Selection['last'] {
    const o = record(x);
    const phase = str(o?.phase);
    const st = status(o?.status);
    return phase && st ? { phase, status: st, reason: str(o?.reason) ?? '' } : null;
}

/**
 * A result event, with the maps and lists the page reads defaulted to empty: a result from the
 * engine always has them, so this guards only a truncated or hand-edited log.
 */
function resultOf<R extends TaskResult>(e: LogEvent): R & { t: number } {
    const o: Record<string, unknown> = e;
    return {
        ...o,
        status: status(o.status) ?? 'error',
        reason: str(o.reason) ?? '',
        xpGained: record<number>(o.xpGained) ?? {},
        inventoryDelta: record<number>(o.inventoryDelta) ?? {},
        levelsGained: record(o.levelsGained) ?? {},
        stepRuns: record<number>(o.stepRuns) ?? {},
        ...(Array.isArray(o.phases) && { phases: o.phases }),
        ...(Array.isArray(o.recent) && { recent: o.recent }),
        ...(record(o.bankDelta) && { bankDelta: record<number>(o.bankDelta) }),
    } as unknown as R & { t: number };
}

/** The phase run in progress: started and not yet ended. */
export const openRun = (run: Run): PhaseRunEntry | null => {
    const r = run.runs.at(-1);
    return r && r.endedAt === null ? r : null;
};

/** Where one phase's share of a plan run went, and what it earned. */
export interface PhaseStats {
    phase: string;
    runs: number;
    /** Runs that ended failed, stuck or error. */
    fails: number;
    /** Time in its runs, the one in progress included. */
    timeMs: number;
    /** XP of its finished runs and their time, the rate being one over the other; xp is null while a finished run has none logged. */
    xp: Record<string, number> | null;
    xpTimeMs: number;
}

/** A plan run's time and XP, phase by phase. */
export interface PlanStats {
    phases: PhaseStats[];
    elapsedMs: number;
    /** Phase time in phases that gained XP, that gained none, and whose XP is not known yet. */
    productiveMs: number;
    overheadMs: number;
    unratedMs: number;
    /** The rest of the elapsed time: choosing phases and starting their runs. */
    betweenMs: number;
    /** XP of the finished phase runs, and the plan's time to the end of the last of them; null when one is not known. */
    xp: Record<string, number> | null;
    xpTimeMs: number;
}

const addXp = (into: Record<string, number>, xp: Record<string, number>) => {
    for (const [k, n] of Object.entries(xp)) into[k] = (into[k] ?? 0) + n;
};
export const xpTotal = (xp: Record<string, number>): number => Object.values(xp).reduce((a, b) => a + b, 0);

/**
 * Per phase: the result's totals once it ends, else the phase runs' own (each run's XP from its
 * phase-end). `open` is the run in progress's XP so far, from its log's latest progress, rated over
 * the time to that progress: without it a phase that runs most of the plan shows no XP until it ends.
 */
export function planStats(run: Run, now: number, open?: { xp: Record<string, number>; at: number }): PlanStats {
    const totals = run.result?.phases;
    const phases = run.phases.map(({ phase }): PhaseStats => {
        const mine = run.runs.filter(r => r.phase === phase);
        const fails = mine.filter(r => r.status !== null && r.status !== 'done').length;
        const summary = totals?.find(x => x.phase === phase);
        if (summary)
            return {
                phase,
                runs: mine.length,
                fails,
                timeMs: summary.durationMs,
                xp: summary.xpGained,
                xpTimeMs: summary.durationMs,
            };
        let timeMs = 0;
        let xpTimeMs = 0;
        let xp: Record<string, number> | null = null;
        let unknown = false;
        for (const r of mine) {
            const ms = r.durationMs ?? (r.endedAt ?? now) - r.startedAt;
            timeMs += ms;
            if (r.endedAt === null) {
                if (open && !totals) {
                    xp ??= {};
                    addXp(xp, open.xp);
                    xpTimeMs += Math.max(0, open.at - r.startedAt);
                }
                continue;
            }
            if (!r.xpGained) unknown = true;
            else {
                xp ??= {};
                addXp(xp, r.xpGained);
                xpTimeMs += ms;
            }
        }
        return { phase, runs: mine.length, fails, timeMs, xp: unknown ? null : xp, xpTimeMs };
    });
    const elapsedMs = (run.endedAt ?? now) - run.startedAt;
    const sum = (f: (p: PhaseStats) => boolean) => phases.filter(f).reduce((n, p) => n + p.timeMs, 0);
    const productiveMs = sum(p => !!p.xp && xpTotal(p.xp) > 0);
    const overheadMs = sum(p => !!p.xp && xpTotal(p.xp) === 0);
    const unratedMs = sum(p => !p.xp);
    // A phase with no finished run yet has no XP to miss; one whose finished runs logged none does.
    const known = phases.every(p => p.xp || !run.runs.some(r => r.phase === p.phase && r.endedAt !== null));
    const xp: Record<string, number> = {};
    for (const p of phases) if (p.xp) addXp(xp, p.xp);
    const openEntry = openRun(run);
    return {
        phases,
        elapsedMs,
        productiveMs,
        overheadMs,
        unratedMs,
        betweenMs: Math.max(0, elapsedMs - productiveMs - overheadMs - unratedMs),
        xp: known ? xp : null,
        // To the end of the last finished run, or to the open run's latest progress when it is counted.
        xpTimeMs:
            elapsedMs -
            (openEntry && !totals ? now - (open ? Math.max(openEntry.startedAt, open.at) : openEntry.startedAt) : 0),
    };
}

/** Folds one plan-log event into `run`, in place. Unknown events and malformed fields are ignored. */
export function applyPlanEvent(run: Run, e: LogEvent): void {
    switch (e.type) {
        case 'source':
            run.sourceFile = str(e.file);
            run.sourceCopy = str(e.copy);
            run.pid = num(e.pid);
            run.session = str(e.session);
            return;
        case 'start':
            run.name = str(e.plan) ?? run.name;
            run.startedAt = e.t;
            run.phases = phasesOf(e.phases);
            run.requires = Array.isArray(e.requires) ? e.requires.filter(x => typeof x === 'string') : [];
            run.stops = Array.isArray(e.stops) ? e.stops : [];
            return;
        case 'select': {
            const phase = str(e.phase);
            run.selections.push({
                t: e.t,
                phase,
                checks: record<string>(e.checks) ?? {},
                reads: record<Record<string, unknown>>(e.reads) ?? {},
                planReads: record(e.planReads),
                last: lastOf(e.last),
                inventory: record<number>(e.inventory) ?? {},
                free: num(e.free) ?? 0,
                bank: record<number>(e.bank),
            });
            // The run starts here; phase-start (or, in older logs, phase-end) names its log.
            if (phase)
                run.runs.push({
                    index: run.runs.length,
                    phase,
                    runId: null,
                    logFile: null,
                    startedAt: e.t,
                    endedAt: null,
                    status: null,
                    reason: null,
                    selection: run.selections.length - 1,
                    durationMs: null,
                    xpGained: null,
                });
            return;
        }
        case 'phase-start': {
            const r = openRun(run);
            if (!r) return;
            r.runId = str(e.runId);
            r.logFile = str(e.logFile);
            return;
        }
        case 'phase-end': {
            const r = openRun(run);
            if (!r) return;
            r.runId ??= str(e.runId);
            r.endedAt = e.t;
            r.status = status(e.status);
            r.reason = str(e.reason);
            r.durationMs = num(e.durationMs);
            r.xpGained = record<number>(e.xpGained);
            return;
        }
        case 'close-error':
        case 'exception':
            run.errors.push({ t: e.t, message: str(e.message) ?? JSON.stringify(e) });
            return;
        case 'result': {
            run.result = resultOf<PlanResult>(e);
            run.endedAt = e.t;
            run.state = 'ended';
            // A kill cuts the phase in progress: it ends with the plan, as the result counts it.
            const r = openRun(run);
            if (r) {
                const ref = run.result.recent?.find(x => x.phase === r.phase && (!r.runId || x.runId === r.runId));
                r.runId ??= ref?.runId ?? null;
                r.logFile ??= ref?.logFile ?? null;
                r.endedAt = e.t;
                r.status = status(ref?.status) ?? status(e.status);
                r.reason = ref?.reason ?? str(e.reason);
            }
            return;
        }
    }
}

/**
 * Folds one event of a task run's own log into `run`, in place: its start opens the one phase run,
 * its result ends it. The steps and lines are the phase log's to fold (applyPhaseEvent).
 */
export function applyTaskEvent(run: Run, e: LogEvent): void {
    switch (e.type) {
        case 'source':
            run.pid = num(e.pid);
            run.session = str(e.session);
            return;
        case 'start':
            run.name = str(e.task) ?? run.name;
            run.startedAt = e.t;
            run.phases = [{ phase: run.name, task: run.name, params: e.params ?? null }];
            run.stops = Array.isArray(e.stops) ? e.stops : [];
            run.runs = [
                {
                    index: 0,
                    phase: run.name,
                    runId: run.runId,
                    logFile: null,
                    startedAt: e.t,
                    endedAt: null,
                    status: null,
                    reason: null,
                    selection: -1,
                    durationMs: null,
                    xpGained: null,
                },
            ];
            return;
        case 'close-error':
        case 'exception':
            run.errors.push({ t: e.t, message: str(e.message) ?? JSON.stringify(e) });
            return;
        case 'result': {
            run.result = resultOf<TaskResult>(e);
            run.partOf = str(e.partOf);
            run.endedAt = e.t;
            run.state = 'ended';
            const r = run.runs[0];
            if (r) {
                r.logFile = str(e.logFile);
                r.endedAt = e.t;
                r.status = run.result.status;
                r.reason = run.result.reason;
                r.durationMs = run.result.durationMs;
                r.xpGained = run.result.xpGained;
            }
            return;
        }
    }
}

/** Folds one event of a run's log, plan or task, into `run`, in place. */
export const applyRunEvent = (run: Run, e: LogEvent): void =>
    run.kind === 'plan' ? applyPlanEvent(run, e) : applyTaskEvent(run, e);

export function foldRun(kind: RunKind, runId: string, bot: string, events: LogEvent[]): Run {
    const run = newRun(kind, runId, bot);
    for (const e of events) applyRunEvent(run, e);
    return run;
}

/** Recent step and log lines a phase view keeps; the counts cover the whole run. */
export const PHASE_LINES = 200;

/** One phase run's own log, folded. */
export interface PhaseLog {
    runId: string;
    task: string;
    params: unknown;
    startedAt: number;
    /** The step running now (the last one entered); null before the first. */
    step: string | null;
    /** Times each step has been entered, from the latest progress event and the steps since. */
    stepRuns: Record<string, number>;
    /** The latest progress event's XP summary, e.g. "Crafting +315". */
    gained: string;
    /** The same as a record, and when it was logged; the result's XP once it ends. Null before the first progress. */
    xpGained: Record<string, number> | null;
    xpAt: number | null;
    /** The last PHASE_LINES step, log and stop events, oldest first. */
    lines: { t: number; kind: 'step' | 'log' | 'stop'; text: string }[];
    result: TaskResult | null;
}

export function newPhaseLog(runId: string): PhaseLog {
    return {
        runId,
        task: /-([a-z0-9-]+)$/.exec(runId)?.[1] ?? '',
        params: null,
        startedAt: stampTime(runId) ?? 0,
        step: null,
        stepRuns: {},
        gained: '',
        xpGained: null,
        xpAt: null,
        lines: [],
        result: null,
    };
}

const pushLine = (log: PhaseLog, line: PhaseLog['lines'][number]) => {
    log.lines.push(line);
    if (log.lines.length > PHASE_LINES) log.lines.splice(0, log.lines.length - PHASE_LINES);
};

export function applyPhaseEvent(log: PhaseLog, e: LogEvent): void {
    switch (e.type) {
        case 'start':
            log.task = str(e.task) ?? log.task;
            log.params = e.params ?? null;
            log.startedAt = e.t;
            return;
        case 'step': {
            const step = str(e.step);
            if (!step) return;
            log.step = step;
            log.stepRuns[step] = (log.stepRuns[step] ?? 0) + 1;
            pushLine(log, { t: e.t, kind: 'step', text: step });
            return;
        }
        case 'progress': {
            // The engine's own count is the truth; steps logged since keep adding to it.
            const runs = record<number>(e.stepRuns);
            if (runs) log.stepRuns = { ...runs };
            log.gained = str(e.gained) ?? log.gained;
            log.xpGained = parseGained(log.gained);
            log.xpAt = e.t;
            return;
        }
        case 'log':
            pushLine(log, { t: e.t, kind: 'log', text: str(e.msg) ?? '' });
            return;
        case 'external-stop':
            pushLine(log, { t: e.t, kind: 'stop', text: `stop: ${str(e.reason) ?? ''}` });
            return;
        case 'result':
            log.result = resultOf<TaskResult>(e);
            log.stepRuns = { ...log.result.stepRuns };
            log.xpGained = log.result.xpGained;
            log.xpAt = e.t;
            return;
    }
}

/** The engine's progress summary, "Thieving +25290, Hitpoints +12", as a record; "" is none yet. */
export function parseGained(gained: string): Record<string, number> {
    const xp: Record<string, number> = {};
    for (const m of gained.matchAll(/([A-Za-z]+) \+(\d+)/g)) xp[m[1]!] = Number(m[2]);
    return xp;
}

export function foldPhase(runId: string, events: LogEvent[]): PhaseLog {
    const log = newPhaseLog(runId);
    for (const e of events) applyPhaseEvent(log, e);
    return log;
}

/** A run, plan or task, as the session list shows it. */
export interface RunSummary {
    kind: RunKind;
    runId: string;
    bot: string;
    name: string;
    startedAt: number;
    endedAt: number | null;
    state: RunState;
    status: TaskStatus | null;
    reason: string | null;
    session: string | null;
    phaseRuns: number;
    xpGained: number;
}

export function summarize(run: Run): RunSummary {
    const xp = run.result?.xpGained ?? {};
    return {
        kind: run.kind,
        runId: run.runId,
        bot: run.bot,
        name: run.name,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        state: run.state,
        status: run.result ? status(run.result.status) : null,
        reason: run.result?.reason ?? null,
        session: run.session,
        phaseRuns: run.runs.length,
        xpGained: Object.values(xp).reduce((n, x) => n + x, 0),
    };
}

/** Runs grouped by the session that ran them; untagged runs by local day. */
export interface SessionGroup {
    /** The session id, or `untagged:<YYYY-MM-DD>`. */
    key: string;
    session: string | null;
    firstAt: number;
    lastAt: number;
    bots: string[];
    /** Newest first. */
    runs: RunSummary[];
}

const localDay = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Newest session first, by its latest run's start; a running run's session sorts as current. */
export function groupSessions(runs: RunSummary[]): SessionGroup[] {
    const groups = new Map<string, SessionGroup>();
    for (const p of runs) {
        const key = p.session ?? `untagged:${localDay(p.startedAt)}`;
        let g = groups.get(key);
        if (!g) {
            g = { key, session: p.session, firstAt: p.startedAt, lastAt: p.startedAt, bots: [], runs: [] };
            groups.set(key, g);
        }
        g.firstAt = Math.min(g.firstAt, p.startedAt);
        g.lastAt = Math.max(g.lastAt, p.endedAt ?? p.startedAt);
        if (!g.bots.includes(p.bot)) g.bots.push(p.bot);
        g.runs.push(p);
    }
    const out = [...groups.values()];
    for (const g of out) {
        g.runs.sort((a, b) => b.startedAt - a.startedAt);
        g.bots.sort();
    }
    const running = (g: SessionGroup) => g.runs.some(p => p.state === 'running');
    return out.sort((a, b) => Number(running(b)) - Number(running(a)) || b.lastAt - a.lastAt);
}

/**
 * The run a follower shows for a bot, plan or task: the newest, which is the running one when one
 * runs (a bot has one controller, so one run at a time).
 */
export function followed(runs: RunSummary[], bot: string): RunSummary | null {
    let best: RunSummary | null = null;
    for (const p of runs) {
        if (p.bot !== bot) continue;
        // RunIds start with a fixed-width UTC stamp: the greatest is the newest.
        if (!best || p.runId > best.runId) best = p;
    }
    return best;
}

/** The live bot as the observer last saw it; what the page's bot panel shows. */
export interface BotSnapshot {
    /** connecting: no state yet; live: ticks advancing; stale: the last state stopped advancing; offline: no connection. */
    status: 'connecting' | 'live' | 'stale' | 'offline';
    /** Why it is offline, or what it is waiting for. */
    message: string | null;
    at: number;
    stateAgeMs: number | null;
    tick: number | null;
    inGame: boolean;
    player: {
        name: string;
        x: number;
        z: number;
        plane: number;
        hp: number;
        maxHp: number;
        combatLevel: number;
        inCombat: boolean;
    } | null;
    inventory: { name: string; count: number }[];
    /** Inventory slots in all, used or not. */
    slots: number;
    equipment: string[];
    skills: { name: string; level: number; baseLevel: number; xp: number }[];
}
