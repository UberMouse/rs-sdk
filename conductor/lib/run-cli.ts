// What run-task.ts shares between a task run and a plan's phase runs (the NDJSON log, the recording,
// the live driver, the result of a run that never produced one) and its argument parsing, kept out of
// the CLI's process handling so tests can reach them.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BotSDK } from '../../sdk/index';
import { LiveDriver } from '../core/drivers/live';
import { Recorder, recordingFile } from '../core/drivers/recording';
import { TICK_STALL_MS } from './engine';
import { readDurableState, REPO_ROOT } from './env';
import { isPlan, type PlanDef } from './plan';
import { captureScreenshot } from './screenshot';
import { parseStop, type StopCondition } from './stop';
import type { Sinks, TaskResult } from './task';
import { errMessage, fileStamp } from './util';

export const USAGE = `usage: bun conductor/run-task.ts <bot> <task> [--params '<json>'] [--until level:<skill>:<n>|xp:<skill>:<n>|minutes:<n>]... [--takeover]
       bun conductor/run-task.ts <bot> --plan <file> [--until ...]... [--takeover]
       bun conductor/run-task.ts --list`;

export interface RunArgs {
    bot: string;
    /** The task to run; '' with `--plan`. */
    task: string;
    /** The plan file as given, or null for a task run. */
    plan: string | null;
    params: unknown;
    stops: StopCondition[];
    takeover: boolean;
}

/** The arguments after `--list` is ruled out; `error` is a usage error, with what was parsed before it. */
export function parseRunArgs(argv: string[]): { args: RunArgs; error?: string } {
    const positional: string[] = [];
    const args: RunArgs = { bot: '', task: '', plan: null, params: {}, stops: [], takeover: false };
    let paramsGiven = false;
    let error: string | undefined;
    try {
        for (let i = 0; i < argv.length; i++) {
            const a = argv[i]!;
            if (a === '--params') {
                args.params = JSON.parse(argv[++i] ?? '');
                paramsGiven = true;
            } else if (a === '--until') args.stops.push(parseStop(argv[++i] ?? ''));
            else if (a === '--takeover') args.takeover = true;
            else if (a === '--plan') {
                if (args.plan !== null) throw new Error('--plan given twice');
                const file = argv[++i];
                if (!file) throw new Error('--plan needs a file');
                args.plan = file;
            } else if (a.startsWith('-')) throw new Error(`unknown flag ${a}`);
            else positional.push(a);
        }
    } catch (e) {
        error = errMessage(e);
    }
    args.bot = positional[0] ?? '';
    if (args.plan === null) args.task = positional[1] ?? '';
    if (error === undefined) {
        if (args.plan === null) {
            if (positional.length !== 2) error = 'expected <bot> <task>';
        } else if (positional.length > 1) error = '--plan and a <task> are mutually exclusive';
        else if (positional.length === 0) error = 'expected <bot> --plan <file>';
        // A plan's phases carry their own params; dropping these silently would run something else.
        else if (paramsGiven) error = "--params is for a task; a plan's params are in its file";
    }
    return error === undefined ? { args } : { args, error };
}

/** The plan a file default-exports; throws a message naming the file when it has none or won't load. */
export async function loadPlan(file: string, cwd = process.cwd()): Promise<{ def: PlanDef; path: string }> {
    const path = resolve(cwd, file);
    if (!existsSync(path)) throw new Error(`no plan file ${file}`);
    let mod: { default?: unknown };
    try {
        mod = await import(path);
    } catch (e) {
        throw new Error(`can't load plan ${file}: ${errMessage(e)}`, { cause: e });
    }
    if (!isPlan(mod.default))
        throw new Error(`${file} does not default-export a plan (export default definePlan(...))`);
    return { def: mod.default, path };
}

/** What a result says about the run it is for, apart from its outcome. */
export interface ResultBase {
    task: string;
    bot: string;
    params: unknown;
    partOf?: string;
}

/** The result of a run that never produced one (a usage error, a failed connection, a kill). */
export function errorResult(
    base: ResultBase,
    reason: string,
    durationMs: number,
    log: { runId: string; logFile: string } | null = null,
): TaskResult {
    return {
        task: base.task,
        bot: base.bot,
        runId: log?.runId ?? '',
        // Where the engine puts it, so a killed phase's result reads like a finished one's.
        ...(base.partOf !== undefined && { partOf: base.partOf }),
        status: 'error',
        reason,
        params: base.params,
        durationMs,
        loops: 0,
        stepRuns: {},
        lastStep: null,
        xpGained: {},
        levelsGained: {},
        inventoryDelta: {},
        finalPos: null,
        hp: null,
        inCombat: null,
        screenshots: [],
        logFile: log?.logFile ?? '',
    };
}

/**
 * The Claude Code session a run belongs to, so a plan viewer can group a conductor's plans: the
 * session running the CLI (task-runners are subagents and share the conductor's), else the
 * `sessionId` of the worktree's durable state, else null (a plan run by hand outside a session).
 */
export function conductorSession(
    env: Record<string, string | undefined> = process.env,
    root: string = REPO_ROOT,
): string | null {
    return env.CLAUDE_CODE_SESSION_ID || readDurableState(root)?.sessionId || null;
}

