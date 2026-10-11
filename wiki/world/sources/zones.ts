// Zones are the engine's 8x8-tile squares. server/content/maps/free2play.csv and multiway.csv list them
// as `level_mx_mz_lx_lz` (map square, then the zone's origin in it), read by GameMap.loadCsvMap
// (server/engine/src/engine/GameMap.ts:306), which keys each line by the zone holding that tile
// (ZoneMap.zoneIndex, x >> 3 and z >> 3). The Wilderness is not a zone list but two boxes in a dbrow.
import { readFileSync } from 'fs';
import { join } from 'path';
import { MAPS } from '../paths';
import type { Tile } from '../types';

/** The key of the zone holding a tile, in the csv's own `level_mx_mz_lx_lz` form. */
export const zoneKey = (t: Tile): string => `${t.level}_${t.x >> 6}_${t.z >> 6}_${t.x & 56}_${t.z & 56}`;

/** A `level_mx_mz_lx_lz` coord (the csv and dbrow form) as a tile. */
export function parseCoord(s: string): Tile {
    const m = s.match(/^(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/);
    if (!m) throw new Error(`not a level_mx_mz_lx_lz coord: '${s}'`);
    const [level, mx, mz, lx, lz] = m.slice(1).map(Number) as [number, number, number, number, number];
    return { level, x: (mx << 6) + lx, z: (mz << 6) + lz };
}

/** Zone keys of a csv. Like loadCsvMap, `//` lines and empty lines are skipped; loadCsvMap's
 * `Number(field)` ignores whitespace around a field, so a line's is trimmed here. */
export function parseZoneCsv(text: string): Set<string> {
    const out = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
        if (!line.length || line.startsWith('//')) continue;
        out.add(zoneKey(parseCoord(line.trim())));
    }
    return out;
}

export interface Zones {
    f2p: Set<string>;
    multiway: Set<string>;
}

export const readZones = (): Zones => ({
    f2p: parseZoneCsv(readFileSync(join(MAPS, 'free2play.csv'), 'utf8')),
    multiway: parseZoneCsv(readFileSync(join(MAPS, 'multiway.csv'), 'utf8')),
});

// GameMap.isFreeToPlay (GameMap.ts:107) looks the zone up on level 0 whatever the tile's level;
// isMulti (GameMap.ts:102) uses the tile's own level.
export const isF2p = (zones: Zones, t: Tile): boolean => zones.f2p.has(zoneKey({ ...t, level: 0 }));

export const isMultiway = (zones: Zones, t: Tile): boolean => zones.multiway.has(zoneKey(t));

/** An inclusive box of tiles, corner to corner, levels included. */
export interface Box {
    from: Tile;
    to: Tile;
}

/**
 * The Wilderness boxes, inclusive on x, z and level as the engine's INZONE is
 * (server/engine/src/engine/script/handlers/ServerOps.ts:48). They are the coord pairs of
 * server/content/scripts/areas/area_wilderness/configs/wilderness_zones.dbrow (lines 4 and 6, pinned
 * by zones.real.test.ts): the surface on every level, then the Edgeville dungeon underground, level 0
 * only.
 */
export const WILDERNESS_ZONES: readonly Box[] = [
    { from: { level: 0, x: 2944, z: 3520 }, to: { level: 3, x: 3391, z: 6399 } },
    { from: { level: 0, x: 2944, z: 9920 }, to: { level: 0, x: 3391, z: 12799 } },
];

const inBox = (t: Tile, { from, to }: Box): boolean =>
    t.x >= from.x && t.x <= to.x && t.level >= from.level && t.level <= to.level && t.z >= from.z && t.z <= to.z;

/**
 * The Wilderness level, 0 outside it. As [proc,wilderness_level]
 * (server/content/scripts/areas/area_wilderness/scripts/wilderness_levels.rs2:4): the first box holding
 * the tile, then one level per 8 tiles north of that box's south edge, starting at 1.
 */
export function wildernessLevel(t: Tile): number {
    const box = WILDERNESS_ZONES.find(b => inBox(t, b));
    return box ? Math.floor((t.z - box.from.z) / 8) + 1 : 0;
}
