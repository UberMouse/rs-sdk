// Run one catalog task, or a plan of them, on one bot and print a single machine-readable result.
//
//   bun conductor/run-task.ts --list
//   bun conductor/run-task.ts <bot> <task> [--params '<json>'] [--until <stop>]... [--takeover]
//   bun conductor/run-task.ts <bot> --plan <file> [--until <stop>]... [--takeover]
//
//   <stop>: level:<skill>:<n> | xp:<skill>:<n> | minutes:<n>   (any one ends the run; for a plan,
//   counted from the plan's start)
//
// The last stdout line is always `RESULT <json>` (a TaskResult; a PlanResult for a plan). Exit 0 for
// status "done", 1 otherwise, 2 for a usage error (an error RESULT is printed first).
// Refuses to start when another controller already drives the bot, unless --takeover. A game client must already be attached
// (conductor/tools/client.ts or the lite runner).
//
// Every run is recorded next to its log, as <runId>.ticks.ndjson.gz, for conductor/tools/replay.ts:
// about 47 KiB a minute of play, 2.8 MB an hour, so always on (sizes in conductor/docs/interruptible-tasks.md).
// A plan (conductor/docs/plans.md) runs in one controller connection. It logs to
// <fileStamp>-plan-<name>.ndjson with a copy of its source beside it (<runId>.plan.ts), and each
// phase is a task run with its own log and recording, as above.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { runScript } from '../sdk/runner';
import { loadTask, taskNames } from './lib/catalog';
import { executeTask } from './lib/engine';
import { controllerCount, loadBotEnv, type BotEnv } from './lib/env';
import { type PhaseRunRef, type PlanDef, type PlanResult, runPlan } from './lib/plan';
import {
    errorResult,
    type LiveRun,
    loadPlan,
    openLiveRun,
    openRunLog,
    parseRunArgs,
    type ResultBase,
    type RunLog,
    runsDir,
    USAGE,
} from './lib/run-cli';
import { captureScreenshot } from './lib/screenshot';
import type { Sinks, TaskDef, TaskResult } from './lib/task';
import { errMessage, fileStamp } from './lib/util';

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
const { bot: botName, task: taskName, params: rawParams, stops, takeover } = args;
const startedAt = Date.now();

/** The plan being run, once its file has loaded. */
let plan: { def: PlanDef; path: string } | null = null;

/** Who the result of a run that never produced one is for. */
const resultBase = (): ResultBase =>
    plan
        ? {
              task: `plan:${plan.def.name}`,
              bot: botName,
              params: {
                  plan: plan.def.name,
                  phases: plan.def.phases.map(p => ({ phase: p.name, task: p.task.name, params: p.params })),
              },
          }
        : { task: taskName, bot: botName, params: rawParams };

/**
 * The result of a run that never produced one. A plan's has no phase totals (it never ran, or was
 * killed before it could add them up); `recent` names the phase run that was killed, if any.
 */
function failure(
    reason: string,
    durationMs = Date.now() - startedAt,
    log: { runId: string; logFile: string } | null = null,
    recent: PhaseRunRef[] = [],
): TaskResult | PlanResult {
    const result = errorResult(resultBase(), reason, durationMs, log);
    return plan ? { ...result, phases: [], recent } : result;
}

/** Print the RESULT line for a run that never produced one, and exit. */
function bail(reason: string, exitCode = 1): never {
    console.log(`RESULT ${JSON.stringify(failure(reason))}`);
    process.exit(exitCode);
}

if (usageError !== undefined) {
    console.error(`run-task: ${usageError}\n${USAGE}`);
    bail(`usage: ${usageError}`, 2);
}

let def: TaskDef | undefined;
if (args.plan !== null) {
    try {
        plan = await loadPlan(args.plan);
    } catch (e) {
        console.error(`run-task: ${errMessage(e)}`);
        bail(errMessage(e), 2);
    }
} else {
    try {
        def = await loadTask(taskName);
    } catch (e) {
        const reason = `no task "${taskName}" (${errMessage(e)}). Known: ${taskNames().join(', ')}`;
        console.error(`run-task: ${reason}`);
        bail(reason, 2);
    }
}

