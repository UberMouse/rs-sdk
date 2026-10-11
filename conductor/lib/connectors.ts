// Level connectors: the staircases and ladders a walk uses to change plane. A curated table, because the
// pathfinder only routes inside one plane and the engine keeps each connector's landing in its scripts
// (server/content/scripts/ladders+stairs/scripts/*.rs2: `case <level>_<mx>_<mz>_<x>_<z> : p_telejump(...)`,
// where a coordinate is level_mapsquareX_mapsquareZ_localX_localZ, x = 64 * mx + localX), not in any data a
// run can read. Locs sit at the tiles of the map files (server/content/maps/*.jm2, ids in pack/loc.pack).
//
// To add one: read its loc tile and landing from those two places, and give it a `stand` tile on the
// loc's own plane (walkable, beside it: the tile the opposite connector lands on is the usual choice;
// a loc with `forceapproach` must be reached from its side). test/lib/connectors.test.ts checks every
// entry's stand and landing tiles are walkable in the collision data and that each connector has its
// way back.
//
// A plane is a level and, at level 0, whether the tile is underground and in which underground area:
// those (the Dwarven Mine, the Wizards' Tower basement) are drawn at the surface's x with z + 6400 on
// level 0, and are separate planes (UNDERGROUND_AREAS): no stairs joins the mine to the basement.

export interface Tile {
    level: number;
    x: number;
    z: number;
}

export interface Connector {
    /** What it is, for logs and messages. */
    name: string;
    direction: 'up' | 'down';
    /** The loc's tile (`NearbyLoc` x, z) and level. */
    loc: Tile;
    /** A walkable tile on the loc's plane to walk to before using it. */
    stand: Tile;
    /** Where the bot stands after using it. */
    to: Tile;
    /** A danger at the stand tile or the landing (monsters that hunt a low-level bot); walks log it, never refuse. */
    hazard?: string;
}

/** z from which a tile is underground (level 0 shifted by 6400; the surface map ends well below it). */
export const UNDERGROUND_Z = 6400;

/**
 * The underground areas, as boxes of tiles (inclusive): the mapsquares of m45..47_152..153 (the Dwarven
 * Mine under Falador, with the Mining Guild) and m48_149 (the Wizards' Tower basement). Other underground
 * tiles count as one area, `u`, that no connector here leads to.
 */
const UNDERGROUND_AREAS = [
    { id: 'mine', minX: 2880, maxX: 3071, minZ: 9728, maxZ: 9855 },
    { id: 'basement', minX: 3072, maxX: 3135, minZ: 9536, maxZ: 9599 },
] as const;

/** The plane a tile is on: its level; at level 0 underground, `u` and the area appended. */
export function planeOf(level: number, x: number, z: number): string {
    if (z < UNDERGROUND_Z) return `${level}`;
    const area = UNDERGROUND_AREAS.find(a => x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ);
    return `${level}u${area ? `-${area.id}` : ''}`;
}
const planeAt = (t: Tile) => planeOf(t.level, t.x, t.z);

const tile = (level: number, x: number, z: number): Tile => ({ level, x, z });
/** The distance in tiles (Chebyshev) between two points. */
export const chebyshev = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * A connector and the one back, as the engine pairs them: `lower` is the lower plane's side (the
 * underground one of a ladder or stairs down into a mine), `up` leaves it and `down` leaves `upper`.
 * A middle floor's loc is in two pairs (its Climb-up and its Climb-down). `hazard` is a danger at either
 * side's tile (both directions carry it).
 */
const pair = (
    name: string,
    lower: { loc: Tile; stand: Tile },
    upper: { loc: Tile; stand: Tile },
    hazard?: string,
): Connector[] => [
    { name, direction: 'up', loc: lower.loc, stand: lower.stand, to: upper.stand, hazard },
    { name, direction: 'down', loc: upper.loc, stand: upper.stand, to: lower.stand, hazard },
];

// Lumbridge castle: the staircase in the south-west tower, ground (spiralstairs) to first floor
// (spiralstairsmiddle: Climb-up and Climb-down) to the top floor (spiralstairstop).
const LUMBRIDGE_STAIRS = tile(0, 3204, 3207);
const LUMBRIDGE_LANDING = { x: 3205, z: 3209 };
// The Wizards' Tower: the staircase in the south-west corner of the ground floor, to the floor above
// (middle) and the top. Its ladder (wizards_tower_laddertop) goes down to the basement, where Sedridor is.
// The stairs and the ladder share one small room (x 3103..3107, z 3159..3163) entered by a diagonal door at
// (3107, 3162) that sdk/collision-data.json does not list, so the pathfinder finds no route into the room
// from outside (a walk there ends `no-path`); from inside it, or after the basement, the connectors work.
const TOWER_LANDING = { x: 3105, z: 3160 };

