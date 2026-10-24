// The world index's travel graph (wiki/world/reach.ts reachGraph, the graph wiki/world/distance.ts walks) as the walker
// can use it: the shortest way in run ticks from where a bot stands to the nearest of some tiles, with the
// connectors it climbs and the moves it crosses on the way. actions/walk.ts plans its walks with it (planWay),
// lib/connectors.ts its climbs and lib/banks.ts finds the nearest bank.
//
// A walk crosses only what actions/walk.ts, actions/climb.ts and actions/cross.ts do:
//
// - a neighbour step the collision allows (the gated doors walled, as reach.ts walls them);
// - a gated door (a wall row of World.gates) the walker opens, when the account meets its requirement: one whose
//   checked op is the Open the walk sends (guild doors), or the Al Kharid toll gate it pays (doorRefusal);
// - a connector edge, when it is one of the table's rows (lib/connectors.ts CONNECTORS: the rows climb can use),
//   at most `maxHops` of them;
// - a move (Move): a crossing row's (World.crossings: a scripted move, a teleport), or a gate row's that is not a
//   door the walker opens (a jump, a door crossed by another op than Open, a rolled door), when the account meets
//   its requirement and moveRefusal (a gate row's) or crossingRefusal (a crossing row's) does not refuse the row;
//   actions/cross.ts makes it;
// - an opened loc's tiles (Gate.opens), when the account meets its requirement.
//
// Not a tile in the Wilderness, unless the way starts or ends there (actions/walk.ts refuses such a route), and not a
// transport (no walk takes a ship or a cart). The tick model is distance.ts's: half a tick a step, CROSSING_TICKS a
// crossing plus its landing's spread (a random landing at its longest), a roll's expected ticks at the bot's current
// level (crossingTicks: failures and the way back to try again included), summed in half ticks and rounded up once.
// A rolled move whose failure takes as many hitpoints as the bot has left is not taken.
//
// The graph is built on the first search, not at import (about a second: the loc configs from server/content, the
// tile index; each tile's steps are read from the collision the first time a search reaches it). A search keeps one
// label per tile (its shortest way, and of equally short ones the first found), so a way that would need more than
// `maxHops` connectors can hide a longer one with fewer; a coin requirement is checked per crossing, not summed
// along the way.
import { reachCollision } from '../../wiki/world/collision';
import { CROSSING_TICKS, crossingTicks, halfTicks } from '../../wiki/world/distance';
import { locSizes } from '../../wiki/world/place';
import {
    type Edge,
    IntList,
    reachGraph,
    STEPS,
    wallTiles,
    type ReachCollision,
    type ReachGraph,
    type ReachInput,
    WALL_SHAPES,
} from '../../wiki/world/reach';
import { CAME_FROM, minimalSets } from '../../wiki/world/requirements';
import { readConfigs } from '../../wiki/world/sources/configs';
import type { Act, Crossing, Gate, Roll } from '../../wiki/world/types';
import { isTollGate } from '../actions/toll';
import { type Account, currentLevel, meetsSet } from './account';
import { type Connector, sameTile, type Tile } from './connectors';
import { isInWilderness } from './wilderness';
import { WORLD } from './world-index';

/** No way yet. */
const INF = 0x7fffffff;
/** Half ticks in a tick: a run step is one. */
const HALVES = 2;
/** A new account's hitpoints: the damage rule's floor when the account does not say. */
const BASE_HITPOINTS = 10;
const wild = (t: Tile): boolean => isInWilderness(t.level, t.x, t.z);
/** A key for the edge from tile index a to b (indexes are below 2^24). */
const pair = (a: number, b: number): number => a * 0x1000000 + b;
/** A requirement's alternatives (set ids) as one string; `''` for none asked (`[[]]`, a door's free side). */
const sig = (graph: ReachGraph, alts: readonly number[]): string =>
    alts
        .map(id => graph.sets.strings(id).join('\n'))
        .sort()
        .join('\0');

