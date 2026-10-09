// Run one catalog task on one bot and print a single machine-readable result.
//
//   bun conductor/run-task.ts --list
//   bun conductor/run-task.ts <bot> <task> [--params '<json>'] [--until <stop>]...
//
//   <stop>: level:<skill>:<n> | xp:<skill>:<n> | minutes:<n>   (any one ends the run)
//
// The last stdout line is always `RESULT <json>` (a TaskResult). Exit 0 for
// status "done", 1 otherwise. A game client must already be attached
// (conductor/tools/client.ts or the lite runner).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { runScript } from '../sdk/runner';
import { executeTask } from './lib/engine';
import { loadBotEnv } from './lib/env';
import { parseStop, type StopCondition } from './lib/stop';
import type { TaskDef, TaskResult } from './lib/task';

const TASKS_DIR = join(import.meta.dir, 'tasks');

async function loadTask(name: string): Promise<TaskDef> {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad task name "${name}"`);
    const mod = await import(join(TASKS_DIR, `${name}.ts`));
    return mod.default as TaskDef;
}

function taskNames(): string[] {
    return readdirSync(TASKS_DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => f.slice(0, -3)).sort();
}

const argv = process.argv.slice(2);

if (argv.includes('--list')) {
    const catalog = [];
    for (const name of taskNames()) {
        const def = await loadTask(name);
        catalog.push({ name: def.name, description: def.description, params: z.toJSONSchema(def.params, { io: 'input' }) });
    }
    console.log(JSON.stringify(catalog, null, 2));
    process.exit(0);
}

const positional: string[] = [];
const stops: StopCondition[] = [];
let rawParams: unknown = {};
try {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (a === '--params') rawParams = JSON.parse(argv[++i] ?? '');
        else if (a === '--until') stops.push(parseStop(argv[++i] ?? ''));
        else if (a.startsWith('-')) throw new Error(`unknown flag ${a}`);
        else positional.push(a);
    }
    if (positional.length !== 2) throw new Error('expected <bot> <task>');
} catch (e: any) {
    console.error(`run-task: ${e.message}\nusage: bun conductor/run-task.ts <bot> <task> [--params '<json>'] [--until level:<skill>:<n>|xp:<skill>:<n>|minutes:<n>]...\n       bun conductor/run-task.ts --list`);
    process.exit(2);
}

const [botName, taskName] = positional as [string, string];
let def: TaskDef;
try {
    def = await loadTask(taskName);
} catch (e: any) {
    console.error(`run-task: no task "${taskName}" (${e.message}). Known: ${taskNames().join(', ')}`);
    process.exit(2);
}
loadBotEnv(botName);

let engineResult: TaskResult | undefined;
const run = await runScript(async ({ bot, sdk }) => {
    engineResult = await executeTask(def, { bot, sdk, botName, rawParams, stops });
}, { printState: false });

// Connection failure or an exception outside the engine still honours the RESULT contract.
const result: TaskResult = engineResult ?? {
    task: taskName, bot: botName, runId: '', status: 'error',
    reason: run.error?.message ?? 'task did not produce a result', params: rawParams,
    durationMs: run.duration, loops: 0, stepRuns: {}, lastStep: null, xpGained: {},
    levelsGained: {}, inventoryDelta: {}, finalPos: null, hp: null, screenshots: [], logFile: '',
};
console.log(`RESULT ${JSON.stringify(result)}`);
process.exitCode = result.status === 'done' ? 0 : 1;
