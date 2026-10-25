// The scenario save library (conductor/saves/): list it, show an entry, and add generated saves.
//
//   bun conductor/tools/library.ts list
//   bun conductor/tools/library.ts show <name>
//   bun conductor/tools/library.ts generate <name> (--preset <NAME> | --spec '<SaveConfig json>') --purpose "<text>" [--replace]
//
// generate builds a save from a spec with sdk/test/utils/save-generator (levels, inventory, worn,
// bank, position, varps) instead of playing the scenario into existence; --preset takes one of its
// TestPresets. Snapshots of live bots go in with `save.ts snapshot <bot> <name> --library --purpose
// "..."`. Load an entry into a worker with `load.ts <worker> lib:<name>`. An existing entry is replaced only with
// --replace: other agents' tests depend on them.
import { join } from 'node:path';
import { z } from 'zod/v4';
import { createSaveData, type SaveConfig, TestPresets } from '../../sdk/test/utils/save-generator';
import { LIBRARY_DIR, listLibrary, readLibrarySave, unstackableStacks, writeLibrarySave } from '../lib/saves';
import { errMessage, fail, parseCli } from '../lib/util';

/** The shape of save-generator's SaveConfig, so a bad --spec fails here rather than as a broken save. */
const Item = z.object({ id: z.number().int().nonnegative(), count: z.number().int().positive() });
const SpecSchema = z.strictObject({
    position: z.object({ x: z.number().int(), z: z.number().int(), level: z.number().int().optional() }).optional(),
    skills: z.record(z.string(), z.number().int().min(1).max(99)).optional(),
    inventory: z.array(Item).optional(),
    equipment: z.array(Item.extend({ slot: z.number().int().nonnegative() })).optional(),
    bank: z.array(Item).optional(),
    coins: z.number().int().nonnegative().optional(),
    varps: z.record(z.string(), z.number().int()).optional(),
    appearance: z
        .object({
            body: z.array(z.number().int()).optional(),
            colors: z.array(z.number().int()).optional(),
            gender: z.number().int().optional(),
        })
        .optional(),
});

/** Typed, not cast: tsc fails here if SpecSchema stops matching save-generator's SaveConfig. */
const toSaveConfig = (spec: z.infer<typeof SpecSchema>): SaveConfig => spec;

const usage =
    'usage: bun conductor/tools/library.ts list | show <name> | generate <name> (--preset <NAME> | --spec <json>) --purpose <text> [--replace]';
const { values: flags, positionals } = parseCli(
    {
        preset: { type: 'string' },
        spec: { type: 'string' },
        purpose: { type: 'string' },
        replace: { type: 'boolean' },
    },
    usage,
);
const [cmd, name] = positionals;
if (positionals.length > (cmd === 'list' ? 1 : 2)) fail(usage, 2);

/** The spec from --preset or --spec, and how to record it as the entry's source. */
function readSpec(): { spec: SaveConfig; recorded: unknown } {
    if (flags.preset) {
        const presets: Record<string, SaveConfig> = TestPresets;
        const preset = presets[flags.preset];
        if (!preset) fail(`no preset ${flags.preset}; one of: ${Object.keys(presets).join(', ')}`, 2);
        return { spec: preset, recorded: { preset: flags.preset, ...preset } };
    }
    let json: unknown;
    try {
        json = JSON.parse(flags.spec ?? '');
    } catch (e) {
        fail(`--spec is not JSON: ${errMessage(e)}`, 2);
    }
    const parsed = SpecSchema.safeParse(json);
    if (!parsed.success) fail(`--spec is not a SaveConfig: ${parsed.error.message}`, 2);
    return { spec: toSaveConfig(parsed.data), recorded: parsed.data };
}

try {
    switch (cmd) {
        case 'list': {
            const { entries, invalid } = listLibrary();
            if (!entries.length && !invalid.length) console.log(`the library (${LIBRARY_DIR}) is empty`);
            for (const bad of invalid) console.log(`${bad.file}  INVALID: ${bad.error}`);
            for (const e of entries) {
                const levels = Object.entries(e.summary.levels)
                    .map(([skill, level]) => `${skill} ${level}`)
                    .join(', ');
                const at = `${e.summary.position.x},${e.summary.position.z}`;
                console.log(`${e.name}  ${e.purpose}\n    ${e.source.kind}; at ${at}; ${levels}`);
            }
            break;
        }
        case 'show': {
            if (!name) fail(usage, 2);
            console.log(JSON.stringify(readLibrarySave(name).entry, null, 4));
            break;
        }
        case 'generate': {
            const purpose = flags.purpose?.trim();
            if (!name) fail(usage, 2);
            if (!purpose) fail('generate needs --purpose "<what the save is for>"', 2);
            if (!flags.preset === !flags.spec) fail('generate needs exactly one of --preset or --spec', 2);
            const { spec, recorded } = readSpec();
            const stacked = unstackableStacks(spec.inventory);
            if (stacked.length) {
                fail(`non-stackable items counted in one slot (list one entry per item): ${stacked.join(', ')}`, 2);
            }
            const entry = writeLibrarySave(name, createSaveData(spec), {
                purpose,
                source: { kind: 'generated', spec: recorded },
                replace: flags.replace,
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