export const CONNECTORS: readonly Connector[] = [
    // Lumbridge castle, ground floor <-> first floor <-> second floor.
    ...pair(
        'Lumbridge castle stairs',
        { loc: LUMBRIDGE_STAIRS, stand: tile(0, LUMBRIDGE_LANDING.x, LUMBRIDGE_LANDING.z) },
        { loc: { ...LUMBRIDGE_STAIRS, level: 1 }, stand: tile(1, LUMBRIDGE_LANDING.x, LUMBRIDGE_LANDING.z) },
    ),
    ...pair(
        'Lumbridge castle stairs',
        { loc: { ...LUMBRIDGE_STAIRS, level: 1 }, stand: tile(1, LUMBRIDGE_LANDING.x, LUMBRIDGE_LANDING.z) },
        { loc: tile(2, 3205, 3208), stand: tile(2, LUMBRIDGE_LANDING.x, LUMBRIDGE_LANDING.z) },
    ),

    // Wizards' Tower, ground floor <-> first floor <-> top floor.
    ...pair(
        "Wizards' Tower stairs",
        { loc: tile(0, 3103, 3159), stand: tile(0, TOWER_LANDING.x, TOWER_LANDING.z) },
        { loc: tile(1, 3103, 3159), stand: tile(1, TOWER_LANDING.x, TOWER_LANDING.z) },
    ),
    ...pair(
        "Wizards' Tower stairs",
        { loc: tile(1, 3103, 3159), stand: tile(1, TOWER_LANDING.x, TOWER_LANDING.z) },
        { loc: tile(2, 3104, 3160), stand: tile(2, 3104, 3161) },
        'a lesser demon (combat 82, hunts every player) wanders the top floor from (3110, 3157), 6 tiles from the stairs',
    ),
    // Wizards' Tower ground floor <-> basement (Rune Mysteries: Sedridor).
    ...pair(
        "Wizards' Tower ladder",
        { loc: tile(0, 3103, 9576), stand: tile(0, 3104, 9576) },
        { loc: tile(0, 3104, 3162), stand: tile(0, 3105, 3162) },
    ),

    // Falador, north-east of the city: the stairs down to the Dwarven Mine (Nurmof's Pickaxe Shop).
    ...pair(
        'Falador mine stairs',
        { loc: tile(0, 3059, 9776), stand: tile(0, 3058, 9776) },
        { loc: tile(0, 3059, 3376), stand: tile(0, 3062, 3376) },
        'scorpions (combat 14, hunt players up to combat 28) 2-3 tiles from the stairs at (3056, 9778) and (3054, 9773), king scorpions (combat 32, up to combat 64) around (3040-3048, 9770-9775)',
    ),
];

/** A walk chains at most this many connectors (Lumbridge ground floor to the top floor is two). */
export const MAX_HOPS = 4;
/**
 * An upper floor (level 1 and up) is one building's, not the whole map's: its connectors are only
 * reachable from a tile this close to them (the largest castle here is about 30 tiles across).
 */
const UPPER_FLOOR_REACH = 40;
/** Cost of using a connector, in tiles of walking: the climb's ticks and a little reluctance. */
const CONNECTOR_COST = 10;

/**
 * The connectors to use, in order, to get from `from` to the plane of `to`: the cheapest chain by
 * walking distance (each leg a straight line, as the pathfinder's routes are unknown here). Empty
 * when `from` is already on `to`'s plane; null when no chain of at most MAX_HOPS connectors leads
 * there.
 */
export function planConnectors(
    from: Tile,
    to: Tile,
    table: readonly Connector[] = CONNECTORS,
): readonly Connector[] | null {
    const goal = planeAt(to);
    interface Plan {
        cost: number;
        chain: readonly Connector[];
    }
    // The cheapest plan from `at`, having spent `cost` along `chain`.
    const search = (at: Tile, cost: number, chain: readonly Connector[]): Plan | null => {
        if (planeAt(at) === goal) {
            // A connector lands on a whole plane, but an upper floor is one building's: the destination
            // must be near where the chain lands, else no connector serves it.
            if (chain.length > 0 && to.level > 0 && chebyshev(at, to) > UPPER_FLOOR_REACH) return null;
            return { cost: cost + chebyshev(at, to), chain };
        }
        if (chain.length >= MAX_HOPS) return null;
        let best: Plan | null = null;
        for (const c of table) {
            if (chain.includes(c) || planeAt(c.loc) !== planeAt(at)) continue;
            if (at.level > 0 && chebyshev(at, c.stand) > UPPER_FLOOR_REACH) continue;
            const found = search(c.to, cost + chebyshev(at, c.stand) + CONNECTOR_COST, [...chain, c]);
            if (found && (!best || found.cost < best.cost)) best = found;
        }
        return best;
    };
    return search(from, 0, [])?.chain ?? null;
}
