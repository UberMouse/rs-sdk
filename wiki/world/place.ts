// Groups features into sites, the unit an agent chooses: same-kind features on one level and in one
// leaf area, linked within a per-kind radius. Each site gets a stand tile, a tile a player can use
// its locs from, decided by the engine's own reach test over the collision data (see SiteCollision).
// Every npc config's spawns are clustered the same way, per config (spawnClusters).
import type { Pathfinder } from '../../conductor/actions/paths';
import type { Config } from './sources/configs';
import { first } from './sources/configs';
import { isF2p, isMultiway, wildernessLevel, type Zones } from './sources/zones';
import type { Feature, FeatureKind, NpcSpawn, Rect, Site, Tile } from './types';

/**
 * How far apart (in tiles, Chebyshev as the engine's CoordGrid.distanceTo, CoordGrid.ts:60) two
 * features of a kind may be and still link into one site. A connector is always its own site.
 * `thieving-chest` has no radius in the spec; it takes the stall's, its thieving sibling.
 */
export const SITE_RADIUS: Record<FeatureKind, number> = {
    bank: 10,
    shop: 6,
    tree: 8,
    rock: 8,
    'fishing-spot': 8,
    tanner: 4,
    furnace: 4,
    anvil: 4,
    range: 4,
    fire: 4,
    'spinning-wheel': 4,
    'pottery-wheel': 4,
    'pottery-oven': 4,
    'sand-pit': 4,
    'water-source': 4,
    altar: 4,
    'rc-altar': 4,
    'rc-ruins': 4,
    stall: 6,
    'thieving-chest': 6,
    pickpocket: 8,
    npc: 6,
    connector: 0,
};

/** A loc's size and approach as its config gives them: unrotated, as the engine's Loc carries them. */
export interface LocSize {
    width: number;
    length: number;
    /** The packed `forceapproach` flags: the sides a player may not use the loc from. */
    forceapproach: number;
}

/** A placed loc, in the terms of the engine's reach test. */
export interface LocReach extends LocSize {
    level: number;
    x: number;
    z: number;
    shape: number;
    rotation: number;
}

/**
 * The collision queries stand tiles need. Production is wiki/world/collision.ts: `walkable` is
 * collisionPaths' on tiles in an allocated zone, and `reached` is the engine's reachedLoc
 * (GameMap.ts:450) over the same data.
 */
export interface SiteCollision {
    walkable: Pathfinder['walkable'];
    /** A player (size 1) on `from` can use the loc, as Player.ts:1204 asks before running its op. */
    reached(from: Tile, loc: LocReach): boolean;
}

export interface SiteOptions {
    /** The size of a loc feature, from its config (`locSizes`). */
    size: (f: Feature) => LocSize;
    /** Where a site with no stand tile is reported. */
    log: (line: string) => void;
}

// The packer's forceapproach bits (server/engine/tools/pack/config/LocConfig.ts:149): every side
// blocked but the named one. A value it doesn't name leaves all four blocked, as there.
const APPROACH: Record<string, number> = { north: 0b1110, east: 0b1101, south: 0b1011, west: 0b0111 };

/** A loc feature's size and approach from its config; 1x1 and open from every side by default. */
export function locSizes(configs: Map<string, Config>): (f: Feature) => LocSize {
    return f => {
        const cfg = configs.get(f.config);
        const approach = first(cfg, 'forceapproach');
        return {
            width: Number(first(cfg, 'width') ?? 1),
            length: Number(first(cfg, 'length') ?? 1),
            forceapproach: approach === undefined ? 0 : (APPROACH[approach] ?? 0b1111),
        };
    };
}

