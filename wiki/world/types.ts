import type { MethodDef } from './methods';
import type { NpcHazard } from './model/family';
import type { MethodWay } from './model/method';
import type { Skill } from './model/server';

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
    | 'flax'
    | 'agility-course'
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
    /**
     * The minimal requirement sets (requirements.ts) a walk from the Lumbridge spawn needs to get to this site's
     * chosen stand tile (reach.ts), and to no other tile of it, joined with what using its features asks (a quest
     * that locks them, gates.ts USE_GATES): `[[]]` with none, `[]` when no set gets there or there is no stand.
     */
    reach: string[][];
    /**
     * On a resource, processor or npc site (distance.ts SINKS), the nearest site of each sink kind it takes its
     * products to (a bank, and a furnace, range or anvil where phase 3 processes on the way), by run ticks from
     * this site's stand under its own reach sets (distance.ts); a kind with none such is left out. Absent on other
     * kinds.
     */
    nearest?: Nearest;
    /** On an `agility-course` site, its lap (sources/courses.ts). */
    course?: Course;
}

/**
 * An agility course's lap as its scripts keep it: a progress varp each obstacle moves on when it is the next one (an
 * earlier one sets it back), and a bonus paid when the last completes (sources/courses.ts).
 */
export interface Course {
    /** The progress varp (`gnome_course_progress`). */
    varp: string;
    /** The lap bonus in xp tenths, paid on top of the last obstacle's own xp. */
    lapBonus: number;
    /** The bonus's stat_advance, as `file:line`. */
    source: string;
    /**
     * The site's placed obstacles in lap order, by step, then tile: one or more per step (the Gnome course's three
     * nets are each step 2), any one of which completes it.
     */
    obstacles: CourseObstacle[];
}

/** One placed obstacle of a course; the crossing rows on its loc (`act.loc` and `at`) are its moves, where World.crossings has them. */
export interface CourseObstacle {
    /** Its place in the lap, from 1 to the last. */
    step: number;
    /** Index into World.features. */
    feature: number;
    /** The loc config and its tile. */
    loc: string;
    tile: Tile;
    /** The call that sets the step, as `file:line`. */
    source: string;
}

/** The nearest sink of one kind: its site id, the run ticks to its stand, and what that way needs. */
export interface NearestSink {
    site: string;
    runTicks: number;
    /** The requirement set of the way (requirements.ts canonicalSet): its crossings' sets joined, `[]` for none. */
    requires: string[];
}

/** The kinds of sink a site's nearest is found for (distance.ts SINKS). */
export const SINK_KINDS = ['bank', 'furnace', 'range', 'anvil'] as const;
export type SinkKind = (typeof SINK_KINDS)[number];

export type Nearest = Partial<Record<SinkKind, NearestSink>>;

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
    /**
     * The minimal requirement sets a walk from the Lumbridge spawn needs to get beside the cluster (reach.ts): the
     * cheapest over the tiles its npcs are used from (place.ts besideCluster: its bbox, and the tiles round it
     * that step onto it or the engine's entity reach test passes from), not one tile's; `[]` when none of them is
     * reached.
     */
    reach: string[][];
}

