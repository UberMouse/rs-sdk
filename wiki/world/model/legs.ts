// The legs of a method's cycle (model/method.ts): the run ticks of a walk between two of its stops, as the cycle repeats
// it. distance.ts prices a crossing that lands on one of several tiles at random (Crossing.landings: the essence mine's
// teleports and its portals out) at its kind's CROSSING_TICKS plus the landing's spread, so a way on from it costs at
// least what it would from the worst landing: sound for comparing nearest sinks, and well over what a repeated walk
// averages. A method leg over one such row is priced at its mean instead:
//
//   ticks(row) + sum over its landings l of chance(l) x runTicks(walk to the row's nearest `from` tile + walk from l)
//
// with each landing's way rounded up once from half ticks (distance.ts), its chance the landing's (Landing.chance;
// absent, the landings are equally likely), and the chances of the landings counted taken as the whole. `ticks(row)`
// is its script's delays and the click (Crossing.ticks + 1: the essence mine teleport's p_delay(4), 6 ticks,
// skill_runecraft/scripts/essence_mine.rs2:20) where the row has them, else CROSSING_TICKS by its via. A stranded
// landing (no spread: distance.ts strandedLandings) counts for none, as in distance.ts; a row with a landing no walk
// takes on to the leg's end is not taken.
//
// The walks are over the graph without the random rows' edges (an edge of another row from and to the same tiles by
// the same via is left out with them), so a leg crosses at most one random row, and takes the shortest of that graph's
// own way and each row's. A leg no such way walks (one that needs two random rows) takes the whole graph's way, its
// random rows at their spread.
//
// The essence mine's portals return to the wizard the way came in by (sources/npc-teleports.ts), under
// `other:came from <npc>`. A leg is priced under its reach set, and given `came`, the npc whose teleport an earlier leg
// of the cycle crossed, with that npc's came-from requirement too, as the conductor's walker meets it once it crosses
// the npc's teleport (conductor/actions/walk.ts).
import { CROSSING_TICKS, HALVES, wayFinder, type HalfWay, type Way } from '../distance';
import type { Edge, ReachGraph } from '../reach';
import { cameFrom, canonicalSet, dominates, requirementSet } from '../requirements';
import { returnsTo } from '../sources/npc-teleports';
import type { Crossing, Tile } from '../types';
import { tileKey } from '../util';

/** A leg's way, and the npc whose teleport it crossed when a way back returns to that npc. */
export interface LegWay extends Way {
    npc?: string;
}

export interface LegFinder {
    /** The whole graph's finder: a family's walk pairs (Family.walks) are priced over it. */
    finder: ReturnType<typeof wayFinder>;
    /**
     * The leg from `from` to `to` under the requirement set `reach` (the header comment), with `came`'s came-from
     * requirement when given; null when no way walks it.
     */
    leg(from: Tile, to: Tile, reach: readonly string[], came?: string): LegWay | null;
}

/** The ticks a random row's move takes from its click (the header comment). */
export const rowTicks = (c: Pick<Crossing, 'via' | 'ticks'>): number =>
    c.ticks === undefined ? CROSSING_TICKS[c.via] : c.ticks + 1;

/** A row's requirement sets as a reach set states them: `members` is met (reach.ts SetTable.intern drops it). */
const altsOf = (c: Crossing): string[][] => c.requires.map(r => r.filter(x => x !== 'members'));

