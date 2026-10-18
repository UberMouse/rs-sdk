// Which tiles a bot can walk to from the Lumbridge spawn, and what it needs to: a flood fill over the
// collision data the bot's walker routes on (collision.ts), with the connectors, gates and transports of
// world.json as edges that carry requirements (requirements.ts).
//
// Nodes are the tiles of the zones the collision data lists (levels 0-3, the underground at z + 6400 and
// the other planes alike), indexed into typed arrays; the zones sdk/pathfinding.ts only allocates as open
// mainland are not land and are not nodes. A tile is entered by a neighbour step the collision allows
// (`canStep`, so walls and blocked tiles refuse it), or by an edge:
//
// - a connector (World.connectors) from its loc's approach tiles, or only from its `stand` when the
//   landing is `relative` (the stand shifted), to its landing;
// - a gate row (World.gates), read as types.ts Gate describes it. A wall row (shapes 0-3 and 9) with no
//   `to` is the door walled again (collision edit) and crossed as an edge between its two tiles: a straight
//   wall's own tile and the one its angle faces, or a diagonal door's two diagonal neighbours (the Ranging
//   Guild door at angle 0 moves the player from its north-west neighbour to its south-east one,
//   minigames/game_ranging/scripts/ranging_guild_door.rs2:24, 34, and back, :4, :14). A row with `to`
//   jumps there from the loc's approach tiles, the loc as the collision data has it; `landings` jump from
//   each stand; `opens` makes the loc's tiles walkable to a set that meets it (collision edit; `from` is not read for it, and
//   no such row has one). With `from`
//   the requirement applies only from that side and the move is free from the other, but a `to` is the
//   checked move's landing, so it is jumped to from that side only; for a stand, one level with the loc on
//   the side's axis counts as on that side, as the scan names `<` and `<=` alike (sources/gate-scan.ts
//   sideOf). A quest window is never crossed (its wall stays walled), and a gate on a connector's loc tile
//   and op puts its requirements on that connector's edges;
// - a transport (World.transports) from its boarding npc's or loc's tile, and from each neighbour that can
//   step onto it (any neighbour when the tile itself is blocked), to its landing.
//
// Every edge's requirement is a list of alternative sets, any one of which crosses it. Bots always play on
// members worlds (user, 2026-10-16), so `members` is met and never added to a set. The fill is a
// multi-label BFS: each tile keeps the antichain of minimal sets that reach it (a set is dropped when a
// subset already reaches the tile, and drops the supersets it finds), at most `maxSets` of them; a tile that
// would hold more evicts its largest set for a smaller new one (else drops the new one) and is reported. Sets are taken in order of size, smallest first, so
// a tile hears of a cheap route before a dear one. Sets come out canonical and sorted (requirementSet).
import { reachTiles, type PlacedLoc, type SiteOptions } from './place';
import { minimalSets, requirementSet } from './requirements';
import type { ConnectorCollision } from './sources/connectors';
import type { Gate, Side, Tile, World } from './types';
import { cmp } from './util';

/** Where a new account stands: the Lumbridge spawn. */
export const LUMBRIDGE_SPAWN: Tile = { level: 0, x: 3222, z: 3218 };

/** The default bound on the minimal sets a tile keeps. */
export const MAX_SETS = 16;

/** A gated door to wall while the fill runs, where the bundle has it open (a door it lists). */
export interface WallEdit {
    tile: Tile;
    shape: number;
    angle: number;
}

/** A loc whose footprint (rotated, as placed) is cleared while the fill runs: an `opens` gate's loc. */
export interface LocEdit {
    tile: Tile;
    width: number;
    length: number;
}

