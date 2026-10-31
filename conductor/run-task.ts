// Run one catalog task, or a plan of them, on one bot and print a single machine-readable result.
//
//   bun conductor/run-task.ts --list
//   bun conductor/run-task.ts <bot> <task> [--params '<json>'] [--until <stop>]... [--takeover]
//   bun conductor/run-task.ts <bot> --plan <file> [--until <stop>]... [--takeover]
//   either form also takes --objective <title> --journal <abs path> (together): when the run ends, run-task
//   appends its journal line itself (kind run; nothing for a run that never opened a log)
//
//   <stop>: level:<skill>:<n> | xp:<skill>:<n> | minutes:<n>   (any one ends the run; for a plan,
//   counted from the plan's start)
//
// The last stdout line is always `RESULT <json>` (a TaskResult; a PlanResult for a plan). Exit 0 for
// status "done", 1 otherwise, 2 for a usage error (an error RESULT is printed first). A plain task run
// that follows another plain task run carries a "hint" in its RESULT: repeated work belongs in a plan.
//
// Refuses to start when another controller already drives the bot, unless --takeover. A game
// client must already be attached (conductor/tools/client.ts or the lite runner).
//
// Every run is recorded next to its log, as <runId>.ticks.ndjson.gz, for conductor/tools/replay.ts:
// about 47 KiB a minute of play, 2.8 MB an hour, so always on (sizes in conductor/docs/interruptible-tasks.md).
// A plan (conductor/docs/plans.md) runs in one controller connection. It logs to
// <fileStamp>-plan-<name>.ndjson with a copy of its source beside it (<runId>.plan.ts), and each
// phase is a task run with its own log and recording, as above.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';
import type { BotSDK } from '../sdk/index';
import { runScript } from '../sdk/runner';
import { loadTask, taskNames } from './lib/catalog';
import { LiveDriver } from './core/drivers/live';
import { executeTask, TICK_STALL_MS } from './lib/engine';
import {
    epilogueSummary,
    needsEpilogue,
    runEpilogue,
    SIGNAL_EPILOGUE_TICKS,
    type SafeSpot,
    trackSafeSpot,
    withEpilogueResult,
} from './lib/epilogue';
import { controllerCount, loadBotEnv, type BotEnv } from './lib/env';
import { type PlanDef, planParams, type PlanResult, runPlan } from './lib/plan';
import {
    emitResult as emit,
    errorResult,
    type LiveRun,
    loadPlan,
    openLiveRun,
    openRunLog,
    parseRunArgs,
    type ResultBase,
    ResultLine,
    type RunLog,
    runsDir,
    sourceEvent,
    USAGE,
} from './lib/run-cli';
import { captureScreenshot } from './lib/screenshot';
import type { TaskDef, TaskResult } from './lib/task';
import { errMessage, fileStamp } from './lib/util';
import { describeCommand } from './lib/journal';

const argv = process.argv.slice(2);

if (argv.includes('--list')) {
    const catalog = [];
    for (const name of taskNames()) {
        const def = await loadTask(name);
        catalog.push({
            name: def.name,
            description: def.description,
            params: z.toJSONSchema(def.params, { io: 'input' }),
        });
    }
    console.log(JSON.stringify(catalog, null, 2));
    process.exit(0);
}

const { args, error: usageError } = parseRunArgs(argv);
const { bot: botName, task: taskName, params: rawParams, stops, takeover, journal } = args;
const startedAt = Date.now();
/** The one RESULT line: the run's own, or a kill's or an error's in its place. */
const resultLine = new ResultLine();
const exitCode = () => (resultLine.printed?.status === 'done' ? 0 : 1);

const emitResult = (result: TaskResult | PlanResult): boolean =>
    emit(result, {
        resultLine,
        runsDir: runsDir(botName),
        isPlan: args.plan !== null,
        journal: journal && { ...journal, command: describeCommand(args) },
    });

type LoadedPlan = { def: PlanDef; path: string };
/** The plan being run, once its file has loaded. */
let plan: LoadedPlan | null = null;

