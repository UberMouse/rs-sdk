// Snapshot and restore the local server's save for a bot, to roll back a risky experiment.
//
//   bun conductor/tools/save.ts list <bot>
//   bun conductor/tools/save.ts snapshot <bot> <label> [--logout] [--takeover]
//   bun conductor/tools/save.ts restore <bot> <label|path/to/x.sav> [--logout] [--takeover] [--force]
//
// The engine writes data/players/main/<bot>.sav on logout and on autosave, so both copies
// need the bot logged out of the server. --logout presses the in-game logout button and waits
// for the server to save; it refuses while a script or task controls the bot unless
// --takeover. Without --logout the tool refuses while the bot is in the world. Restart the
// bot's client afterwards: it sits on the login screen.
//
// A restore label is the part of a snapshot's filename after its timestamp, matched exactly
// (the newest wins); a path must be a .sav file. Restoring a snapshot older than the current
// save needs --force. Restore keeps the save it replaces as a `pre-restore` snapshot. Local only.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isLocalServer } from '../../sdk/runner';
import { connectSdk, disconnectQuietly, loadBotEnv, REPO_ROOT, sleep } from '../lib/env';
import { errMessage, FILE_STAMP_PREFIX, fileStamp } from '../lib/util';

/** `logout:try_logout` in server/content/pack/interface.pack. */
const LOGOUT_BUTTON = 2458;
/** Combat delays a logout by up to 10s, so the button is re-pressed on this period. */
const LOGOUT_RETRY_MS = 5_000;
const LOGOUT_TIMEOUT_MS = 30_000;
/** Longest a request to the engine's web endpoints may take before it counts as failed. */
const FETCH_TIMEOUT_MS = 5_000;
/** A snapshot label, and the part of a snapshot filename after its timestamp. */
const LABEL = /^[a-z0-9-]+$/i;

const usage =
    'usage: bun conductor/tools/save.ts list|snapshot|restore <bot> [label|file.sav] [--logout] [--takeover] [--force]';
const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { logout: { type: 'boolean' }, takeover: { type: 'boolean' }, force: { type: 'boolean' } },
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

// The engine may run from another checkout than this one (one shared local server, many
// worktrees); RS_ENGINE_DIR points at the server/engine directory it runs from.
const engineDir = process.env.RS_ENGINE_DIR ?? join(REPO_ROOT, 'server/engine');
const saveFile = join(engineDir, 'data/players/main', `${env.username.toLowerCase()}.sav`);
const dir = join(REPO_ROOT, 'conductor/runs', name, 'saves');

/** Server-side truth: is the player still in the world loop? null when the engine is down. */
async function inWorld(): Promise<boolean | null> {
    try {
        const players: { name: string }[] = await (
            await fetch(`${env.webOrigin}/playerpositions`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        ).json();
        return players.some(p => p.name.toLowerCase() === env.username.toLowerCase());
    } catch {
        return null;
    }
}

/** Exit unless no script or task holds a control connection (pressing logout pre-empts it). */
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
        console.error(`could not check ${name} for a running controller (${errMessage(e)}); not logging out`);
        process.exit(1);
    }
    if (controllers.length > 0 && !flags.takeover) {
        console.error(
            `${name} is controlled by ${controllers.length} connection(s) (a running task or script); logging out would pre-empt it. Stop it first, or pass --takeover`,
        );
        process.exit(1);
    }
}

/** Poll once a second until the player leaves the world or `until` passes; returns the last presence seen. */
async function pollWhileInWorld(until: number): Promise<boolean | null> {
    let present = await inWorld();
    while (present && Date.now() < until) {
        await sleep(1000);
        present = await inWorld();
    }
    return present;
}

/** Press logout until the player leaves the world; returns whether it is still in. */
async function logOut(): Promise<boolean | null> {
    await requireNoController();
    const sdk = await connectSdk(env, 'control');
    try {
        const deadline = Date.now() + LOGOUT_TIMEOUT_MS;
        let present: boolean | null = true;
        while (present && Date.now() < deadline) {
            // An open shop/bank/dialog would swallow the click.
            await sdk.sendCloseModal();
            await sdk.sendClickComponent(LOGOUT_BUTTON);
            present = await pollWhileInWorld(Math.min(deadline, Date.now() + LOGOUT_RETRY_MS));
        }
        return present;
    } finally {
        await disconnectQuietly(sdk);
    }
}

