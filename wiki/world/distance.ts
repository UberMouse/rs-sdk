// How far each resource and processor site is from the sinks a method takes its products to: the nearest bank,
// and for the kinds phase 3 processes on the way, the nearest furnace, range or anvil (SINKS). A distance is the
// travel time in run ticks (bots always run) from the site's stand tile to the sink site's stand,
// over the reach fill's graph (reach.ts reachGraph: the neighbour steps, connectors, gates, opened locs and
// transports), so a door, a staircase or a boat on the way counts.
//
// The tick model, counted in half ticks so every cost is a whole number:
//
// - A neighbour step, straight or diagonal, is half a tick: a running player moves two tiles a tick
//   (server/engine/src/engine/entity/PathingEntity.ts:147, processMovement takes a second step when running).
//   The half ticks of a path are summed and rounded up once, at the end (`runTicks`). Rounding each of the k + 1
//   stretches between a path's k crossings instead would add up to half a tick per stretch; once does not.
// - A crossing costs CROSSING_TICKS by how it moves the player (reach.ts Via), a stated constant per kind: no
//   world.json row carries its own duration. An edge with a cost of its own (reach.ts EdgeCost) adds to it
//   (crossingTicks): a crossing row's landing its spread, the run ticks from the row's landing farthest from it
//   (Landing.spread, priceCrossings), so a random landing costs its longest; a rolled move its expected ticks at the
//   lowest level its requirement allows (roll.ts expectedTicks), failures and the walk back to try again included.
//   Such a cost is rounded up to a half tick, and an edge the build could not price is not taken.
// - Stepping onto an opened loc's tiles (Gate.opens) from a tile that is not one costs as a gate crossing.
//
// Under the site's own requirement sets: a site's reach (Site.reach) lists the minimal sets that get a walk from
// the Lumbridge spawn to it; each is a context. A way's `requires` is the join (SetTable.union, canonical: coins
// and consumed objs summed) of the alternatives its crossings take, and an edge or opened tile is crossed only
// when that join, the crossing's alternative added, is still dominated by the context (requirements.ts dominates:
// asks no more than it). So a site reached with `{}` gets a distance over `{}` edges alone, a site reached with
// `{coins:30}` may pay one 30-coin fare but not two 20-coin tolls, and no way asks more than its context. A site
// takes the shortest over its contexts, then the one whose way asks fewest requirements.
//
// Each tile keeps one label (its shortest way found, and of ways equally short the one asking less), so the search
// is exact for the path cost wherever whether a crossing is allowed does not depend on the way so far: a context
// with no coins or consume, where every requirement of a join is one of its parts' and a part the context meets
// keeps meeting it. With coins or consume a crossing can depend on what the way already paid, and one label per
// tile is then a heuristic: a shorter way that spent the context's coins can hide a longer one that kept them for a
// later toll, and the site reads a longer way or none.
//
// One search per sink kind and context, not a path per site: a multi-source Dijkstra (buckets by distance, as
// every cost is a small whole number) from every reachable sink site's stand at once, over the edges reversed, so a
// tile's distance is its way *to* the nearest sink, as a bot walks it with a full inventory. The `{}` context's
// search runs to the end and is the base; another context's search starts from the base labels of the tiles a
// non-`{}` edge or opened tile leads into, and keeps a label only where it is shorter than the base's, so it covers
// only what the context's edges change (every context meets `{}`, so its ways are never longer). The way's
// `requires` is the join (SetTable.union) of the alternatives its crossings take; of two ways equally short, the one
// asking fewer requirements is kept.
import { actName, coord, IntList, STEPS, type Edge, type ReachGraph, type Via } from './reach';
import { expectedTicks, lowestLevel, statRandomChance } from './roll';
import {
    SINK_KINDS,
    type Crossing,
    type FeatureKind,
    type Gate,
    type Nearest,
    type Roll,
    type SinkKind,
    type Site,
    type Tile,
    type World,
} from './types';
import { cmp } from './util';

