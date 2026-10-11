// Reads server/content/maps/m{mx}_{mz}.jm2. The bridge rule mirrors GameMap.loadLocations
// (server/engine/src/engine/GameMap.ts:264): a loc on any level whose column has the LINK_BELOW flag (0x2)
// on its level-1 tile sits one level lower, and is skipped if that is below level 0. GameMap.loadNpcs
// takes no land data, so npc spawns keep the level they are filed on.
// The engine also skips locs outside F2P zones on a non-members world (GameMap.ts:248-262); this parser
// deliberately does not model that, the world index records every placement and flags F2P separately.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { MAPS } from '../paths';
import type { Tile } from '../types';

const LINK_BELOW = 0x2;

export interface MapLoc {
    id: number;
    shape: number;
    rotation: number;
    tile: Tile;
}

export interface MapNpc {
    id: number;
    tile: Tile;
}

export function parseMapSquare(mx: number, mz: number, text: string): { locs: MapLoc[]; npcs: MapNpc[] } {
    const bridged = new Set<number>(); // localX * 64 + localZ
    const rawLocs: MapLoc[] = [];
    const npcs: MapNpc[] = [];
    let section = '';
    for (const line of text.split('\n')) {
        const header = line.match(/^==== (\w+) ====/);
        if (header) {
            section = header[1]!;
            continue;
        }
        const m = line.match(/^(\d+) (\d+) (\d+):\s*(.*)$/);
        if (!m) continue;
        const [level, lx, lz] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const rest = m[4]!.trim().split(/\s+/);
        const tile = { level, x: mx * 64 + lx, z: mz * 64 + lz };
        if (section === 'MAP' && level === 1) {
            const flag = rest.find(t => t.startsWith('f'));
            if (flag && (Number(flag.slice(1)) & LINK_BELOW) !== 0) bridged.add(lx * 64 + lz);
        } else if (section === 'LOC') {
            rawLocs.push({ id: Number(rest[0]), shape: Number(rest[1] ?? 10), rotation: Number(rest[2] ?? 0), tile });
        } else if (section === 'NPC') {
            npcs.push({ id: Number(rest[0]), tile });
        }
    }
    const locs: MapLoc[] = [];
    for (const loc of rawLocs) {
        const local = (loc.tile.x - mx * 64) * 64 + (loc.tile.z - mz * 64);
        const level = bridged.has(local) ? loc.tile.level - 1 : loc.tile.level;
        if (level < 0) continue;
        locs.push({ ...loc, tile: { ...loc.tile, level } });
    }
    return { locs, npcs };
}

export function readAllMapSquares(dir = MAPS): { locs: MapLoc[]; npcs: MapNpc[] } {
    const locs: MapLoc[] = [];
    const npcs: MapNpc[] = [];
    for (const file of readdirSync(dir).sort()) {
        const m = file.match(/^m(\d+)_(\d+)\.jm2$/);
        if (!m) continue;
        const parsed = parseMapSquare(Number(m[1]), Number(m[2]), readFileSync(join(dir, file), 'utf8'));
        locs.push(...parsed.locs);
        npcs.push(...parsed.npcs);
    }
    return { locs, npcs };
}