/** The op actions/walk.ts sends on a closed door (its `OPEN`); actions/toll.ts handles the Al Kharid toll gate. */
const WALKER_OPENS = /^open$/i;
/** A trigger an op on the loc runs (`oploc1,x`), and its op; a use-item trigger (`oplocu`) has none. */
const triggerOp = (trigger: string): number | undefined => {
    const op = /^(?:op|ap)loc([1-5]),/.exec(trigger)?.[1];
    return op === undefined ? undefined : Number(op);
};
const pays = (g: Gate): boolean => g.requires.some(set => set.some(r => /^(coins|consume):/.test(r)));

/**
 * Doors whose Open the walker sends but whose script then needs what a walk does not do, by loc config: answering a
 * choice (the walker's dialog guard answers no choice).
 */
export const NOT_WALKER_DOORS: ReadonlyMap<string, string> = new Map([
    ['lgstrengthtrialgater', 'asks to force the doors (quests/quest_legends/scripts/quest_legends.rs2:466)'],
    ['lgstrengthtrialgatel', 'asks to force the doors (quests/quest_legends/scripts/quest_legends.rs2:466)'],
]);

/**
 * Key doors the walker crosses by using the key on them (an `oplocu` trigger, which no `Open` reaches), as
 * `<loc config>@<x>,<z>`: those whose script opens the door and walks the player through to its other side. A key door
 * that moves the player elsewhere is a crossing row (wiki/world/gates.ts CURATED_CROSSINGS), not listed here. The
 * waterfall dungeon's Door (2568, 9893), south of the pillar room's corridor, is a plain pass
 * (quest_waterfall.rs2:393-407; walked through with the A key on the worker conductor3w2, 2026-10-24, landing on the
 * door's own tile when used from the north). Only that north-to-south use was observed in play; the script has no
 * side check, so the reverse edge follows from it. Its other Doors move the player (:389, :401, :405).
 */
const KEY_DOORS: ReadonlySet<string> = new Set(['baxtorian_door_2_waterfall_quest@2568,9893']);
/** The one obj a gate row asks to be held, when that is all it asks. */
const keyOf = (g: Gate): string | undefined => {
    const [only, ...rest] = g.requires;
    const held = only?.length === 1 ? /^item:([a-z0-9_]+):held$/.exec(only[0]!) : null;
    return rest.length ? undefined : held?.[1];
};

/**
 * Why a walk does not cross a gated door row (World.gates, a wall with no `to`) by opening it, or undefined when it
 * does: the walker sends Open (actions/walk.ts openDoorAt) and pays only the Al Kharid toll (actions/toll.ts).
 * `opName` is the loc config's name for an op (`op1=Open`). A door it does not open may still be a move
 * (moveRefusal).
 */
export function doorRefusal(g: Gate, opName: (loc: string, op: number) => string | undefined): string | undefined {
    if (isTollGate(g.tile)) return undefined;
    const op = triggerOp(g.trigger);
    if (!op) return `a ${g.trigger.split(',')[0]} trigger (an item used on it)`;
    const name = opName(g.loc, op);
    if (!name || !WALKER_OPENS.test(name)) return `op ${name ?? op}, not Open`;
    if (pays(g)) return 'a payment other than the toll';
    return NOT_WALKER_DOORS.get(g.loc);
}

/**
 * Why actions/cross.ts does not make a gate row's move (a jump, or a door the walker does not open), or undefined
 * when it does: it sends the trigger's op on the loc and answers the row's choices (Gate.act). A use-item trigger
 * names no obj, and a payment is asked in dialogue, which only a row with choices answers.
 */
export function moveRefusal(g: Gate): string | undefined {
    if (g.kind !== 'gate') return 'a quest window';
    if (triggerOp(g.trigger) === undefined) return `a ${g.trigger.split(',')[0]} trigger (an item used on it)`;
    if (pays(g) && !g.act?.choices?.length) return 'a payment asked in a dialogue the row has no choices for';
    return NOT_WALKER_DOORS.get(g.loc);
}

