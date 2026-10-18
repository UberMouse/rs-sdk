// The world index's travel graph (wiki/world/reach.ts reachGraph, the graph Task 5's distances walk) as the walker
// can use it: the shortest way in run ticks from where a bot stands to the nearest of some tiles, with the
// connectors it climbs on the way. lib/connectors.ts plans a walk's climbs with it and lib/banks.ts finds the nearest
// bank.
//
// A walk crosses only what actions/walk.ts and actions/climb.ts do:
//
// - a neighbour step the collision allows (the gated doors walled, as reach.ts walls them);
// - a gated door (a wall row of World.gates) the walker opens, when the account meets its requirement: one whose
//   checked op is the Open the walk sends (guild doors), or the Al Kharid toll gate it pays (doorRefusal);
// - a connector edge, when it is one of the table's rows (lib/connectors.ts CONNECTORS: the rows climb can use),
//   at most `maxHops` of them;
// - an opened loc's tiles (Gate.opens), when the account meets its requirement.
//
// Not a tile in the Wilderness, unless the way starts or ends there (actions/walk.ts refuses such a route). Not a
// gate's jump (an agility shortcut, the Shantay Pass, the Mining Guild ladder: no walk op makes them) and not a
// transport (no walk takes a ship or a cart). The tick model is distance.ts's: half a tick a step, CROSSING_TICKS a
// crossing, summed in half ticks and rounded up once.
//
// The graph is built on the first search, not at import (about a second: the loc configs from server/content, the
// tile index; each tile's steps are read from the collision the first time a search reaches it). A search keeps one
// label per tile (its shortest way, and of equally short ones the first found), so a way that would need more than
// `maxHops` connectors can hide a longer one with fewer; a coin requirement is checked per crossing, not summed
// along the way.
import { reachCollision } from '../../wiki/world/collision';
import { CROSSING_TICKS } from '../../wiki/world/distance';
import { locSizes } from '../../wiki/world/place';
import { IntList, reachGraph, STEPS, wallTiles, type ReachGraph } from '../../wiki/world/reach';
import { minimalSets } from '../../wiki/world/requirements';
import { readConfigs } from '../../wiki/world/sources/configs';
import type { Gate } from '../../wiki/world/types';
import { isTollGate } from '../actions/toll';
import { type Account, meetsSet } from './account';
import type { Connector, Tile } from './connectors';
import { isInWilderness } from './wilderness';
import { WORLD } from './world-index';

/** No way yet. */
const INF = 0x7fffffff;
/** Half ticks in a tick: a run step is one. */
const HALVES = 2;
/** reach.ts's wall shapes: a gate row of one of them with no `to` is a door, crossed between its two tiles. */
const WALL_SHAPES: ReadonlySet<number> = new Set([0, 1, 2, 3, 9]);
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

/**
 * Doors whose Open the walker sends but whose script then needs what a walk does not do, by loc config: answering a
 * choice (the walker's dialog guard answers no choice).
 */
export const NOT_WALKER_DOORS: ReadonlyMap<string, string> = new Map([
    ['lgstrengthtrialgater', 'asks to force the doors (quests/quest_legends/scripts/quest_legends.rs2:466)'],
    ['lgstrengthtrialgatel', 'asks to force the doors (quests/quest_legends/scripts/quest_legends.rs2:466)'],
]);

/**
 * Why a walk does not cross a gated door row (World.gates, a wall with no `to`), or undefined when it does: the walker
 * sends Open (actions/walk.ts openDoorAt) and pays only the Al Kharid toll (actions/toll.ts). `opName` is the loc
 * config's name for an op (`op1=Open`).
 */
export function doorRefusal(g: Gate, opName: (loc: string, op: number) => string | undefined): string | undefined {
    if (isTollGate(g.tile)) return undefined;
    const op = /^(?:op|ap)loc([1-5]),/.exec(g.trigger)?.[1];
    if (!op) return `a ${g.trigger.split(',')[0]} trigger (an item used on it)`;
    const name = opName(g.loc, Number(op));
    if (!name || !WALKER_OPENS.test(name)) return `op ${name ?? op}, not Open`;
    if (g.requires.some(set => set.some(r => /^(coins|consume):/.test(r)))) return 'a payment other than the toll';
    return NOT_WALKER_DOORS.get(g.loc);
}

