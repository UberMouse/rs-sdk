// Load a save into a worker account, for testing in parallel without touching the main account.
//
//   bun conductor/tools/load.ts <worker> <source> [--client] [--create] [--takeover]
//
//   <source>  <name> or lib:<name>  a library save (conductor/saves/<name>.sav)
//             bot:<bot>             a live copy of another bot's save, taken without logging it out
//             path/to/x.sav         a save file
//
// Only loads into accounts whose bots/<worker>/bot.env has WORKER=true; --create makes the account
// (create-bot.ts --local) and marks it. A worker in the world is logged out first (refused while a
// script or task controls it, unless --takeover). --client then starts the worker's lite client and
// waits for it to connect. Writes conductor/runs/<worker>/loaded.json, so a test can name the state
// it started from, and prints one `LOADED <json>` line. Local server only, with the Grand Exchange off.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isLocalServer } from '../../sdk/runner';
import { startLiteClient, stopLiteClient } from '../lib/client';
import { loadBotEnv, REPO_ROOT } from '../lib/env';
import { exportSave, inWorld, kick, readLibrarySave, sha1, verifySave, writeSave } from '../lib/saves';
import { errMessage } from '../lib/util';

const FETCH_TIMEOUT_MS = 5_000;
const usage =
    'usage: bun conductor/tools/load.ts <worker> <name|lib:<name>|bot:<bot>|file.sav> [--client] [--create] [--takeover]';
const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { client: { type: 'boolean' }, create: { type: 'boolean' }, takeover: { type: 'boolean' } },
});
const [worker, source] = positionals;

function fail(message: string, code = 1): never {
    console.error(message);
    process.exit(code);
}

if (!worker || !source) fail(usage, 2);

/** Create bots/<worker>/ for the local server and mark it as a worker. */
function createWorker(): void {
    const proc = Bun.spawnSync([process.execPath, 'bots/create-bot.ts', worker!, '--local', '--no-chat'], {
        cwd: REPO_ROOT,
        stdout: 'ignore',
        stderr: 'pipe',
    });
    if (proc.exitCode !== 0) fail(`create-bot.ts ${worker} failed: ${proc.stderr.toString().trim()}`);
    appendFileSync(
        join(REPO_ROOT, 'bots', worker!, 'bot.env'),
        '\n# A disposable worker account: conductor/tools/load.ts may overwrite its save.\nWORKER=true\n',
    );
}

/** The save bytes for `spec`, and a description of where they came from. */
async function resolveSource(spec: string): Promise<{ bytes: Uint8Array; from: string }> {
    if (spec.startsWith('bot:')) {
        const base = loadBotEnv(spec.slice(4));
        const save = await exportSave(base.username);
        return { bytes: save.bytes, from: `${spec} (${save.source})` };
    }
    if (spec.endsWith('.sav')) {
        const path = resolve(spec);
        if (!existsSync(path) || !statSync(path).isFile()) fail(`no save file at ${path}`);
        const bytes = new Uint8Array(readFileSync(path));
        verifySave(bytes);
        return { bytes, from: path };
    }
    const { bytes, entry } = readLibrarySave(spec.replace(/^lib:/, ''));
    return { bytes, from: `lib:${entry.name}` };
}

async function controllerCount(webOrigin: string, username: string): Promise<number> {
    const res = await fetch(`${webOrigin}/status/${encodeURIComponent(username)}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const status: { controllers?: unknown[] } = await res.json();
    return status.controllers?.length ?? 0;
}

try {
    if (!existsSync(join(REPO_ROOT, 'bots', worker, 'bot.env'))) {
        if (!flags.create) fail(`no bot ${worker}; pass --create to make it a worker account`);
        createWorker();
    }
    const env = loadBotEnv(worker);
    if (!isLocalServer(env.server))
        fail(`load.ts only works against the local server; ${worker} points at ${env.server}`, 2);
    if (env.raw.WORKER !== 'true') {
        fail(`${worker} is not a worker account (no WORKER=true in its bot.env); load.ts never overwrites other bots`);
    }

    const { bytes, from } = await resolveSource(source);

    if (await inWorld(env.username)) {
        if (!flags.takeover && (await controllerCount(env.webOrigin, env.username)) > 0) {
            fail(`${worker} is controlled by a running task or script; stop it first, or pass --takeover`);
        }
        await stopLiteClient(worker);
        if (!(await kick(env.username))) fail(`${worker} did not log out (in combat?); try again`);
    }
    const path = await writeSave(env.username, bytes);
    const loaded = { worker, source: from, sha1: sha1(bytes), loadedAt: new Date().toISOString(), path };
    const runDir = join(REPO_ROOT, 'conductor/runs', worker);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'loaded.json'), `${JSON.stringify(loaded, null, 4)}\n`);

    let client: { pid: number; log: string } | undefined;
    if (flags.client) {
        const started = await startLiteClient(worker);
        client = { pid: started.pid, log: started.log };
    }
    console.log(`LOADED ${JSON.stringify({ ...loaded, client })}`);
    // A started client is detached and keeps running; exit without waiting on it.
    process.exit(0);
} catch (e) {
    fail(`load.ts: ${errMessage(e)}`);
}
