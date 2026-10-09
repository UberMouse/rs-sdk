// Snapshot and restore a bot's save on the local server, and add saves to the scenario library.
//
//   bun conductor/tools/save.ts list <bot>
//   bun conductor/tools/save.ts snapshot <bot> <label> [--library --purpose "<what it is for>"] [--logout [--takeover]]
//   bun conductor/tools/save.ts restore <bot> <label|lib:<name>|path/to/x.sav> [--takeover] [--force]
//
// snapshot exports the save as it is now, from the running engine, without logging the bot out or
// disturbing its controller (items behind an open trade/duel offer are not included). It lands in
// conductor/runs/<bot>/saves/; --library also files it as conductor/saves/<label>.sav + .json.
// --logout first logs the bot out server-side (so it cannot die unattended), refused while a
// script or task controls it unless --takeover.
//
// restore logs the bot out server-side if it is in the world (refused while a script or task
// controls it, unless --takeover), then writes the save. Restart the bot's client afterwards. A
// label is the part of a snapshot's filename after its timestamp, matched exactly (the newest
// wins); lib:<name> is a library save. Restoring a snapshot older than the current save, or any
// library save over an existing one, needs --force (worker accounts use load.ts instead); the
// replaced save is kept as a `pre-restore` snapshot. Local server only, with the
// Grand Exchange off (conductor/docs/parallel-bots.md).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isLocalServer } from '../../sdk/runner';
import { loadBotEnv, REPO_ROOT } from '../lib/env';
import {
    atomicWrite,
    exportSave,
    inWorld,
    kick,
    LIBRARY_DIR,
    readLibrarySave,
    SAVE_NAME,
    savePath,
    writeLibrarySave,
    writeSave,
} from '../lib/saves';
import { errMessage, FILE_STAMP_PREFIX, fileStamp } from '../lib/util';

/** Longest a request to the gateway's status endpoint may take before it counts as failed. */
const FETCH_TIMEOUT_MS = 5_000;

const usage =
    'usage: bun conductor/tools/save.ts list|snapshot|restore <bot> [label|lib:<name>|file.sav] [--library --purpose <text>] [--takeover] [--force]';
const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
        library: { type: 'boolean' },
        purpose: { type: 'string' },
        takeover: { type: 'boolean' },
        force: { type: 'boolean' },
        // snapshot: also log the bot out (the save is taken after it leaves the world)
        logout: { type: 'boolean' },
    },
});
const [cmd, name, arg] = positionals;
if (!cmd || !name) {
    console.error(usage);
    process.exit(2);
}
const env = loadBotEnv(name);
if (!isLocalServer(env.server)) {
    console.error(`save.ts only works against the local server; ${name} points at ${env.server}`);
    process.exit(2);
}
const dir = join(REPO_ROOT, 'conductor/runs', name, 'saves');

function fail(message: string, code = 1): never {
    console.error(message);
    process.exit(code);
}

/** Exit unless no script or task holds a control connection (logging out would pull the bot from under it). */
async function requireNoController(): Promise<void> {
    let controllers: unknown[];
    try {
        const status: { controllers?: unknown[] } = await (
            await fetch(`${env.webOrigin}/status/${encodeURIComponent(env.username)}`, {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            })
        ).json();
        controllers = status.controllers ?? [];
    } catch (e) {
        fail(`could not check ${name} for a running controller (${errMessage(e)}); not logging out`);
    }
    if (controllers.length > 0 && !flags.takeover) {
        fail(
            `${name} is controlled by ${controllers.length} connection(s) (a running task or script); logging out would pre-empt it. Stop it first, or pass --takeover`,
        );
    }
}

const snapshots = () =>
    existsSync(dir)
        ? readdirSync(dir)
              .filter(f => f.endsWith('.sav'))
              .sort()
        : [];