/**
 * The sinks each kind of site gets a nearest of. Every gathering, thieving and processing kind takes its products
 * or loot to a bank (conductor/docs/world-index.md, "Analysis: training methods"); on the way ore is smelted at a
 * furnace, raw fish cooked on a range, and the bars a furnace makes smithed at an anvil. Fires cook too, but phase 3
 * models a range (the spec's "range for raw fish"), so fires are not range sinks.
 */
export const SINKS: Partial<Record<FeatureKind, readonly SinkKind[]>> = {
    tree: ['bank'],
    rock: ['bank', 'furnace'],
    'fishing-spot': ['bank', 'range'],
    stall: ['bank'],
    'thieving-chest': ['bank'],
    pickpocket: ['bank'],
    furnace: ['bank', 'anvil'],
    anvil: ['bank'],
    range: ['bank'],
    fire: ['bank'],
    'spinning-wheel': ['bank'],
    'pottery-wheel': ['bank'],
    'pottery-oven': ['bank'],
};

/**
 * Ticks a crossing takes, by how it moves the player, including the tick the op is clicked from its stand. All are
 * estimates:
 *
 * - connector: `p_arrivedelay` then the climb's `p_delay(0)` before the jump (ladders+stairs/scripts/ladders.rs2:3,
 *   and ~climb_ladder's `p_delay(0)` at :160), 2 ticks;
 * - gate: a gated door's `p_delay(1)` between the two moves through it (doors/scripts/open_and_close_doors.rs2:31),
 *   2 ticks; a gate's jump and an opened loc are priced the same, an estimate (their scripts' delays vary);
 * - ship: the sail proc's `p_delay($delay)` at sea, 7 ticks on the sailors' routes (interface_boat/scripts/sail.rs2:22,
 *   areas/area_port_sarim/scripts/sailors.rs2:31; Entrana's monks take 13-14), plus about 5 ticks of talking to the
 *   sailor and paying, 12 ticks;
 * - cart: only dialogue, about 8 pages of it before and after the teleport (areas/area_shilo/scripts/vigroy.rs2:20-31),
 *   8 ticks;
 * - sled: the toboggan ride's op and its teleport (quests/quest_troll_love/scripts/quest_troll_love.rs2:1), an
 *   estimate of 4 ticks;
 * - scripted: a loc op's move with no condition, priced as a gate's jump, 2 ticks (its scripts' delays vary);
 * - teleport: the runecrafting ruins' `p_delay(1)` before the jump (skill_runecraft/scripts/runecraft.rs2:44), 3 ticks;
 *   an npc's teleport talks first and waits longer (the essence mine's `p_delay(4)`,
 *   skill_runecraft/scripts/essence_mine.rs2:20), so this is a floor.
 */
export const CROSSING_TICKS: Readonly<Record<Via, number>> = {
    connector: 2,
    gate: 2,
    ship: 12,
    cart: 8,
    sled: 4,
    scripted: 2,
    teleport: 3,
};

/**
 * The ticks an edge's crossing takes: CROSSING_TICKS by its kind, plus its landing's spread, and for a roll the
 * expected ticks at `level` of the rolled stat (roll.ts). Undefined when the build has not priced the edge (a spread
 * or a way back it found no walk for), or the roll never succeeds at that level.
 */
export function crossingTicks(e: Pick<Edge, 'via' | 'cost'>, level = 1): number | undefined {
    const base = CROSSING_TICKS[e.via];
    if (!e.cost) return base;
    if (e.cost.spread === undefined) return undefined;
    const success = base + e.cost.spread;
    const roll = e.cost.roll;
    if (!roll) return success;
    const back = roll.fail.to ? roll.fail.back : 0;
    if (back === undefined) return undefined;
    const ticks = expectedTicks(success, statRandomChance(roll.low, roll.high, level), roll.fail.ticks, back);
    return Number.isFinite(ticks) ? ticks : undefined;
}

/** Half ticks in a tick: a run step is one. */
const HALVES = 2;