/** A LegFinder over `graph`, whose crossing rows are `crossings`. */
export function legFinder(graph: ReachGraph, crossings: readonly Crossing[]): LegFinder {
    const { index, quests } = graph;
    const at = (t: Tile): number => index.of(t.level, t.x, t.z);
    const random = crossings.filter(c => c.landings.length > 1);
    const skip = new Set<string>();
    for (const c of random)
        for (const f of c.from) for (const l of c.landings) skip.add(`${at(f)} ${at(l.tile)} ${c.via}`);
    const edgeFrom = new Map<number, readonly Edge[]>();
    for (const [from, es] of graph.edgeFrom) {
        const kept = es.filter(e => !skip.has(`${from} ${e.to} ${e.via}`));
        if (kept.length) edgeFrom.set(from, kept);
    }
    const whole = wayFinder(graph);
    const walks = wayFinder({ ...graph, edgeFrom });
    // The npcs a way back returns to.
    const returned = new Set(crossings.flatMap(c => returnsTo(c) ?? []));
    const memo = new Map<string, LegWay | null>();

    const price = (from: Tile, to: Tile, ctx: string[]): LegWay | null => {
        const plain = walks.runTicksBetween(from, to, ctx);
        const rows = random.filter(c => altsOf(c).some(a => dominates(a, ctx, quests)));
        if (!rows.length) return plain;
        // What a row must beat: the plain way, or else the whole graph's way with the row's ticks over its kind's (a
        // row's mean is at most its spread-priced way's, CROSSING_TICKS[via] swapped for its own ticks).
        let bound = plain?.runTicks;
        let fallback: Way | null = null;
        if (bound === undefined) {
            fallback = whole.runTicksBetween(from, to, ctx);
            if (!fallback) return null;
            bound = fallback.runTicks + Math.max(0, ...rows.map(c => rowTicks(c) - CROSSING_TICKS[c.via]));
        }
        // A row beats it only from a landing within `bound` of `to`, and then, a landing's spread being the walk to it
        // from the row's farthest landing, every landing of the row is within `bound` and the most spread.
        const counted = rows.flatMap(c => c.landings.filter(l => l.spread !== undefined));
        const spread = Math.max(0, ...counted.map(l => l.spread!));
        const landed = [...new Map(counted.map(l => [tileKey(l.tile), l.tile] as const)).values()];
        const onward = new Map<string, HalfWay | null>();
        walks
            .halfWays(landed, [to], ctx, HALVES * (bound + spread))
            .forEach((w, i) => onward.set(tileKey(landed[i]!), w));
        let best: LegWay | null = plain;
        for (const c of rows) {
            const ls = c.landings.filter(l => l.spread !== undefined);
            const on = ls.map(l => onward.get(tileKey(l.tile)));
            if (!ls.length || on.some(w => !w)) continue;
            const ticks = rowTicks(c);
            const weights = ls.map(l => l.chance ?? 1);
            const total = weights.reduce((a, b) => a + b, 0);
            const mean = (walkHalf: number) =>
                weights.reduce((t, w, i) => t + w * Math.ceil((walkHalf + on[i]!.half) / HALVES), 0) / total;
            // Its walk to the row is at least 0.
            if (ticks + mean(0) > (best?.runTicks ?? bound)) continue;
            const [walk] = walks.halfWays([from], c.from, ctx, HALVES * bound);
            if (!walk) continue;
            const runTicks = ticks + mean(walk.half);
            if (best && runTicks >= best.runTicks) continue;
            const alt = altsOf(c).find(a => dominates(canonicalSet([...walk.requires, ...a], quests), ctx, quests));
            if (!alt) continue;
            const requires = canonicalSet([...walk.requires, ...alt, ...on.flatMap(w => w!.requires)], quests);
            if (!dominates(requires, ctx, quests)) continue;
            const npc = c.act.kind === 'npc-op' && returned.has(c.act.npc) ? c.act.npc : undefined;
            best = { runTicks, requires, ...(npc ? { npc } : {}) };
        }
        return best ?? fallback;
    };

    return {
        finder: whole,
        leg(from, to, reach, came) {
            const ctx = came === undefined ? [...reach] : requirementSet([...reach, cameFrom(came)]);
            const key = `${tileKey(from)} ${tileKey(to)} ${ctx.join('\n')}`;
            let way = memo.get(key);
            if (way === undefined) memo.set(key, (way = price(from, to, ctx)));
            return way;
        },
    };
}

/**
 * The legs of a tour of `stands` under `reach` (LegFinder.leg), each with the came-from of the npc whose teleport the
 * leg before it crossed (the tour is a cycle: its last leg comes before its first), as a walker that came in by an npc's
 * teleport meets the way back to it. The last leg is priced first, as it comes back to the method's site: a way into
 * the essence mine, which the first leg walks out of. A leg priced before the leg that sets its npc is priced again.
 */
export function tourLegs(finder: LegFinder, stands: readonly Tile[], reach: readonly string[]): (LegWay | null)[] {
    const n = stands.length - 1;
    const legs: (LegWay | null)[] = Array.from({ length: n }, () => null);
    const npcs: (string | undefined)[] = Array.from({ length: n }, () => undefined);
    let came: string | undefined;
    const price = (i: number) => {
        npcs[i] = came;
        legs[i] = finder.leg(stands[i]!, stands[i + 1]!, reach, came);
        came = legs[i]?.npc ?? came;
    };
    for (let k = 0; k < n; k++) price((n - 1 + k) % n);
    // Once round from the last leg, `came` is what the cycle carries into it: a leg priced with another goes again.
    for (let k = 0; k < n; k++) {
        const i = (n - 1 + k) % n;
        if (npcs[i] !== came) price(i);
        else came = legs[i]?.npc ?? came;
    }
    return legs;
}
