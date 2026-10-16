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
 * One way a connector loc (a ladder, staircase, trapdoor or manhole, kind `connector`) moves the player:
 * one op and one landing its script gives that loc (sources/connectors.ts). An op with a choice (Climb on a
 * middle floor asks up or down) or a condition the script can't settle offline has a row per landing.
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
    /**
     * `op` turns the loc into another (`loc_change` in place, with no condition or move: a trapdoor's
     * Open), and this op of that loc moves the player (`{ op: 1, opName: 'Climb-down' }`): use `op`,
     * then this op on the same tile. `source` is this op's line.
     */
    thenOp?: { op: number; opName: string };
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
     * itself when the script compares with no constant (`%itwatchtower < 4` names `4`), `<n>+1` when that
     * opens past it (`%misc > 0` names `0+1`). Empty until a gate names one.
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
 * A ban on carrying or wearing any obj of some categories, or some objs by name, read from the proc that
 * checks it (sources/loadout.ts): an edge that needs `loadout:<id>` can't be crossed with one.
 */
export interface LoadoutRule {
    /** Obj category -> where it is forbidden. */
    forbidCategories: Record<string, LoadoutScope>;
    /** Obj -> where it is forbidden, for the objs the proc bans by name (the Mage Arena's bow string). */
    forbidObjs?: Record<string, LoadoutScope>;
    /** The proc, as `areas/area_port_sarim/scripts/monk_of_entrana.rs2:26`. */
    source: string;
}

/**
 * A ride between two tiles no walk joins, boarded by talking to an npc or using a loc: a ship route from
 * the sail scripts (sources/transports.ts), or a curated one (gates.ts). One row per boarding npc spawn or
 * placed loc, landing and minimal requirement set.
 */
export interface Transport {
    kind: 'ship' | 'cart' | 'sled';
    /** The sail route, from its constant in interface_boat/scripts/sail.constant (`port_sarim_to_karamja`). */
    route?: string;
    /** The npc config the player talks to, or (`loc`) the loc config they use; `from` is its tile. */
    npc?: string;
    loc?: string;
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
 * Which side of a loc the player stands on (sources/gate-scan.ts).
 *
 * `loc` and `far` are the two sides of a wall loc's axis, as the door procs' `~check_axis(coord, loc_coord,
 * loc_angle)` (doors/scripts/door_procs.rs2:77) tells them apart: for a loc at angle north or south it
 * compares the player's z with the loc's, for west or east their x; equal is `loc` (the loc's own row or
 * column, so its own tile), anything else `far`. The far tile of a straight wall (shape 0) is the one its
 * door opens onto (`~door_open`, door_procs.rs2:1): angle 0 (west) x - 1, 1 (north) z + 1, 2 (east)
 * x + 1, 3 (south) z - 1.
 *
 * A compass side compares the player's tile with the loc's on one axis, as the scripts write it: `west`
 * x below the loc's, `east` x above, `south` z below, `north` z above. On a straight wall it names one of
 * the two tiles. A diagonal door (shape 9) runs corner to corner, so each side is a pair of directions;
 * gates.ts names it by one of them and its why says which pair (the Ranging Guild door's `west` is its
 * north-west side, x <= the loc's and z >= the loc's, minigames/game_ranging/scripts/ranging_guild_door.rs2:2).
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
    /**
     * The placed loc config, its tile, shape (0 a straight wall, 9 a diagonal one, 10 an object) and angle
     * (its rotation: 0 west, 1 north, 2 east, 3 south, the side of the tile a straight wall stands on).
     */
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
    /**
     * The check applies only when crossing from this side (Side); crossing from the other is free. Absent:
     * the check applies from either side.
     */
    from?: Side;
    /**
     * The gated move is a jump to this tile (the Zanaris shed's teleport), not a crossing of the loc; the
     * loc itself is passable as the collision data has it. On an object (not a wall: shapes 0-3 and 9) it
     * can also be read from the script (sources/gate-landings.ts): from every tile the loc is used from, the
     * move lands here, a tile of walkable land.
     */
    to?: Tile;
    /**
     * On an object, a move whose landing depends on the tile the player uses the loc from (`movecoord(coord,
     * ...)`, a step picked by the player's side; sources/gate-landings.ts): from each `stand` (a walkable
     * tile on land the loc is reached from) it lands on `landing`, walkable land. A stand may have several
     * (a dialogue choice), and a stand the move can't be derived from, or lands off land from, has none (the
     * build report lists those stands).
     */
    landings?: { stand: Tile; landing: Tile }[];
    /**
     * On an object, the move deletes the loc or swaps it for one whose collision does not block
     * (sources/gate-landings.ts): once `requires` is met, the op makes the loc's tiles walkable for a while.
     * LOC_DEL and LOC_CHANGE take a duration, after which the loc comes back (the Kharazi jungle's after
     * `$respawnrate`), so the tiles are not open for good.
     */
    opens?: true;
    /** The script line that makes the check, as `file:line`. */
    source: string;
    /** A gate's notes (gates.ts), or what a quest window is open for. */
    notes?: string;
}

/** The shape world.json has; bumped when it changes, so a reader refuses a file in an older one. */
export const WORLD_FORMAT = 10;

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