/** A plan log's `source` event: the plan file as given, the copy that ran, and who ran it. */
export function sourceEvent(
    file: string,
    copy: string,
    env: Record<string, string | undefined> = process.env,
    root: string = REPO_ROOT,
): Record<string, unknown> {
    // The pid tells a viewer a plan still running from one hard-killed without a result.
    return { type: 'source', file, copy, pid: process.pid, session: conductorSession(env, root) };
}

/** Where a bot's run logs, recordings and plan copies go. */
export const runsDir = (bot: string): string => join(REPO_ROOT, 'conductor/runs', bot);

export interface RunLog {
    runId: string;
    logFile: string;
    /**
     * Appends one event, stamped with the wall-clock time `t` that stats.ts orders results by. A log
     * takes one `result`, the first: a later one (the run's own after a kill wrote one) is dropped,
     * so stats never counts a run twice.
     */
    append(event: Record<string, unknown>): void;
    /** It holds its result. */
    readonly ended: boolean;
}

export function openRunLog(dir: string, runId: string): RunLog {
    const logFile = join(dir, `${runId}.ndjson`);
    mkdirSync(dir, { recursive: true });
    let ended = false;
    return {
        runId,
        logFile,
        append: event => {
            if (event.type === 'result') {
                if (ended) return;
                ended = true;
            }
            appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...event }) + '\n');
        },
        get ended() {
            return ended;
        },
    };
}

/**
 * The process's one `RESULT` line: whichever of the run's own and a kill's comes first. A later one
 * is dropped. Keeping it the last stdout line is the caller's part (run-task.ts).
 */
export class ResultLine {
    private shown: TaskResult | null = null;

    constructor(private readonly out: (line: string) => void = line => console.log(line)) {}

    /** The result printed, once one has been. */
    get printed(): TaskResult | null {
        return this.shown;
    }

    /** Prints `result` unless a result is already printed; true when it printed. */
    print(result: TaskResult): boolean {
        if (this.shown) return false;
        this.shown = result;
        this.out(`RESULT ${JSON.stringify(result)}`);
        return true;
    }
}

/**
 * `<fileStamp>-<task>`, at a millisecond no run of `task` in `dir` has used: two phase runs of one
 * task can open within a millisecond (the first refused at preflight), and would share a log. The
 * log appears on its first append, the recording when the run opens; either marks the stamp used.
 */
function freshRunId(dir: string, task: string): string {
    for (;;) {
        const runId = `${fileStamp()}-${task}`;
        const logFile = join(dir, `${runId}.ndjson`);
        if (!existsSync(logFile) && !existsSync(recordingFile(logFile))) return runId;
    }
}

/** One task run on the live client: its log, recording and driver. */
export interface LiveRun extends RunLog {
    driver: LiveDriver;
    sinks: Sinks;
    recorder: Recorder | null;
    /** Closes the driver, then the recording. */
    close(): void;
    /**
     * For a signal handler: closes the recording (synchronously, so it is whole before the process
     * exits) and returns an error result, written to the log unless the run's own result already is.
     * The log then takes no other result.
     */
    kill(reason: string, durationMs?: number): TaskResult;
}

export interface LiveRunOptions extends ResultBase {
    /** Where the log and recording go: `runsDir(bot)` in the CLI. */
    dir: string;
    stops: StopCondition[];
    print(line: string): void;
    warn(msg: string): void;
}

/**
 * Opens a run of `task` as run-task records every run: `<fileStamp>-<task>.ndjson` and its
 * `.ticks.ndjson.gz` beside it, with the inputs in the recording's header (partOf included) so
 * replay.ts re-runs it from the file alone.
 */
export function openLiveRun(sdk: BotSDK, o: LiveRunOptions): LiveRun {
    const startedAt = Date.now();
    const log = openRunLog(o.dir, freshRunId(o.dir, o.task));
    const { runId, logFile } = log;
    const logSinks: Sinks = {
        event: event => log.append(event),
        print: o.print,
        screenshot: label => captureScreenshot(sdk, o.bot, undefined, label),
    };
    const recorder = Recorder.toFile(
        recordingFile(logFile),
        {
            task: o.task,
            bot: o.bot,
            runId,
            logFile,
            params: o.params,
            stops: o.stops,
            ...(o.partOf !== undefined && { partOf: o.partOf }),
        },
        o.warn,
    );
    const sinks = recorder ? recorder.wrap(logSinks) : logSinks;
    const driver = new LiveDriver(sdk, sinks, TICK_STALL_MS, recorder ?? undefined);
    return {
        runId,
        logFile,
        append: log.append,
        get ended() {
            return log.ended;
        },
        driver,
        sinks,
        recorder,
        close() {
            try {
                driver.close();
            } finally {
                recorder?.close();
            }
        },
        kill(reason, durationMs = Date.now() - startedAt) {
            recorder?.close();
            const open = !log.ended;
            const result = errorResult(o, reason, durationMs, open ? log : null);
            if (open) log.append({ type: 'result', ...result });
            return result;
        },
    };
}
