// Run one catalog task on one bot and print a single machine-readable result.
//
//   bun conductor/run-task.ts --list
//   bun conductor/run-task.ts <bot> <task> [--params '<json>'] [--until <stop>]... [--takeover]
//
//   <stop>: level:<skill>:<n> | xp:<skill>:<n> | minutes:<n>   (any one ends the run)
//
// The last stdout line is always `RESULT <json>` (a TaskResult). Exit 0 for
// status "done", 1 otherwise, 2 for a usage error (an error RESULT is printed first). Refuses to start when another controller already
// drives the bot, unless --takeover. A game client must already be attached
// (conductor/tools/client.ts or the lite runner).
//
// Every run is recorded next to its log, as <runId>.ticks.ndjson.gz, for conductor/tools/replay.ts:
// about 47 KiB a minute of play, 2.8 MB an hour, so always on (sizes in conductor/docs/interruptible-tasks.md).
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod/v4';
import { runScript } from '../sdk/runner';
import { LiveDriver } from './core/drivers/live';
import { Recorder, recordingFile } from './core/drivers/recording';
import { loadTask, taskNames } from './lib/catalog';
import { executeTask, TICK_STALL_MS } from './lib/engine';
import { loadBotEnv, REPO_ROOT, type BotEnv } from './lib/env';
import { captureScreenshot } from './lib/screenshot';
import { parseStop, type StopCondition } from './lib/stop';
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

const positional: string[] = [];
const stops: StopCondition[] = [];
let rawParams: unknown = {};
let takeover = false;
let usageError: string | undefined;
try {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (a === '--params') rawParams = JSON.parse(argv[++i] ?? '');
        else if (a === '--until') stops.push(parseStop(argv[++i] ?? ''));
        else if (a === '--takeover') takeover = true;
        else if (a.startsWith('-')) throw new Error(`unknown flag ${a}`);
        else positional.push(a);
    }
} catch (e) {
    usageError = errMessage(e);
}
const [botName = '', taskName = ''] = positional;
const startedAt = Date.now();

function errorResult(
    reason: string,
    durationMs = Date.now() - startedAt,
    log: { runId: string; logFile: string } | null = null,
): TaskResult {
    return {
        task: taskName,
        bot: botName,
        runId: log?.runId ?? '',
        status: 'error',
        reason,
        params: rawParams,
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

/** Print the RESULT line for a run that never produced one, and exit. */
function bail(reason: string, exitCode = 1): never {
    console.log(`RESULT ${JSON.stringify(errorResult(reason))}`);
    process.exit(exitCode);
}

if (usageError === undefined && positional.length !== 2) usageError = 'expected <bot> <task>';
if (usageError !== undefined) {
    console.error(
        `run-task: ${usageError}\nusage: bun conductor/run-task.ts <bot> <task> [--params '<json>'] [--until level:<skill>:<n>|xp:<skill>:<n>|minutes:<n>]... [--takeover]\n       bun conductor/run-task.ts --list`,
    );
    bail(`usage: ${usageError}`, 2);
}

let def: TaskDef;
try {
    def = await loadTask(taskName);
} catch (e) {
    const reason = `no task "${taskName}" (${errMessage(e)}). Known: ${taskNames().join(', ')}`;
    console.error(`run-task: ${reason}`);
    bail(reason, 2);
}

interface RunLog {
    runId: string;
    logFile: string;
    append(event: Record<string, unknown>): void;
}

/** The run whose NDJSON log is open, until its result is written. */
let openLog: RunLog | null = null;
/** The run's recording, until the run ends. */
let openRecorder: Recorder | null = null;

// Registered before runScript's own handlers so a killed run still prints its RESULT line. runScript
// disconnects and exits within 5s; the timer covers a signal that lands before it has registered.
const SIGNAL_EXIT_GRACE_MS = 6000;
const STATUS_FETCH_TIMEOUT_MS = 5000;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        // Synchronous, so the recording is whole before runScript's own handler exits.
        openRecorder?.close();
        const log = openLog;
        const killed = errorResult(`killed by ${signal}`, undefined, log);
        log?.append({ type: 'result', ...killed });
        console.log(`RESULT ${JSON.stringify(killed)}`);
        setTimeout(() => process.exit(1), SIGNAL_EXIT_GRACE_MS);
    });
}

let env: BotEnv;
try {
    env = loadBotEnv(botName);
} catch (e) {
    bail(errMessage(e));
}

// A new control connection silently pre-empts the existing one (last controller wins).
if (!takeover) {
    try {
        const res = await fetch(`${env.webOrigin}/status/${encodeURIComponent(env.username)}`, {
            signal: AbortSignal.timeout(STATUS_FETCH_TIMEOUT_MS),
        });
        const status: { controllers?: string[] } = await res.json();
        const controllers = status.controllers?.length ?? 0;
        if (controllers > 0)
            bail(`${botName} already has ${controllers} controller(s) attached; pass --takeover to pre-empt`);
    } catch {
        // Gateway unreachable: runScript reports the connection failure itself.
    }
}

let engineResult: TaskResult | undefined;
const run = await runScript(
    async ({ sdk }) => {
        const runId = `${fileStamp()}-${def.name}`;
        const logFile = join(REPO_ROOT, 'conductor/runs', botName, `${runId}.ndjson`);
        mkdirSync(dirname(logFile), { recursive: true });
        const append = (event: Record<string, unknown>) =>
            appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...event }) + '\n');
        openLog = { runId, logFile, append };
        const logSinks: Sinks = {
            event: event => {
                append(event);
                if (event.type === 'result') openLog = null;
            },
            print: line => console.log(line),
            screenshot: label => captureScreenshot(sdk, botName, undefined, label),
        };
        const recorder = Recorder.toFile(
            recordingFile(logFile),
            { task: def.name, bot: botName, runId, logFile, params: rawParams, stops },
            msg => console.error(`run-task: ${msg}`),
        );
        openRecorder = recorder;
        const sinks = recorder ? recorder.wrap(logSinks) : logSinks;
        const driver = new LiveDriver(sdk, sinks, TICK_STALL_MS, recorder ?? undefined);
        try {
            engineResult = await executeTask(def, {
                driver,
                sinks,
                botName,
                runId,
                logFile,
                rawParams,
                stops,
            });
        } finally {
            driver.close();
            recorder?.close();
            openRecorder = null;
        }
    },
    { printState: false },
);

// Connection failure or an exception outside the engine still honours the RESULT contract.
const result = engineResult ?? errorResult(run.error?.message ?? 'task did not produce a result', run.duration);
console.log(`RESULT ${JSON.stringify(result)}`);
// Exit explicitly, with the status's code, so nothing the run left pending keeps the process alive.
process.exit(result.status === 'done' ? 0 : 1);