/** The collision the fill walks: the stand-tile queries, steps, the zone list, and edits to it. */
export interface ReachCollision extends ConnectorCollision {
    /** The zones the collision data lists, as [level, x, z] of each one's first tile (x, z multiples of 8). */
    zones: readonly (readonly [number, number, number])[];
    /** A one-tile step from (x, z) by (dx, dz) is open: walls, corners and a blocked destination refuse it. */
    canStep(level: number, x: number, z: number, dx: number, dz: number): boolean;
    /** Runs `f` with `close` walled and the `open` footprints cleared, then restores the collision. */
    edited<T>(edits: { close: readonly WallEdit[]; open: readonly LocEdit[] }, f: () => T): T;
}

export interface ReachInput {
    world: Pick<World, 'features' | 'connectors' | 'gates' | 'transports'>;
    collision: ReachCollision;
    /** A loc's size and approach, from its config (place.ts locSizes). */
    size: SiteOptions['size'];
    /** Where the fill starts, with no requirement; LUMBRIDGE_SPAWN by default. */
    start?: Tile;
    /** The most minimal sets a tile keeps; MAX_SETS by default. */
    maxSets?: number;
}

export interface ReachReport {
    /** Tiles indexed: every tile of every zone the collision data lists. */
    nodes: number;
    /** Tiles some set reaches, and those the empty set does. */
    reached: number;
    free: number;
    /** Reached tiles by level, the underground (z >= 6400) counted with its level. */
    byLevel: number[];
    /** Distinct requirement sets the reached tiles hold, and labels (tile, set) held. */
    sets: number;
    labels: number;
    /** Edges added: connector, gate (walls crossed, jumps, landings) and transport ones; opened loc tiles. */
    edges: { connectors: number; gates: number; transports: number };
    openTiles: number;
    /**
     * Tiles a reached tile steps to that are not land: the mainland zones sdk/pathfinding.ts allocates as
     * open so its long searches cross gaps, which the fill never enters.
     */
    offLand: number;
    /** The tiles that would have held more than the bound, the first few of them, sorted. */
    bound: { max: number; tiles: number; sample: Tile[] };
    /** Rows and edges the fill could not use, as `<what>: <why>`, sorted. */
    skipped: string[];
    /** Wall-clock time of the fill, and bytes of typed arrays it allocated. */
    ms: number;
    bytes: number;
}

export interface Reach {
    /** The minimal requirement sets that reach the tile, in minimalSets order; [] when none does. */
    setsAt(t: Tile): string[][];
    report: ReachReport;
}

/** The two tiles of a wall row (shape 0 or 9), with the far one second; undefined for a shape not read. */
export function wallTiles(g: Pick<Gate, 'tile' | 'shape' | 'angle'>): [Tile, Tile] | undefined {
    const { level, x, z } = g.tile;
    const at = (dx: number, dz: number): Tile => ({ level, x: x + dx, z: z + dz });
    // A straight wall stands on the side of its tile its angle names: 0 west, 1 north, 2 east, 3 south
    // (~door_open, doors/scripts/door_procs.rs2:1).
    const FACING: [number, number][] = [
        [-1, 0],
        [0, 1],
        [1, 0],
        [0, -1],
    ];
    if (g.shape === 0) {
        const [dx, dz] = FACING[g.angle & 3]!;
        return [g.tile, at(dx, dz)];
    }
    // A diagonal door runs corner to corner: at an even angle it parts the north-west neighbour from the
    // south-east one (ranging_guild_door.rs2:24, 34), at an odd one the north-east from the south-west.
    if (g.shape === 9) return g.angle % 2 === 0 ? [at(-1, 1), at(1, -1)] : [at(1, 1), at(-1, -1)];
    return undefined;
}

/** The axis and sign a compass side compares on: `west` is x below, `north` z above. */
const COMPASS: Partial<Record<Side, ['x' | 'z', -1 | 1]>> = {
    west: ['x', -1],
    east: ['x', 1],
    south: ['z', -1],
    north: ['z', 1],
};

/**
 * Whether crossing from `tile` to `other` (a wall's two tiles) starts on side `from`: true, false, or
 * undefined when the side doesn't tell the two apart (an x side on a wall whose tiles share their x).
 */