/**
 * `ticks` in half ticks, rounded up. A rolled crossing's expected ticks (crossingTicks) are a float that, when exactly
 * on a half tick, can come out an ulp above it, so 1e-9 is taken off before rounding up. Off a half tick they are at
 * least 1/256 of one above it: they are S + ((256 - v) / v) * (F + B) with S, F and B whole ticks and v in 1..256
 * (the chance is v/256), so in half ticks they are a whole number over v. Float error is about 1e-12.
 */
const halfTicks = (ticks: number): number => Math.ceil(ticks * HALVES - 1e-9);

/** A way to a sink as one search found it: half ticks, the sink's index among the sources, the way's set id. */
interface Found {
    half: number;
    sink: number;
    set: number;
}

export interface DistanceReport {
    /** Requirement contexts searched per sink kind, `{}` (the base search) among them: one search each. */
    contexts: Record<SinkKind, number>;
    /** Sink sites searched from, and target sites with and without a nearest, per sink kind. */
    sinks: Record<SinkKind, number>;
    found: Record<SinkKind, number>;
    missing: Record<SinkKind, number>;
    /** Tiles settled over every search. */
    settled: number;
    ms: number;
    /** Bytes of the typed arrays the searches share. */
    bytes: number;
}

type SiteIn = Pick<Site, 'id' | 'kind' | 'stand' | 'reach'>;

export interface NearestOptions {
    /**
     * For tests: search each context other than `{}` in full from the sinks, as the base search is, instead of only
     * where it betters the base layer; the results must not differ.
     */
    full?: boolean;
    /**
     * The tiles a walk from the Lumbridge spawn reaches, by index (Reach.reachedAt): the searches enter no other.
     * Every tile of a way from a reached stand to a sink is reached, so this changes no distance; it keeps the
     * searches off the land no walk gets to, which a crossing out of it joins to the sinks. Absent: every tile.
     */
    reached?: (i: number) => boolean;
}

/** Offers or expands a label: a tile, half ticks to the sink, the sink's index, the way's set id. */
type Relax = (tile: number, half: number, sink: number, set: number) => void;

const perKind = (): Record<SinkKind, number> => ({ bank: 0, furnace: 0, range: 0, anvil: 0 });

/** No way to a sink. */
const INF = 0x7fffffff;

/**
 * The nearest sinks of every site whose kind SINKS lists, by site id: `{}` for one with no stand, no reach or no
 * sink its contexts get to. Sinks are the sites of the sink kind with a stand some set reaches.
 */
