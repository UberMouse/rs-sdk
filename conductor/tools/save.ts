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
// existing save, needs --force (worker accounts load scenarios with load.ts instead). Refused
// while a script or task is attached to the bot, in the world or not (it would resume on the
// restored save), unless --takeover; a bot in the world is then logged out server-side first. The replaced save is kept as a `pre-restore` snapshot. Restart the bot's
// client afterwards. Local server only, with the Grand Exchange off (conductor/docs/parallel-bots.md).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isLocalServer } from '../../sdk/runner';
import { loadBotEnvOrFail, REPO_ROOT } from '../lib/env';
import {
    atomicWrite,
    checkpointRefusal,
    exportSave,
    inWorld,
    isBackupLabel,
    LIBRARY_DIR,
    RESERVED_LABEL_PREFIX,
    listLibrary,
    logOut,
    readLibrarySave,
    requireNoController,
    SAVE_NAME,
    saveStatus,
    verifySave,
    writeLibrarySave,
    writeSave,
} from '../lib/saves';
import { errMessage, fail, FILE_STAMP_PREFIX, fileStamp, parseCli } from '../lib/util';

const usage =
    'usage: bun conductor/tools/save.ts list|snapshot|restore <bot> [label|lib:<name>|file.sav] [--library --purpose <text> [--replace]] [--logout] [--force] [--takeover]';
const { values: flags, positionals } = parseCli(
    {
        library: { type: 'boolean' },
        purpose: { type: 'string' },
        replace: { type: 'boolean' },
        logout: { type: 'boolean' },
        takeover: { type: 'boolean' },
        force: { type: 'boolean' },
    },
    usage,
);
const [cmd, name, arg] = positionals;
if (!cmd || !name || positionals.length > (cmd === 'list' ? 2 : 3)) fail(usage, 2);
const env = loadBotEnvOrFail(name);
if (!isLocalServer(env.server)) fail(`save.ts only works against the local server; ${name} points at ${env.server}`, 2);
const dir = join(REPO_ROOT, 'conductor/runs', name, 'saves');

// Flags that only mean something with another flag or command; given without it, they would be ignored.
if (cmd === 'snapshot') {
    if (!flags.library && (flags.purpose !== undefined || flags.replace))
        fail('--purpose and --replace go with --library', 2);
    if (!flags.logout && flags.takeover) fail('--takeover goes with --logout on snapshot', 2);
    if (flags.force) fail('--force is for restore', 2);
} else if (cmd === 'restore') {
    if (flags.library || flags.purpose !== undefined || flags.replace || flags.logout) {
        fail('--library, --purpose, --replace and --logout are for snapshot', 2);
    }
} else if (cmd === 'list' && Object.values(flags).some(v => v !== undefined)) {
    fail('list takes no flags', 2);
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
        // writeSave's own backups (pre-restore, pre-load) are not newer states of the account, unless
        // the pick is itself a backup: then skipping a newer backup also needs --force.
        const pickIsBackup = isBackupLabel(spec);
        const newer = all.slice(index + 1).filter(f => pickIsBackup || !isBackupLabel(labelOf(f)));
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
            const { entries, invalid } = listLibrary();
            if (entries.length) console.log(`\nlibrary (${LIBRARY_DIR}), restore with lib:<name>:`);
            for (const entry of entries) console.log(`  ${entry.name}  ${entry.purpose}`);
            for (const bad of invalid) console.log(`  ${bad.file}  INVALID: ${bad.error}`);
            break;
        }
        case 'snapshot': {
            if (!arg || !SAVE_NAME.test(arg)) fail('snapshot needs a label of letters, digits and dashes', 2);
            if (arg.startsWith(RESERVED_LABEL_PREFIX)) {
                fail(
                    `snapshot labels starting "${RESERVED_LABEL_PREFIX}" are reserved for the backups restore and load.ts keep`,
                    2,
                );
            }
            const purpose = flags.purpose?.trim();
            if (flags.library && !purpose) fail('--library needs --purpose "<what the save is for>"', 2);
            if (flags.logout && inWorld(await saveStatus(env))) await logOut(env, { takeover: flags.takeover });
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
            verifySave(pick.bytes);
            const status = await saveStatus(env);
            if (status.source === 'checkpoint') fail(checkpointRefusal(name, 'restoring'));
            if (status.source !== 'none' && pick.needsForce && !flags.force) {
                fail(
                    `not restoring ${pick.from} over ${name}'s save: ${pick.needsForce}. Pass --force to restore anyway`,
                );
            }
            if (!flags.takeover) await requireNoController(env, 'restoring');
            if (inWorld(status)) await logOut(env, { takeover: true }); // controllers checked above
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