/**
 * One way a connector loc (a ladder, staircase, trapdoor, manhole or gangplank, kind `connector`) moves the
 * player: one op and one landing its script gives that loc (sources/connectors.ts). An op with a choice (Climb
 * on a middle floor asks up or down) or a condition the script can't settle offline has a row per landing.
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
    /**
     * How it is boarded (Act), when the row says: the sail and curated rows name the npc or loc but not the op or
     * the dialogue, and leave it out.
     */
    act?: Act;
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
     * With `from`: crossing from the other side is not free but refused, as the script turns that side away (the
     * castle crumbly wall, skill_agility/scripts/shortcuts.rs2:6).
     */
    oneWay?: true;
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
     * build report lists those stands). A `free` landing is one the script makes from that stand needing
     * nothing, whatever `from` says of the stand's side (the Shantay Pass lets a player level with it out free).
     */
    landings?: { stand: Tile; landing: Tile; free?: true }[];
    /**
     * With `to` or `landings` read from the script: the ticks a successful move takes, its script's delays summed
     * (sources/gate-scan.ts Path.ticks), the most any stand's takes (on a `to` row, the most of `standTicks`). Absent
     * when a delay on the way is not known offline.
     */
    ticks?: number;
    /**
     * On a `to` row with `ticks`: each stand's own, the fewest its paths take, by stand tile, the tiles the move is
     * made from; `ticks` is the most of them (the Wilderness course pipe takes 11 from the tile south of it and 12 from
     * the others, which its script walks there first, skill_agility/scripts/wilderness_course.rs2:57-60). A `landings`
     * row has none: a stand's paths there can land on different tiles in different ticks (sources/gate-landings.ts
     * ticksOf).
     */
    standTicks?: { stand: Tile; ticks: number }[];
    /**
     * On an object, the move deletes the loc or swaps it for one whose collision does not block
     * (sources/gate-landings.ts): once `requires` is met, the op makes the loc's tiles walkable for a while.
     * LOC_DEL and LOC_CHANGE take a duration, after which the loc comes back (the Kharazi jungle's after
     * `$respawnrate`), so the tiles are not open for good.
     */
    opens?: true;
    /**
     * How the move is done, when the trigger's op is not all of it (gates.ts): a `loc-op` of the row's loc and the
     * trigger's op, with the dialogue options picked on the way. A choice the script asks only on some paths (the
     * Shantay Pass poster, asked of a player holding no disclaimer) is answered when it is shown.
     */
    act?: Extract<Act, { kind: 'loc-op' }>;
    /** The script line that makes the check, as `file:line`. */
    source: string;
    /**
     * The move is behind a stat_random roll (an agility shortcut): it prices the checked move's edges, and the
     * other side of a `from` row is not rolled.
     */
    roll?: Roll;
    /** A gate's notes (gates.ts), or what a quest window is open for. */
    notes?: string;
}

/**
 * How a crossing is done: the op the player sends. A connector row's act is its loc's op and a gate row's its
 * trigger's, so those rows carry none; a gate whose move is behind dialogue carries the choices in Gate.act.
 *
 * - `loc-op`: op `op` (1-5) of the loc config `loc`, then `choices`, the dialogue options picked in order (by their
 *   text), when the move is behind some;
 * - `item-on-loc`: the obj `obj`, or any obj of the category `category`, used on the loc config `loc`;
 * - `npc-op`: op `op` (1-5) of the npc config `npc`, then `choices`, the dialogue options picked in order (by their
 *   text), when the move is behind some;
 * - `item-op`: op `op` (1-5) of the obj `obj` in the inventory;
 * - `interface`: a click on the interface component `component` (a glider's destination).
 */
export type Act =
    | { kind: 'loc-op'; loc: string; op: number; choices?: string[] }
    | { kind: 'item-on-loc'; obj: string; loc: string }
    | { kind: 'item-on-loc'; category: string; loc: string }
    | { kind: 'npc-op'; npc: string; op: number; choices?: string[] }
    | { kind: 'item-op'; obj: string; op: number }
    | { kind: 'interface'; component: string };

/** One tile a crossing lands on. */
export interface Landing {
    tile: Tile;
    /**
     * The run ticks to this landing from the one of the row's landings farthest from it (distance.ts
     * priceCrossings), 0 for a row's only landing; a stranded landing, which no walk leaves for the rest (distance.ts
     * strandedLandings), counts for none. An edge to this landing costs its crossing plus this, so a way on from it
     * costs at least what it would from the worst landing. Written at build; absent when some other landing does not
     * walk here, or this one is stranded, and then no distance goes by this landing.
     */
    spread?: number;
    /**
     * The chance the move lands here, where a row's landings are not equally likely: an npc teleport draws a coord of
     * its enum, each equally likely, then a tile of that coord's ring (sources/npc-teleports.ts), so a tile of a
     * smaller ring is likelier. Absent: the row's landings are equally likely. A ring's tiles off land keep their
     * share, so a row's chances may sum to under 1. Only a method leg over the landings reads it (model/legs.ts).
     */
    chance?: number;
}

/**
 * Hitpoints a hit takes from a player with HP current hitpoints: floor(HP x a / b) + c (roll.ts damageAt). The
 * Wilderness course's log takes floor(HP x 15 / 100) + 1 (skill_agility/scripts/wilderness_course.rs2:137); a hit
 * that reads no hitpoints has `a` 0 and `b` 1.
 */
