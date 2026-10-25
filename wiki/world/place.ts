// Groups features into sites, the unit an agent chooses: same-kind features on one level and in one
// leaf area, linked within a per-kind radius. Each site gets a stand tile, a tile a player can use
// its locs from, decided by the engine's own reach test over the collision data (see SiteCollision).
// Every npc config's spawns are clustered the same way, per config (spawnClusters).
import type { Pathfinder } from '../../conductor/actions/paths';
import { coverOf } from './cover';
import type { Config } from './sources/configs';
import { first } from './sources/configs';
import type { CourseDef, CourseStep } from './sources/courses';
import { STEPS } from './reach';
import type { NpcMovement } from './sources/npc-movement';
import { isF2p, isMultiway, wildernessLevel, type Zones } from './sources/zones';
import type { Course, Feature, FeatureKind, NpcRoam, NpcSpawn, Rect, Site, Tile } from './types';
import { cmp, push, uniqueTiles } from './util';

/**
 * How far apart (in tiles, Chebyshev as the engine's CoordGrid.distanceTo, CoordGrid.ts:60) two
 * features of a kind may be and still link into one site. A connector is always its own site.
 * `thieving-chest` uses the stall radius: both are thieving targets agents treat as one place. An agility course's
 * obstacles lie further apart than a resource's (the Gnome course's log is 10 tiles from its nets) and link across
 * levels (buildSites).
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
    flax: 8,
    'agility-course': 12,
    npc: 6,
    connector: 0,
};

/** A site or npc spawn cluster as placed, before the build adds its reach (reach.ts). */
export type Placed<T extends Site | NpcSpawn> = Omit<T, 'reach'>;

/** A loc's size and approach as its config gives them: unrotated, as the engine's Loc carries them. */
export interface LocSize {
    width: number;
    length: number;
    /** The packed `forceapproach` flags: the sides a player may not use the loc from. */
    forceapproach: number;
}

/** A placed loc as its size and reach need it: a loc feature, or a gate's loc (World.gates). */
export type PlacedLoc = Pick<Feature, 'config' | 'tile' | 'shape' | 'rotation'>;

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
    size: (f: PlacedLoc) => LocSize;
    /** Where a site with no stand tile is reported. */
    log: (line: string) => void;
    /**
     * Whether a walk from the Lumbridge spawn gets to a tile (reach.ts): a stand candidate it gets to beats every
     * one it does not, before any other preference. Absent: every candidate is taken as reached.
     */
    walked?: (t: Tile) => boolean;
    /**
     * Whether a walk from the spawn needs nothing to get to a tile: of the candidates a walk gets to, the first (in
     * the order below) that is free is the stand, as a tile the fresh account gets to beats one behind a key (a
     * sandbar at the Catherby shore). Absent: the first walked candidate stands.
     */
    free?: (t: Tile) => boolean;
    /**
     * An npc used by approach ops from further off than beside it (sources/triggers.ts approachRange): its range by
     * config, and whether a player on one tile sees another (the engine's line of sight). Absent: none is.
     */
    approach?: {
        range: (config: string) => number | undefined;
        inSight: (from: Tile, to: Tile) => boolean;
    };
    /**
     * The agility courses (sources/courses.ts), and the step an `agility-course` feature sets (stepAt). Needed when
     * the features hold that kind.
     */
    courses?: { defs: readonly CourseDef[]; step: (f: Feature) => CourseStep | undefined };
    /**
     * The shore a feature belongs to, or undefined: features with the same shore in one kind, level and leaf area
     * are one site however far apart they stand (a fishing spot moves over every tile of its enum,
     * sources/fishing-movement.ts, so the spots sharing one are one place to fish).
     */
    shore?: (f: Feature) => string | undefined;
    /** Each npc config's movement (sources/npc-movement.ts): a site whose features are all npcs gets their NpcRoam. */
    movement?: (config: string) => NpcMovement;
    /**
     * The tiles a feature moves among besides its own, or undefined for one that stays put: a fishing spot's enum
     * tiles (sources/fishing-movement.ts enumTiles), which standTile stands beside.
     */
    moves?: (f: Feature) => readonly Tile[] | undefined;
}

// The packer's forceapproach bits (server/engine/tools/pack/config/LocConfig.ts:149): every side
// blocked but the named one. A value it doesn't name leaves all four blocked, as there.
const APPROACH: Record<string, number> = { north: 0b1110, east: 0b1101, south: 0b1011, west: 0b0111 };

