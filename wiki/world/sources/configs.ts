// INI-style configs (.loc/.npc/.obj/.varbit/.enum): `[name]` then `key=value`. A key may repeat (data=, param=).
import { readFileSync } from 'fs';
import { join } from 'path';
import { Glob } from 'bun';
import { SCRIPTS } from '../paths';

export type Config = Record<string, string[]>;

export function parseConfigs(text: string): Map<string, Config> {
    const out = new Map<string, Config>();
    let cur: Config | undefined;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            cur = {};
            out.set(header[1]!, cur);
            continue;
        }
        if (!cur || !line || line.startsWith('//')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        (cur[line.slice(0, eq)] ??= []).push(line.slice(eq + 1));
    }
    return out;
}

/**
 * Reads every config of one kind into a single map and throws on a name defined twice, naming both
 * files, as the engine packer does (`Duplicate config found`, server/engine/tools/pack/config/PackShared.ts
 * readConfigs), so no precedence rule is needed.
 */
export function collectConfigs(files: [file: string, text: string][]): Map<string, Config> {
    const out = new Map<string, Config>();
    const origin = new Map<string, string>();
    for (const [file, text] of files) {
        for (const [name, config] of parseConfigs(text)) {
            if (out.has(name)) throw new Error(`Duplicate config found: ${name} in ${origin.get(name)} and ${file}`);
            out.set(name, config);
            origin.set(name, file);
        }
    }
    return out;
}

/** Every config of a kind: all `_unpack/<rev>` dumps and the hand-written configs, skipping `_test/`. */
export function readConfigs(ext: 'loc' | 'npc' | 'obj' | 'varbit' | 'enum'): Map<string, Config> {
    const files = [...new Glob(`**/*.${ext}`).scanSync(SCRIPTS)].filter(f => !f.startsWith('_test/')).sort();
    return collectConfigs(files.map((f): [string, string] => [f, readFileSync(join(SCRIPTS, f), 'utf8')]));
}

export const first = (c: Config | undefined, key: string): string | undefined => c?.[key]?.[0];
