// What the plan viewer shows, folded from a plan's NDJSON log and the logs of its phase runs
// (event shapes: conductor/docs/plans.md, "Results, logs and stats"). Pure and free of Node imports:
// the server folds whole logs with it, and the page folds the events the server streams with the
// same functions, so a live view and a reload agree.
import type { PlanParams, PlanResult } from '../../lib/plan';
import type { TaskResult, TaskStatus } from '../../lib/task';
import { stampTime } from '../../lib/stamp';

export { stampTime };

/** One NDJSON log line: every event is stamped with its wall-clock `t`. */
export type LogEvent = Record<string, unknown> & { t: number; type: string };

/** Running: a result is still to come. Killed: no result and its process is gone. */
export type PlanState = 'running' | 'ended' | 'killed';

/** One phase choice: what each phase answered, and the inventory and bank it was made on. */
export interface Selection {
    t: number;
    /** The phase chosen; null when none applied (the plan then fails). */
    phase: string | null;
    checks: Record<string, string>;
    last: { phase: string; status: TaskStatus; reason: string } | null;
    inventory: Record<string, number>;
    free: number;
    bank: Record<string, number> | null;
}

/** One phase run as the plan log tells it. */
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
    /** The selection that started it, an index into `PlanRun.selections`. */
    selection: number;
}

export interface PlanRun {
    runId: string;
    bot: string;
    /** The plan's name; from the runId until the start event. */
    plan: string;
    startedAt: number;
    endedAt: number | null;
    state: PlanState;
    /** The Claude Code session that ran it (conductorSession); null for logs without one. */
    session: string | null;
    pid: number | null;
    /** The plan file as given, and the copy of it that ran. */
    sourceFile: string | null;
    sourceCopy: string | null;
    phases: PlanParams['phases'];
    requires: string[];
    stops: unknown[];
    selections: Selection[];
    runs: PhaseRunEntry[];
    /** The result event, with the time it was logged. */
    result: (PlanResult & { t: number }) | null;
    /** close-error and exception events, in order. */
    errors: { t: number; message: string }[];
}

/** `<stamp>-plan-<name>` -> `<name>`. */
export const planNameOf = (runId: string): string => /-plan-([a-z0-9-]+)$/.exec(runId)?.[1] ?? runId;

export function newPlanRun(runId: string, bot: string): PlanRun {
    return {
        runId,
        bot,
        plan: planNameOf(runId),
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
    } as unknown as R & { t: number };
}

/** The phase run in progress: started and not yet ended. */
export const openRun = (run: PlanRun): PhaseRunEntry | null => {
    const r = run.runs.at(-1);
    return r && r.endedAt === null ? r : null;
};

/** Folds one plan-log event into `run`, in place. Unknown events and malformed fields are ignored. */
export function applyPlanEvent(run: PlanRun, e: LogEvent): void {
    switch (e.type) {
        case 'source':
            run.sourceFile = str(e.file);
            run.sourceCopy = str(e.copy);
            run.pid = num(e.pid);
            run.session = str(e.session);
            return;
        case 'start':
            run.plan = str(e.plan) ?? run.plan;
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

export function foldPlan(runId: string, bot: string, events: LogEvent[]): PlanRun {
    const run = newPlanRun(runId, bot);
    for (const e of events) applyPlanEvent(run, e);
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
            return;
    }
}

export function foldPhase(runId: string, events: LogEvent[]): PhaseLog {
    const log = newPhaseLog(runId);
    for (const e of events) applyPhaseEvent(log, e);
    return log;
}

/** A plan run as the session list shows it. */
export interface PlanSummary {
    runId: string;
    bot: string;
    plan: string;
    startedAt: number;
    endedAt: number | null;
    state: PlanState;
    status: TaskStatus | null;
    reason: string | null;
    session: string | null;
    phaseRuns: number;
    xpGained: number;
}

export function summarize(run: PlanRun): PlanSummary {
    const xp = run.result?.xpGained ?? {};
    return {
        runId: run.runId,
        bot: run.bot,
        plan: run.plan,
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

/** Plan runs grouped by the session that ran them; untagged runs by local day. */
export interface SessionGroup {
    /** The session id, or `untagged:<YYYY-MM-DD>`. */
    key: string;
    session: string | null;
    firstAt: number;
    lastAt: number;
    bots: string[];
    /** Newest first. */
    plans: PlanSummary[];
}

const localDay = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Newest session first, by its latest plan's start; a running plan's session sorts as current. */
export function groupSessions(plans: PlanSummary[]): SessionGroup[] {
    const groups = new Map<string, SessionGroup>();
    for (const p of plans) {
        const key = p.session ?? `untagged:${localDay(p.startedAt)}`;
        let g = groups.get(key);
        if (!g) {
            g = { key, session: p.session, firstAt: p.startedAt, lastAt: p.startedAt, bots: [], plans: [] };
            groups.set(key, g);
        }
        g.firstAt = Math.min(g.firstAt, p.startedAt);
        g.lastAt = Math.max(g.lastAt, p.endedAt ?? p.startedAt);
        if (!g.bots.includes(p.bot)) g.bots.push(p.bot);
        g.plans.push(p);
    }
    const out = [...groups.values()];
    for (const g of out) {
        g.plans.sort((a, b) => b.startedAt - a.startedAt);
        g.bots.sort();
    }
    const running = (g: SessionGroup) => g.plans.some(p => p.state === 'running');
    return out.sort((a, b) => Number(running(b)) - Number(running(a)) || b.lastAt - a.lastAt);
}

/** The plan a follower shows for a bot: the newest, which is the running one when one runs. */
export function followed(plans: PlanSummary[], bot: string): PlanSummary | null {
    let best: PlanSummary | null = null;
    for (const p of plans) {
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
