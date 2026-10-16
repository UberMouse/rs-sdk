export interface Tile {
    level: number;
    x: number;
    z: number;
}

export interface Placement {
    source: 'loc' | 'npc';
    id: number;
    config: string;
    tile: Tile;
    /** Locs only. */
    shape?: number;
    rotation?: number;
}

export type FeatureKind =
    | 'tree'
    | 'rock'
    | 'fishing-spot'
    | 'bank'
    | 'shop'
    | 'tanner'
    | 'furnace'
    | 'anvil'
    | 'range'
    | 'fire'
    | 'spinning-wheel'
    | 'pottery-wheel'
    | 'pottery-oven'
    | 'sand-pit'
    | 'water-source'
    | 'altar'
    | 'rc-altar'
    | 'rc-ruins'
    | 'stall'
    | 'thieving-chest'
    | 'pickpocket'
    | 'npc'
    | 'connector';

export interface Feature extends Placement {
    kind: FeatureKind;
    /** `yew`, `iron`, `freshfish`, a shop name, an npc config; `''` when the kind has none. */
    subtype: string;
    /** The in-game name. */
    name: string;
}

export interface Rect {
    x1: number;
    z1: number;
    x2: number;
    z2: number;
    /** Omitted: every level. */
    level?: number;
}

export interface Area {
    id: string;
    name: string;
    parent?: string;
    rects: Rect[];
    requires?: string[];
    notes?: string;
}

export interface Site {
    id: string;
    kind: FeatureKind;
    /** Area ids from the root to the deepest containing area; empty when none contains it. */
    areaPath: string[];
    centre: Tile;
    bbox: Rect;
    stand: Tile | null;
    counts: Record<string, number>;
    /** Indexes into World.features. */
    features: number[];
    f2p: boolean;
    multiway: boolean;
    wildernessLevel: number;
}

/**
 * Where one npc config spawns: its map placements clustered as sites are (one level, one leaf area,
 * single-linkage within the `npc` radius), but per config and whatever the config classifies as, so
 * an npc no feature kind takes still has a place.
 */
export interface NpcSpawn {
    config: string;
    /** Area ids from the root to the deepest containing area; empty when none contains it. */
    areaPath: string[];
    centre: Tile;
    bbox: Rect;
    /** Placements in the cluster. */
    count: number;
    f2p: boolean;
}

/**
 * One way a connector loc (a ladder or staircase, kind `connector`) moves the player: one op and one
 * landing its script gives that loc (sources/connectors.ts). An op with a choice (Climb on a middle
 * floor asks up or down) or a condition the script can't settle offline has a row per landing.
 */
export interface Connector {
    /** Index into World.features: the loc. */
    feature: number;
    /** The loc's tile. */
    loc: Tile;
    /** 1-5. */
    op: number;
    /** The op's name in the loc's config (`Climb-up`), or `op<n>` when it names none. */
    opName: string;
    /** By the landing's level; on one level, into (`down`) or out of (`up`) the underground at z + 6400. */
    direction: 'up' | 'down' | 'other';
    landing: Tile;
    /** A walkable tile on land, on the loc's level, that reaches it; null when none does. */
    stand: Tile | null;
    /**
     * The script moves the player's own tile (`movecoord(coord, ...)`), so `landing` is `stand` shifted:
     * from another tile the climb lands as far off it.
     */
    relative?: true;
    /** The script line the landing comes from, as `ladders+stairs/scripts/stairs.rs2:185`. */
    source: string;
}

/** The shape world.json has; bumped when it changes, so a reader refuses a file in an older one. */
export const WORLD_FORMAT = 3;

export interface World {
    /** WORLD_FORMAT when written. */
    format: number;
    generatedFrom: string;
    areas: Area[];
    features: Feature[];
    sites: Site[];
    npcSpawns: NpcSpawn[];
    connectors: Connector[];
}