export function nearestSinks(
    graph: ReachGraph,
    sites: readonly SiteIn[],
    options: NearestOptions = {},
): { nearest: Map<string, Nearest>; report: DistanceReport } {
    const began = performance.now();
    const { index, sets, openAlts, stepMask } = graph;
    const { reached } = options;
    const n = index.size;
    const at = (t: Tile): number => index.of(t.level, t.x, t.z);

    // The edges reversed: by target tile, each source tile with its alternatives and cost in half ticks. A roll is
    // priced at the lowest level any of the edge's alternatives lets through.
    const edgeTo = new Map<number, { from: number; alts: readonly number[]; half: number }[]>();
    for (const [from, out] of graph.edgeFrom)
        for (const e of out) {
            const roll = e.cost?.roll;
            const ticks = crossingTicks(e, roll && lowestLevel(e.alts.map(sets.strings), roll.stat));
            if (ticks === undefined) continue;
            const list = edgeTo.get(e.to) ?? [];
            list.push({ from, alts: e.alts, half: halfTicks(ticks) });
            edgeTo.set(e.to, list);
        }
    const openHalf = CROSSING_TICKS.gate * HALVES;
    const hasIn = new Uint8Array(n);
    for (const i of edgeTo.keys()) hasIn[i] = 1;
    const opened = new Uint8Array(n);
    for (const i of openAlts.keys()) opened[i] = 1;
    // The tiles a way into which may need more than {}: the targets of edges and the opened tiles that ask
    // something. Only from these does a context's search start (below).
    const gated = [
        ...new Set([
            ...[...edgeTo].filter(([, es]) => es.some(e => !e.alts.includes(0))).map(([i]) => i),
            ...[...openAlts].filter(([, alts]) => !alts.includes(0)).map(([i]) => i),
        ]),
    ].sort((a, b) => a - b);

    // The base layer: each tile's way to the nearest sink of the kind over `{}` edges alone, its set always `{}`.
    const baseDist = new Int32Array(n);
    const baseSink = new Int16Array(n);
    // The search layer: `mark` is 2 * run when a search has seen the tile, + 1 once settled.
    const mark = new Int32Array(n);
    const dist = new Int32Array(n);
    const sinkOf = new Int16Array(n);
    const setOf = new Uint16Array(n);
    const buckets: (IntList | undefined)[] = [];
    let run = 0;
    let settled = 0;

    /** The first of `alts` the context `ctx` meets, or -1. */
    const admit = (alts: readonly number[], ctx: number): number => {
        for (const a of alts) if (sets.dominates(a, ctx)) return a;
        return -1;
    };
    /** The join of `set` with the first of `alts` that keeps it within the context `ctx`, or -1. */
    const join = (set: number, alts: readonly number[], ctx: number): number => {
        for (const a of alts) {
            const u = sets.union(set, a);
            if (sets.dominates(u, ctx)) return u;
        }
        return -1;
    };
    /** Whether `set` asks less than `have`, of two ways equally short: fewer requirements, or no more of any. */
    const asksLess = (set: number, have: number): boolean =>
        sets.size(set) < sets.size(have) ||
        (set !== have && sets.size(set) === sets.size(have) && sets.dominates(set, have));

    /**
     * A Dijkstra over the reversed graph under context `ctx`, on the search layer, from the labels `seed` gives; it
     * returns the run's `seen` mark. With `base`, a tile takes a label only when it betters the base layer's: the
     * first search of a kind (ctx `{}`, no base) finds every tile's way over `{}` edges; a later one (a context that
     * asks more) only the tiles whose way it shortens, starting from the gated tiles' base labels, so it walks no
     * further than the context changes things. With `stop`, it ends once every tile of it is settled.
     */
    const search = (
        ctx: number,
        base: boolean,
        seed: (from: Relax, to: Relax) => void,
        stop?: ReadonlySet<number>,
    ): number => {
        run++;
        const seen = 2 * run;
        let queued = 0;
        let lo = INF;
        let hi = 0;
        const relaxTo: Relax = (p, half, sink, set) => {
            if (mark[p] === seen + 1 || (reached && !reached(p))) return;
            const [have, haveSet] = mark[p] === seen ? [dist[p]!, setOf[p]!] : [base ? baseDist[p]! : INF, 0];
            if (half > have || (half === have && !asksLess(set, haveSet))) return;
            mark[p] = seen;
            dist[p] = half;
            sinkOf[p] = sink;
            setOf[p] = set;
            (buckets[half] ??= new IntList()).push(p);
            queued++;
            if (half < lo) lo = half;
            if (half > hi) hi = half;
        };
        /** Every way into tile i, which is `d` half ticks from sink `sink` by a way asking `set`. */
        const relaxFrom: Relax = (i, d, sink, set) => {
            // An opened tile asks its requirement of any way onto it, and costs a crossing from a tile that is not one;
            // from one of its own tiles the way has crossed it already.
            const opens = opened[i] ? openAlts.get(i)! : undefined;
            if (opens && admit(opens, ctx) < 0) return;
            const stepped = opens ? join(set, opens, ctx) : set;
            const [level, x, z] = [index.level(i), index.x(i), index.z(i)];
            for (let bit = 0; bit < 8; bit++) {
                const [dx, dz] = STEPS[bit]!;
                const p = index.of(level, x - dx, z - dz);
                if (p < 0 || !(stepMask(p) & (1 << bit))) continue;
                if (opens && !opened[p]) {
                    if (stepped >= 0) relaxTo(p, d + 1 + openHalf, sink, stepped);
                } else relaxTo(p, d + 1, sink, set);
            }
            if (!hasIn[i]) return;
            for (const e of edgeTo.get(i)!) {
                const way = join(set, e.alts, ctx);
                if (way < 0) continue;
                if (opens && !opened[e.from]) {
                    const onto = join(way, opens, ctx);
                    if (onto >= 0) relaxTo(e.from, d + e.half + openHalf, sink, onto);
                } else relaxTo(e.from, d + e.half, sink, way);
            }
        };
        seed(relaxFrom, relaxTo);
        let left = stop?.size ?? INF;
        for (let d = lo; queued > 0 && left > 0; d++) {
            const bucket = buckets[d];
            if (!bucket) continue;
            for (let k = 0; k < bucket.length && left > 0; k++) {
                const i = bucket.data[k]!;
                queued--;
                if (mark[i] !== seen || dist[i] !== d) continue;
                mark[i] = seen + 1;
                settled++;
                if (stop?.has(i)) left--;
                relaxFrom(i, d, sinkOf[i]!, setOf[i]!);
            }
            bucket.length = 0;
        }
        // An early stop leaves later buckets full.
        for (let d = lo; d <= hi; d++) if (buckets[d]) buckets[d]!.length = 0;
        return seen;
    };

    const nearest = new Map<string, Nearest>();
    for (const s of sites) if (SINKS[s.kind]) nearest.set(s.id, {});
    const report: DistanceReport = {
        contexts: perKind(),
        sinks: perKind(),
        found: perKind(),
        missing: perKind(),
        settled: 0,
        ms: 0,
        bytes:
            baseDist.byteLength +
            baseSink.byteLength +
            mark.byteLength +
            dist.byteLength +
            sinkOf.byteLength +
            setOf.byteLength +
            hasIn.byteLength +
            opened.byteLength,
    };
    const usable = (s: SiteIn): boolean => s.stand !== null && s.reach.length > 0 && at(s.stand) >= 0;

    graph.within(() => {
        for (const kind of SINK_KINDS) {
            const sinks = sites.filter(s => s.kind === kind && usable(s)).sort((a, b) => cmp(a.id, b.id));
            const targets = sites.filter(s => SINKS[s.kind]?.includes(kind));
            report.sinks[kind] = sinks.length;
            // Each target's contexts, and each context's target tiles.
            const contexts = new Map<number, Set<number>>();
            const ctxOf = new Map<SiteIn, number[]>();
            for (const t of targets) {
                if (!usable(t)) continue;
                const ids = t.reach.map(r => sets.intern(r));
                ctxOf.set(t, ids);
                for (const c of ids) {
                    const tiles = contexts.get(c) ?? new Set<number>();
                    tiles.add(at(t.stand!));
                    contexts.set(c, tiles);
                }
            }
            const found = new Map<number, Map<number, Found>>();
            if (sinks.length && contexts.size) {
                // The base search, from every sink at once; its labels become the base layer.
                const seen = search(0, false, (_, to) => sinks.forEach((s, k) => to(at(s.stand!), 0, k, 0)));
                for (let i = 0; i < n; i++) {
                    baseDist[i] = mark[i]! >= seen ? dist[i]! : INF;
                    baseSink[i] = sinkOf[i]!;
                }
                report.contexts[kind] = new Set([0, ...contexts.keys()]).size;
                const fromSinks = (_: Relax, to: Relax) => sinks.forEach((s, k) => to(at(s.stand!), 0, k, 0));
                for (const [c, tiles] of contexts) {
                    const ran =
                        c === 0
                            ? seen
                            : options.full
                              ? search(c, false, fromSinks, tiles)
                              : search(c, true, from => {
                                    for (const g of gated)
                                        if (baseDist[g]! < INF) from(g, baseDist[g]!, baseSink[g]!, 0);
                                });
                    const got = new Map<number, Found>();
                    for (const t of tiles)
                        if (c !== 0 && mark[t]! >= ran)
                            got.set(t, { half: dist[t]!, sink: sinkOf[t]!, set: setOf[t]! });
                        else if ((c === 0 || !options.full) && baseDist[t]! < INF)
                            got.set(t, { half: baseDist[t]!, sink: baseSink[t]!, set: 0 });
                    found.set(c, got);
                }
            }
            for (const t of targets) {
                let best: Found | undefined;
                for (const c of ctxOf.get(t) ?? []) {
                    const f = found.get(c)?.get(at(t.stand!));
                    if (
                        f &&
                        (!best ||
                            f.half < best.half ||
                            (f.half === best.half && sets.size(f.set) < sets.size(best.set)))
                    )
                        best = f;
                }
                if (!best) {
                    report.missing[kind]++;
                    continue;
                }
                report.found[kind]++;
                nearest.get(t.id)![kind] = {
                    site: sinks[best.sink]!.id,
                    runTicks: Math.ceil(best.half / HALVES),
                    requires: sets.strings(best.set),
                };
            }
        }
    });
    report.settled = settled;
    report.ms = Math.round(performance.now() - began);
    return { nearest, report };
}