function startsOnSide(from: Side, wall: [Tile, Tile], tile: Tile, other: Tile): boolean | undefined {
    if (from === 'loc' || from === 'far') return sameTile(tile, from === 'loc' ? wall[0] : wall[1]);
    const [axis, sign] = COMPASS[from]!;
    const d = (tile[axis] - other[axis]) * sign;
    return d === 0 ? undefined : d > 0;
}

/**
 * Whether a stand of a jump off a loc is on side `from`: false only when it is strictly on the other side
 * of the loc's tile on that side's axis (a wall side, `loc` or `far`, says nothing of an object's stands).
 */
function standOnSide(from: Side, loc: Tile, stand: Tile): boolean {
    const compass = COMPASS[from];
    if (!compass) return true;
    const [axis, sign] = compass;
    return (stand[axis] - loc[axis]) * sign >= 0;
}

const sameTile = (a: Tile, b: Tile): boolean => a.level === b.level && a.x === b.x && a.z === b.z;
const coord = (t: Tile): string => `(${t.x}, ${t.z}${t.level ? `, ${t.level}` : ''})`;
const WALL_SHAPES: ReadonlySet<number> = new Set([0, 1, 2, 3, 9]);

/** A trigger's op number (`oploc1,x` -> 1); undefined for a use-item trigger. */
const opOf = (trigger: string): number | undefined => {
    const m = trigger.match(/^(?:op|ap)loc([1-5]),/);
    return m ? Number(m[1]) : undefined;
};

// ---- Requirement sets ----------------------------------------------------------------------------------

/**
 * Interned requirement sets: each a sorted list of token ids, id 0 the empty set. Union and subset are
 * cached by id pair, as a fill asks the same few hundred pairs millions of times.
 */
class SetTable {
    private readonly tokens: string[] = [];
    private readonly tokenIds = new Map<string, number>();
    private readonly lists: number[][] = [[]];
    private readonly ids = new Map<string, number>([['', 0]]);
    private readonly unions = new Map<number, number>();
    private readonly subsets = new Map<number, boolean>();

    /** The id of a set of canonical requirement strings; `members` is met, so left out. */
    intern(set: readonly string[]): number {
        const ids = set
            .filter(r => r !== 'members')
            .map(r => {
                let id = this.tokenIds.get(r);
                if (id === undefined) {
                    id = this.tokens.length;
                    this.tokens.push(r);
                    this.tokenIds.set(r, id);
                }
                return id;
            });
        return this.of([...new Set(ids)].sort((a, b) => a - b));
    }

    private of(list: number[]): number {
        const key = list.join(',');
        let id = this.ids.get(key);
        if (id === undefined) {
            // The union and subset cache keys pack two ids into `a * 65536 + b`.
            if (this.lists.length > 65535) throw new Error('reach: more than 65535 interned requirement sets');
            id = this.lists.length;
            this.lists.push(list);
            this.ids.set(key, id);
        }
        return id;
    }

    size = (id: number): number => this.lists[id]!.length;

    get count(): number {
        return this.lists.length;
    }

    union(a: number, b: number): number {
        if (a === b || b === 0) return a;
        if (a === 0) return b;
        const key = a < b ? a * 65536 + b : b * 65536 + a;
        let id = this.unions.get(key);
        if (id === undefined) {
            id = this.of([...new Set([...this.lists[a]!, ...this.lists[b]!])].sort((x, y) => x - y));
            this.unions.set(key, id);
        }
        return id;
    }

    /** Whether set a asks for no more than set b. */
    subset(a: number, b: number): boolean {
        if (a === b || a === 0) return true;
        const key = a * 65536 + b;
        let is = this.subsets.get(key);
        if (is === undefined) {
            const have = new Set(this.lists[b]!);
            is = this.lists[a]!.every(t => have.has(t));
            this.subsets.set(key, is);
        }
        return is;
    }

    /** A set as world.json writes it. */
    strings = (id: number): string[] => requirementSet(this.lists[id]!.map(t => this.tokens[t]!));
}

