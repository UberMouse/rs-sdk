// How far each resource and processor site is from the sinks a method takes its products to: the nearest bank,
// and for the kinds phase 3 processes on the way, the nearest furnace, range or anvil (SINKS). A distance is the
// travel time in run ticks (bots always run, user 2026-10-16) from the site's stand tile to the sink site's stand,
// over the reach fill's graph (reach.ts reachGraph: the neighbour steps, connectors, gates, opened locs and
// transports), so a door, a staircase or a boat on the way counts.
//
// The tick model, counted in half ticks so every cost is a whole number:
//
// - A neighbour step, straight or diagonal, is half a tick: a running player moves two tiles a tick
//   (server/engine/src/engine/entity/PathingEntity.ts:147, processMovement takes a second step when running).
//   The half ticks of a path are summed and rounded up once, at the end (`runTicks`), not per stretch between
//   two crossings, so a path with k crossings may read up to (k + 1) / 2 ticks short of the walk.
// - A crossing costs CROSSING_TICKS by how it moves the player (reach.ts Via), a stated constant per kind: no
//   world.json row carries its own duration.
// - Stepping onto an opened loc's tiles (Gate.opens) from a tile that is not one costs as a gate crossing.
//
// Under the site's own requirement sets: a site's reach (Site.reach) lists the minimal sets that get a walk from
// the Lumbridge spawn to it; each is a context. In a context only the edges (and opened tiles) one of whose
// alternatives that set dominates are crossed (requirements.ts dominates: asks no more than it), so a site
// reached with `{}` gets a distance over `{}` edges alone, and a site reached with `{coins:30}` may cross a 30-coin
// fare, each crossing judged on its own (two tolls on the way read `coins:20` in `requires`, as canonicalSet sums
// them). A site takes the shortest over its contexts, then the one whose way asks fewest requirements.
//
// One search per sink kind and context, not a path per site: a multi-source Dijkstra (buckets by distance, as
// every cost is a small whole number) from every reachable sink site's stand at once, over the edges reversed, so a
// tile's distance is its way *to* the nearest sink, as a bot walks it with a full inventory. The `{}` context's
// search runs to the end and is the base; another context's search starts from the base labels of the tiles a
// non-`{}` edge or opened tile leads into, and keeps a label only where it is shorter than the base's, so it covers
// only what the context's edges change (every context meets `{}`, so its ways are never longer). The way's
// `requires` is the join (SetTable.union) of the alternatives its crossings take; of two ways equally short, the one
// asking fewer requirements is kept.
import { IntList, STEPS, type ReachGraph, type Via } from './reach';
import type { FeatureKind, NearestSink, Site, Tile } from './types';
import { cmp } from './util';

/** The kinds of site a nearest is found for. */
export type SinkKind = 'bank' | 'furnace' | 'range' | 'anvil';

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

const SINK_KINDS: readonly SinkKind[] = ['bank', 'furnace', 'range', 'anvil'];

/**
 * Ticks a crossing takes, by how it moves the player, including the tick the op is clicked from its stand:
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
 *   estimate of 4 ticks.
 */
export const CROSSING_TICKS: Readonly<Record<Via, number>> = { connector: 2, gate: 2, ship: 12, cart: 8, sled: 4 };

