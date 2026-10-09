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
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { runScript } from '../sdk/runner';
import { currentRunLog, executeTask } from './lib/engine';
import { loadBotEnv, type BotEnv } from './lib/env';
import { parseStop, type StopCondition } from './lib/stop';
import type { TaskDef, TaskResult } from './lib/task';
import { errMessage } from './lib/util';

const TASKS_DIR = join(import.meta.dir, 'tasks');

async function loadTask(name: string): Promise<TaskDef> {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad task name "${name}"`);
    const mod: { default?: TaskDef } = await import(join(TASKS_DIR, `${name}.ts`));
    const def = mod.default;
    if (!def) throw new Error(`conductor/tasks/${name}.ts has no default export (use export default defineTask(...))`);
    if (def.name !== name)
        throw new Error(`conductor/tasks/${name}.ts defines task "${def.name}"; the name must match the filename`);
    return def;
}

function taskNames(): string[] {
    return readdirSync(TASKS_DIR)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map(f => f.slice(0, -3))
        .sort();
}

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

// Registered before runScript's own handlers so a killed run still prints its RESULT line. runScript
// disconnects and exits within 5s; the timer covers a signal that lands before it has registered.
const SIGNAL_EXIT_GRACE_MS = 6000;
const STATUS_FETCH_TIMEOUT_MS = 5000;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        const log = currentRunLog();
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

// The gateway's controller lease refuses a second controller by itself; this pre-check fails
// sooner, with a message naming the flag. It is also the only guard on a gateway that predates
// the lease, where a new control connection silently pre-empts the existing one.
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
    async ({ bot, sdk }) => {
        engineResult = await executeTask(def, { bot, sdk, botName, rawParams, stops });
    },
    { printState: false, takeover },
);

// Connection failure or an exception outside the engine still honours the RESULT contract.
const result = engineResult ?? errorResult(run.error?.message ?? 'task did not produce a result', run.duration);
console.log(`RESULT ${JSON.stringify(result)}`);
// Exit explicitly so a step abandoned on timeout dies with the process instead of acting on.
process.exit(result.status === 'done' ? 0 : 1);