/**
 * Why actions/cross.ts does not make a crossing row's move (World.crossings), or undefined when it does: it sends the
 * act and answers its choices, and an interface click (a gnome glider's button) is sent with nothing opening the
 * interface first, as the row names no op that does (the glider map opens from the pilot's dialogue).
 */
export function crossingRefusal(c: Pick<Crossing, 'act'>): string | undefined {
    if (c.act.kind === 'interface')
        return `an interface click (${c.act.component}) on an interface no op of the row opens`;
    return undefined;
}

/**
 * A move the walker makes with actions/cross.ts: a crossing row's, or a gate row's (moveRefusal), from one tile to
 * one of `landings`.
 */
export interface Move {
    via: 'scripted' | 'teleport' | 'gate';
    act: Act;
    /** The loc's or npc's tile the act is done on. */
    at: Tile;
    /** Every tile it may land on from where it is made: a random landing's set, or the one tile. */
    landings: readonly Tile[];
    roll?: Roll;
    /** The script line that makes the move, as `file:line`. */
    source: string;
}

/** A move and the requirements (`sig`) of the edges it makes; for a gate's jump, how far from its loc it is made. */
interface MoveEdge {
    sigs: ReadonlySet<string>;
    move: Move;
}
interface JumpEdge extends MoveEdge {
    reach: number;
}

/** The walker's graph of a world (walkGraph), and the search's arrays. */
export interface WalkGraph {
    graph: ReachGraph;
    /**
     * The door edges the walker crosses, both ways across a wall: by `pair`, the requirement alternatives (`sig`) of
     * each row on it the walker opens, and `''` for the free side.
     */
    doors: ReadonlyMap<number, ReadonlySet<string>>;
    /** The moves of crossing rows, gate doors and gate landings, by `pair` of their edge. */
    moves: ReadonlyMap<number, readonly MoveEdge[]>;
    /** The moves of gate rows with a `to`, by landing tile: their edges go from every approach tile of the loc. */
    jumps: ReadonlyMap<number, readonly JumpEdge[]>;
    /** The objs a requirement of the graph names (`item:<obj>:held`, `consume:<obj>:<n>`): what a bank may supply. */
    bankable: readonly string[];
    /** The `other:came from <npc>` tokens a requirement of the graph names: the npcs whose moves a walk records. */
    cameFrom: ReadonlySet<string>;
    /** Per tile: half ticks of the way found, connectors climbed on it, its chain node; reset after each search. */
    dist: Int32Array;
    hops: Uint8Array;
    node: Int32Array;
    /** Each connector table's connector edges (connectorEdges), by table. */
    climbs: WeakMap<readonly Connector[], Map<number, number>>;
    /** Each alternatives list's `sig`, by list (reach.ts interns one list per requirement). */
    sigs: WeakMap<readonly number[], string>;
}

let built: WalkGraph | undefined;

/** The world index's walk graph, built on the first call. */
export function worldGraph(): WalkGraph {
    if (built) return built;
    const configs = readConfigs('loc');
    built = walkGraph({
        world: WORLD,
        collision: reachCollision,
        size: locSizes(configs),
        opName: (loc, op) => configs.get(loc)?.[`op${op}`]?.[0],
    });
    return built;
}

/**
 * The walk graph of `world` over `collision` (the world index's for nearestWay; a scripted one in a test), `opName`
 * naming a loc config's op as doorRefusal reads it.
 */