/** A loc feature's size and approach from its config; 1x1 and open from every side by default. */
export function locSizes(configs: Map<string, Config>): (f: PlacedLoc) => LocSize {
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
    members.forEach((i, k) => push(groups, root(k), i));
    return [...groups.values()];
}

/** `clusters` with those that hold a feature of one shore (SiteOptions.shore) merged. */
function joinShores(features: readonly Feature[], clusters: number[][], shore: SiteOptions['shore']): number[][] {
    if (!shore) return clusters;
    const byShore = new Map<string, number[]>();
    const out: number[][] = [];
    for (const c of clusters) {
        const keys = [...new Set(c.flatMap(i => shore(features[i]!) ?? []))];
        const into = keys.map(k => byShore.get(k)).find(m => m !== undefined);
        const target = into ?? c;
        if (into) into.push(...c);
        else out.push(c);
        for (const k of keys) {
            const held = byShore.get(k);
            if (held && held !== target) {
                // A cluster joining two merged sites: fold the other into this one.
                target.push(...held);
                out.splice(out.indexOf(held), 1);
                for (const [key, v] of byShore) if (v === held) byShore.set(key, target);
            }
            byShore.set(k, target);
        }
    }
    return out;
}

interface Candidate {
    tile: Tile;
    /** How far the tile's side of its loc points away from the bankers; 0 outside banks. */
    away: number;
}

/**
 * A loc's footprint as placed: the engine's Loc keeps the config's width and length, and its reach test
 * swaps them for a loc turned a quarter (ReachStrategy.reachRectangle's rotate).
 */
export function footprint(f: PlacedLoc, size: SiteOptions['size']): { w: number; l: number } {
    const s = size(f);
    return (f.rotation ?? 0) % 2 === 1 ? { w: s.length, l: s.width } : { w: s.width, l: s.length };
}

/**
 * The tiles a player can use a loc from: around its rotated footprint (and on it, for a loc that does
 * not block), walkable and passing the engine's reach test; with `walkable` false, the tiles that pass the
 * reach test whether or not a player can stand there now.
 */
export function reachTiles(f: PlacedLoc, collision: SiteCollision, size: SiteOptions['size'], walkable = true): Tile[] {
    const loc: LocReach = { ...f.tile, ...size(f), shape: f.shape ?? 10, rotation: f.rotation ?? 0 };
    const { w, l } = footprint(f, size);
    const { level, x, z } = f.tile;
    const out: Tile[] = [];
    for (let cx = x - 1; cx <= x + w; cx++)
        for (let cz = z - 1; cz <= z + l; cz++) {
            const tile = { level, x: cx, z: cz };
            if ((!walkable || collision.walkable(level, cx, cz)) && collision.reached(tile, loc)) out.push(tile);
        }
    return out;
}

/** The tiles a player can use a site's locs from (reachTiles), each with its side's bank preference. */
function locCandidates(
    features: readonly Feature[],
    locs: number[],
    collision: SiteCollision,
    size: SiteOptions['size'],
    /** From the site's locs toward its bankers; zero when no side is preferred. */
    bankers: { x: number; z: number },
): Candidate[] {
    return locs.flatMap(i => {
        const f = features[i]!;
        const { w, l } = footprint(f, size);
        const { x, z } = f.tile;
        return reachTiles(f, collision, size).map(tile => {
            const side = { x: tile.x < x ? -1 : tile.x >= x + w ? 1 : 0, z: tile.z < z ? -1 : tile.z >= z + l ? 1 : 0 };
            return { tile, away: -(side.x * bankers.x + side.z * bankers.z) };
        });
    });
}

const mean = (tiles: Tile[], axis: 'x' | 'z'): number => tiles.reduce((s, t) => s + t[axis], 0) / tiles.length;

