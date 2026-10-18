// Config names and ids: the content packs (server/content/pack/<kind>.pack, one `id=name` line per config; ids are
// the same in every checkout) and the obj configs' display names, categories and stack flag. The world index names
// locs, npcs and objs by config name, the state by id and display name; actions/cross.ts and lib/account.ts read
// between the two through here. Each table is read once, on first use.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfigs } from '../../wiki/world/sources/configs';
import { REPO_ROOT } from './env';

/** `interface` names components as `<interface>:<component>`. */
export type PackKind = 'obj' | 'loc' | 'npc' | 'interface';

interface Pack {
    names: Map<number, string>;
    ids: Map<string, number>;
}

const packs = new Map<PackKind, Pack>();

function pack(kind: PackKind): Pack {
    let p = packs.get(kind);
    if (p) return p;
    p = { names: new Map(), ids: new Map() };
    for (const line of readFileSync(join(REPO_ROOT, `server/content/pack/${kind}.pack`), 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const [id, name] = [Number(line.slice(0, eq)), line.slice(eq + 1).trim()];
        p.names.set(id, name);
        p.ids.set(name, id);
    }
    packs.set(kind, p);
    return p;
}

/** The config name of an id (`1438` -> `air_talisman`), or undefined for an id the pack does not list. */
export const configName = (kind: PackKind, id: number): string | undefined => pack(kind).names.get(id);

/** The id of a config name, or undefined for a name the pack does not list. */
export const configId = (kind: PackKind, name: string): number | undefined => pack(kind).ids.get(name);

/** What the obj configs say of an obj, by config name. */
export interface ObjInfo {
    /** Its display name, as the state's inventory and bank name it (`Air talisman`). */
    name: string;
    category?: string;
    stackable: boolean;
}

let objs: Map<string, ObjInfo> | undefined;

/** The obj config `obj`'s display name, category and stack flag, or undefined for no such config. */
export function objInfo(obj: string): ObjInfo | undefined {
    if (!objs) {
        objs = new Map();
        for (const [name, c] of readConfigs('obj')) {
            const category = c.category?.[0];
            objs.set(name, {
                name: c.name?.[0] ?? name,
                ...(category && { category }),
                stackable: c.stackable?.[0] === 'yes',
            });
        }
    }
    return objs.get(obj);
}