export function walkGraph(input: {
    world: ReachInput['world'];
    collision: ReachCollision;
    size: ReachInput['size'];
    opName: (loc: string, op: number) => string | undefined;
}): WalkGraph {
    const { world, collision, size, opName } = input;
    const graph = reachGraph({ world, collision, size });
    const { index } = graph;
    const at = (t: Tile) => index.of(t.level, t.x, t.z);
    // As reach.ts interns a row's requirement (`alternatives`): its minimal sets, `members` met.
    const sigOf = (requires: readonly (readonly string[])[]): string =>
        sig(
            graph,
            minimalSets(
                requires.map(set => set.filter(r => r !== 'members')),
                graph.quests,
            ).map(s => graph.sets.intern(s)),
        );
    const doors = new Map<number, Set<string>>();
    const moves = new Map<number, MoveEdge[]>();
    const jumps = new Map<number, JumpEdge[]>();
    const addMove = (from: Tile, to: Tile, sigs: ReadonlySet<string>, move: Move) => {
        const [a, b] = [at(from), at(to)];
        if (a < 0 || b < 0) return;
        const p = pair(a, b);
        moves.set(p, [...(moves.get(p) ?? []), { sigs, move }]);
    };
    for (const g of world.gates) {
        if (g.kind !== 'gate') continue;
        const door = WALL_SHAPES.has(g.shape) && !g.to;
        const gated = sigOf(g.requires);
        const key = door && KEY_DOORS.has(`${g.loc}@${g.tile.x},${g.tile.z}`) ? keyOf(g) : undefined;
        if (key) {
            // The key used on the door walks the player through: an edge each way; as with an ordinary door, the edges carry the row's
            // requirement (the key held) on the checked side and none on the other.
            const tiles = wallTiles(g);
            if (!tiles) continue;
            const act: Act = { kind: 'item-on-loc', obj: key, loc: g.loc };
            const cross = (landing: Tile): Move => ({
                via: 'gate',
                act,
                at: g.tile,
                landings: [landing],
                source: g.source,
            });
            const sigs = new Set([gated, '']);
            addMove(tiles[0], tiles[1], sigs, cross(tiles[1]));
            addMove(tiles[1], tiles[0], sigs, cross(tiles[0]));
            continue;
        }
        if (door && !g.roll && !doorRefusal(g, opName)) {
            const tiles = wallTiles(g);
            if (!tiles) continue;
            const [a, b] = tiles.map(at) as [number, number];
            if (a < 0 || b < 0) continue;
            for (const p of [pair(a, b), pair(b, a)]) {
                const sigs = doors.get(p) ?? new Set<string>();
                doors.set(p, sigs.add(gated).add(''));
            }
            continue;
        }
        const op = triggerOp(g.trigger);
        if (op === undefined || moveRefusal(g)) continue;
        // The checked side's edges carry the row's requirement, the other side's none (reach.ts).
        const sigs = new Set([gated, '']);
        const move = (landings: readonly Tile[]): Move => ({
            via: 'gate',
            act: g.act ?? { kind: 'loc-op', loc: g.loc, op },
            at: g.tile,
            landings,
            ...(g.roll && { roll: g.roll }),
            source: g.source,
        });
        if (door) {
            const tiles = wallTiles(g);
            if (!tiles) continue;
            addMove(tiles[0], tiles[1], sigs, move([tiles[1]]));
            addMove(tiles[1], tiles[0], sigs, move([tiles[0]]));
        } else if (g.to) {
            const t = at(g.to);
            // The loc's approach tiles are beside its footprint (reach.ts approach), at most its longer side away.
            if (t >= 0)
                jumps.set(t, [
                    ...(jumps.get(t) ?? []),
                    { sigs, move: move([g.to]), reach: Math.max(g.width ?? 1, g.length ?? 1) + 1 },
                ]);
        } else if (g.landings) {
            for (const l of g.landings) {
                const from = g.landings.filter(o => sameTile(o.stand, l.stand)).map(o => o.landing);
                addMove(l.stand, l.landing, sigs, move(from));
            }
        }
    }
    for (const c of world.crossings ?? []) {
        if (!c.requires.length || crossingRefusal(c)) continue;
        const sigs = new Set([sigOf(c.requires)]);
        const move: Move = {
            via: c.via,
            act: c.act,
            at: c.at,
            landings: c.landings.map(l => l.tile),
            ...(c.roll && { roll: c.roll }),
            source: c.source,
        };
        for (const from of c.from) for (const l of c.landings) addMove(from, l.tile, sigs, move);
    }
    const bankable = new Set<string>();
    const cameFrom = new Set<string>();
    for (let id = 0; id < graph.sets.count; id++)
        for (const r of graph.sets.strings(id)) {
            const obj = /^(?:item:([a-z0-9_]+):held|consume:([a-z0-9_]+):\d+)$/.exec(r);
            if (obj) bankable.add(obj[1] ?? obj[2]!);
            if (r.startsWith(CAME_FROM)) cameFrom.add(r);
        }
    return {
        graph,
        doors,
        moves,
        jumps,
        bankable: [...bankable].sort(),
        cameFrom,
        dist: new Int32Array(index.size).fill(INF),
        hops: new Uint8Array(index.size),
        node: new Int32Array(index.size),
        climbs: new WeakMap(),
        sigs: new WeakMap(),
    };
}