/** The task run, or the plan's running phase, until it is closed. */
let current: LiveRun | null = null;
/** The running phase's name. */
let currentPhase = '';
/** The plan's log, until its result is written. */
let openPlanLog: RunLog | null = null;

// Registered before runScript's own handlers so a killed run still prints its RESULT line. runScript
// disconnects and exits within 5s; the timer covers a signal that lands before it has registered.
const SIGNAL_EXIT_GRACE_MS = 6000;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        const reason = `killed by ${signal}`;
        let killed: TaskResult | PlanResult;
        if (plan) {
            // The phase's own killed result goes to its log, as a task run's does.
            const phase = current;
            const cut = phase !== null && !phase.ended;
            phase?.kill(reason);
            const recent: PhaseRunRef[] = cut
                ? [{ phase: currentPhase, runId: phase.runId, logFile: phase.logFile, status: 'error', reason }]
                : [];
            const log = openPlanLog;
            killed = failure(reason, undefined, log, recent);
            log?.append({ type: 'result', ...killed });
        } else {
            killed = current?.kill(reason, Date.now() - startedAt) ?? failure(reason);
        }
        console.log(`RESULT ${JSON.stringify(killed)}`);
        setTimeout(() => process.exit(1), SIGNAL_EXIT_GRACE_MS);
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
const print = (line: string) => console.log(line);
const warn = (msg: string) => console.error(`run-task: ${msg}`);

let ranResult: TaskResult | undefined;
const run = await runScript(
    async ({ sdk }) => {
        if (!plan) {
            const task = def!;
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
            try {
                ranResult = await executeTask(task, {
                    driver: live.driver,
                    sinks: live.sinks,
                    botName,
                    runId: live.runId,
                    logFile: live.logFile,
                    rawParams,
                    stops,
                });
            } finally {
                live.close();
                current = null;
            }
            return;
        }

        const runId = `${fileStamp()}-plan-${plan.def.name}`;
        const log = openRunLog(dir, runId);
        openPlanLog = log;
        // Drafts change; the run keeps the source that ran.
        const copy = join(dir, `${runId}.plan.ts`);
        copyFileSync(plan.path, copy);
        log.append({ type: 'source', file: plan.path, copy });
        const planSinks: Sinks = {
            event: event => {
                log.append(event);
                if (event.type === 'result') openPlanLog = null;
            },
            print,
            screenshot: label => captureScreenshot(sdk, botName, undefined, label),
        };
        ranResult = await runPlan(plan.def, {
            botName,
            runId,
            logFile: log.logFile,
            sinks: planSinks,
            stops,
            // Through the running phase's driver, so each phase's recording holds every clock read its
            // run made and replays them; the wall clock directly between phases.
            now: () => current?.driver.now() ?? Date.now(),
            state: () => {
                const s = sdk.getState();
                if (!s) throw new Error('no world state from client');
                return s;
            },
            newPhaseRun: p => {
                const phase = openLiveRun(sdk, {
                    dir,
                    task: p.task.name,
                    bot: botName,
                    params: p.params,
                    stops: [],
                    partOf: runId,
                    print,
                    warn,
                });
                current = phase;
                currentPhase = p.name;
                return {
                    driver: phase.driver,
                    sinks: phase.sinks,
                    runId: phase.runId,
                    logFile: phase.logFile,
                    close: () => {
                        phase.close();
                        current = null;
                    },
                };
            },
        });
    },
    { printState: false, takeover },
);

// Connection failure or an exception outside the engine still honours the RESULT contract.
const result =
    ranResult ?? failure(run.error?.message ?? `${plan ? 'plan' : 'task'} did not produce a result`, run.duration);
console.log(`RESULT ${JSON.stringify(result)}`);
// Exit explicitly, with the status's code, so nothing the run left pending keeps the process alive.
process.exit(result.status === 'done' ? 0 : 1);