const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const dist2 = (a: Tile, b: Tile): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const cmp = (a: number | string, b: number | string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Features in a stable order that does not depend on their index: tile, then identity. */
const byFeature = (a: Feature, b: Feature): number =>
    a.tile.x - b.tile.x ||
    a.tile.z - b.tile.z ||
    a.tile.level - b.tile.level ||
    cmp(a.source, b.source) ||
    cmp(a.config, b.config) ||
    a.id - b.id ||
    (a.shape ?? 0) - (b.shape ?? 0) ||
    (a.rotation ?? 0) - (b.rotation ?? 0) ||
    cmp(a.subtype, b.subtype);

/**
 * Single-linkage clusters of `members` (indexes into `features`) within `radius`, by union-find over a
 * grid of `radius`-sized cells: two tiles within the radius sit in the same or adjacent cells, so each
 * feature is compared with its 3x3 cells only.
 */
function cluster(features: readonly { tile: Tile }[], members: number[], radius: number): number[][] {
    if (radius === 0) return members.map(i => [i]);
    const parent = members.map((_, k) => k);
    const root = (k: number): number => {
        while (parent[k] !== k) k = parent[k] = parent[parent[k]!]!;
        return k;
    };
    const cells = new Map<string, number[]>();
    members.forEach((i, k) => {
        const t = features[i]!.tile;
        const cx = Math.floor(t.x / radius);
        const cz = Math.floor(t.z / radius);
        for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
                for (const other of cells.get(`${cx + dx},${cz + dz}`) ?? [])
                    if (cheb(t, features[members[other]!]!.tile) <= radius) parent[root(k)] = root(other);
        const key = `${cx},${cz}`;
        const cell = cells.get(key);
        if (cell) cell.push(k);
        else cells.set(key, [k]);
    });
    const groups = new Map<number, number[]>();
    members.forEach((i, k) => {
        const r = root(k);
        const g = groups.get(r);
        if (g) g.push(i);
        else groups.set(r, [i]);
    });
    return [...groups.values()];
}

interface Candidate {
    tile: Tile;
    /** How far the tile's side of its loc points away from the bankers; 0 outside banks. */
    away: number;
}

/**
 * The tiles a player can use a site's locs from: around each loc's rotated footprint (and on it, for
 * a loc that does not block), walkable and passing the engine's reach test.
 */
function locCandidates(
    features: readonly Feature[],
    locs: number[],
    collision: SiteCollision,
    size: SiteOptions['size'],
    /** From the site's locs toward its bankers; zero when no side is preferred. */
    bankers: { x: number; z: number },
): Candidate[] {
    const out: Candidate[] = [];
    for (const i of locs) {
        const f = features[i]!;
        const s = size(f);
        const rotation = f.rotation ?? 0;
        const loc: LocReach = { ...f.tile, ...s, shape: f.shape ?? 10, rotation };
        // The engine's Loc keeps the config's width and length; its reach test swaps them for a loc
        // turned a quarter (ReachStrategy.reachRectangle's rotate), and so must the ring searched here.
        const [w, l] = rotation % 2 === 1 ? [s.length, s.width] : [s.width, s.length];
        const { level, x, z } = f.tile;
        for (let cx = x - 1; cx <= x + w; cx++)
            for (let cz = z - 1; cz <= z + l; cz++) {
                const tile = { level, x: cx, z: cz };
                if (!collision.walkable(level, cx, cz) || !collision.reached(tile, loc)) continue;
                const side = { x: cx < x ? -1 : cx >= x + w ? 1 : 0, z: cz < z ? -1 : cz >= z + l ? 1 : 0 };
                out.push({ tile, away: -(side.x * bankers.x + side.z * bankers.z) });
            }
    }
    return out;
}

const mean = (tiles: Tile[], axis: 'x' | 'z'): number => tiles.reduce((s, t) => s + t[axis], 0) / tiles.length;

/** The rounded mean tile of tiles on one level. */
const centreOf = (tiles: Tile[]): Tile => ({
    level: tiles[0]!.level,
    x: Math.round(mean(tiles, 'x')),
    z: Math.round(mean(tiles, 'z')),
});

/** The box around tiles on one level. */
const bboxOf = (tiles: Tile[]): Rect => {
    const level = tiles[0]!.level;
    return tiles.reduce(
        (b, t) => ({
            x1: Math.min(b.x1, t.x),
            z1: Math.min(b.z1, t.z),
            x2: Math.max(b.x2, t.x),
            z2: Math.max(b.z2, t.z),
            level,
        }),
        { x1: Infinity, z1: Infinity, x2: -Infinity, z2: -Infinity, level },
    );
};

/**
 * A site's stand tile. With locs: a tile that reaches one of them, nearest the centre; at a bank,
 * first the one on the side facing away from the bankers. A booth reaches from every open side
 * (bankbooth has no forceapproach), the bankers' side included, so the side matters. It is taken as
 * the direction from the locs' mean to the bankers' mean, not as the distance to the nearest banker:
 * past the end of a long row with one banker behind its middle, a tile is further from that banker
 * than any tile in front of the row. Without locs: the walkable tile nearest the centre in the bbox
 * grown by one tile, as an npc op is used from an adjacent tile and a fishing spot's own tiles are
 * water.
 */
function standTile(
    features: readonly Feature[],
    members: number[],
    kind: FeatureKind,
    centre: Tile,
    bbox: Rect,
    collision: SiteCollision,
    size: SiteOptions['size'],
): Tile | null {
    const locs = members.filter(i => features[i]!.source === 'loc');
    let found: Candidate[];
    if (locs.length) {
        const bankers = members.filter(i => features[i]!.source === 'npc').map(i => features[i]!.tile);
        let toward = { x: 0, z: 0 };
        if (kind === 'bank' && bankers.length) {
            const locTiles = locs.map(i => features[i]!.tile);
            toward = { x: mean(bankers, 'x') - mean(locTiles, 'x'), z: mean(bankers, 'z') - mean(locTiles, 'z') };
        }
        found = locCandidates(features, locs, collision, size, toward);
    } else {
        found = [];
        for (let x = bbox.x1 - 1; x <= bbox.x2 + 1; x++)
            for (let z = bbox.z1 - 1; z <= bbox.z2 + 1; z++)
                if (collision.walkable(centre.level, x, z))
                    found.push({ tile: { level: centre.level, x, z }, away: 0 });
    }
    found.sort(
        (a, b) =>
            b.away - a.away ||
            dist2(a.tile, centre) - dist2(b.tile, centre) ||
            a.tile.x - b.tile.x ||
            a.tile.z - b.tile.z,
    );
    return found[0]?.tile ?? null;
}

/** Counts per subtype, or per kind where the kind has no subtypes, with keys in sorted order. */
function countsOf(fs: Feature[]): Record<string, number> {
    const counts = new Map<string, number>();
    for (const f of fs) counts.set(f.subtype || f.kind, (counts.get(f.subtype || f.kind) ?? 0) + 1);
    return Object.fromEntries([...counts].sort(([a], [b]) => cmp(a, b)));
}

/**
 * Clusters `features` into sites: per kind, level and leaf area (the last id of `resolve`'s path),
 * single-linkage within SITE_RADIUS. A site's id is `kind:leaf:n` (`unnamed` for no area), `n`
 * counting that kind's sites in that area by their first feature's (x, z), so ids do not depend on
 * the input order. Sites come out sorted by kind, area and `n`; `features` holds indexes into
 * `features`, ordered by tile.
 */
export function buildSites(
    features: readonly Feature[],
    resolve: (t: Tile) => string[],
    zones: Zones,
    collision: SiteCollision,
    { size, log }: SiteOptions,
): Site[] {
    const paths = features.map(f => resolve(f.tile));
    const groups = new Map<string, number[]>();
    features.forEach((f, i) => {
        const key = `${f.kind}\0${paths[i]!.at(-1) ?? ''}\0${f.tile.level}`;
        const g = groups.get(key);
        if (g) g.push(i);
        else groups.set(key, [i]);
    });

    // Clusters per kind and area, across levels, since `n` counts within the area.
    const byArea = new Map<string, number[][]>();
    for (const [key, members] of groups) {
        const area = key.slice(0, key.lastIndexOf('\0'));
        const clusters = cluster(features, members, SITE_RADIUS[features[members[0]!]!.kind]);
        for (const c of clusters) c.sort((a, b) => byFeature(features[a]!, features[b]!) || a - b);
        byArea.set(area, [...(byArea.get(area) ?? []), ...clusters]);
    }

    const sites: Site[] = [];
    for (const area of [...byArea.keys()].sort()) {
        const clusters = byArea.get(area)!.sort((a, b) => {
            for (let k = 0; k < Math.min(a.length, b.length); k++) {
                const d = byFeature(features[a[k]!]!, features[b[k]!]!);
                if (d) return d;
            }
            return a.length - b.length;
        });
        clusters.forEach((members, n) => {
            const fs = members.map(i => features[i]!);
            const tiles = fs.map(f => f.tile);
            const { kind } = fs[0]!;
            const areaPath = paths[members[0]!]!;
            const id = `${kind}:${areaPath.at(-1) ?? 'unnamed'}:${n}`;
            const centre = centreOf(tiles);
            const bbox = bboxOf(tiles);
            const stand = standTile(features, members, kind, centre, bbox, collision, size);
            if (!stand) log(`place: site ${id} has no stand tile`);
            sites.push({
                id,
                kind,
                areaPath,
                centre,
                bbox,
                stand,
                counts: countsOf(fs),
                features: members,
                f2p: tiles.some(t => isF2p(zones, t)),
                multiway: tiles.some(t => isMultiway(zones, t)),
                wildernessLevel: tiles.reduce((max, t) => Math.max(max, wildernessLevel(t)), 0),
            });
        });
    }
    return sites;
}

const byTile = (a: Tile, b: Tile): number => a.x - b.x || a.z - b.z || a.level - b.level;

/**
 * Clusters each npc config's spawns as buildSites clusters a kind's features: per config, level and
 * leaf area, single-linkage within the `npc` radius. Two spawns on one tile are two placements and
 * count twice. Clusters come out sorted by config, then by their first tile (x, z, level), which no
 * two clusters of one config share.
 */
export function spawnClusters(
    spawns: readonly { config: string; tile: Tile }[],
    resolve: (t: Tile) => string[],
    zones: Zones,
): NpcSpawn[] {
    const paths = spawns.map(s => resolve(s.tile));
    const groups = new Map<string, number[]>();
    spawns.forEach((s, i) => {
        const key = `${s.config}\0${paths[i]!.at(-1) ?? ''}\0${s.tile.level}`;
        const g = groups.get(key);
        if (g) g.push(i);
        else groups.set(key, [i]);
    });
    const out: { first: Tile; spawn: NpcSpawn }[] = [];
    for (const members of groups.values())
        for (const c of cluster(spawns, members, SITE_RADIUS.npc)) {
            const tiles = c.map(i => spawns[i]!.tile).sort(byTile);
            out.push({
                first: tiles[0]!,
                spawn: {
                    config: spawns[c[0]!]!.config,
                    areaPath: paths[c[0]!]!,
                    centre: centreOf(tiles),
                    bbox: bboxOf(tiles),
                    count: c.length,
                    f2p: tiles.some(t => isF2p(zones, t)),
                },
            });
        }
    return out.sort((a, b) => cmp(a.spawn.config, b.spawn.config) || byTile(a.first, b.first)).map(o => o.spawn);
}