/**
 * Which row of `table` each connector edge of the graph is: the row that lands where the edge does, with its loc on
 * the edge's level and nearest the edge's source (a loc's approach tiles are beside its footprint, at most a few
 * tiles from its own tile). An edge no row lands on is a connector the table left out.
 */
function connectorEdges(b: WalkGraph, table: readonly Connector[]): Map<number, number> {
    let m = b.climbs.get(table);
    if (m) return m;
    m = new Map();
    const { index, edgeFrom } = b.graph;
    const landing = new Map<number, number[]>();
    table.forEach((c, i) => {
        const t = index.of(c.to.level, c.to.x, c.to.z);
        if (t >= 0) landing.set(t, [...(landing.get(t) ?? []), i]);
    });
    /** The farthest an approach tile is from its loc's own tile: a 3x3 loc's far side and the tile past it. */
    const APPROACH = 4;
    for (const [from, out] of edgeFrom)
        for (const e of out) {
            if (e.via !== 'connector') continue;
            const [level, x, z] = [index.level(from), index.x(from), index.z(from)];
            let best = -1;
            let gap = APPROACH + 1;
            for (const i of landing.get(e.to) ?? []) {
                const c = table[i]!;
                const d = Math.max(Math.abs(c.loc.x - x), Math.abs(c.loc.z - z));
                if (c.loc.level === level && d < gap) [best, gap] = [i, d];
            }
            if (best >= 0) m.set(pair(from, e.to), best);
        }
    b.climbs.set(table, m);
    return m;
}

/** The move an edge from tile index `from` makes, or undefined when it is no move the walker makes. */
function moveOf(b: WalkGraph, from: number, e: Edge): Move | undefined {
    let s = b.sigs.get(e.alts);
    if (s === undefined) b.sigs.set(e.alts, (s = sig(b.graph, e.alts)));
    const key = s;
    const exact = b.moves.get(pair(from, e.to))?.find(m => m.sigs.has(key));
    if (exact) return exact.move;
    if (e.via !== 'gate') return undefined;
    const { index } = b.graph;
    const [level, x, z] = [index.level(from), index.x(from), index.z(from)];
    return b.jumps
        .get(e.to)
        ?.find(
            j =>
                j.sigs.has(key) &&
                j.move.at.level === level &&
                Math.max(Math.abs(j.move.at.x - x), Math.abs(j.move.at.z - z)) <= j.reach,
        )?.move;
}

/** What a walk plans over (actions/walk.ts): the graph, the connectors it climbs, the banks a detour may go to. */
export interface WalkWorld {
    graph: WalkGraph;
    connectors: readonly Connector[];
    /** Each bank's stand tile and the requirement sets that get a walk there (lib/banks.ts BankSite). */
    banks: readonly { stand: Tile; reach: readonly (readonly string[])[] }[];
}

/** One crossing of a way, with the alternatives of its edge (any one of which crosses it). */
export type Hop = { requires: readonly (readonly string[])[] } & (
    | { kind: 'climb'; connector: Connector }
    | { kind: 'cross'; move: Move; stand: Tile; landing: Tile }
    | { kind: 'door'; stand: Tile; landing: Tile }
    | {
          kind: 'bank';
          /** The bank's stand tile, to walk to. */
          stand: Tile;
          /** The objs to withdraw there, by config name, for the crossings after it. */
          withdraw: { obj: string; count: number }[];
      }
);