/** The distances' section of the build report. */
export function formatDistance(r: DistanceReport): string[] {
    const kinds = SINK_KINDS.filter(k => r.sinks[k] || r.found[k] || r.missing[k]);
    return [
        `distance: ${kinds
            .map(
                k =>
                    `${k} ${r.found[k]} sites with a nearest, ${r.missing[k]} without (${r.sinks[k]} sinks, ` +
                    `${r.contexts[k]} contexts)`,
            )
            .join('; ')}`,
        `distance: ${Object.values(r.contexts).reduce((a, b) => a + b, 0)} searches settled ${r.settled} tiles; ` +
            `${r.ms} ms, ${(r.bytes / 2 ** 20).toFixed(1)} MiB of typed arrays`,
    ];
}

export interface Priced {
    /**
     * The rows with their landings' spreads and their rolls' ways back filled in where a walk was found; the input
     * arrays themselves when there is nothing to price (no crossing row and no rolled gate row).
     */
    crossings: Crossing[];
    gates: Gate[];
    /** What could not be priced, as `<row>: <why>`, sorted: those edges are not taken by a distance. */
    unpriced: string[];
}

/**
 * Prices the crossing rows and rolled gate rows of `graph` (built from `rows`) for the distances: each landing's
 * spread (Landing.spread), and each roll's way back from its failure's tile (Roll.fail.back). Both are run ticks
 * over the neighbour steps and the free edges that carry no cost of their own (reach.ts Edge.cost), so a price does
 * not depend on another; the build writes them on the rows and builds the graph again from them.
 */
