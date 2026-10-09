// Load a save into a worker account, for testing in parallel without touching the main account.
//
//   bun conductor/tools/load.ts <worker> <source> [--client] [--create] [--takeover]
//
//   <source>  lib:<name>      a library save (conductor/saves/<name>.sav)
//             bot:<bot>       a live copy of another bot's save, taken without logging it out
//             path/to/x.sav   a save file
//
// Only loads into accounts whose bots/<worker>/bot.env has WORKER=true. --create makes the account
// (create-bot.ts --local) and marks it, refusing a name the server already has a save for.
// Refused while a script or task is attached to the worker, in the world or not, unless
// --takeover; a worker in the world is then logged out first, and the save it had is kept in
// conductor/runs/<worker>/saves/. --client then starts the worker's lite client (lib/client.ts;
// only clients started this way are stopped on the next load) and waits for it to connect. Keeps
// a copy of what it loaded as conductor/runs/<worker>/saves/<stamp>-loaded.sav (`replay`: pass
// that path to load.ts to retest from the same state, even for a bot: source), writes
// conductor/runs/<worker>/loaded.json and prints one `LOADED <json>` line. Local server only,
// with the Grand Exchange off.
import { appendFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isLocalServer } from '../../sdk/runner';
import { startLiteClient, stopLiteClient } from '../lib/client';
import { loadBotEnvOrFail, REPO_ROOT } from '../lib/env';
import {
    atomicWrite,
    exportSave,
    prepareForWrite,
    readLibrarySave,
    saveStatus,
    sha1,
    verifySave,
    writeSave,
} from '../lib/saves';
import { errMessage, fail, fileStamp, parseCli } from '../lib/util';

const usage =
    'usage: bun conductor/tools/load.ts <worker> <lib:<name>|bot:<bot>|file.sav> [--client] [--create] [--takeover]';
const { values: flags, positionals } = parseCli(
    { client: { type: 'boolean' }, create: { type: 'boolean' }, takeover: { type: 'boolean' } },
    usage,
);
const [worker, source] = positionals;
if (!worker || !source || positionals.length > 2) fail(usage, 2);
// Checked up front, so a typo never gets as far as --create making an account.
if (!/^(lib|bot):./.test(source) && !source.endsWith('.sav')) {
    fail(`unknown source "${source}": use lib:<name>, bot:<bot> or a path ending .sav`, 2);
}
const sourceBot = source.startsWith('bot:') ? loadBotEnvOrFail(source.slice(4)) : undefined;

/** Create bots/<name>/ for the local server and mark it as a worker. */
function createWorker(name: string): void {
    const proc = Bun.spawnSync([process.execPath, 'bots/create-bot.ts', name, '--local', '--no-chat'], {
        cwd: REPO_ROOT,
        stdout: 'ignore',
        stderr: 'pipe',
    });
    if (proc.exitCode !== 0) fail(`create-bot.ts ${name} failed: ${proc.stderr.toString().trim()}`);
    appendFileSync(
        join(REPO_ROOT, 'bots', name, 'bot.env'),
        '\n# A disposable worker account: conductor/tools/load.ts may overwrite its save.\nWORKER=true\n',
    );
}

/** The save bytes for `spec`, and a description of where they came from. */
async function resolveSource(spec: string): Promise<{ bytes: Uint8Array; from: string }> {
    if (sourceBot) {
        const save = await exportSave(sourceBot);
        return { bytes: save.bytes, from: `${spec} (${save.source})` };
    }
    if (spec.startsWith('lib:')) {
        const { bytes, entry } = readLibrarySave(spec.slice(4));
        return { bytes, from: `lib:${entry.name}` };
    }
    const path = resolve(spec);
    if (!existsSync(path) || !statSync(path).isFile()) fail(`no save file at ${path}`);
    const bytes = new Uint8Array(readFileSync(path));
    verifySave(bytes);
    return { bytes, from: path };
}

const botDir = join(REPO_ROOT, 'bots', worker);
/** Set once the write may have reached the server: from then on the account is real, so it is kept. */
let wroteSave = false;
try {
    const created = !existsSync(join(botDir, 'bot.env'));
    if (created) {
        if (!flags.create) fail(`no bot ${worker} in this checkout; pass --create to make it a worker account`);
        createWorker(worker);
        // Any exit before the save is written (a refusal, an error, Ctrl-C) removes the account it made.
        process.on('exit', () => wroteSave || rmSync(botDir, { recursive: true, force: true }));
        for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => process.exit(130));
    }
    const env = loadBotEnvOrFail(worker);
    if (!isLocalServer(env.server))
        fail(`load.ts only works against the local server; ${worker} points at ${env.server}`, 2);
    if (env.raw.WORKER !== 'true') {
        fail(`${worker} is not a worker account (no WORKER=true in its bot.env); load.ts never overwrites other bots`);
    }

    const status = await saveStatus(env);
    if (created && status.source !== 'none') {
        // bots/ is per checkout: the name may be another checkout's bot, even the main account.
        fail(`the server already has an account named ${worker} (${status.source}); pick another worker name`);
    }
    const { bytes, from } = await resolveSource(source);

    // Log out before stopping the client: a failed logout (combat) then leaves the worker attended.
    // Every refusal comes before the worker is touched.
    await prepareForWrite(env, status, 'loading', flags.takeover);
    await stopLiteClient(worker);
    const runDir = join(REPO_ROOT, 'conductor/runs', worker);
    const { path, backup } = await writeSave(env, bytes, {
        backupDir: join(runDir, 'saves'),
        label: 'load',
        onWrite: () => (wroteSave = true),
    });
    const replay = join(runDir, 'saves', `${fileStamp()}-loaded.sav`);
    atomicWrite(replay, bytes);
    const loaded = {
        worker,
        source: from,
        replay,
        sha1: sha1(bytes),
        loadedAt: new Date().toISOString(),
        path,
        backup,
    };
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