/** The nearest of a search's targets, the run ticks to it, and what is crossed on the way, in order. */
export interface Way {
    /** Its index in `targets`. */
    target: number;
    runTicks: number;
    /** The connectors climbed. */
    chain: Connector[];
    /** The doors, connectors and moves crossed (and for planWay, a bank detour's withdrawal). */
    hops: Hop[];
}

export interface WalkSearch {
    /** What the account meets decides which doors, connectors and moves the way may cross. */
    account: Account;
    /** The connectors the way may climb. */
    connectors: readonly Connector[];
    /** At most this many of them. */
    maxHops: number;
    /** The graph searched: the world index's (worldGraph) by default. */
    graph?: WalkGraph;
    /** Moves the way may not make (ones a walk has given up on). */
    avoid?: (m: Move) => boolean;
}

/** The hitpoints the account has left: its current level, else its base level, else a new account's. */
const hitpointsLeft = (a: Account): number => a.current?.hitpoints ?? a.levels.hitpoints ?? BASE_HITPOINTS;

/**
 * The shortest way a walk takes from `from` to the nearest of `targets` (a target off the graph is never reached),
 * or undefined when none is reached. The first target in `targets` wins a tie on one tile.
 */
export function nearestWay(from: Tile, targets: readonly Tile[], opts: WalkSearch): Way | undefined {
    const b = opts.graph ?? worldGraph();
    const { graph, doors, dist, hops, node } = b;
    const { index, sets, edgeFrom, openAlts, stepMask } = graph;
    const start = index.of(from.level, from.x, from.z);
    if (start < 0) return undefined;
    const goal = new Map<number, number>();
    targets.forEach((t, k) => {
        const i = index.of(t.level, t.x, t.z);
        if (i >= 0 && !goal.has(i)) goal.set(i, k);
    });
    if (!goal.size) return undefined;
    const { account } = opts;
    const climbs = connectorEdges(b, opts.connectors);
    const metCache = new Map<number, boolean>();
    const met = (alts: readonly number[]): boolean =>
        alts.some(id => {
            let ok = metCache.get(id);
            if (ok === undefined) metCache.set(id, (ok = meetsSet(account, sets.strings(id))));
            return ok;
        });
    const hitpoints = hitpointsLeft(account);
    /** A move's half ticks at the account's level, or undefined when the walk does not make it. */
    const moveHalf = (m: Move, e: Edge): number | undefined => {
        if (opts.avoid?.(m)) return undefined;
        if (m.roll && m.roll.fail.damage > 0 && m.roll.fail.damage >= hitpoints) return undefined;
        const ticks = crossingTicks(e, m.roll && currentLevel(account, m.roll.stat));
        return ticks === undefined ? undefined : halfTicks(ticks);
    };
    const gateHalf = CROSSING_TICKS.gate * HALVES;
    // A walk to somewhere outside the Wilderness never routes through it unless it starts inside (actions/walk.ts).
    const tame = !wild(from) && !targets.some(wild);
    // Chain nodes: the edge crossed, the tile it was crossed from, the connector row or move it is, and the node
    // before it (-1 for none).
    const nodeEdge: Edge[] = [];
    const nodeFrom: number[] = [];
    const nodeWhat: (number | Move | null)[] = [];
    const nodeUp: number[] = [];
    const touched = new IntList();
    const buckets: (IntList | undefined)[] = [];
    let queued = 0;

    /** Offers tile j a way of `half` half ticks, `h` climbs and chain node `n`, from tile i (-1 for none). */
    const enter = (i: number, j: number, half: number, h: number, n: number) => {
        if (tame && isInWilderness(index.level(j), index.x(j), index.z(j))) return;
        const opens = openAlts.get(j);
        if (opens) {
            if (!met(opens)) return;
            if (i >= 0 && !openAlts.has(i)) half += gateHalf;
        }
        if (half >= dist[j]!) return;
        if (dist[j] === INF) touched.push(j);
        dist[j] = half;
        hops[j] = h;
        node[j] = n;
        (buckets[half] ??= new IntList()).push(j);
        queued++;
    };
    /** A chain node for edge `e` from tile `i`, after node `n`. */
    const chained = (i: number, e: Edge, what: number | Move | null, n: number): number => {
        nodeEdge.push(e);
        nodeFrom.push(i);
        nodeWhat.push(what);
        nodeUp.push(n);
        return nodeEdge.length - 1;
    };
    const hopOf = (k: number): Hop => {
        const [e, what] = [nodeEdge[k]!, nodeWhat[k]];
        const requires = e.alts.map(id => sets.strings(id));
        const [stand, landing] = [index.tile(nodeFrom[k]!), index.tile(e.to)];
        if (typeof what === 'number') return { kind: 'climb', connector: opts.connectors[what]!, requires };
        if (what) return { kind: 'cross', move: what, stand, landing, requires };
        return { kind: 'door', stand, landing, requires };
    };

    try {
        return graph.within(() => {
            enter(-1, start, 0, 0, -1);
            for (let d = 0; queued > 0; d++) {
                const bucket = buckets[d];
                if (!bucket) continue;
                for (let k = 0; k < bucket.length; k++) {
                    const i = bucket.data[k]!;
                    queued--;
                    if (dist[i] !== d) continue;
                    const target = goal.get(i);
                    if (target !== undefined) {
                        const way: Hop[] = [];
                        for (let n = node[i]!; n >= 0; n = nodeUp[n]!) way.unshift(hopOf(n));
                        const chain = way.flatMap(h => (h.kind === 'climb' ? [h.connector] : []));
                        return { target, runTicks: Math.ceil(d / HALVES), chain, hops: way };
                    }
                    const [level, x, z, h, n] = [index.level(i), index.x(i), index.z(i), hops[i]!, node[i]!];
                    const steps = stepMask(i);
                    for (let bit = 0; bit < 8; bit++) {
                        if (!(steps & (1 << bit))) continue;
                        const [dx, dz] = STEPS[bit]!;
                        enter(i, index.of(level, x + dx, z + dz), d + 1, h, n);
                    }
                    for (const e of edgeFrom.get(i) ?? []) {
                        if (e.via === 'connector') {
                            const row = climbs.get(pair(i, e.to));
                            if (row === undefined || h >= opts.maxHops || !met(e.alts)) continue;
                            enter(i, e.to, d + CROSSING_TICKS.connector * HALVES, h + 1, chained(i, e, row, n));
                            continue;
                        }
                        if (e.via === 'gate' && doors.get(pair(i, e.to))?.has(sig(graph, e.alts))) {
                            if (met(e.alts)) enter(i, e.to, d + gateHalf, h, chained(i, e, null, n));
                            continue;
                        }
                        if (e.via !== 'gate' && e.via !== 'scripted' && e.via !== 'teleport') continue;
                        const move = moveOf(b, i, e);
                        if (!move || !met(e.alts)) continue;
                        const half = moveHalf(move, e);
                        if (half !== undefined) enter(i, e.to, d + half, h, chained(i, e, move, n));
                    }
                }
                bucket.length = 0;
            }
            return undefined;
        });
    } finally {
        for (let k = 0; k < touched.length; k++) dist[touched.data[k]!] = INF;
    }
}