/** Who the result of a run that never produced one is for. */
function resultBase(): ResultBase {
    if (plan) return { task: `plan:${plan.def.name}`, bot: botName, params: planParams(plan.def) };
    // A plan that never loaded is named by the file asked for.
    if (args.plan !== null) return { task: `plan:${args.plan}`, bot: botName, params: {} };
    return { task: taskName, bot: botName, params: rawParams };
}

/**
 * The result of a run that never produced one. A plan's has no phase totals: it never got as far as
 * running one (a killed plan that did adds up its own, through `killPlan`).
 */
function failure(
    reason: string,
    durationMs = Date.now() - startedAt,
    log: { runId: string; logFile: string } | null = null,
): TaskResult | PlanResult {
    const result = errorResult(resultBase(), reason, durationMs, log);
    return args.plan !== null ? { ...result, phases: [], recent: [] } : result;
}

/** Print the RESULT line for a run that never produced one, and exit. */
function bail(reason: string, code = 1): never {
    emitResult(failure(reason));
    process.exit(code);
}

if (usageError !== undefined) {
    console.error(`run-task: ${usageError}\n${USAGE}`);
    bail(`usage: ${usageError}`, 2);
}

/** What to run: a catalog task or a plan. */
async function loadJob(): Promise<{ task: TaskDef } | { plan: LoadedPlan }> {
    if (args.plan !== null) {
        let loaded: LoadedPlan;
        try {
            loaded = await loadPlan(args.plan);
        } catch (e) {
            console.error(`run-task: ${errMessage(e)}`);
            bail(errMessage(e), 2);
        }
        plan = loaded;
        return { plan: loaded };
    }
    try {
        return { task: await loadTask(taskName) };
    } catch (e) {
        const reason = `no task "${taskName}" (${errMessage(e)}). Known: ${taskNames().join(', ')}`;
        console.error(`run-task: ${reason}`);
        bail(reason, 2);
    }
}
const job = await loadJob();

/** The task run, or the plan's running phase, until it is closed. */
let current: LiveRun | null = null;
/** The plan's log, once open. */
let planLog: RunLog | null = null;
/** The running plan's totals so far as a killed result (RunPlanOptions.onKillable), once it has started. */
let killPlan: ((reason: string) => PlanResult) | null = null;
/** What the run produced, once it has. */
let ranResult: TaskResult | undefined;
/** Set by the first SIGTERM or SIGHUP once connected: the run is being killed, and its epilogue is the signal path's. */
let killSignalled = false;
/** The signal path (kill the run, epilogue, RESULT, exit), once begun; the script waits for it before returning. */
let signalFlow: Promise<void> | null = null;
/** The game tick the script began at: a death since then makes the epilogue skip (the state is a respawn). */
let startTick: number | null = null;
/** Where the bot last stood out of combat, once a run tracks it. */
let liveSafe: { spot(): SafeSpot | null } | null = null;

/**
 * A killed run's result, written to the logs of the run (or the plan and its running phase) unless
 * they hold their own; a log takes one result, so the run's own, coming later, is dropped. A plan's
 * carries its totals so far, the cut phase run counted as `error`, so stats keeps its XP and runs.
 */
function killedResult(reason: string): TaskResult | PlanResult {
    const run = current;
    if (args.plan === null) return run?.kill(reason, Date.now() - startedAt) ?? failure(reason);
    run?.kill(reason);
    const log = planLog;
    const killed = killPlan?.(reason) ?? failure(reason, undefined, log && !log.ended ? log : null);
    log?.append({ type: 'result', ...killed });
    return killed;
}