/** A snapshot label (newest match), lib:<name>, or a .sav path: its bytes and when it was taken. */
function resolveSave(spec: string): { bytes: Uint8Array; takenAt: Date; from: string } | undefined {
    if (spec.startsWith('lib:')) {
        const { bytes, entry } = readLibrarySave(spec.slice(4));
        return { bytes, takenAt: new Date(entry.createdAt), from: `library save ${entry.name}` };
    }
    let path: string | undefined;
    if (SAVE_NAME.test(spec)) {
        const match = snapshots()
            .filter(f => f.replace(FILE_STAMP_PREFIX, '') === `${spec}.sav`)
            .pop();
        if (match) path = join(dir, match);
    } else if (spec.endsWith('.sav') && existsSync(resolve(spec)) && statSync(resolve(spec)).isFile()) {
        path = resolve(spec);
    }
    if (!path) return undefined;
    // Snapshots are written once, so their mtime is when they were taken.
    return { bytes: new Uint8Array(readFileSync(path)), takenAt: statSync(path).mtime, from: path };
}

try {
    switch (cmd) {
        case 'list': {
            const all = snapshots();
            if (!all.length) console.log(`no snapshots for ${name}`);
            for (const f of all) console.log(`${f}  ${statSync(join(dir, f)).size} bytes`);
            const library = existsSync(LIBRARY_DIR) ? readdirSync(LIBRARY_DIR).filter(f => f.endsWith('.json')) : [];
            if (library.length) console.log(`\nlibrary (${LIBRARY_DIR}), restore with lib:<name>:`);
            for (const f of library.sort()) {
                const entry: { name: string; purpose: string } = JSON.parse(readFileSync(join(LIBRARY_DIR, f), 'utf8'));
                console.log(`  ${entry.name}  ${entry.purpose}`);
            }
            break;
        }
        case 'snapshot': {
            if (!arg || !SAVE_NAME.test(arg)) fail('snapshot needs a label of letters, digits and dashes', 2);
            if (flags.library && !flags.purpose?.trim()) fail('--library needs --purpose "<what the save is for>"', 2);
            if (flags.logout && (await inWorld(env.username))) {
                await requireNoController();
                if (!(await kick(env.username))) fail(`${name} did not log out (in combat, or still busy); try again`);
            }
            const save = await exportSave(env.username);
            const out = join(dir, `${fileStamp()}-${arg}.sav`);
            atomicWrite(out, save.bytes);
            console.log(`${out}  (${save.source}, sha1 ${save.sha1.slice(0, 12)})`);
            if (flags.library) {
                const entry = writeLibrarySave(arg, save.bytes, {
                    purpose: flags.purpose!,
                    source: { kind: 'snapshot', bot: name },
                });
                console.log(`library: ${join(LIBRARY_DIR, `${entry.name}.sav`)}`);
            }
            break;
        }
        case 'restore': {
            if (!arg) fail(usage, 2);
            const pick = resolveSave(arg);
            if (!pick) {
                fail(
                    `no snapshot "${arg}" for ${name} (a label matches exactly; lib:<name> is a library save; a path must be a .sav file); run: bun conductor/tools/save.ts list ${name}`,
                );
            }
            // Every refusal comes before the kick, so a refused restore leaves the bot as it was.
            const online = await inWorld(env.username);
            const current = savePath(env.username);
            if ((online || existsSync(current)) && !flags.force) {
                // A library save is another account's state, not an earlier point of this one.
                if (arg.startsWith('lib:')) {
                    fail(
                        `${name} has a save; restoring ${pick.from} replaces it with an unrelated scenario. Load scenarios into worker accounts with conductor/tools/load.ts, or pass --force`,
                    );
                }
                // In the world, the live state is newer than any snapshot.
                const saveAt = online ? new Date() : statSync(current).mtime;
                if (pick.takenAt < saveAt) {
                    fail(
                        `${pick.from} (${pick.takenAt.toISOString()}) is older than ${name}'s ${online ? 'live state' : `save (${saveAt.toISOString()})`}; restoring loses progress since. Pass --force to restore anyway`,
                    );
                }
            }
            if (online) {
                await requireNoController();
                if (!(await kick(env.username))) fail(`${name} did not log out (in combat, or still busy); try again`);
            }
            if (existsSync(current)) {
                atomicWrite(join(dir, `${fileStamp()}-pre-restore.sav`), new Uint8Array(readFileSync(current)));
            }
            await writeSave(env.username, pick.bytes);
            console.log(`restored ${pick.from} -> ${current}; restart ${name}'s client`);
            break;
        }
        default:
            fail(usage, 2);
    }
} catch (e) {
    fail(`save.ts ${cmd}: ${errMessage(e)}`);
}