// /status/<bot> only reports the SDK client's connection, and a player whose client merely
// dropped stays in the world for ~3.5 min (rs-sdk relaxes TIMEOUT_NO_CONNECTION to 500 ticks)
// before the idle logout writes the save. So check the world loop, and log out explicitly.
async function requireLoggedOut(): Promise<void> {
    const present = await inWorld();
    if (present === null) return; // engine down: nothing can write the save
    if (present) {
        if (!flags.logout) {
            console.error(`${name} is in the world; rerun with --logout to log it out cleanly first`);
            process.exit(1);
        }
        if (await logOut()) {
            console.error(
                `${name} did not log out within ${LOGOUT_TIMEOUT_MS / 1000}s (in combat, or the client is not attached)`,
            );
            process.exit(1);
        }
    }
    // Removal posts the save to the login thread; give it a moment to land on disk.
    await sleep(2000);
}

/** Last-moment guard: the player may have logged back in since requireLoggedOut. */
async function requireStillOut(): Promise<void> {
    if (await inWorld()) {
        console.error(`${name} is back in the world; not touching its save`);
        process.exit(1);
    }
}

/** Copy via a tmp file in the destination dir, so a reader never sees a half-written .sav. */
function atomicCopy(src: string, dest: string): void {
    const tmp = join(dirname(dest), `.${Date.now()}.tmp`);
    copyFileSync(src, tmp);
    renameSync(tmp, dest);
}

const snapshots = () =>
    existsSync(dir)
        ? readdirSync(dir)
              .filter(f => f.endsWith('.sav'))
              .sort()
        : [];

/** The newest snapshot with exactly this label, or an explicit .sav file path. */
function resolveSnapshot(spec: string): string | undefined {
    if (LABEL.test(spec)) {
        const match = snapshots()
            .filter(f => f.replace(FILE_STAMP_PREFIX, '') === `${spec}.sav`)
            .pop();
        return match && join(dir, match);
    }
    const path = resolve(spec);
    return spec.endsWith('.sav') && existsSync(path) && statSync(path).isFile() ? path : undefined;
}

switch (cmd) {
    case 'list': {
        const all = snapshots();
        if (!all.length) console.log(`no snapshots for ${name}`);
        for (const f of all) console.log(`${f}  ${statSync(join(dir, f)).size} bytes`);
        break;
    }
    case 'snapshot': {
        if (!arg || !LABEL.test(arg)) {
            console.error('snapshot needs a label of letters, digits and dashes');
            process.exit(2);
        }
        await requireLoggedOut();
        if (!existsSync(saveFile)) {
            console.error(`no save at ${saveFile}`);
            process.exit(1);
        }
        mkdirSync(dir, { recursive: true });
        await requireStillOut();
        const out = join(dir, `${fileStamp()}-${arg}.sav`);
        atomicCopy(saveFile, out);
        console.log(out);
        break;
    }
    case 'restore': {
        if (!arg) {
            console.error(usage);
            process.exit(2);
        }
        const pick = resolveSnapshot(arg);
        if (!pick) {
            console.error(
                `no snapshot "${arg}" for ${name} (a label matches exactly; a path must be a .sav file); run: bun conductor/tools/save.ts list ${name}`,
            );
            process.exit(1);
        }
        await requireLoggedOut();
        if (existsSync(saveFile) && !flags.force) {
            // Compared after logout, which rewrites the save. Snapshots are copies, so their mtime is when they were taken.
            const snapAt = statSync(pick).mtime;
            const saveAt = statSync(saveFile).mtime;
            if (snapAt < saveAt) {
                console.error(
                    `${pick} (${snapAt.toISOString()}) is older than the current save (${saveAt.toISOString()}); restoring loses progress since. Pass --force to restore anyway`,
                );
                process.exit(1);
            }
        }
        mkdirSync(dir, { recursive: true });
        await requireStillOut();
        if (existsSync(saveFile)) atomicCopy(saveFile, join(dir, `${fileStamp()}-pre-restore.sav`));
        atomicCopy(pick, saveFile);
        console.log(`restored ${pick} -> ${saveFile}`);
        break;
    }
    default:
        console.error(usage);
        process.exit(2);
}