// ---- Tiles -----------------------------------------------------------------------------------------------

/** Where each tile of the collision data's zones sits in the fill's typed arrays. */
class TileIndex {
    readonly size: number;
    private readonly x0: number;
    private readonly z0: number;
    private readonly width: number;
    private readonly height: number;
    /** Zone slot by (level, zone x, zone z) - x0/z0, or -1. */
    private readonly slots: Int32Array;
    private readonly zoneLevel: Uint8Array;
    private readonly zoneX: Int32Array;
    private readonly zoneZ: Int32Array;

    constructor(zones: readonly (readonly [number, number, number])[]) {
        const xs = zones.map(z => z[1] >> 3);
        const zs = zones.map(z => z[2] >> 3);
        this.x0 = Math.min(...xs);
        this.z0 = Math.min(...zs);
        this.width = Math.max(...xs) - this.x0 + 1;
        this.height = Math.max(...zs) - this.z0 + 1;
        this.slots = new Int32Array(4 * this.width * this.height).fill(-1);
        this.zoneLevel = new Uint8Array(zones.length);
        this.zoneX = new Int32Array(zones.length);
        this.zoneZ = new Int32Array(zones.length);
        zones.forEach(([level, x, z], i) => {
            this.slots[(level * this.width + (x >> 3) - this.x0) * this.height + (z >> 3) - this.z0] = i;
            this.zoneLevel[i] = level;
            this.zoneX[i] = x & ~7;
            this.zoneZ[i] = z & ~7;
        });
        this.size = zones.length * 64;
    }

    get bytes(): number {
        return this.slots.byteLength + this.zoneLevel.byteLength + this.zoneX.byteLength + this.zoneZ.byteLength;
    }

    /** The tile's index, or -1 when its zone is not in the data. */
    of(level: number, x: number, z: number): number {
        const cx = (x >> 3) - this.x0;
        const cz = (z >> 3) - this.z0;
        if (level < 0 || level > 3 || cx < 0 || cz < 0 || cx >= this.width || cz >= this.height) return -1;
        const slot = this.slots[(level * this.width + cx) * this.height + cz]!;
        return slot < 0 ? -1 : slot * 64 + ((x & 7) << 3) + (z & 7);
    }

    level = (i: number): number => this.zoneLevel[i >> 6]!;
    x = (i: number): number => this.zoneX[i >> 6]! + ((i >> 3) & 7);
    z = (i: number): number => this.zoneZ[i >> 6]! + (i & 7);
    tile = (i: number): Tile => ({ level: this.level(i), x: this.x(i), z: this.z(i) });
}

/** A growable list of ints. */
class IntList {
    data = new Int32Array(1024);
    length = 0;

    push(...xs: number[]): void {
        if (this.length + xs.length > this.data.length) {
            const grown = new Int32Array(Math.max(this.data.length * 2, this.length + xs.length));
            grown.set(this.data.subarray(0, this.length));
            this.data = grown;
        }
        for (const x of xs) this.data[this.length++] = x;
    }
}

// ---- The fill ------------------------------------------------------------------------------------------

/** The eight steps, as (dx, dz), by bit of a tile's step mask. */
const STEPS: readonly (readonly [number, number])[] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
];
/** A step mask's bit for "computed". */
const KNOWN = 1 << 8;
/** Slots per block of a tile's overflow chain of sets. */
const BLOCK = 4;

