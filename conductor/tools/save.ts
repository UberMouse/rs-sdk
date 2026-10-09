// Snapshot and restore the local server's save for a bot, to roll back a risky experiment.
//
//   bun conductor/tools/save.ts list <bot>
//   bun conductor/tools/save.ts snapshot <bot> <label> [--logout]
//   bun conductor/tools/save.ts restore <bot> <snapshot-file-or-label> [--logout]
//
// The engine writes data/players/main/<bot>.sav on logout and on autosave, so both copies
// need the bot logged out of the server. --logout presses the in-game logout button (taking
// control from any running task) and waits for the server to save; without it the tool
// refuses while the bot is in the world. Restart the bot's client afterwards: it sits on the
// login screen. Restore keeps the save it replaces as a `pre-restore` snapshot. Local only.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { loadBotEnv, REPO_ROOT } from '../lib/env';

/** `logout:try_logout` in server/content/pack/interface.pack. */
const LOGOUT_BUTTON = 2458;

const [cmd, name, arg] = process.argv.slice(2);
const usage = 'usage: bun conductor/tools/save.ts list|snapshot|restore <bot> [label|file]';
if (!cmd || !name) {
    console.error(usage);
    process.exit(2);
}
const env = loadBotEnv(name);
if (env.server && !env.server.startsWith('localhost') && !env.server.startsWith('127.')) {
    console.error(`save.ts only works against the local server; ${name} points at ${env.server}`);
    process.exit(2);
}

const saveFile = join(REPO_ROOT, 'server/engine/data/players/main', `${env.username.toLowerCase()}.sav`);
const dir = join(REPO_ROOT, 'conductor/runs', name, 'saves');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Server-side truth: is the player still in the world loop? null when the engine is down. */
async function inWorld(): Promise<boolean | null> {
    try {
        const players: { name: string }[] = await (await fetch(`${env.webOrigin}/playerpositions`)).json();
        return players.some(p => p.name.toLowerCase() === env.username.toLowerCase());
    } catch {
        return null;
    }
}

async function pressLogout(): Promise<void> {
    const sdk = new BotSDK({
        botUsername: env.username,
        password: env.password,
        gatewayUrl: deriveGatewayUrl(env.server),
        connectionMode: 'control',
        autoLaunchBrowser: false,
        autoReconnect: false,
        showChat: false,
    });
    try {
        await sdk.connect();
        await sdk.sendClickComponent(LOGOUT_BUTTON);
    } finally {
        await Promise.race([sdk.disconnect(), sleep(3000)]);
    }
}

// /status/<bot> only reports the SDK client's connection, and a player whose client merely
// dropped stays in the world for ~3.5 min (rs-sdk relaxes TIMEOUT_NO_CONNECTION to 500 ticks)
// before the idle logout writes the save. So check the world loop, and log out explicitly.
async function requireLoggedOut(): Promise<void> {
    let present = await inWorld();
    if (present === null) return; // engine down: nothing can write the save
    if (present) {
        if (!process.argv.includes('--logout')) {
            console.error(`${name} is in the world; rerun with --logout to log it out cleanly first`);
            process.exit(1);
        }
        await pressLogout();
        // Combat delays a logout by up to 10s; the button is pressed once, so allow for that.
        const deadline = Date.now() + 30_000;
        while ((present = await inWorld()) && Date.now() < deadline) await sleep(1000);
        if (present) {
            console.error(`${name} did not log out within 30s (in combat, or the client is not attached)`);
            process.exit(1);
        }
    }
    // Removal posts the save to the login thread; give it a moment to land on disk.
    await sleep(2000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const snapshots = () =>
    existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.sav')).sort() : [];

switch (cmd) {
    case 'list': {
        const all = snapshots();
        if (!all.length) console.log(`no snapshots for ${name}`);
        for (const f of all) console.log(`${f}  ${statSync(join(dir, f)).size} bytes`);
        break;
    }
    case 'snapshot': {
        if (!arg || !/^[a-z0-9-]+$/i.test(arg)) {
            console.error('snapshot needs a label of letters, digits and dashes');
            process.exit(2);
        }
        await requireLoggedOut();
        if (!existsSync(saveFile)) {
            console.error(`no save at ${saveFile}`);
            process.exit(1);
        }
        mkdirSync(dir, { recursive: true });
        const out = join(dir, `${stamp()}-${arg}.sav`);
        copyFileSync(saveFile, out);
        console.log(out);
        break;
    }
    case 'restore': {
        if (!arg) {
            console.error(usage);
            process.exit(2);
        }
        const all = snapshots();
        // A label picks its newest snapshot; a filename or path picks that one.
        const pick = existsSync(arg) ? arg
            : all.includes(basename(arg)) ? join(dir, basename(arg))
            : all.filter(f => f.endsWith(`-${arg}.sav`)).map(f => join(dir, f)).pop();
        if (!pick) {
            console.error(`no snapshot "${arg}" for ${name}; run: bun conductor/tools/save.ts list ${name}`);
            process.exit(1);
        }
        await requireLoggedOut();
        mkdirSync(dir, { recursive: true });
        if (existsSync(saveFile)) copyFileSync(saveFile, join(dir, `${stamp()}-pre-restore.sav`));
        copyFileSync(pick, saveFile);
        console.log(`restored ${pick} -> ${saveFile}`);
        break;
    }
    default:
        console.error(usage);
        process.exit(2);
}
