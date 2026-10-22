// Small helpers the builder, the renderers and the generators of wiki/npcs and wiki/shops share.
import type { Tile } from './types';

/** Ascending order of numbers or strings (by code unit, as `<` compares them), 0 when equal. */
export const cmp = (a: number | string, b: number | string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A config's pack id, for ordering by the game's id order; a config without one is a broken input, not a last place. */
export const packId = (ids: Map<string, number>, config: string): number => {
    const id = ids.get(config);
    if (id === undefined) throw new Error(`config ${config} has no pack id`);
    return id;
};

/** Appends `x` to the list at `key`, making the list when it is the first. */
export function push<K, V>(lists: Map<K, V[]>, key: K, x: V): void {
    const list = lists.get(key);
    if (list) list.push(x);
    else lists.set(key, [x]);
}

/** A tile as a map key: `level x z`. */
export const tileKey = (t: Tile): string => `${t.level} ${t.x} ${t.z}`;

/** Ascending order of tiles: by level, then x, then z. */
export const byTile = (a: Tile, b: Tile): number => a.level - b.level || a.x - b.x || a.z - b.z;

/** `tiles` each once, in byTile order. */
export const uniqueTiles = (tiles: readonly Tile[]): Tile[] =>
    [...new Map(tiles.map(t => [tileKey(t), t])).values()].sort(byTile);

/** The collision a tile is on land by (sources/connectors.ts ConnectorCollision). */
interface LandCollision {
    land(level: number, x: number, z: number): boolean;
    walkable(level: number, x: number, z: number): boolean;
}

/** Whether a tile is walkable land under `collision`: its zone is in the collision data, and it is walkable. */
export const onLandIn =
    (collision: LandCollision) =>
    (t: Tile): boolean =>
        collision.land(t.level, t.x, t.z) && collision.walkable(t.level, t.x, t.z);
