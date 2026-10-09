// The scenario save library (conductor/saves/): list it, show an entry, and add generated saves.
//
//   bun conductor/tools/library.ts list
//   bun conductor/tools/library.ts show <name>
//   bun conductor/tools/library.ts generate <name> (--preset <NAME> | --spec '<SaveConfig json>') --purpose "<text>"
//
// generate builds a save from a spec with sdk/test/utils/save-generator (levels, inventory, worn,
// bank, position, varps) instead of playing the scenario into existence; --preset takes one of its
// TestPresets. Snapshots of live bots go in with `save.ts snapshot <bot> <name> --library`. Load an
// entry into a worker with `load.ts <worker> <name>`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createSaveData, type SaveConfig, TestPresets } from '../../sdk/test/utils/save-generator';
import { LIBRARY_DIR, type LibraryEntry, readLibrarySave, writeLibrarySave } from '../lib/saves';
import { errMessage } from '../lib/util';

const usage =
    'usage: bun conductor/tools/library.ts list | show <name> | generate <name> (--preset <NAME> | --spec <json>) --purpose <text>';
const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { preset: { type: 'string' }, spec: { type: 'string' }, purpose: { type: 'string' } },
});
const [cmd, name] = positionals;

function fail(message: string, code = 1): never {
    console.error(message);
    process.exit(code);
}

function entries(): LibraryEntry[] {
    if (!existsSync(LIBRARY_DIR)) return [];
    return readdirSync(LIBRARY_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(f => JSON.parse(readFileSync(join(LIBRARY_DIR, f), 'utf8')) as LibraryEntry);
}

try {
    switch (cmd) {
        case 'list': {
            const all = entries();
            if (!all.length) console.log(`the library (${LIBRARY_DIR}) is empty`);
            for (const e of all) {
                const levels = Object.entries(e.summary.levels)
                    .map(([skill, level]) => `${skill} ${level}`)
                    .join(', ');
                console.log(
                    `${e.name}  ${e.purpose}\n    ${e.source.kind}; at ${e.summary.position.x},${e.summary.position.z}; ${levels}`,
                );
            }
            break;
        }
        case 'show': {
            if (!name) fail(usage, 2);
            console.log(JSON.stringify(readLibrarySave(name).entry, null, 4));
            break;
        }
        case 'generate': {
            if (!name) fail(usage, 2);
            if (!flags.purpose?.trim()) fail('generate needs --purpose "<what the save is for>"', 2);
            if (!flags.preset === !flags.spec) fail('generate needs exactly one of --preset or --spec', 2);
            let spec: SaveConfig;
            if (flags.preset) {
                const presets: Record<string, SaveConfig> = TestPresets;
                const preset = presets[flags.preset];
                if (!preset) fail(`no preset ${flags.preset}; one of: ${Object.keys(presets).join(', ')}`, 2);
                spec = preset;
            } else {
                spec = JSON.parse(flags.spec!) as SaveConfig;
            }
            const entry = writeLibrarySave(name, createSaveData(spec), {
                purpose: flags.purpose!,
                source: { kind: 'generated', spec: flags.preset ? { preset: flags.preset, ...spec } : spec },
            });
            console.log(`${join(LIBRARY_DIR, `${entry.name}.sav`)}  (${entry.sha1.slice(0, 12)})`);
            break;
        }
        default:
            fail(usage, 2);
    }
} catch (e) {
    fail(`library.ts ${cmd}: ${errMessage(e)}`);
}
