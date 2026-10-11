// INI-style configs (.loc/.npc/.obj): `[name]` then `key=value`. A key may repeat (data=, param=).
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

const paramName = (value: string): string => value.split(',')[0]!;

/**
 * Layers configs, later over earlier, the way wiki/generate-npcs.ts merges a hand-written npc config
 * over the `_unpack` dump: a key the later config sets replaces the earlier values, other keys are
 * kept, and `param=` merges by param name. The engine packer refuses a name defined twice
 * (`Duplicate config found`, server/engine/tools/pack/config/PackShared.ts readConfigs), so on real
 * content no name is in two layers and this only decides what a duplicate would mean.
 */
export function mergeConfigs(layers: Map<string, Config>[]): Map<string, Config> {
    const out = new Map<string, Config>();
    for (const layer of layers) {
        for (const [name, config] of layer) {
            const base = out.get(name);
            if (!base) {
                out.set(name, { ...config });
                continue;
            }
            for (const [key, values] of Object.entries(config)) {
                if (key !== 'param') {
                    base[key] = values;
                    continue;
                }
                const params = new Map((base.param ?? []).map(v => [paramName(v), v]));
                for (const v of values) params.set(paramName(v), v);
                base.param = [...params.values()];
            }
        }
    }
    return out;
}

/** Every config of a kind: the `_unpack` dumps, then the hand-written configs over them. */
export function readConfigs(ext: 'loc' | 'npc' | 'obj'): Map<string, Config> {
    const files = [...new Glob(`**/*.${ext}`).scanSync(SCRIPTS)].sort();
    const read = (fs: string[]): Map<string, Config> =>
        mergeConfigs(fs.map(f => parseConfigs(readFileSync(join(SCRIPTS, f), 'utf8'))));
    const unpacked = files.filter(f => f.startsWith('_unpack/'));
    const written = files.filter(f => !f.startsWith('_unpack/') && !f.startsWith('_test/'));
    return mergeConfigs([read(unpacked), read(written)]);
}

export const first = (c: Config | undefined, key: string): string | undefined => c?.[key]?.[0];
