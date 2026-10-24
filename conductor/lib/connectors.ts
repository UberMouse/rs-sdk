// Level connectors: the staircases, ladders and trapdoors a walk uses to change plane, as a view of the generated
// world index (lib/world-index.ts, `World.connectors`, which wiki/world/sources/connectors.ts reads from the scripts:
// each row's landing and its `source` line). The pathfinder only routes inside one plane; a walk across planes goes
// to a connector's `stand` tile, climbs it (actions/climb.ts) and goes on from its landing. Which connectors, in
// which order, is planConnectors: the climbs of the shortest way over the world index's graph (lib/walk-graph.ts).
//
// The table keeps the generated rows a walk can use (`leftOut` below says why the others are not), one per loc,
// direction and landing, and lays the curated facts the scripts do not give over them: a readable name and a hazard
// note per loc tile (OVERRIDES). A fact the scripts do give (a landing, a stand) is not curated here: correct the
// generator instead (wiki/world/README.md). test/lib/connectors.test.ts checks every row's stand and landing are
// walkable in the collision data and that each connector has its way back.
//
// A plane is a level and, at level 0, whether the tile is underground and in which underground area:
// those (UNDERGROUND_AREAS names each) are drawn at the surface's x with z + 6400 on level 0, and are separate
// planes: no stairs joins the mine to the basement, and none joins the Taverley Dungeon to the mine.
import type { Connector as Row, World } from '../../wiki/world/types';
import { type Account, NO_ACCOUNT } from './account';
import { nearestWay } from './walk-graph';
import { WORLD } from './world-index';

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
 * The underground areas, as boxes of tiles (inclusive), the first match wins: the Taverley Dungeon (m44..46_152..153,
 * which interleaves with the mine's west edge, so it is two boxes listed before the mine), the mapsquares of
 * m45..47_152..153 (the Dwarven Mine under Falador, with the Mining Guild), the Varrock Sewers, the Edgeville
 * Dungeon, m48_149 (the Wizards' Tower basement), and four quest areas, each the bounding box (plus a margin of
 * 2 tiles) of a collision flood fill from its ladder's landing: the Paterdomus mausoleum dungeon (Priest in Peril),
 * the Tree Gnome Village cellar (Golrie's), Glarial's tomb and the Waterfall dungeon with the chalice room (Waterfall
 * Quest; the dungeon is joined to the surface by scripted moves, not a ladder). A box with a `level` holds tiles of
 * that level only; one without holds every level. Other underground tiles count as one area, `u`, so the table leaves out every
 * connector into them.
 */
const UNDERGROUND_AREAS: readonly {
    id: string;
    level?: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}[] = [
    // The Taverley Dungeon (collision flood fill from the ladder's landing: x 2817..2969, z 9671..9854). Its east
    // edge (x 2944..2969, z <= 9801) lies inside the mine's box, next to a mine pocket at z >= 9806; no passage joins them.
    { id: 'taverley', minX: 2816, maxX: 2943, minZ: 9664, maxZ: 9855 },
    { id: 'taverley', minX: 2944, maxX: 2975, minZ: 9728, maxZ: 9803 },
    { id: 'mine', minX: 2880, maxX: 3071, minZ: 9728, maxZ: 9855 },
    // The Varrock Sewers, before the Edgeville Dungeon: the dungeon has no tile at x >= 3152, and the moss giant room
    // (x 3153..3221, z 9874..9908) inside the dungeon's box is a pocket of the sewers, opened by the web at (3210, 9898).
    { id: 'varrock-sewers', level: 0, minX: 3152, maxX: 3295, minZ: 9840, maxZ: 9919 },
    // The Edgeville Dungeon, including its Wilderness part north of z 9920.
    { id: 'edgeville', minX: 3072, maxX: 3199, minZ: 9792, maxZ: 9983 },
    { id: 'basement', minX: 3072, maxX: 3135, minZ: 9536, maxZ: 9599 },
    // Priest in Peril: the Paterdomus mausoleum dungeon (flood fill x 3403..3441, z 9881..9906 from the west ladder's
    // landing (3405, 9906), which also reaches the east trapdoor's landing (3440, 9887) by Drezel).
    { id: 'mausoleum', minX: 3401, maxX: 3443, minZ: 9879, maxZ: 9908 },
    // Waterfall Quest: Golrie's cellar under the Tree Gnome Village (flood fill x 2508..2552, z 9552..9584 from the
    // ladder's landing (2533, 9556)), Glarial's tomb (x 2526..2557, z 9809..9848 from the ladder (2556, 9844)) and the
    // Waterfall dungeon (x 2561..2595, z 9861..9917 from its entry (2575, 9861); the chalice room x 2599..2608,
    // z 9890..9916 is a separate pocket, its own area: only scripted moves (the statue, the Door (2604, 9900) and, from quest stage 8, the dungeon key on the Door (2566, 9901)) join it to the dungeon).
    { id: 'gnome-cellar', minX: 2506, maxX: 2554, minZ: 9550, maxZ: 9586 },
    { id: 'glarial-tomb', minX: 2524, maxX: 2559, minZ: 9807, maxZ: 9850 },
    { id: 'waterfall', minX: 2559, maxX: 2597, minZ: 9859, maxZ: 9919 },
    { id: 'waterfall-chalice', minX: 2597, maxX: 2610, minZ: 9888, maxZ: 9918 },
];

/** The plane a tile is on: its level; at level 0 underground, `u` and the area appended. */
export function planeOf(level: number, x: number, z: number): string {
    if (z < UNDERGROUND_Z) return `${level}`;
    const area = UNDERGROUND_AREAS.find(
        a => (a.level === undefined || a.level === level) && x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ,
    );
    return `${level}u${area ? `-${area.id}` : ''}`;
}
const planeAt = (t: Tile) => planeOf(t.level, t.x, t.z);
/**
 * An underground plane in no named area: one plane for many unconnected places. A walk decides by planeOf whether it
 * has arrived on its destination's plane (actions/walk.ts walkTo), so it cannot follow a climb into one of them.
 */
const lumped = (plane: string) => plane.endsWith('u');

/** The distance in tiles (Chebyshev) between two points. */
export const chebyshev = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
/** The same tile: level and coordinates. */
export const sameTile = (a: Tile, b: Tile): boolean => a.level === b.level && a.x === b.x && a.z === b.z;

/** What the table lays over a generated row: a curated name and hazard. */
export interface Override {
    name?: string;
    hazard?: string;
}

/** An override's key: the loc's tile, and the direction when it holds for one of the loc's directions only. */
const key = (level: number, x: number, z: number, direction?: 'up' | 'down') =>
    `${level},${x},${z}${direction ? ` ${direction}` : ''}`;

const SCORPIONS =
    'scorpions (combat 14, hunt players up to combat 28) 2-3 tiles from the stairs at (3056, 9778) and (3054, 9773), king scorpions (combat 32, up to combat 64) around (3040-3048, 9770-9775)';
const LESSER_DEMON =
    'a lesser demon (combat 82, hunts every player) wanders the top floor from (3110, 3157), 6 tiles from the stairs';
const TAVERLEY_DUNGEON =
    'skeletons (combat 22-25, hunt players up to combat 44-50) north of the landing, a baby blue dragon at (2892, 9799) and blue dragons at (2897, 9797) and (2899, 9802) beside it; poison spiders (combat 64, hunt range 1) in the west part';
const EDGEVILLE_DUNGEON =
    'giant spiders and skeletons roam the dungeon near the ladder; hill giants (combat 28, hunt players up to combat 55) at (3100-3114, 9827-9840)';
const VARROCK_SEWERS =
    'giant rats (combat 6, hunt players up to combat 12) at (3223, 9860), (3237, 9868) and (3239, 9864), by the ladder landing; giant spiders (combat 27, hunt up to combat 54) at (3217-3220, 9886-9889) and (combat 2) at (3219-3221, 9886) on the way to the web at (3210, 9898); zombies (combat 24, hunt up to combat 48) at (3224-3230, 9903-9906), 5-8 tiles north of that route; in the west pocket beyond the web, deadly red spiders (combat 34, hunt up to combat 68) at (3171-3186, 9883-9906) and moss giants (combat 42, hunt up to combat 84) at (3157-3167, 9878-9905)';

/**
 * The curated names and hazards, by loc tile (`level,x,z`, with ` up` or ` down` for one direction of a middle
 * floor's loc). A hazard is on both sides of a connector: the loc on each side carries it.
 */
export const OVERRIDES: ReadonlyMap<string, Override> = new Map([
    // Lumbridge castle: the staircase in the south-west tower, ground (spiralstairs) to first floor
    // (spiralstairsmiddle: Climb-up and Climb-down) to the top floor (spiralstairstop).
    [key(0, 3204, 3207), { name: 'Lumbridge castle stairs' }],
    [key(1, 3204, 3207), { name: 'Lumbridge castle stairs' }],
    [key(2, 3205, 3208), { name: 'Lumbridge castle stairs' }],
    // The Wizards' Tower: the staircase in the south-west corner of the ground floor, to the floor above and the top,
    // and its ladder down to the basement, where Sedridor is. The stairs and the ladder share one small room
    // (x 3103..3107, z 3159..3163) entered by a diagonal door at (3107, 3162) that sdk/collision-data.json does not
    // list as a door; actions/paths.ts adds it (EXTRA_DOORS), so a walk opens it.
    [key(0, 3103, 3159), { name: "Wizards' Tower stairs" }],
    [key(1, 3103, 3159), { name: "Wizards' Tower stairs" }],
    [key(1, 3103, 3159, 'up'), { hazard: LESSER_DEMON }],
    [key(2, 3104, 3160), { name: "Wizards' Tower stairs", hazard: LESSER_DEMON }],
    [key(0, 3104, 3162), { name: "Wizards' Tower ladder" }],
    [key(0, 3103, 9576), { name: "Wizards' Tower ladder" }],
    // Falador, north-east of the city: the stairs down to the Dwarven Mine (Nurmof's Pickaxe Shop).
    [key(0, 3059, 3376), { name: 'Falador mine stairs', hazard: SCORPIONS }],
    [key(0, 3059, 9776), { name: 'Falador mine stairs', hazard: SCORPIONS }],
    // Taverley, Sanfew's herb house (Druidic Ritual): spiral stairs up to the first floor.
    [key(0, 2898, 3428), { name: "Taverley Sanfew's house stairs" }],
    [key(1, 2898, 3428), { name: "Taverley Sanfew's house stairs" }],
    // Taverley, south of the village: the ladder down into the Taverley Dungeon and the ladder back.
    [key(0, 2884, 3397), { name: 'Taverley Dungeon ladder', hazard: TAVERLEY_DUNGEON }],
    [key(0, 2884, 9797), { name: 'Taverley Dungeon ladder', hazard: TAVERLEY_DUNGEON }],
    // Edgeville, in the ruined house south-west of the bank: the trapdoor (closed: "Open", then Climb-down) into the
    // Edgeville Dungeon and the ladder back. The trapdoor is reached by the opening on the house's west side.
    [key(0, 3097, 3468), { name: 'Edgeville Dungeon trapdoor', hazard: EDGEVILLE_DUNGEON }],
    [key(0, 3096, 9867), { name: 'Edgeville Dungeon trapdoor', hazard: EDGEVILLE_DUNGEON }],
    // Varrock: the manhole (closed: "Open", then "Climb down") into the Varrock Sewers and the ladder back.
    [key(0, 3237, 3458), { name: 'Varrock Sewers manhole', hazard: VARROCK_SEWERS }],
    [key(0, 3237, 9858), { name: 'Varrock Sewers manhole', hazard: VARROCK_SEWERS }],
    // Paterdomus, north of the temple: the trapdoor (closed: "Open", then Climb-down) into the mausoleum dungeon and its
    // ladder back. The temple's east trapdoor (3422, 3485), beside the Large door, lands by Drezel at (3440, 9887); the
    // way back from there is the ladder at the west end or, from quest stage 61, the holy barrier.
    [key(0, 3405, 3507), { name: 'Paterdomus mausoleum trapdoor' }],
    [key(0, 3405, 9907), { name: 'Paterdomus mausoleum ladder' }],
    [key(0, 3422, 3485), { name: 'Paterdomus temple east trapdoor' }],
    // Tree Gnome Village: the ladder down into Golrie's cellar (Waterfall Quest) and the ladder back.
    [key(0, 2533, 3155), { name: 'Tree Gnome Village cellar ladder' }],
    [key(0, 2533, 9555), { name: 'Tree Gnome Village cellar ladder' }],
    // Glarial's tomb (Waterfall Quest), entered by the pebble on the tombstone: its ladder up to (2557, 3444).
    [key(0, 2556, 9844), { name: "Glarial's tomb ladder" }],
    // Seers' Village, the spinning wheel's house (door at (2716, 3472)): the ladder to the first floor and back.
    [key(0, 2715, 3470), { name: "Seers' Village spinning house ladder" }],
    [key(1, 2715, 3470), { name: "Seers' Village spinning house ladder" }],
]);

/** A climb's op as actions/climb.ts sends it: the direction's own option, or a middle floor's plain Climb. */
const CLIMB_OP = /^((climb[- ]|walk-)(up|down)|climb)$/i;
/** The closed locs actions/climb.ts opens before it climbs them. */
export const OPENS = /trapdoor|manhole/i;

/**
 * Why a walk cannot use a generated row, or undefined when it can. actions/climb.ts sends a Climb-up or Climb-down
 * (Walk-), or Climb and answers its question, or opens a closed trapdoor or manhole first; it waits until the plane
 * changes.
 * A gate on a row's op needs no check here: the graph's edge carries its requirement (wiki/world/reach.ts).
 */
function leftOut(row: Row, world: World): string | undefined {
    if (row.direction === 'other') return 'not up or down';
    if (!row.stand) return 'no stand tile';
    const from = planeAt(row.loc);
    const to = planeAt(row.landing);
    if (from === to) return 'stays on its plane';
    if (lumped(from) || lumped(to)) return 'into an underground area planeOf does not name';
    const moving = row.thenOp ?? row;
    if (!CLIMB_OP.test(moving.opName)) return `op ${moving.opName}, which climb does not send`;
    if (row.thenOp && !(/^open$/i.test(row.opName) && OPENS.test(world.features[row.feature]?.name ?? '')))
        return `opened by ${row.opName}, and climb opens only a trapdoor or a manhole`;
    return undefined;
}

/** A generated row left out of the table, and why. */
export interface LeftOut {
    row: string;
    why: string;
}

/** The connectors of `world` a walk can use, with `overrides` laid over them, and the rows left out. */
export function connectorTable(
    world: World,
    overrides: ReadonlyMap<string, Override> = OVERRIDES,
): { connectors: Connector[]; left: LeftOut[] } {
    const areaName = new Map(world.areas.map(a => [a.id, a.name]));
    const placeOf = new Map<number, string>();
    for (const s of world.sites) {
        const place = areaName.get(s.areaPath.at(-1) ?? '');
        if (place) for (const f of s.features) placeOf.set(f, place);
    }
    const connectors: Connector[] = [];
    const left: LeftOut[] = [];
    const seen = new Set<string>();
    for (const row of world.connectors) {
        const feature = world.features[row.feature];
        const what = `${feature?.config ?? `feature ${row.feature}`} (${row.loc.x}, ${row.loc.z}) L${row.loc.level} ${row.opName}`;
        const why = leftOut(row, world);
        // The direction and stand checks narrow the row's type; leftOut has refused it already.
        if (why || row.direction === 'other' || !row.stand) {
            left.push({ row: what, why: why ?? 'not up or down' });
            continue;
        }
        // A middle floor's Climb and its Climb-up (or Climb-down) are one connector to climb.
        const { level, x, z } = row.loc;
        const once = `${key(level, x, z, row.direction)} ${row.landing.level},${row.landing.x},${row.landing.z}`;
        if (seen.has(once)) continue;
        seen.add(once);
        const o = { ...overrides.get(key(level, x, z)), ...overrides.get(key(level, x, z, row.direction)) };
        const place = placeOf.get(row.feature);
        connectors.push({
            name: o.name ?? `${feature?.name ?? 'connector'}${place ? `, ${place}` : ''}`,
            direction: row.direction,
            loc: { ...row.loc },
            stand: { ...row.stand },
            to: { ...row.landing },
            ...(o.hazard ? { hazard: o.hazard } : {}),
        });
    }
    return { connectors, left };
}

const BUILT = connectorTable(WORLD);
export const CONNECTORS: readonly Connector[] = BUILT.connectors;
/** The generated rows CONNECTORS leaves out, each with why. */
export const LEFT_OUT: readonly LeftOut[] = BUILT.left;

/** A walk chains at most this many connectors (Lumbridge ground floor to the top floor is two). */
export const MAX_HOPS = 4;

/**
 * The connectors to use, in order, to get from `from` to the plane of `to`: those of the shortest way a walk takes
 * to `to` or a tile beside it, in run ticks over the world index's graph (lib/walk-graph.ts), climbing only rows of
 * `table` and crossing only the doors `account` opens (by default only those that ask nothing). Empty when `from` is
 * already on `to`'s plane; null when no way of at most MAX_HOPS connectors leads there.
 */
export function planConnectors(
    from: Tile,
    to: Tile,
    table: readonly Connector[] = CONNECTORS,
    account: Account = NO_ACCOUNT,
): readonly Connector[] | null {
    if (planeAt(from) === planeAt(to)) return [];
    // `to` may be a loc's tile, which no step enters: a tile beside it serves, as a walk's tolerance does.
    const near: Tile[] = [to];
    for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) if (dx || dz) near.push({ level: to.level, x: to.x + dx, z: to.z + dz });
    return nearestWay(from, near, { account, connectors: table, maxHops: MAX_HOPS })?.chain ?? null;
}
