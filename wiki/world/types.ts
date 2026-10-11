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

/** The shape world.json has; bumped when it changes, so a reader refuses a file in an older one. */
export const WORLD_FORMAT = 1;

export interface World {
    /** WORLD_FORMAT when written. */
    format: number;
    generatedFrom: string;
    areas: Area[];
    features: Feature[];
    sites: Site[];
}