interface Built {
    graph: ReachGraph;
    /**
     * The door edges the walker crosses, both ways across a wall: by `pair`, the requirement alternatives (`sig`) of
     * each row on it the walker opens, and `''` for the free side.
     */
    doors: ReadonlyMap<number, ReadonlySet<string>>;
    /** Per tile: half ticks of the way found, connectors climbed on it, its chain node; reset after each search. */
    dist: Int32Array;
    hops: Uint8Array;
    node: Int32Array;
}

let built: Built | undefined;

/** The graph and the search's arrays, built on the first call. */
function graphOf(): Built {
    if (built) return built;
    const configs = readConfigs('loc');
    const graph = reachGraph({ world: WORLD, collision: reachCollision, size: locSizes(configs) });
    const { index } = graph;
    const at = (t: Tile) => index.of(t.level, t.x, t.z);
    const opName = (loc: string, op: number) => configs.get(loc)?.[`op${op}`]?.[0];
    const doors = new Map<number, Set<string>>();
    for (const g of WORLD.gates) {
        if (g.kind !== 'gate' || !WALL_SHAPES.has(g.shape) || g.to || doorRefusal(g, opName)) continue;
        const tiles = wallTiles(g);
        if (!tiles) continue;
        const [a, b] = tiles.map(at) as [number, number];
        if (a < 0 || b < 0) continue;
        // As reach.ts interns a row's requirement (`alternatives`): its minimal sets, `members` met.
        const ids = minimalSets(
            g.requires.map(set => set.filter(r => r !== 'members')),
            graph.quests,
        ).map(s => graph.sets.intern(s));
        for (const p of [pair(a, b), pair(b, a)]) {
            const sigs = doors.get(p) ?? new Set<string>();
            doors.set(p, sigs.add(sig(graph, ids)).add(''));
        }
    }
    built = {
        graph,
        doors,
        dist: new Int32Array(index.size).fill(INF),
        hops: new Uint8Array(index.size),
        node: new Int32Array(index.size),
    };
    return built;
}

/** A table's connector edges: each graph edge of a connector, by `pair`, to the table row it climbs. */
const edgesOf = new WeakMap<readonly Connector[], Map<number, number>>();

/**
 * Which row of `table` each connector edge of the graph is: the row that lands where the edge does, with its loc on
 * the edge's level and nearest the edge's source (a loc's approach tiles are beside its footprint, at most a few
 * tiles from its own tile). An edge no row lands on is a connector the table left out.
 */
function connectorEdges(b: Built, table: readonly Connector[]): Map<number, number> {
    let m = edgesOf.get(table);
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
    edgesOf.set(table, m);
    return m;
}

/** The nearest of a search's targets, the run ticks to it, and the connectors climbed on the way, in order. */
export interface Way {
    /** Its index in `targets`. */
    target: number;
    runTicks: number;
    chain: Connector[];
}

export interface WalkSearch {
    /** What the account meets decides which doors and connectors the way may cross. */
    account: Account;
    /** The connectors the way may climb. */
    connectors: readonly Connector[];
    /** At most this many of them. */
    maxHops: number;
}

/**
 * The shortest way a walk takes from `from` to the nearest of `targets` (a target off the graph is never reached),
 * or undefined when none is reached. The first target in `targets` wins a tie on one tile.
 */
export function nearestWay(from: Tile, targets: readonly Tile[], opts: WalkSearch): Way | undefined {
    const b = graphOf();
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
    const climbs = connectorEdges(b, opts.connectors);
    const metCache = new Map<number, boolean>();
    const met = (alts: readonly number[]): boolean =>
        alts.some(id => {
            let ok = metCache.get(id);
            if (ok === undefined) metCache.set(id, (ok = meetsSet(opts.account, sets.strings(id))));
            return ok;
        });
    const gateHalf = CROSSING_TICKS.gate * HALVES;
    // A walk to somewhere outside the Wilderness never routes through it unless it starts inside (actions/walk.ts).
    const tame = !wild(from) && !targets.some(wild);
    // Chain nodes: the connector climbed and the node before it (-1 for none).
    const nodeRow: number[] = [];
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
                        const chain: Connector[] = [];
                        for (let n = node[i]!; n >= 0; n = nodeUp[n]!) chain.unshift(opts.connectors[nodeRow[n]!]!);
                        return { target, runTicks: Math.ceil(d / HALVES), chain };
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
                            nodeRow.push(row);
                            nodeUp.push(n);
                            enter(i, e.to, d + CROSSING_TICKS.connector * HALVES, h + 1, nodeRow.length - 1);
                        } else if (e.via === 'gate' && doors.get(pair(i, e.to))?.has(sig(graph, e.alts)) && met(e.alts))
                            enter(i, e.to, d + gateHalf, h, n);
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