/**
 * The ticks a bank detour spends at the bank, an estimate: the booth's op once the walk is there and the bank
 * interface opening (actions/bank.ts openBank), a withdrawal, the close.
 */
export const BANK_DETOUR_TICKS = 4;

/** What a bank detour may draw on (planWay). */
export interface Detour {
    /** The bank's count of an obj (by config name) as last seen open; 0 for one the record does not list. */
    bank(obj: string): number;
    /** The banks a detour may go to, by stand tile. */
    banks: readonly Tile[];
    /** Free inventory slots: an obj not carried yet needs one (a stackable one carried adds to its stack). */
    free: number;
    /** Whether an obj (by config name) stacks. */
    stackable(obj: string): boolean;
}

/**
 * The way a walk takes from `from` to the nearest of `targets` (nearestWay), or one that goes first to a bank for objs
 * a crossing needs that the bot does not carry: to the bank nearest `from`, BANK_DETOUR_TICKS there, then on with the
 * objs, when that total is shorter. An obj a detour withdraws is one `detour.bank` counts above none, and there is a
 * free slot for it or a stack to add to. Its `hops` then hold a `bank` hop naming what to withdraw, after the
 * crossings that get the walk to the bank.
 */
export function planWay(from: Tile, targets: readonly Tile[], opts: WalkSearch & { detour?: Detour }): Way | undefined {
    const plain = nearestWay(from, targets, opts);
    const { detour, account } = opts;
    if (!detour) return plain;
    const b = opts.graph ?? worldGraph();
    const held = new Map(account.held ?? []);
    let coins = account.coins;
    let free = detour.free;
    let added = false;
    for (const obj of ['coins', ...b.bankable]) {
        const count = detour.bank(obj);
        if (count <= 0) continue;
        const carried = obj === 'coins' ? coins : (held.get(obj) ?? 0);
        if (!(carried > 0 && detour.stackable(obj))) {
            if (free <= 0) continue;
            free--;
        }
        if (obj === 'coins') coins += count;
        else held.set(obj, carried + count);
        added = true;
    }
    if (!added) return plain;
    const rich: Account = { ...account, held, coins };
    // The way with the objs from here is the shortest a detour could be: no shorter, no detour.
    const best = nearestWay(from, targets, { ...opts, account: rich });
    if (!best || (plain && best.runTicks >= plain.runTicks)) return plain;
    const toBank = nearestWay(from, detour.banks, opts);
    if (!toBank) return plain;
    const bank = detour.banks[toBank.target]!;
    const onward = nearestWay(bank, targets, { ...opts, account: rich });
    if (!onward) return plain;
    const total = toBank.runTicks + BANK_DETOUR_TICKS + onward.runTicks;
    if (plain && plain.runTicks <= total) return plain;
    // What the way on needs of each obj: the most one crossing asks to be held, and what the crossings spend (consume,
    // coins) summed; less what the bot carries.
    const kept = new Map<string, number>();
    const spent = new Map<string, number>();
    for (const hop of onward.hops) {
        if (hop.requires.some(set => meetsSet(account, set))) continue;
        const set = hop.requires.find(s => meetsSet(rich, s));
        for (const r of set ?? []) {
            const m = /^(?:item:([a-z0-9_]+):held|consume:([a-z0-9_]+):(\d+)|coins:(\d+))$/.exec(r);
            if (!m) continue;
            if (m[1]) kept.set(m[1], 1);
            else if (m[4]) spent.set('coins', (spent.get('coins') ?? 0) + Number(m[4]));
            else spent.set(m[2]!, (spent.get(m[2]!) ?? 0) + Number(m[3]));
        }
    }
    const withdraw: { obj: string; count: number }[] = [];
    for (const obj of new Set([...kept.keys(), ...spent.keys()])) {
        const carried = obj === 'coins' ? account.coins : (account.held?.get(obj) ?? 0);
        const count = Math.max(kept.get(obj) ?? 0, spent.get(obj) ?? 0) - carried;
        if (count > 0) withdraw.push({ obj, count });
    }
    if (!withdraw.length) return plain;
    return {
        target: onward.target,
        runTicks: total,
        chain: [...toBank.chain, ...onward.chain],
        hops: [
            ...toBank.hops,
            {
                kind: 'bank',
                stand: bank,
                withdraw,
                requires: [[]],
            },
            ...onward.hops,
        ],
    };
}
