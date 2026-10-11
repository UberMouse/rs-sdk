// server/content/pack/{loc,npc,obj}.pack: one `id=name` line per config.
import { readFileSync } from 'fs';
import { join } from 'path';
import { PACK } from '../paths';

export interface Pack {
    name: Map<number, string>;
    id: Map<string, number>;
}

export function parsePack(text: string): Pack {
    const name = new Map<number, string>();
    const id = new Map<string, number>();
    for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const n = Number(line.slice(0, eq));
        const s = line.slice(eq + 1).trim();
        name.set(n, s);
        id.set(s, n);
    }
    return { name, id };
}

export const readPack = (kind: 'loc' | 'npc' | 'obj'): Pack =>
    parsePack(readFileSync(join(PACK, `${kind}.pack`), 'utf8'));
