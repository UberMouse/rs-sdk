// Where fishing spots move to. A fishing spot npc with a `fishing_movement_enum` param teleports every
// 280 + random(250) ticks to a random tile of that enum that holds no other spot
// (skill_fishing/scripts/fishing_movement.rs2:8-47), so the tiles it can stand on are the enum's coords and its
// placed spawn; a config with no param stays where it is (fishing_spot_random_coord returns npc_coord). The spots of a
// shore share an enum, so the build links them into one site (place.ts SiteOptions.shore).
import { coverOf } from '../cover';
import type { Feature, SpotMovement, Tile } from '../types';
import type { Config } from './configs';
import { coordTile, isCoordLiteral } from './runescript';

/** A spot config's movement enum name, or undefined for a spot that stays put. */
export function movementEnum(cfg: Config | undefined): string | undefined {
    for (const p of cfg?.param ?? []) {
        const [name, value] = p.split(',');
        if (name === 'fishing_movement_enum') return value;
    }
    return undefined;
}

/** The coords of a movement enum, as tiles. */
export function enumTiles(name: string, enums: ReadonlyMap<string, Config>): Tile[] {
    const cfg = enums.get(name);
    if (!cfg) throw new Error(`fishing movement enum ${name} is not defined`);
    const coords = (cfg.val ?? []).map(v => v.slice(v.indexOf(',') + 1));
    if (!coords.length || !coords.every(isCoordLiteral)) throw new Error(`enum ${name} has no coords, or a non-coord`);
    return coords.map(coordTile);
}

/**
 * A site's spots' movement by subtype: for each subtype among its features, the union of its configs' enum tiles
 * and the spawn tiles.
 */
export function siteMovement(
    features: readonly Feature[],
    npcs: ReadonlyMap<string, Config>,
    enums: ReadonlyMap<string, Config>,
): Record<string, SpotMovement> {
    const bySubtype = new Map<string, Map<string, Tile>>();
    for (const f of features) {
        const tiles = bySubtype.get(f.subtype) ?? new Map<string, Tile>();
        bySubtype.set(f.subtype, tiles);
        const name = movementEnum(npcs.get(f.config));
        for (const t of [f.tile, ...(name ? enumTiles(name, enums) : [])]) tiles.set(`${t.level},${t.x},${t.z}`, t);
    }
    return Object.fromEntries(
        [...bySubtype]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([subtype, tiles]) => {
                const sorted = [...tiles.values()].sort((a, b) => a.x - b.x || a.z - b.z || a.level - b.level);
                return [subtype, { tiles: sorted, ...coverOf(sorted) }];
            }),
    );
}
