// Snapshot and restore a bot's save on the local server, and add saves to the scenario library.
//
//   bun conductor/tools/save.ts list <bot>
//   bun conductor/tools/save.ts snapshot <bot> <label> [--library --purpose "<what it is for>" [--replace]] [--logout [--takeover]]
//   bun conductor/tools/save.ts restore <bot> <label|lib:<name>|path/to/x.sav> [--force] [--takeover]
//
// snapshot exports the save as it is now, from the running engine, without logging the bot out or
// disturbing its controller (items behind an open trade/duel offer are not included). It lands in
// conductor/runs/<bot>/saves/; --library also files it as conductor/saves/<label>.sav + .json
// (--replace to overwrite an existing library save). --logout first logs the bot out server-side
// (so it cannot die unattended), refused while a script or task controls it unless --takeover.
//
// restore rolls the bot back. A label is the part of a snapshot's filename after its timestamp,
// matched exactly (the newest match wins). Restoring the bot's newest snapshot needs no flag;
// skipping past a newer snapshot, or restoring a library save (lib:<name>) or a file over an
// existing save, needs --force (worker accounts load scenarios with load.ts instead). If the bot
// is in the world it is logged out server-side first, refused while a script or task controls it
// unless --takeover. The replaced save is kept as a `pre-restore` snapshot. Restart the bot's
// client afterwards. Local server only, with the Grand Exchange off (conductor/docs/parallel-bots.md).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isLocalServer } from '../../sdk/runner';
import { type BotEnv, loadBotEnv, REPO_ROOT } from '../lib/env';
import {
    atomicWrite,
    controllerCount,
    exportSave,
    inWorld,
    kick,
    LIBRARY_DIR,
    listLibrary,
    readLibrarySave,
    SAVE_NAME,
    saveStatus,
    writeLibrarySave,
    writeSave,
} from '../lib/saves';
import { errMessage, fail, FILE_STAMP_PREFIX, fileStamp } from '../lib/util';

/** Labels save.ts writes itself; a rollback ignores them when looking for newer snapshots. */
const OWN_LABELS = new Set(['pre-restore']);
const usage =
    'usage: bun conductor/tools/save.ts list|snapshot|restore <bot> [label|lib:<name>|file.sav] [--library --purpose <text> [--replace]] [--logout] [--force] [--takeover]';
const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
        library: { type: 'boolean' },
        purpose: { type: 'string' },
        replace: { type: 'boolean' },
        logout: { type: 'boolean' },
        takeover: { type: 'boolean' },
        force: { type: 'boolean' },
    },
});
const [cmd, name, arg] = positionals;
if (!cmd || !name) fail(usage, 2);
const env = loadBotEnv(name);
if (!isLocalServer(env.server)) fail(`save.ts only works against the local server; ${name} points at ${env.server}`, 2);
const dir = join(REPO_ROOT, 'conductor/runs', name, 'saves');

/** Log the bot out server-side, unless a script or task controls it (then only with --takeover). */
async function logOut(botEnv: BotEnv): Promise<void> {
    let controllers: number;
    try {
        controllers = await controllerCount(botEnv);
    } catch (e) {
        fail(`could not check ${name} for a running controller (${errMessage(e)}); not logging out`);
    }
    if (controllers > 0 && !flags.takeover) {
        fail(
            `${name} is controlled by ${controllers} connection(s) (a running task or script); logging out would pull the bot from under it. Stop it first, or pass --takeover`,
        );
    }
    if (!(await kick(botEnv))) fail(`${name} did not log out (in combat, or still busy); try again`);
}

/** This bot's snapshot files, oldest first. */
const snapshots = () =>
    existsSync(dir)
        ? readdirSync(dir)
              .filter(f => f.endsWith('.sav'))
              .sort()
        : [];
const labelOf = (file: string) => file.replace(FILE_STAMP_PREFIX, '').replace(/\.sav$/, '');

interface Pick {
    bytes: Uint8Array;
    from: string;
    /** Why restoring it over an existing save needs --force, if it does. */
    needsForce?: string;
}

/** A snapshot label (newest match), lib:<name>, or a .sav path. */
function resolveSave(spec: string): Pick | undefined {
    if (spec.startsWith('lib:')) {
        const { bytes, entry } = readLibrarySave(spec.slice(4));
        return {
            bytes,
            from: `library save ${entry.name}`,
            needsForce: 'a library save is another scenario, not an earlier point of this account',
        };
    }
    if (SAVE_NAME.test(spec)) {
        const all = snapshots();
        const index = all.findLastIndex(f => labelOf(f) === spec);
        if (index < 0) return undefined;
        const newer = all.slice(index + 1).filter(f => !OWN_LABELS.has(labelOf(f)));
        return {
            bytes: new Uint8Array(readFileSync(join(dir, all[index]!))),
            from: join(dir, all[index]!),
            needsForce: newer.length ? `newer snapshots exist (${newer.map(labelOf).join(', ')})` : undefined,
        };
    }
    const path = resolve(spec);
    if (!spec.endsWith('.sav') || !existsSync(path) || !statSync(path).isFile()) return undefined;
    return {
        bytes: new Uint8Array(readFileSync(path)),
        from: path,
        needsForce: 'nothing shows that file came from this account',
    };
}

try {
    switch (cmd) {
        case 'list': {
            const all = snapshots();
            if (!all.length) console.log(`no snapshots for ${name}`);
            for (const f of all) console.log(`${f}  ${statSync(join(dir, f)).size} bytes`);
            const library = listLibrary();
            if (library.length) console.log(`\nlibrary (${LIBRARY_DIR}), restore with lib:<name>:`);
            for (const entry of library) console.log(`  ${entry.name}  ${entry.purpose}`);
            break;
        }
        case 'snapshot': {
            if (!arg || !SAVE_NAME.test(arg)) fail('snapshot needs a label of letters, digits and dashes', 2);
            const purpose = flags.purpose?.trim();
            if (flags.library && !purpose) fail('--library needs --purpose "<what the save is for>"', 2);
            if (flags.logout && inWorld(await saveStatus(env))) await logOut(env);
            const save = await exportSave(env);
            const out = join(dir, `${fileStamp()}-${arg}.sav`);
            atomicWrite(out, save.bytes);
            console.log(`${out}  (${save.source}, sha1 ${save.sha1.slice(0, 12)})`);
            if (flags.library && purpose) {
                const entry = writeLibrarySave(arg, save.bytes, {
                    purpose,
                    source: { kind: 'snapshot', bot: name },
                    replace: flags.replace,
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
            // Every refusal comes before the logout, so a refused restore leaves the bot as it was.
            const status = await saveStatus(env);
            if (status.source !== 'none' && pick.needsForce && !flags.force) {
                fail(
                    `not restoring ${pick.from} over ${name}'s save: ${pick.needsForce}. Pass --force to restore anyway`,
                );
            }
            if (inWorld(status)) await logOut(env);
            const { path, backup } = await writeSave(env, pick.bytes, { backupDir: dir, label: 'restore' });
            console.log(
                `restored ${pick.from} -> ${path}${backup ? ` (previous save: ${backup})` : ''}; restart ${name}'s client`,
            );
            break;
        }
        default:
            fail(usage, 2);
    }
} catch (e) {
    fail(`save.ts ${cmd}: ${errMessage(e)}`);
}