/** Half ticks in a tick: a run step is one. */
const HALVES = 2;

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
): { nearest: Map<string, Partial<Record<SinkKind, NearestSink>>>; report: DistanceReport } {
    const began = performance.now();
    const { index, sets, openAlts, stepMask } = graph;
    const n = index.size;
    const at = (t: Tile): number => index.of(t.level, t.x, t.z);

    // The edges reversed: by target tile, each source tile with its alternatives and cost in half ticks.
    const edgeTo = new Map<number, { from: number; alts: readonly number[]; half: number }[]>();
    for (const [from, out] of graph.edgeFrom)
        for (const e of out) {
            const list = edgeTo.get(e.to) ?? [];
            list.push({ from, alts: e.alts, half: CROSSING_TICKS[e.via] * HALVES });
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

    /**
     * A Dijkstra over the reversed graph under context `ctx`, on the search layer, from the labels `seed` gives; it
     * returns the run's `seen` mark. With `base`, a tile takes a label only when it betters the base layer's: the
     * first search of a kind (ctx `{}`, no base) finds every tile's way over `{}` edges; a later one (a context that
     * asks more) only the tiles whose way it shortens, starting from the gated tiles' base labels, so it walks no
     * further than the context changes things.
     */
    const search = (ctx: number, base: boolean, seed: (from: Relax, to: Relax) => void): number => {
        run++;
        const seen = 2 * run;
        let queued = 0;
        let lo = INF;
        const relaxTo: Relax = (p, half, sink, set) => {
            if (mark[p] === seen + 1) return;
            const [have, haveSet] = mark[p] === seen ? [dist[p]!, setOf[p]!] : [base ? baseDist[p]! : INF, 0];
            if (half > have || (half === have && sets.size(set) >= sets.size(haveSet))) return;
            mark[p] = seen;
            dist[p] = half;
            sinkOf[p] = sink;
            setOf[p] = set;
            (buckets[half] ??= new IntList()).push(p);
            queued++;
            if (half < lo) lo = half;
        };
        /** Every way into tile i, which is `d` half ticks from sink `sink` by a way asking `set`. */
        const relaxFrom: Relax = (i, d, sink, set) => {
            // An opened tile asks its requirement of any way onto it, and costs a crossing from a tile that is not one.
            const enter = opened[i] ? admit(openAlts.get(i)!, ctx) : 0;
            if (enter < 0) return;
            const [level, x, z] = [index.level(i), index.x(i), index.z(i)];
            for (let bit = 0; bit < 8; bit++) {
                const [dx, dz] = STEPS[bit]!;
                const p = index.of(level, x - dx, z - dz);
                if (p < 0 || !(stepMask(p) & (1 << bit))) continue;
                if (opened[i] && !opened[p]) relaxTo(p, d + 1 + openHalf, sink, sets.union(set, enter));
                else relaxTo(p, d + 1, sink, set);
            }
            if (!hasIn[i]) return;
            for (const e of edgeTo.get(i)!) {
                const a = admit(e.alts, ctx);
                if (a < 0) continue;
                const way = sets.union(set, a);
                if (opened[i] && !opened[e.from]) relaxTo(e.from, d + e.half + openHalf, sink, sets.union(way, enter));
                else relaxTo(e.from, d + e.half, sink, way);
            }
        };
        seed(relaxFrom, relaxTo);
        for (let d = lo; queued > 0; d++) {
            const bucket = buckets[d];
            if (!bucket) continue;
            for (let k = 0; k < bucket.length; k++) {
                const i = bucket.data[k]!;
                queued--;
                if (mark[i] !== seen || dist[i] !== d) continue;
                mark[i] = seen + 1;
                settled++;
                relaxFrom(i, d, sinkOf[i]!, setOf[i]!);
            }
            bucket.length = 0;
        }
        return seen;
    };

    const nearest = new Map<string, Partial<Record<SinkKind, NearestSink>>>();
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
                for (const [c, tiles] of contexts) {
                    const ran =
                        c === 0
                            ? seen
                            : search(c, true, from => {
                                  for (const g of gated) if (baseDist[g]! < INF) from(g, baseDist[g]!, baseSink[g]!, 0);
                              });
                    const got = new Map<number, Found>();
                    for (const t of tiles)
                        if (c !== 0 && mark[t]! >= ran)
                            got.set(t, { half: dist[t]!, sink: sinkOf[t]!, set: setOf[t]! });
                        else if (baseDist[t]! < INF) got.set(t, { half: baseDist[t]!, sink: baseSink[t]!, set: 0 });
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