// Registered before runScript's own handlers so a killed run still prints its RESULT line. The
// process's exit code on a signal is runScript's: its handler (registered once connected)
// disconnects and exits 130/143/129 (SIGINT/SIGTERM/SIGHUP) within 5s, at once on a second signal.
// This timer is only the backup, for a signal before runScript's handler is in place, and exits
// with the printed result's code. Once connected SIGTERM and SIGHUP are taken over by `handleKillSignals`
// (below), which runs a capped epilogue before the RESULT; SIGINT stays as above (a person at a terminal
// wants out now, and a plan's interruptible stop is the way to end a fight cleanly).
const SIGNAL_EXIT_GRACE_MS = 6000;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
        // A repeated signal, or one after the RESULT line, adds nothing.
        if (resultLine.printed) return;
        // The kill path (SIGTERM, SIGHUP) owns the RESULT: a SIGINT during its epilogue prints what it holds, and
        // builds no new killed result.
        if (killSignalled) {
            const held = signalResult ?? ranResult;
            if (held) emitResult(held);
            process.exit(130);
        }
        // A run that has its result (runScript is disconnecting) was not cut short: that is its RESULT.
        emitResult(ranResult ?? killedResult(`killed by ${signal}`));
        // Until the process exits, the engine winds down and runScript reports the disconnect (its
        // `── Error ──` and a stack, when the disconnect rejects the script), on stdout: send that
        // to stderr, so the RESULT stays the last stdout line and the diagnostics survive.
        console.log = console.error;
        console.info = console.error;
        setTimeout(() => process.exit(exitCode()), SIGNAL_EXIT_GRACE_MS);
    });
}

let env: BotEnv;
try {
    env = loadBotEnv(botName);
} catch (e) {
    bail(errMessage(e), 2); // a usage error, as in the other tools
}

// The gateway's controller lease refuses a second controller by itself; this pre-check fails
// sooner, with a message naming the flag. It is also the only guard on a gateway that predates
// the lease, where a new control connection silently pre-empts the existing one.
if (!takeover) {
    let controllers = 0;
    try {
        controllers = await controllerCount(env);
    } catch {
        // Gateway unreachable: runScript reports the connection failure itself.
    }
    if (controllers > 0)
        bail(
            `${botName} already has ${controllers} controller(s) attached (another task or script is driving it); wait for it to finish or report back. --takeover pre-empts it: only for a run that is yours`,
        );
}

const dir = runsDir(botName);
/** The run's console lines; none once the RESULT is printed, which must stay the last stdout line. */
const print = (line: string) => {
    if (!resultLine.printed) console.log(line);
};
const warn = (msg: string) => console.error(`run-task: ${msg}`);

/** The epilogue's own driver while one runs: the wall backstop closes it so it stops sending before the disconnect. */
let epilogueDriver: LiveDriver | null = null;
/** The run's own epilogue while it is in flight: a signal waits for it instead of abandoning the bot mid-fight. */
let normalEpilogue: Promise<TaskResult> | null = null;
/** What the signal path will print, set before its epilogue starts: a second signal prints it too. */
let signalResult: TaskResult | PlanResult | null = null;

/**
 * A run that ends with the bot under attack, `done` included, gets lib/epilogue.ts: eat, run, teleport, hold the
 * bot's own fight. Up to EPILOGUE_TICKS (60 s); SIGNAL_EPILOGUE_TICKS (20 s) for a done run and when `signalPath` is set. Before the process exits and the guards with it. The result keeps its
 * status and reason and gains an `epilogue`. Skipped when the client is gone or another controller took the bot
 * over (no connection to act through).
 */
function withEpilogue(
    sdk: BotSDK,
    result: TaskResult,
    safe: { spot(): SafeSpot | null },
    append: (event: Record<string, unknown>) => void,
    say: (line: string) => void,
    // The signal path runs its own, capped, and the run's normal one yields to it.
    signalPath = false,
): Promise<TaskResult> {
    const runStartTick = startTick;
    if (killSignalled && !signalPath) return Promise.resolve(result);
    if (!needsEpilogue(result) || sdk.getConnectionState() !== 'connected' || resultLine.printed)
        return Promise.resolve(result);
    // Its own driver, unrecorded: a recording replays the run's decisions, which end where the run did.
    const driver = new LiveDriver(
        sdk,
        { event: append, print: say, screenshot: label => captureScreenshot(sdk, botName, undefined, label) },
        TICK_STALL_MS,
    );
    epilogueDriver = driver;
    let flow: Promise<TaskResult> | null = null;
    flow = (async (): Promise<TaskResult> => {
        try {
            const epilogue = await runEpilogue(driver, {
                safe: safe.spot(),
                ...(runStartTick !== null && { runStartTick }),
                ...((signalPath || result.status === 'done') && { budgetTicks: SIGNAL_EPILOGUE_TICKS }),
            });
            if (!epilogue) return result;
            append({ type: 'epilogue', ...epilogue });
            say(epilogueSummary(epilogue));
            // The final position, HP and combat state are the bot's now.
            return withEpilogueResult(result, epilogue, sdk.getState());
        } finally {
            driver.close();
            if (epilogueDriver === driver) epilogueDriver = null;
            if (normalEpilogue === flow) normalEpilogue = null;
        }
    })();
    if (!signalPath) normalEpilogue = flow;
    return flow;
}