export interface HpDamage {
    a: number;
    b: number;
    c: number;
}

/** A move behind `stat_random(stat, low, high)` (roll.ts statRandomChance), and what a failed roll does. */
export interface Roll {
    /** The stat rolled, as a `skill:` requirement names it (`agility`). */
    stat: string;
    low: number;
    high: number;
    /** The stat_random call, as `file:line`. */
    source: string;
    fail: {
        /** Ticks a failed attempt takes, its delays summed. */
        ticks: number;
        /** Where it leaves the player: absent, the tile they tried from; else that tile (a river bank). */
        to?: Tile;
        /** Hitpoints a failure takes at 99 hitpoints (hpDamage there), the most when the script rolls the damage. */
        damage: number;
        /**
         * Hitpoints a failure takes at the player's hitpoints, the most when the script rolls the damage. Always
         * written at build and required by load.ts; optional in the type only because conductor tests build rolls by
         * hand without it.
         */
        hpDamage?: HpDamage;
        /**
         * With `to`, the run ticks from it back to the nearest tile the move is tried from (distance.ts
         * priceCrossings). Written at build; absent when no walk gets back, and then no distance takes the move.
         */
        back?: number;
    };
}

/**
 * A move no connector, gate or transport row describes, made by an op on a placed loc or npc (or an item op or
 * interface click done there): a `scripted` loc op move with no condition the gate scan decides, or a `teleport`
 * (an item used on a loc, an npc's op and dialogue, an item op, an interface click). Its edges go from each tile
 * of `from` to each landing, with any one of `requires`.
 */
export interface Crossing {
    via: 'scripted' | 'teleport';
    act: Act;
    /** The placed loc's or npc spawn's tile the act is done on. */
    at: Tile;
    /** The walkable tiles on land the act is done from: the loc's approach tiles, or the tiles beside the npc. */
    from: Tile[];
    /**
     * Where it lands: one tile, or a random set (an enum or dbrow of coords the script draws from), the walk going on
     * from wherever it lands.
     */
    landings: Landing[];
    /** The minimal requirement sets (requirements.ts), any one of which makes the move. */
    requires: string[][];
    /**
     * The ticks a successful move takes, its script's delays summed: a `scripted` row's (sources/gate-scan.ts
     * Path.ticks), an npc teleport's and its way back's (sources/npc-teleports.ts). Absent when a delay on the way is
     * not known offline, and on curated and other teleport rows. distance.ts prices a move by CROSSING_TICKS, not
     * these; a method leg over a random landing reads them (model/legs.ts).
     */
    ticks?: number;
    roll?: Roll;
    /** The script line that makes the move, as `file:line`. */
    source: string;
    notes?: string;
}

/** The shape world.json has; bumped when it changes, so a reader refuses a file in an older one. */
export const WORLD_FORMAT = 21;

/**
 * A curated method (methods.ts) as the build resolved it (model/method.ts): the record's own fields, then its site, the
 * site's stand, its sink sites, the levels it needs and its legs under each requirement set that walks them. No rates:
 * a page or a query computes them from a profile (model/cycle.ts), so a model fix shows without a format change.
 */
export interface WorldMethod extends MethodDef {
    /** The site `at` lies in, and its stand. */
    site: string;
    stand: Tile;
    /** The bank site of a bank sink, or of a process sink that banks at another site than its own. */
    bank?: string;
    /** A process sink's step sites, one per step: a site id, `'here'`, or a bare tile step's `tile:x,z,level`. */
    processors?: string[];
    /** The gather family's first skill. */
    skill: Skill;
    /** The lowest level at which it models with every skill of `levels` at that level (ResolvedMethod.minLevel). */
    minLevel: number;
    /** Each skill it trains, and the lowest level of it that models with the others at 99 (ResolvedMethod.levels). */
    levels: Partial<Record<Skill, number>>;
    /** One per minimal requirement set that walks every leg, shortest travel first. */
    ways: MethodWay[];
    /** The npcs where it acts, as a hazard (ResolvedMethod.npcs). */
    npcs?: NpcHazard;
}

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
    crossings: Crossing[];
    methods: WorldMethod[];
}