/** Fills from `start` (reach.ts header) and returns each tile's minimal requirement sets. */
export function fillReach(input: ReachInput): Reach {
    const began = performance.now();
    const { world, collision, size } = input;
    const start = input.start ?? LUMBRIDGE_SPAWN;
    const maxSets = input.maxSets ?? MAX_SETS;
    const index = new TileIndex(collision.zones);
    const sets = new SetTable();
    const skipped = new Set<string>();

    /** Alternatives (each a set id, minimal among them) of a requirement list, interned once. */
    const altIds = new Map<string, number[]>();
    const alternatives = (reqs: readonly (readonly string[])[]): number[] => {
        const minimal = minimalSets(reqs.map(set => set.filter(r => r !== 'members')));
        const key = minimal.map(s => s.join('\n')).join('\0');
        let ids = altIds.get(key);
        if (!ids) altIds.set(key, (ids = minimal.map(s => sets.intern(s))));
        return ids;
    };
    const FREE = alternatives([[]]);

    // Extra edges by source tile: target tile and alternatives, in the order added.
    const edgeFrom = new Map<number, { to: number; alts: number[] }[]>();
    const edges = { connectors: 0, gates: 0, transports: 0 };
    const addEdge = (kind: keyof typeof edges, from: Tile, to: Tile, alts: number[], what: string): boolean => {
        const [a, b] = [index.of(from.level, from.x, from.z), index.of(to.level, to.x, to.z)];
        if (a < 0 || b < 0) {
            skipped.add(`${what}: ${coord(a < 0 ? from : to)} is not on land`);
            return false;
        }
        const list = edgeFrom.get(a);
        if (list) list.push({ to: b, alts });
        else edgeFrom.set(a, [{ to: b, alts }]);
        edges[kind]++;
        return true;
    };
    /** The approach tiles of a placed loc on land (place.ts reachTiles). */
    const approach = (loc: PlacedLoc): Tile[] =>
        reachTiles(loc, collision, size).filter(t => collision.land(t.level, t.x, t.z));

    // ---- Gates -------------------------------------------------------------------------------------------
    const close: WallEdit[] = [];
    const open: LocEdit[] = [];
    /** Opened tiles: the alternatives that open each (several rows on one loc are alternatives). */
    const opened = new Map<number, (readonly string[])[]>();
    /** Gate rows and quest windows on a connector's loc and op, by `level x z op`. */
    const onConnector = new Map<string, Gate[]>();
    const connectorAt = new Set(world.connectors.map(c => `${c.loc.level} ${c.loc.x} ${c.loc.z} ${c.op}`));
    const gateEdges: (() => void)[] = [];
    for (const g of world.gates) {
        const name = `${g.trigger} ${g.loc} ${coord(g.tile)}`;
        const wall = WALL_SHAPES.has(g.shape);
        if (wall && !g.to) {
            const tiles = wallTiles(g);
            if (!tiles) {
                skipped.add(`${name}: a wall of shape ${g.shape}, whose two sides are not read`);
                continue;
            }
            close.push({ tile: g.tile, shape: g.shape, angle: g.angle });
            if (g.kind !== 'gate') continue;
            const gated = alternatives(g.requires);
            gateEdges.push(() => {
                for (const [a, b] of [tiles, [tiles[1], tiles[0]]] as [Tile, Tile][]) {
                    const side = g.from && startsOnSide(g.from, tiles, a, b);
                    if (g.from && side === undefined)
                        skipped.add(
                            `${name}: from ${g.from} does not tell the wall's two tiles apart, gated both ways`,
                        );
                    addEdge('gates', a, b, side === false ? FREE : gated, name);
                }
            });
            continue;
        }
        const op = opOf(g.trigger);
        const key = `${g.tile.level} ${g.tile.x} ${g.tile.z} ${op}`;
        if (op !== undefined && connectorAt.has(key)) {
            const list = onConnector.get(key);
            if (list) list.push(g);
            else onConnector.set(key, [g]);
        }
        if (g.kind !== 'gate') continue;
        const loc: PlacedLoc = { config: g.loc, tile: g.tile, shape: g.shape, rotation: g.angle };
        const gated = alternatives(g.requires);
        const altsFrom = (stand: Tile) => (g.from && !standOnSide(g.from, g.tile, stand) ? FREE : gated);
        if (g.to) {
            // `to` is where the checked move lands; from the other side the script makes some other move
            // (the Zanaris shed door just opens from inside), so no jump from there.
            const to = g.to;
            gateEdges.push(() => {
                for (const stand of approach(loc))
                    if (!g.from || standOnSide(g.from, g.tile, stand)) addEdge('gates', stand, to, gated, name);
            });
        } else if (g.landings) {
            const landings = g.landings;
            gateEdges.push(() => {
                for (const l of landings) addEdge('gates', l.stand, l.landing, altsFrom(l.stand), name);
            });
        } else if (g.opens) {
            const s = size(loc);
            const [w, l] = g.angle % 2 === 1 ? [s.length, s.width] : [s.width, s.length];
            open.push({ tile: g.tile, width: w, length: l });
            for (let dx = 0; dx < w; dx++)
                for (let dz = 0; dz < l; dz++) {
                    const i = index.of(g.tile.level, g.tile.x + dx, g.tile.z + dz);
                    if (i < 0) continue;
                    opened.set(i, [...(opened.get(i) ?? []), ...g.requires]);
                }
        } else skipped.add(`${name}: a gate row with no derived landing`);
    }
    const openAlts = new Map([...opened].map(([i, reqs]) => [i, alternatives(reqs)]));

    return collision.edited({ close, open }, () => {
        for (const add of gateEdges) add();

        // ---- Connectors ----------------------------------------------------------------------------------
        for (const c of world.connectors) {
            const f = world.features[c.feature];
            if (!f) continue;
            const name = `connector ${f.config} ${coord(c.loc)} op${c.op}`;
            const gates = onConnector.get(`${c.loc.level} ${c.loc.x} ${c.loc.z} ${c.op}`) ?? [];
            if (gates.some(g => g.kind !== 'gate')) {
                skipped.add(`${name}: a quest window, never crossed`);
                continue;
            }
            const altsFrom = (stand: Tile): number[] => {
                if (!gates.length) return FREE;
                // Each gate row is a way to make the move; one whose side the stand is not on is free.
                const ways = gates.flatMap(g => (g.from && !standOnSide(g.from, g.tile, stand) ? [[]] : g.requires));
                return alternatives(ways);
            };
            if (c.relative) {
                if (c.stand) addEdge('connectors', c.stand, c.landing, altsFrom(c.stand), name);
                else skipped.add(`${name}: a relative landing with no stand`);
            } else for (const stand of approach(f)) addEdge('connectors', stand, c.landing, altsFrom(stand), name);
        }

        // ---- Transports ----------------------------------------------------------------------------------
        for (const t of world.transports) {
            const name = `${t.kind} ${t.npc ?? t.loc} ${coord(t.from)} -> ${t.route ?? coord(t.to)}`;
            const alts = alternatives([t.requires]);
            const { level, x, z } = t.from;
            const here = collision.walkable(level, x, z);
            const sources: Tile[] = here ? [t.from] : [];
            for (const [dx, dz] of STEPS)
                if (
                    here
                        ? collision.canStep(level, x + dx, z + dz, -dx, -dz)
                        : collision.walkable(level, x + dx, z + dz)
                )
                    sources.push({ level, x: x + dx, z: z + dz });
            if (!sources.length) skipped.add(`${name}: no walkable tile at or beside the boarding tile`);
            for (const s of sources) addEdge('transports', s, t.to, alts, name);
        }

        return flood();
    });

    function flood(): Reach {
        const n = index.size;
        const masks = new Uint16Array(n);
        // -1 unreached; a set id when the tile holds one set; -2 - block for a chain of blocks.
        const head = new Int32Array(n).fill(-1);
        let poolSets = new Int32Array(BLOCK * 1024);
        let poolNext = new Int32Array(1024);
        let blocks = 0;
        /** The queues' buffers, summed as each bucket is let go: an upper bound on what they held at once. */
        let queueBytes = 0;
        const bound = new Set<number>();
        const offLand = new Set<string>();
        const queues: IntList[] = [];
        const heads: number[] = [];

        const newBlock = (): number => {
            if (blocks === poolNext.length) {
                const [s, nx] = [new Int32Array(poolSets.length * 2), new Int32Array(poolNext.length * 2)];
                s.set(poolSets);
                nx.set(poolNext);
                [poolSets, poolNext] = [s, nx];
            }
            poolSets.fill(-1, blocks * BLOCK, (blocks + 1) * BLOCK);
            poolNext[blocks] = -1;
            return blocks++;
        };
        /** The sets a tile holds. */
        const held = (i: number): number[] => {
            const h = head[i]!;
            if (h === -1) return [];
            if (h >= 0) return [h];
            const out: number[] = [];
            for (let b = -2 - h; b !== -1; b = poolNext[b]!)
                for (let k = 0; k < BLOCK; k++) {
                    const s = poolSets[b * BLOCK + k]!;
                    if (s >= 0) out.push(s);
                }
            return out;
        };
        const store = (i: number, kept: number[]): void => {
            if (kept.length === 1) {
                head[i] = kept[0]!;
                return;
            }
            // Reuse the tile's blocks, adding as many as it needs.
            let b = head[i]! <= -2 ? -2 - head[i]! : newBlock();
            head[i] = -2 - b;
            for (let k = 0; k < kept.length; k += BLOCK) {
                for (let j = 0; j < BLOCK; j++) poolSets[b * BLOCK + j] = kept[k + j] ?? -1;
                if (k + BLOCK < kept.length) {
                    if (poolNext[b] === -1) poolNext[b] = newBlock();
                    b = poolNext[b]!;
                }
            }
            for (let rest = poolNext[b]!; rest !== -1; rest = poolNext[rest]!)
                poolSets.fill(-1, rest * BLOCK, (rest + 1) * BLOCK);
        };
        const enqueue = (i: number, s: number): void => {
            const k = sets.size(s);
            while (queues.length <= k) {
                queues.push(new IntList());
                heads.push(0);
            }
            queues[k]!.push(i, s);
        };
        /** Offers set `s` to tile `i`: kept unless a subset is there, and then drops the supersets there. */
        const offer = (i: number, s: number): void => {
            const h = head[i]!;
            if (h === -1) {
                head[i] = s;
                enqueue(i, s);
                return;
            }
            // The common case: the set the tile holds, or one it asks no more than, arrives again.
            if (h >= 0 && sets.subset(h, s)) return;
            const have = held(i);
            if (have.some(o => sets.subset(o, s))) return;
            const kept = have.filter(o => !sets.subset(s, o));
            if (kept.length >= maxSets) {
                // Full: a set that sorts before the largest held (by size, then canonical string) evicts it, so the sets
                // kept do not depend on the order they arrive in. Either way the tile is reported.
                bound.add(i);
                let worst = 0;
                for (let k = 1; k < kept.length; k++) {
                    const [w, o] = [kept[worst]!, kept[k]!];
                    const d = sets.size(o) - sets.size(w);
                    if (d > 0 || (d === 0 && sets.strings(o).join('\0') > sets.strings(w).join('\0'))) worst = k;
                }
                const d = sets.size(s) - sets.size(kept[worst]!);
                if (d > 0 || (d === 0 && sets.strings(s).join('\0') >= sets.strings(kept[worst]!).join('\0'))) return;
                kept.splice(worst, 1);
            }
            kept.push(s);
            store(i, kept);
            enqueue(i, s);
        };
        /** Arriving on tile `i` with set `s`: an opened loc's tile asks its requirement too. */
        const arrive = (i: number, s: number): void => {
            const alts = openAlts.get(i);
            if (!alts) return offer(i, s);
            for (const a of alts) offer(i, sets.union(s, a));
        };
        const stepMask = (i: number): number => {
            let m = masks[i]!;
            if (m & KNOWN) return m;
            m = KNOWN;
            const [level, x, z] = [index.level(i), index.x(i), index.z(i)];
            STEPS.forEach(([dx, dz], bit) => {
                if (!collision.canStep(level, x, z, dx, dz)) return;
                if (index.of(level, x + dx, z + dz) >= 0) m |= 1 << bit;
                else offLand.add(`${level} ${x + dx} ${z + dz}`);
            });
            masks[i] = m;
            return m;
        };

        const s0 = index.of(start.level, start.x, start.z);
        if (s0 < 0 || !collision.walkable(start.level, start.x, start.z))
            throw new Error(`the fill's start ${coord(start)} is not a walkable tile on land`);
        arrive(s0, 0);
        for (let k = 0; k < queues.length; k++) {
            const q = queues[k]!;
            while (heads[k]! < q.length) {
                const at = heads[k]!;
                const [i, s] = [q.data[at]!, q.data[at + 1]!];
                heads[k] = at + 2;
                // A set dropped since it was queued (a subset arrived) goes no further.
                if (head[i] !== s && (head[i]! >= 0 || !held(i).includes(s))) continue;
                const m = stepMask(i);
                const [level, x, z] = [index.level(i), index.x(i), index.z(i)];
                for (let bit = 0; bit < 8; bit++)
                    if (m & (1 << bit)) arrive(index.of(level, x + STEPS[bit]![0], z + STEPS[bit]![1]), s);
                const out = edgeFrom.get(i);
                if (out) for (const e of out) for (const a of e.alts) arrive(e.to, sets.union(s, a));
            }
            queueBytes += q.data.byteLength;
            // A bucket is done once taken: no union is smaller than the sets it joins.
            queues[k] = new IntList();
        }

        let reached = 0;
        let free = 0;
        let labels = 0;
        const byLevel = [0, 0, 0, 0];
        const used = new Set<number>();
        for (let i = 0; i < n; i++) {
            if (head[i] === -1) continue;
            reached++;
            byLevel[index.level(i)]!++;
            const have = held(i);
            labels += have.length;
            if (have.includes(0)) free++;
            for (const s of have) used.add(s);
        }
        const boundTiles = [...bound].map(index.tile).sort((a, b) => a.level - b.level || a.x - b.x || a.z - b.z);
        const report: ReachReport = {
            nodes: n,
            reached,
            free,
            byLevel,
            sets: used.size,
            labels,
            edges,
            openTiles: openAlts.size,
            offLand: offLand.size,
            bound: { max: maxSets, tiles: bound.size, sample: boundTiles.slice(0, 10) },
            skipped: [...skipped].sort(cmp),
            ms: Math.round(performance.now() - began),
            bytes:
                index.bytes +
                masks.byteLength +
                head.byteLength +
                poolSets.byteLength +
                poolNext.byteLength +
                queueBytes,
        };
        return {
            setsAt(t) {
                const i = index.of(t.level, t.x, t.z);
                if (i < 0) return [];
                return minimalSets(held(i).map(sets.strings));
            },
            report,
        };
    }
}

/** The fill's section of the build report. */
export function formatReach(r: ReachReport): string[] {
    const lines = [
        `reach: ${r.reached} of ${r.nodes} tiles from the Lumbridge spawn, ${r.free} with no requirement ` +
            `(by level ${r.byLevel.join(' / ')}); ${r.sets} requirement sets on ${r.labels} labels`,
        `reach edges: ${r.edges.connectors} connector, ${r.edges.gates} gate, ${r.edges.transports} transport; ` +
            `${r.openTiles} opened loc tiles; ${r.offLand} tiles beside reached land not land (not entered); ` +
            `${r.ms} ms, ${(r.bytes / 2 ** 20).toFixed(1)} MiB of typed arrays`,
    ];
    if (r.bound.tiles)
        lines.push(
            `warning: ${r.bound.tiles} tiles would hold more than ${r.bound.max} minimal sets, so results there may be incomplete; the first few:`,
            `  ${r.bound.sample.map(coord).join(', ')}`,
        );
    if (r.skipped.length)
        lines.push(`warning: ${r.skipped.length} rows the fill could not use:`, ...r.skipped.map(s => `  ${s}`));
    return lines;
}