/**
 * Wall-clock backstop for the epilogue of a killed run: (50 + 12 grace) ticks of 400 ms is 24.8 s, so 30 s is slack.
 * It also bounds the wait for a run's own 150-tick (60 s) epilogue when a signal arrives during it: that one is
 * cut at 30 s and the run's RESULT prints without its epilogue.
 */
const KILL_EPILOGUE_WALL_MS = 30_000;

/**
 * Waits for `epilogue` at most KILL_EPILOGUE_WALL_MS. When the backstop wins (the game stopped ticking) the
 * epilogue's driver is closed so it stops sending, and `fallback` stands in. The timer is always cleared.
 */
async function withinWall(epilogue: Promise<TaskResult>, fallback: TaskResult): Promise<TaskResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            epilogue,
            new Promise<TaskResult>(resolve => {
                timer = setTimeout(() => {
                    epilogueDriver?.close();
                    resolve(fallback);
                }, KILL_EPILOGUE_WALL_MS);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * SIGTERM and SIGHUP, once connected, replace runScript's handlers (which disconnect and exit within 5 s, so
 * nothing could run after the kill): the first stops the run, runs the epilogue for up to SIGNAL_EPILOGUE_TICKS,
 * prints the RESULT (the kill's own, with the `epilogue`), then disconnects and exits 143/129 as runScript did.
 * A run whose own epilogue is in flight is waited for the same way (its result prints, with the epilogue if it
 * finished); a run that already has its result is not cut short: that is its RESULT. A second signal prints the
 * same RESULT (a no-op once printed) and exits at once.
 */
function handleKillSignals(sdk: BotSDK): void {
    const codes = { SIGTERM: 143, SIGHUP: 129 } as const;
    const finish = (code: number) => {
        // The engine winds down and runScript reports the disconnect on stdout: send it to stderr, so the
        // RESULT stays the last stdout line.
        console.log = console.error;
        console.info = console.error;
        setTimeout(() => process.exit(code), 5000);
        sdk.disconnect().finally(() => process.exit(code));
    };
    for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
        process.removeAllListeners(signal);
        process.on(signal, () => {
            const code = codes[signal];
            if (killSignalled) {
                const held = signalResult ?? ranResult;
                if (held) emitResult(held);
                process.exit(code);
            }
            killSignalled = true;
            if (normalEpilogue && ranResult) {
                const inFlight = normalEpilogue;
                const held = ranResult;
                signalResult = held;
                signalFlow = (async () => {
                    let out: TaskResult = held;
                    try {
                        out = await withinWall(inFlight, held);
                    } catch (e) {
                        warn(`epilogue on ${signal} failed: ${errMessage(e)}`);
                    }
                    emitResult(out);
                    finish(code);
                })();
                return;
            }
            if (ranResult || resultLine.printed) {
                signalResult = ranResult ?? killedResult(`killed by ${signal}`);
                emitResult(signalResult);
                finish(code);
                return;
            }
            const append = current?.append ?? planLog?.append ?? (() => {});
            const killed = killedResult(`killed by ${signal}`);
            signalResult = killed;
            // Stop the run's steps: they must not send while the epilogue acts.
            current?.driver.close();
            signalFlow = (async () => {
                let out: TaskResult | PlanResult = killed;
                try {
                    if (liveSafe)
                        out = await withinWall(withEpilogue(sdk, killed, liveSafe, append, print, true), killed);
                } catch (e) {
                    warn(`epilogue on ${signal} failed: ${errMessage(e)}`);
                }
                emitResult(out);
                finish(code);
            })();
        });
    }
}

const run = await runScript(
    async ({ sdk }) => {
        handleKillSignals(sdk);
        startTick = sdk.getState()?.tick ?? null;
        try {
            await runJob(sdk);
        } finally {
            // A kill is being finished (epilogue, RESULT, exit): the process must not wind down under it.
            if (signalFlow) await signalFlow;
        }
    },
    { printState: false, takeover },
);

async function runJob(sdk: BotSDK): Promise<void> {
    if ('task' in job) {
        const { task } = job;
        const live = openLiveRun(sdk, {
            dir,
            task: task.name,
            bot: botName,
            params: rawParams,
            stops,
            print,
            warn,
        });
        current = live;
        const safe = trackSafeSpot(sdk);
        liveSafe = safe;
        try {
            live.append(sourceEvent(null));
            ranResult = await executeTask(task, {
                driver: live.driver,
                sinks: live.sinks,
                botName,
                runId: live.runId,
                logFile: live.logFile,
                rawParams,
                stops,
            });
            // `ranResult` already holds the run's own result: a signal during the epilogue prints that.
            ranResult = await withEpilogue(sdk, ranResult, safe, live.append, print);
        } finally {
            safe.stop();
            try {
                live.close();
            } finally {
                current = null;
            }
        }
        return;
    }

    const { def, path } = job.plan;
    const runId = `${fileStamp()}-plan-${def.name}`;
    const log = openRunLog(dir, runId);
    planLog = log;
    // Drafts change; the run keeps the source that ran.
    const copy = join(dir, `${runId}.plan.ts`);
    copyFileSync(path, copy);
    log.append(sourceEvent({ file: path, copy }));
    const safe = trackSafeSpot(sdk);
    liveSafe = safe;
    try {
        // The plan's own result is held before the epilogue runs: a signal during it prints this one.
        ranResult = await runPlan(def, {
            botName,
            runId,
            logFile: log.logFile,
            sinks: {
                event: event => log.append(event),
                print,
                screenshot: label => captureScreenshot(sdk, botName, undefined, label),
            },
            stops,
            onKillable: killed => {
                killPlan = killed;
            },
            // Through the running phase's driver, so each phase's recording holds every clock read its
            // run made and replays them; the wall clock directly between phases.
            now: () => current?.driver.now() ?? Date.now(),
            state: () => {
                const s = sdk.getState();
                if (!s) throw new Error('no world state from client');
                return s;
            },
            nextTick: () => sdk.waitForTicks(1),
            newPhaseRun: (p, _index, inputs) => {
                // A killed plan starts nothing more: the next phase would log a run that never was.
                if (resultLine.printed || killSignalled) throw new Error('the run was killed');
                const phase = openLiveRun(sdk, {
                    dir,
                    task: p.task.name,
                    bot: botName,
                    params: p.params,
                    stops: [],
                    partOf: runId,
                    ...(inputs?.bank && { bank: inputs.bank }),
                    print,
                    warn,
                });
                current = phase;
                return {
                    driver: phase.driver,
                    sinks: phase.sinks,
                    runId: phase.runId,
                    logFile: phase.logFile,
                    close: () => {
                        try {
                            phase.close();
                        } finally {
                            current = null;
                        }
                    },
                };
            },
        });
        ranResult = await withEpilogue(sdk, ranResult, safe, log.append, print);
    } finally {
        safe.stop();
    }
}

// Connection failure or an exception outside the engine still honours the RESULT contract.
const printed = emitResult(
    ranResult ?? failure(run.error?.message ?? `${plan ? 'plan' : 'task'} did not produce a result`, run.duration),
);
// Exit explicitly, with the status's code, so nothing the run left pending keeps the process alive.
// After a signal (which printed the RESULT) the exits armed on the signal path end the process.
if (printed) process.exit(exitCode());