/** The rounded mean tile of tiles on one level. */
export const centreOf = (tiles: Tile[]): Tile => ({
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

/** The tiles of a box grown by one tile, on `level`: by x, then by z. */
export function grownBox(b: Rect, level: number): Tile[] {
    const out: Tile[] = [];
    for (let x = b.x1 - 1; x <= b.x2 + 1; x++) for (let z = b.z1 - 1; z <= b.z2 + 1; z++) out.push({ level, x, z });
    return out;
}

/**
 * The NpcRoam of npcs of `configs` spawned in `bbox`. A patrol's wander is how far its coords' box reaches past
 * `bbox` on any side, on whatever level the box is.
 */
export function roamOf(configs: readonly string[], bbox: Rect, movement: (config: string) => NpcMovement): NpcRoam {
    const ms = [...new Set(configs)].sort().map(c => movement(c));
    const wanderOf = ({ wander, patrol: p }: NpcMovement): number =>
        p ? Math.max(wander, bbox.x1 - p.x1, p.x2 - bbox.x2, bbox.z1 - p.z1, p.z2 - bbox.z2) : wander;
    const wander = Math.max(0, ...ms.map(wanderOf));
    const moves = ms.find(m => m.moves)?.moves;
    return {
        wander,
        respawnTicks: Math.min(...ms.map(m => m.respawnTicks)),
        roam: { ...bbox, x1: bbox.x1 - wander, z1: bbox.z1 - wander, x2: bbox.x2 + wander, z2: bbox.z2 + wander },
        ...(moves ? { moves } : {}),
    };
}

/** SiteCollision with the one-tile step test the walker routes by (reach.ts ReachCollision.canStep). */
export interface StepCollision extends SiteCollision {
    canStep(level: number, x: number, z: number, dx: number, dz: number): boolean;
    /**
     * The tile's zone is in the collision data (collision.ts): the open mainland the pathfinder allocates around it
     * walks, but is no land an npc walks to.
     */
    land(level: number, x: number, z: number): boolean;
    /**
     * Runs `f` with every door the collision has open for the walker walled again (collision.ts), as an npc opens
     * none and a player beside a closed door is not beside what is behind it. Absent: `f` runs on the collision as
     * it is.
     */
    walled?<T>(f: () => T): T;
}

/**
 * The tiles an npc of a cluster is used from (NpcSpawn.reach): where its npcs can be, and each tile round them
 * that can step onto one, or from which the engine's entity reach test passes to one (reachedEntity,
 * server/engine/src/engine/GameMap.ts:446, which Player.ts:1201 asks of an npc target): a tile across a wall is
 * not one. Its npcs can be on its bbox, and on each tile of its roam that one-tile steps over land with doors
 * shut (StepCollision.land, walled) get to from the bbox, as an npc walks to its wander destination a step at a
 * time (MoveStrategy.NAIVE, Npc.ts:78). So a roam tile behind a wall or a door is not one, and a map-sized roam
 * (Bob the cat's `wanderrange=30000`) costs the land the walk gets to, not its box. An npc used by an approach op
 * from further off (a banker across its booth, interface_bank/scripts/banker.rs2:7) is not modelled: such a
 * cluster reads as its beside tiles do. By x, then z.
 */
export function besideCluster(c: Pick<NpcSpawn, 'bbox' | 'roam' | 'centre'>, collision: StepCollision): Tile[] {
    return collision.walled ? collision.walled(() => besideTiles(c, collision)) : besideTiles(c, collision);
}

function besideTiles(c: Pick<NpcSpawn, 'bbox' | 'roam' | 'centre'>, collision: StepCollision): Tile[] {
    const { bbox, roam } = c;
    const level = c.centre.level;
    const inRoam = (x: number, z: number): boolean => x >= roam.x1 && x <= roam.x2 && z >= roam.z1 && z <= roam.z2;
    // Tiles by x * SPAN + z: z stays under SPAN (the underground sits at z + 6400).
    const SPAN = 1 << 15;
    const at = (k: number): Tile => ({ level, x: Math.floor(k / SPAN), z: k % SPAN });
    const walked = new Set<number>();
    for (let x = bbox.x1; x <= bbox.x2; x++) for (let z = bbox.z1; z <= bbox.z2; z++) walked.add(x * SPAN + z);
    const queue = [...walked];
    while (queue.length) {
        const { x, z } = at(queue.pop()!);
        for (const [dx, dz] of STEPS) {
            const k = (x + dx) * SPAN + z + dz;
            if (walked.has(k) || !inRoam(x + dx, z + dz) || !collision.land(level, x + dx, z + dz)) continue;
            if (!collision.canStep(level, x, z, dx, dz)) continue;
            walked.add(k);
            queue.push(k);
        }
    }
    const ring = new Set<number>();
    for (const k of walked)
        for (const [dx, dz] of STEPS) if (!walked.has(k + dx * SPAN + dz)) ring.add(k + dx * SPAN + dz);
    const beside = [...ring].filter(k => {
        const t = at(k);
        return STEPS.some(([dx, dz]) => {
            const [x, z] = [t.x + dx, t.z + dz];
            if (!walked.has(x * SPAN + z)) return false;
            if (collision.canStep(level, t.x, t.z, dx, dz)) return true;
            // An npc as a 1x1 rectangle (shape -2, GameMap.ts:447).
            return collision.reached(t, { level, x, z, width: 1, length: 1, forceapproach: 0, shape: -2, rotation: 0 });
        });
    });
    return [...walked, ...beside].sort((a, b) => a - b).map(at);
}

/**
 * The walkable tiles a player uses an npc standing on `t` from, as besideCluster has them for a cluster of that one
 * tile that does not wander: one sharing an edge with it that steps onto it or passes the entity reach test, so not
 * a diagonal one nor one across a wall. A fishing spot's, on each tile it moves to (standTile, checks.ts useTiles).
 */
export function besideSpot(t: Tile, collision: StepCollision): Tile[] {
    const box = { x1: t.x, z1: t.z, x2: t.x, z2: t.z };
    return besideCluster({ bbox: box, roam: box, centre: t }, collision).filter(u =>
        collision.walkable(u.level, u.x, u.z),
    );
}

/**
 * A site's stand tile: first a tile a walk gets to (SiteOptions.walked), as a tile walled in with the locs
 * (the bankers' side of a counter) is no stand. With locs: a tile that reaches one of them, nearest the centre;
 * at a bank, first the one on the side facing away from the bankers. A booth reaches from every open side
 * (bankbooth has no forceapproach), the bankers' side included, so the side matters. It is taken as
 * the direction from the locs' mean to the bankers' mean, not as the distance to the nearest banker:
 * past the end of a long row with one banker behind its middle, a tile is further from that banker
 * than any tile in front of the row. Without locs: the walkable tile nearest the centre in the bbox
 * grown by one tile, as an npc op is used from an adjacent tile and a fishing spot's own tiles are
 * water; for an npc used by approach ops from further off (SiteOptions.approach), also each walkable tile
 * within its range of a spawn (Chebyshev, the spawn's own tile left out) in sight of it, as
 * PathingEntity.inApproachDistance (server/engine/src/engine/entity/PathingEntity.ts:422) takes an approach op:
 * the Burthorpe Games Room barmaid is traded with across her bar. When a member moves (SiteOptions.moves: a fishing
 * spot, which teleports among its enum's tiles, skill_fishing/scripts/fishing_movement.rs2:8-47), the walkable
 * tiles beside any tile a member can stand on (besideSpot) instead of the grown bbox, nearest the centre of those tiles' cover
 * (cover.ts coverOf), as a spot placed at one end of its enum spends most of its time away from there.
 */
function standTile(
    features: readonly Feature[],
    members: number[],
    kind: FeatureKind,
    centre: Tile,
    bbox: Rect,
    collision: StepCollision,
    {
        size,
        walked = () => true,
        free,
        approach,
        moves,
    }: Pick<SiteOptions, 'size' | 'walked' | 'free' | 'approach' | 'moves'>,
): Tile | null {
    const locs = members.filter(i => features[i]!.source === 'loc');
    let found: Candidate[];
    let target = centre;
    if (locs.length) {
        const bankers = members.filter(i => features[i]!.source === 'npc').map(i => features[i]!.tile);
        let toward = { x: 0, z: 0 };
        if (kind === 'bank' && bankers.length) {
            const locTiles = locs.map(i => features[i]!.tile);
            toward = { x: mean(bankers, 'x') - mean(locTiles, 'x'), z: mean(bankers, 'z') - mean(locTiles, 'z') };
        }
        found = locCandidates(features, locs, collision, size, toward);
    } else {
        const far = members.flatMap(i => {
            const { config, tile: npc } = features[i]!;
            const range = approach?.range(config);
            if (!approach || range === undefined) return [];
            const out: Tile[] = [];
            for (let dx = -range; dx <= range; dx++)
                for (let dz = -range; dz <= range; dz++) {
                    const t = { level: npc.level, x: npc.x + dx, z: npc.z + dz };
                    if ((dx || dz) && collision.walkable(t.level, t.x, t.z) && approach.inSight(t, npc)) out.push(t);
                }
            return out;
        });
        const moved = members.flatMap(i => moves?.(features[i]!) ?? []);
        let beside: Tile[];
        if (moved.length) {
            const spots = uniqueTiles([...members.map(i => features[i]!.tile), ...moved]);
            target = coverOf(spots).centre;
            const walled = collision.walled ?? (<T>(f: () => T): T => f());
            beside = walled(() => spots.flatMap(t => besideSpot(t, collision)));
        } else beside = grownBox(bbox, centre.level).filter(t => collision.walkable(t.level, t.x, t.z));
        found = uniqueTiles([...beside, ...far]).map(tile => ({ tile, away: 0 }));
    }
    const unwalked = (c: Candidate): number => (walked(c.tile) ? 0 : 1);
    found.sort(
        (a, b) =>
            unwalked(a) - unwalked(b) ||
            b.away - a.away ||
            dist2(a.tile, target) - dist2(b.tile, target) ||
            a.tile.x - b.tile.x ||
            a.tile.z - b.tile.z,
    );
    const freeStand = free && found.find(c => walked(c.tile) && free(c.tile));
    return (freeStand ?? found[0])?.tile ?? null;
}

/** Counts per subtype, or per kind where the kind has no subtypes, with keys in sorted order. */
function countsOf(fs: Feature[]): Record<string, number> {
    const counts = new Map<string, number>();
    for (const f of fs) counts.set(f.subtype || f.kind, (counts.get(f.subtype || f.kind) ?? 0) + 1);
    return Object.fromEntries([...counts].sort(([a], [b]) => cmp(a, b)));
}

/** An agility course's cluster as buildSites places it: its first obstacle decides its area and stand. */
interface Lap {
    def: CourseDef;
    /** Each member's step, by feature index. */
    steps: Map<number, CourseStep>;
    /** The members that set step 1, by tile. */
    first: number[];
    /** The members that set the last step. */
    last: number[];
}

/**
 * Each course's laps: its features linked within SITE_RADIUS on any level (a course climbs to level 2 and back), a
 * cluster that holds every step from 1 to the last being one lap. A cluster short of a step (the Gnome course's tree
 * branch placed 30 tiles north of it, whose Climb-down lands on the course) is no site, and logged; a course left
 * with no site throws.
 */
function courseLaps(
    features: readonly Feature[],
    members: Map<string, number[]>,
    courses: SiteOptions['courses'],
    log: SiteOptions['log'],
): Map<number[], Lap> {
    const out = new Map<number[], Lap>();
    for (const [name, of] of members) {
        const def = courses?.defs.find(d => d.course === name);
        if (!courses || !def) throw new Error(`buildSites: no course ${name} for its agility-course features`);
        for (const c of cluster(features, of, SITE_RADIUS['agility-course'])) {
            c.sort((a, b) => byFeature(features[a]!, features[b]!) || a - b);
            const steps = new Map<number, CourseStep>();
            for (const i of c) {
                const step = courses.step(features[i]!);
                if (!step)
                    throw new Error(`buildSites: ${features[i]!.config} is an agility-course feature with no step`);
                steps.set(i, step);
            }
            const missing = Array.from({ length: def.lastStep }, (_, k) => k + 1).filter(
                k => ![...steps.values()].some(s => s.step === k),
            );
            if (missing.length) {
                const at = c.map(i => `${features[i]!.config} (${features[i]!.tile.x}, ${features[i]!.tile.z})`);
                log(
                    `place: agility-course ${name} placements ${at.join(', ')} lack step ${missing.join(', ')}: no site`,
                );
                continue;
            }
            out.set(c, {
                def,
                steps,
                first: c.filter(i => steps.get(i)!.step === 1),
                last: c.filter(i => steps.get(i)!.step === def.lastStep),
            });
        }
    }
    for (const def of courses?.defs ?? [])
        if (![...out.values()].some(l => l.def === def))
            throw new Error(`buildSites: no placement of course ${def.course} holds every step 1 to ${def.lastStep}`);
    return out;
}

/** A lap's Course: its obstacles by step, then as the cluster orders them (by tile). */
const courseOf = (features: readonly Feature[], members: number[], lap: Lap): Course => ({
    varp: lap.def.varp,
    lapBonus: lap.def.lapBonus,
    source: lap.def.source,
    obstacles: members
        .map(i => ({ i, step: lap.steps.get(i)! }))
        .sort((a, b) => a.step.step - b.step.step)
        .map(({ i, step }) => ({
            step: step.step,
            feature: i,
            loc: features[i]!.config,
            tile: features[i]!.tile,
            source: step.source,
        })),
});

/**
 * Clusters `features` into sites: per kind, level and leaf area (the last id of `resolve`'s path),
 * single-linkage within SITE_RADIUS. A site's id is `kind:leaf:n` (`unnamed` for no area), `n`
 * counting that kind's sites in that area by their first feature's (x, z), so ids do not depend on
 * the input order. Sites come out sorted by kind, area and `n`; `features` holds indexes into
 * `features`, ordered by tile.
 *
 * An agility course is one site per lap (courseLaps), on every level it holds: its area is its first obstacle's,
 * its centre the mean of its features on that obstacle's level, its bbox on no one level when it spans several,
 * and its stand the tile using a first obstacle nearest the last obstacles, as the lap comes back to the first from
 * the last.
 */
export function buildSites(
    features: readonly Feature[],
    resolve: (t: Tile) => string[],
    zones: Zones,
    collision: StepCollision,
    { size, log, walked, free, approach, courses, shore, movement, moves }: SiteOptions,
): Placed<Site>[] {
    const paths = features.map(f => resolve(f.tile));
    const groups = new Map<string, number[]>();
    const courseMembers = new Map<string, number[]>();
    features.forEach((f, i) =>
        f.kind === 'agility-course'
            ? push(courseMembers, f.subtype, i)
            : push(groups, `${f.kind}\0${paths[i]!.at(-1) ?? ''}\0${f.tile.level}`, i),
    );

    // Clusters per kind and area, across levels, since `n` counts within the area.
    const byArea = new Map<string, number[][]>();
    for (const [key, members] of groups) {
        const area = key.slice(0, key.lastIndexOf('\0'));
        const clusters = joinShores(
            features,
            cluster(features, members, SITE_RADIUS[features[members[0]!]!.kind]),
            shore,
        );
        for (const c of clusters) c.sort((a, b) => byFeature(features[a]!, features[b]!) || a - b);
        byArea.set(area, [...(byArea.get(area) ?? []), ...clusters]);
    }
    const laps = courseLaps(features, courseMembers, courses, log);
    for (const [c, lap] of laps) {
        const area = `agility-course\0${paths[lap.first[0]!]!.at(-1) ?? ''}`;
        byArea.set(area, [...(byArea.get(area) ?? []), c]);
    }

    const sites: Placed<Site>[] = [];
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
            const lap = laps.get(members);
            const areaPath = paths[lap ? lap.first[0]! : members[0]!]!;
            const id = `${kind}:${areaPath.at(-1) ?? 'unnamed'}:${n}`;
            let centre = centreOf(tiles);
            let bbox = bboxOf(tiles);
            let stand: Tile | null;
            if (lap) {
                const level = features[lap.first[0]!]!.tile.level;
                centre = centreOf(tiles.filter(t => t.level === level));
                if (tiles.some(t => t.level !== level)) {
                    const { level: _, ...every } = bbox;
                    bbox = every;
                }
                const last = centreOf(lap.last.map(i => features[i]!.tile));
                stand = standTile(features, lap.first, kind, last, bbox, collision, {
                    size,
                    walked,
                    free,
                    approach,
                });
            } else
                stand = standTile(features, members, kind, centre, bbox, collision, {
                    size,
                    walked,
                    free,
                    approach,
                    moves,
                });
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
                ...(lap ? { course: courseOf(features, members, lap) } : {}),
                ...(movement && fs.every(f => f.source === 'npc')
                    ? roamOf(
                          fs.map(f => f.config),
                          bbox,
                          movement,
                      )
                    : {}),
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
 * two clusters of one config share. Each gets its config's NpcRoam (roamOf).
 */
export function spawnClusters(
    spawns: readonly { config: string; tile: Tile }[],
    resolve: (t: Tile) => string[],
    zones: Zones,
    movement: (config: string) => NpcMovement,
): Placed<NpcSpawn>[] {
    const paths = spawns.map(s => resolve(s.tile));
    const groups = new Map<string, number[]>();
    spawns.forEach((s, i) => push(groups, `${s.config}\0${paths[i]!.at(-1) ?? ''}\0${s.tile.level}`, i));
    const out: { first: Tile; spawn: Placed<NpcSpawn> }[] = [];
    for (const members of groups.values())
        for (const c of cluster(spawns, members, SITE_RADIUS.npc)) {
            const tiles = c.map(i => spawns[i]!.tile).sort(byTile);
            const config = spawns[c[0]!]!.config;
            const bbox = bboxOf(tiles);
            out.push({
                first: tiles[0]!,
                spawn: {
                    config,
                    areaPath: paths[c[0]!]!,
                    centre: centreOf(tiles),
                    bbox,
                    count: c.length,
                    f2p: tiles.some(t => isF2p(zones, t)),
                    ...roamOf([config], bbox, movement),
                },
            });
        }
    return out.sort((a, b) => cmp(a.spawn.config, b.spawn.config) || byTile(a.first, b.first)).map(o => o.spawn);
}
