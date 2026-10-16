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

/** One varp a quest's progress is read from (sources/quests.ts). */
export interface QuestVarp {
    /** The varp's name (`zanaris`) and its id in pack/varp.pack, as a save stores perm varps by id. */
    varp: string;
    varpId: number;
    /**
     * Progress is `getbit_range(varp, lo, hi)`, not the whole varp: the bits of a varbit, or a computed
     * progress (Clock Tower's `~get_cog_progress`).
     */
    bits?: [lo: number, hi: number];
    /** The varbit the scripts name, when progress is one (`horrorquest`: bits 0-10 of `deephorror`). */
    varbit?: string;
    /** The quest is done at progress >= complete. */
    complete: number;
}

/**
 * A quest by its quest-journal component (`questlist:<id>`), and how a save shows it done: `quest:<id>`
 * is progress >= complete on `varp`, or on any one of `or`.
 */
export interface Quest extends QuestVarp {
    id: string;
    /** Other varps that show it done (Shield of Arrav: either gang's). */
    or?: QuestVarp[];
    /**
     * The stages gates name (`quest:<id>>=<stage>`), by constant name: the value a gate compares the
     * varp with, or `^name+1` for one that opens past it (`%princequest > ^prince_guard_drunk`); the number
     * itself when the script compares with no constant (`%itwatchtower < 4` names `4`). Empty until a gate
     * names one.
     */
    stages: Record<string, number>;
    /** The journal call it is read from, or the curated override's script (gates.ts). */
    source: string;
    /**
     * Set when a script sets the varp back below a stage (gates.ts QUEST_VARP_EXCEPTIONS): why, with the
     * script line. A `quest:<id>>=<stage>` on this quest may stop holding.
     */
    varpDecreases?: string;
}

/** What a loadout rule forbids an obj category in: the inventory, the worn slots, or either. */
export type LoadoutScope = 'carried' | 'worn' | 'both';

/**
 * A ban on carrying or wearing any obj of some categories, read from the proc that checks it
 * (sources/loadout.ts): an edge that needs `loadout:<id>` can't be crossed with one.
 */
export interface LoadoutRule {
    /** Obj category -> where it is forbidden. */
    forbidCategories: Record<string, LoadoutScope>;
    /** The proc, as `areas/area_port_sarim/scripts/monk_of_entrana.rs2:26`. */
    source: string;
}

/**
 * A ride between two tiles no walk joins, boarded by talking to an npc: a ship route from the sail
 * scripts (sources/transports.ts), or a curated one (gates.ts). One row per boarding npc spawn, landing
 * and minimal requirement set.
 */
export interface Transport {
    kind: 'ship' | 'cart';
    /** The sail route, from its constant in interface_boat/scripts/sail.constant (`port_sarim_to_karamja`). */
    route?: string;
    /** The npc config the player talks to, and its spawn tile. */
    npc: string;
    from: Tile;
    to: Tile;
    /** Coins taken; requires lists it too, as coins:<fare>, when above 0. */
    fare: number;
    /** A minimal requirement set (requirements.ts), canonical and sorted. */
    requires: string[];
    /**
     * The script line that makes the move: the call of the sail proc (`~set_sail(...)`), or the
     * teleport itself when no sail proc makes it.
     */
    source: string;
    /** The script lines that take the fare and any consumed objs, as `file:line`; absent when none do. */
    paidAt?: string[];
    notes?: string;
}

/**
 * Which side of a loc the player stands on (sources/gate-scan.ts): `loc` the loc's own tile (where the door
 * procs' `~check_axis(coord, loc_coord, loc_angle)` is true, doors/scripts/door_procs.rs2), `far` the tile
 * across its wall, or a compass side of it (`west`: the player's x below the loc's).
 */
export type Side = 'loc' | 'far' | 'west' | 'east' | 'north' | 'south';

/**
 * One placed loc whose op checks a condition before letting the player through (gates.ts GATES): a gate,
 * or a quest window (open only between two stages of a quest, so on a settled account never).
 */
export interface Gate {
    /** The op trigger that checks it, as its header names it: `oploc1,chefdoor`, `oploc1,_shilo_metalgate`. */
    trigger: string;
    kind: 'gate' | 'quest-window';
    /** The placed loc config, its tile, shape and angle (its rotation, 0 west to 3 south). */
    loc: string;
    tile: Tile;
    shape: number;
    angle: number;
    /** The config's size, unrotated, when it is not 1x1. */
    width?: number;
    length?: number;
    /**
     * The minimal requirement sets (requirements.ts), any one of which lets the player through; `[]` for a
     * quest window.
     */
    requires: string[][];
    /** The check applies only when crossing from this side; absent: from either. */
    from?: Side;
    /**
     * The gated move is a jump to this tile (the Zanaris shed's teleport), not a crossing of the loc; the
     * loc itself is passable as the collision data has it.
     */
    to?: Tile;
    /** The script line that makes the check, as `file:line`. */
    source: string;
    /** A gate's notes (gates.ts), or what a quest window is open for. */
    notes?: string;
}

/** The shape world.json has; bumped when it changes, so a reader refuses a file in an older one. */
export const WORLD_FORMAT = 6;

export interface World {
    /** WORLD_FORMAT when written. */
    format: number;
    generatedFrom: string;
    areas: Area[];
    features: Feature[];
    sites: Site[];
    npcSpawns: NpcSpawn[];
    connectors: Connector[];
    quests: Quest[];
    loadoutRules: Record<string, LoadoutRule>;
    transports: Transport[];
    gates: Gate[];
}