export function priceCrossings(graph: ReachGraph, rows: Pick<World, 'crossings' | 'gates'>): Priced {
    if (!rows.crossings.length && !rows.gates.some(g => g.roll))
        return { crossings: rows.crossings, gates: rows.gates, unpriced: [] };
    const { index, edgeFrom, openAlts, stepMask } = graph;
    const at = (t: Tile): number => index.of(t.level, t.x, t.z);
    const unpriced: string[] = [];
    const mark = new Int32Array(index.size);
    const dist = new Int32Array(index.size);
    let run = 0;
    const openHalf = CROSSING_TICKS.gate * HALVES;

    /** Half ticks from tile `start` to each of `targets` it walks to (only the nearest when `first`). */
    const walk = (start: number, targets: ReadonlySet<number>, first: boolean): Map<number, number> => {
        run++;
        const seen = 2 * run;
        const buckets: (IntList | undefined)[] = [];
        const found = new Map<number, number>();
        let queued = 0;
        const enter = (from: number, j: number, half: number): void => {
            if (j < 0) return;
            const opens = openAlts.get(j);
            if (opens) {
                if (!opens.includes(0)) return;
                if (from >= 0 && !openAlts.has(from)) half += openHalf;
            }
            if (mark[j] === seen + 1 || (mark[j] === seen && dist[j]! <= half)) return;
            mark[j] = seen;
            dist[j] = half;
            (buckets[half] ??= new IntList()).push(j);
            queued++;
        };
        enter(-1, start, 0);
        for (let d = 0; queued > 0; d++) {
            const bucket = buckets[d];
            if (!bucket) continue;
            for (let k = 0; k < bucket.length; k++) {
                const i = bucket.data[k]!;
                queued--;
                if (mark[i] !== seen || dist[i] !== d) continue;
                mark[i] = seen + 1;
                if (targets.has(i)) {
                    found.set(i, d);
                    if (first || found.size === targets.size) return found;
                }
                const m = stepMask(i);
                const [level, x, z] = [index.level(i), index.x(i), index.z(i)];
                for (let bit = 0; bit < 8; bit++)
                    if (m & (1 << bit)) enter(i, index.of(level, x + STEPS[bit]![0], z + STEPS[bit]![1]), d + 1);
                for (const e of edgeFrom.get(i) ?? [])
                    if (!e.cost && e.alts.includes(0)) enter(i, e.to, d + CROSSING_TICKS[e.via] * HALVES);
            }
        }
        return found;
    };
    const ticks = (half: number): number => Math.ceil(half / HALVES);

    /** The tiles each rolled gate row's checked edges go from, by its roll. */
    const tried = new Map<Roll, number[]>();
    for (const [from, out] of edgeFrom)
        for (const e of out) {
            const roll = e.cost?.roll;
            if (roll) tried.set(roll, [...(tried.get(roll) ?? []), from]);
        }

    return graph.within(() => {
        /** A roll with its way back, when it fails onto another tile and a walk gets back from there. */
        const priceRoll = (roll: Roll, from: readonly number[], name: string): Roll => {
            if (!roll.fail.to) return roll;
            if (!from.length) {
                unpriced.push(`${name}: no tile on land it is tried from, so no way back to price`);
                return roll;
            }
            const start = at(roll.fail.to);
            const back = start < 0 ? undefined : walk(start, new Set(from), true).values().next().value;
            if (back === undefined) {
                unpriced.push(
                    `${name}: no walk from its failure's tile ${coord(roll.fail.to)} back to where it is tried`,
                );
                return roll;
            }
            return { ...roll, fail: { ...roll.fail, back: ticks(back) } };
        };
        const crossings = rows.crossings.map(c => {
            const name = `${c.via} ${actName(c)} ${coord(c.at)}`;
            const tiles = c.landings.map(l => at(l.tile));
            const onLand = new Set(tiles.filter(i => i >= 0));
            // From each landing on land, the half ticks to the others on land. A landing off land has no edge to it
            // (reach.ts addEdge), so it is reported on its own and the other landings' spreads leave it out.
            const from = tiles.map(j => (j < 0 ? undefined : walk(j, onLand, false)));
            const landings = c.landings.map((l, i) => {
                if (tiles[i]! < 0) {
                    unpriced.push(`${name}: its landing ${coord(l.tile)} is not on land`);
                    return l;
                }
                let half = 0;
                for (let j = 0; j < tiles.length; j++) {
                    if (tiles[j]! < 0 || j === i) continue;
                    const d = from[j]!.get(tiles[i]!);
                    if (d === undefined) {
                        unpriced.push(
                            `${name}: no walk to its landing ${coord(l.tile)} from ${coord(c.landings[j]!.tile)}`,
                        );
                        return l;
                    }
                    half = Math.max(half, d);
                }
                return { ...l, spread: ticks(half) };
            });
            const roll =
                c.roll &&
                priceRoll(
                    c.roll,
                    c.from.map(at).filter(i => i >= 0),
                    name,
                );
            return roll ? { ...c, landings, roll } : { ...c, landings };
        });
        const gates = rows.gates.map(g =>
            g.roll
                ? { ...g, roll: priceRoll(g.roll, tried.get(g.roll) ?? [], `${g.trigger} ${g.loc} ${coord(g.tile)}`) }
                : g,
        );
        return { crossings, gates, unpriced: unpriced.sort(cmp) };
    });
}
