// Build checks for the classes of wrong data the world index audit found (conductor/docs/world-index-data-audit.md
// §2.2): each check returns findings that name their sites by SiteKey, a curated allowlist (allow.ts) leaves out the
// ones known and explained, and build.ts fails on what is left, and on an allowlist entry naming no site (invalid) or
// matching no finding (stale), as it does for EXPECTED_UNREACHED.
import { SINKS } from './distance';
import { besideCluster, reachTiles, SITE_RADIUS, type SiteOptions, type StepCollision } from './place';
import { coord, STEPS, type Reach, type ReachGraph } from './reach';
import { dominates, joinUse } from './requirements';
import { resolveSiteKeys, siteKeyMatches, siteKeyName, type SiteKey, type SiteKeyWorld } from './site-key';
import type { Area, Feature, FeatureKind, Rect, Site, Tile } from './types';

/** The checks, by the id their report lines carry. */
export type CheckId = 'near-miss' | 'split' | 'stand';

/** What one check found: the site or sites it is about, by id and by key, and what is wrong with them. */
export interface Finding {
    /** The sites' ids, in the order of `keys`. */
    ids: string[];
    keys: SiteKey[];
    detail: string;
}

/** A finding a check may make, and why it is left: `keys` names its sites, one per site the finding names. */
export interface Allowed {
    keys: SiteKey[];
    reason: string;
    /** A script line (`file:line` under server/content/scripts) or a map line (`maps/mX_Z.jm2:line`). */
    source: string;
}

/** A check's findings less its allowlist. */
export interface CheckResult {
    /** The findings no entry allows, as `<keys>: <detail>`: errors. */
    left: string[];
    /** How many findings an entry allows. */
    allowed: number;
    /** Entries with a key naming no one site: errors. */
    invalid: string[];
    /** Valid entries no finding matches (fixed now, or gone), or that duplicate an earlier one's match: errors. */
    stale: string[];
}

/** What a check reads: the placed sites, the features they index and the curated areas. */
export interface CheckWorld extends SiteKeyWorld {
    sites: readonly Pick<Site, 'id' | 'kind' | 'features' | 'areaPath' | 'bbox'>[];
    features: readonly Pick<Feature, 'tile' | 'config'>[];
    areas: readonly Pick<Area, 'id' | 'parent' | 'rects'>[];
}

const keysName = (keys: readonly SiteKey[]): string => keys.map(siteKeyName).join(' and ');

/**
 * The Chebyshev distance between the nearest tiles of two rects (adjacent rects 1, overlapping ones 0), or Infinity
 * when they share no level: a rect with no level holds every level.
 */
export function rectGap(a: Rect, b: Rect): number {
    if (a.level !== undefined && b.level !== undefined && a.level !== b.level) return Infinity;
    return Math.max(0, a.x1 - b.x2, b.x1 - a.x2, a.z1 - b.z2, b.z1 - a.z2);
}

const rectName = (r: Rect): string => `x ${r.x1}-${r.x2}, z ${r.z1}-${r.z2}`;

/**
 * A key for each site: its first feature whose tile no other site of its kind holds, so the key resolves back to it.
 * A site with no such feature gets its first feature's, and an entry naming it with that key is invalid.
 */
function keyOf(world: SiteKeyWorld): (site: Pick<Site, 'kind' | 'features'>) => SiteKey {
    const matches = siteKeyMatches(world);
    return site => {
        const keys = site.features.map(i => ({ kind: site.kind, at: world.features[i]!.tile }));
        return keys.find(k => matches(k).length === 1) ?? keys[0]!;
    };
}

/** The sites a check looks at: covered kinds but trees, whose sites chain whole forests (audit E2, plan 2.4). */
const looked = (world: CheckWorld, covered: ReadonlySet<FeatureKind>): CheckWorld['sites'] =>
    world.sites.filter(s => covered.has(s.kind) && s.kind !== 'tree');

/** How far outside a leaf area's rects a site may lie and still be a near miss. */
export const NEAR_MISS_GAP = 3;

/**
 * Check 2, near-miss area (audit D): a site whose bbox lies outside every rect of a leaf area (one no area is the
 * parent of) but within NEAR_MISS_GAP tiles of one of them, on its level, while its own leaf area is another:
 * usually a rect not fitted to the place, with the site filed under the place's parent. One finding per site, naming each such area.
 */
export function nearMissAreas(world: CheckWorld, covered: ReadonlySet<FeatureKind>): Finding[] {
    const parents = new Set(world.areas.flatMap(a => (a.parent === undefined ? [] : [a.parent])));
    const leaves = world.areas.filter(a => !parents.has(a.id));
    const key = keyOf(world);
    return looked(world, covered).flatMap(site => {
        const near = leaves.flatMap(a => {
            if (a.id === site.areaPath.at(-1)) return [];
            const gaps = a.rects.map(r => rectGap(site.bbox, r));
            const gap = Math.min(...gaps);
            if (gap === 0 || gap > NEAR_MISS_GAP) return [];
            return [`${gap} tiles outside ${a.id} (${rectName(a.rects[gaps.indexOf(gap)]!)})`];
        });
        if (!near.length) return [];
        const where = site.areaPath.at(-1) ?? 'no area';
        return [
            {
                ids: [site.id],
                keys: [key(site)],
                detail: `${site.id} (${rectName(site.bbox)}) in ${where}, ${near.join('; ')}`,
            },
        ];
    });
}

const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Check 3, split resource (audit E1): two sites of one kind holding a feature of the same config, with a feature of
 * one within the kind's SITE_RADIUS of a feature of the other on its level, and whose leaf areas differ: place.ts
 * buildSites links any two features of a kind that close (Chebyshev, feature to feature, any config) but only within
 * one leaf area, so they are one place clustered as two because an area edge runs through it. One finding per pair.
 */
export function splitResources(world: CheckWorld, covered: ReadonlySet<FeatureKind>): Finding[] {
    const key = keyOf(world);
    const sites = looked(world, covered).map(s => ({
        site: s,
        tiles: s.features.map(i => world.features[i]!.tile),
        configs: new Set(s.features.map(i => world.features[i]!.config)),
    }));
    const out: Finding[] = [];
    for (let i = 0; i < sites.length; i++)
        for (let j = i + 1; j < sites.length; j++) {
            const a = sites[i]!;
            const b = sites[j]!;
            if (a.site.kind !== b.site.kind || a.site.areaPath.at(-1) === b.site.areaPath.at(-1)) continue;
            const radius = SITE_RADIUS[a.site.kind];
            // Bboxes further apart than the radius hold no two features within it.
            if (rectGap(a.site.bbox, b.site.bbox) > radius) continue;
            let gap = Infinity;
            for (const s of a.tiles) for (const t of b.tiles) if (s.level === t.level) gap = Math.min(gap, cheb(s, t));
            if (gap > radius) continue;
            const shared = [...a.configs].filter(c => b.configs.has(c));
            if (!shared.length) continue;
            out.push({
                ids: [a.site.id, b.site.id],
                keys: [key(a.site), key(b.site)],
                detail: `${a.site.id} and ${b.site.id}, ${gap} tiles apart, both hold ${shared.join(', ')}`,
            });
        }
    return out;
}

/**
 * `findings` less those an `allow` entry matches (one whose keys resolve, in `world`, to the finding's sites in any
 * order), with the entries whose keys name no one site (invalid) and the valid ones no finding matches (stale). An
 * entry matching a finding an earlier entry matches is stale too, as a duplicate of that one.
 */
export function applyAllow(findings: readonly Finding[], allow: readonly Allowed[], world: SiteKeyWorld): CheckResult {
    const named = new Map<Allowed, string>();
    const invalid: string[] = [];
    for (const e of allow) {
        const { ids, invalid: bad } = resolveSiteKeys(e.keys, world);
        if (bad.length) invalid.push(`${keysName(e.keys)} (${e.source}): ${bad.join('; ')}`);
        else
            named.set(
                e,
                e.keys
                    .map(k => ids.get(k)!)
                    .sort()
                    .join(' '),
            );
    }
    const name = (e: Allowed): string => `${keysName(e.keys)} (${e.source})`;
    const used = new Set<Allowed>();
    const dupes: string[] = [];
    const left: string[] = [];
    let allowed = 0;
    for (const f of findings) {
        const ids = [...f.ids].sort().join(' ');
        const [first, ...rest] = [...named].filter(([, n]) => n === ids).map(([e]) => e);
        if (!first) {
            left.push(`${keysName(f.keys)}: ${f.detail}`);
            continue;
        }
        allowed++;
        used.add(first);
        for (const e of rest) {
            used.add(e);
            dupes.push(`${name(e)}: a duplicate of ${name(first)}`);
        }
    }
    const unused = [...named.keys()].filter(e => !used.has(e)).map(name);
    return { left, allowed, invalid, stale: [...unused, ...dupes] };
}

/** What the stand check reads: the placed sites with their stands, reach, nearest sinks and fishing movement. */
export interface StandWorld extends SiteKeyWorld {
    sites: readonly Pick<
        Site,
        'id' | 'kind' | 'features' | 'bbox' | 'stand' | 'reach' | 'nearest' | 'wander' | 'roam' | 'movement'
    >[];
    features: readonly Pick<Feature, 'source' | 'config' | 'tile' | 'shape' | 'rotation' | 'subtype'>[];
}

/** What the stand check walks: the reach graph and the collision it was built from, and the fill over it. */
export interface StandInput {
    graph: ReachGraph;
    collision: StepCollision;
    size: SiteOptions['size'];
    /** The fill over `graph` from the Lumbridge spawn. */
    reach: Pick<Reach, 'setsAny' | 'reached'>;
    /** What using a site asks, as alternatives (build.ts useSets); absent, nothing. */
    use?: (s: Pick<Site, 'features'>) => string[][];
    /** A reach set widened into the context its nearest sinks were searched under (distance.ts NearestOptions.context). */
    context?: (set: readonly string[]) => string[];
}

const tileRect = (t: Tile, grow = 0): Rect => ({ x1: t.x - grow, z1: t.z - grow, x2: t.x + grow, z2: t.z + grow });

/**
 * The tiles each of a site's features is used from: a loc's reachTiles; an npc's walkable tiles beside where it
 * walks (besideCluster, its roam the site's wander round its spawn); a fishing spot's, the tiles beside each tile its
 * subtype's spots can stand on (Site.movement), as a spot moves to any of them.
 */
function useTiles(site: StandWorld['sites'][number], world: StandWorld, input: StandInput): Tile[][] {
    const { collision, size } = input;
    const beside = (t: Tile, wander: number): Tile[] =>
        besideCluster({ bbox: tileRect(t), roam: tileRect(t, wander), centre: t }, collision).filter(u =>
            collision.walkable(u.level, u.x, u.z),
        );
    const bySubtype = new Map<string, Tile[]>();
    return site.features.map(i => {
        const f = world.features[i]!;
        if (f.source === 'loc') return reachTiles(f, collision, size);
        const spots = site.kind === 'fishing-spot' ? site.movement?.[f.subtype]?.tiles : undefined;
        if (!spots) return beside(f.tile, site.wander ?? 0);
        let tiles = bySubtype.get(f.subtype);
        if (!tiles) bySubtype.set(f.subtype, (tiles = spots.flatMap(t => beside(t, 0))));
        return tiles;
    });
}

/**
 * The tiles a walk from tile `start` gets to by steps and by crossings that need nothing (an edge or opened loc
 * whose alternatives hold set 0, the empty set, as fillReach and priceCrossings test), inside `bound` (x and z,
 * any level), as tile indexes, handing each to `done` as it is reached; the walk stops once `done` returns true.
 * An opened loc's tile asks its requirement on the start too, as fillReach's arrive does. Read inside
 * `graph.within`, as stepMask is.
 */
function freeComponent(graph: ReachGraph, start: number, bound: Rect, done: (i: number) => boolean): void {
    const { index, edgeFrom, openAlts, stepMask } = graph;
    const inside = (i: number): boolean => {
        const [x, z] = [index.x(i), index.z(i)];
        return x >= bound.x1 && x <= bound.x2 && z >= bound.z1 && z <= bound.z2;
    };
    const seen = new Set<number>();
    const queue: number[] = [];
    let stop = false;
    const visit = (i: number): void => {
        // The start is the walk's own whatever the bound (a connector's stand is beside its 0-radius bbox).
        if (stop || i < 0 || seen.has(i) || (i !== start && !inside(i))) return;
        if (openAlts.get(i)?.includes(0) === false) return;
        seen.add(i);
        queue.push(i);
        stop = done(i);
    };
    visit(start);
    while (queue.length) {
        if (stop) return;
        const i = queue.pop()!;
        const m = stepMask(i);
        const [level, x, z] = [index.level(i), index.x(i), index.z(i)];
        for (let bit = 0; bit < 8; bit++)
            if (m & (1 << bit)) visit(index.of(level, x + STEPS[bit]![0], z + STEPS[bit]![1]));
        for (const e of edgeFrom.get(i) ?? []) if (e.alts.includes(0)) visit(e.to);
    }
}

/**
 * The most an npc site wanders for which the stand check walks to its members. An npc's use tiles lie up to its
 * wander past its spawn (useTiles), so the walk's bound grows with it; the sites tested today wander 63 at most,
 * and a config wandering map-wide (quest_fluffs.npc:57, wanderrange=30000) would make the walk the whole map.
 */
const MAX_WANDER = 64;

/**
 * How many of a site's members (`tiles`, each member's use tiles) the free walk from tile `start` gets to a use tile
 * of, bounded to the site's roam (its bbox when it has none) grown by twice its kind's SITE_RADIUS, the way round
 * a wall. The walk stops once half are, so a count under half is exact. Undefined for a site wandering past
 * MAX_WANDER, whose bound would be most of the map: it is not walked, so it is never found cut off on a walk
 * capped short of its members.
 */
function usableFrom(
    graph: ReachGraph,
    site: StandWorld['sites'][number],
    start: number,
    tiles: readonly Tile[][],
): number | undefined {
    if ((site.wander ?? 0) > MAX_WANDER) return undefined;
    const grow = 2 * SITE_RADIUS[site.kind];
    const { x1, z1, x2, z2 } = site.roam ?? site.bbox;
    // The members each tile is a use tile of.
    const membersAt = new Map<number, number[]>();
    tiles.forEach((ts, m) => {
        for (const t of ts) {
            const i = graph.index.of(t.level, t.x, t.z);
            membersAt.set(i, [...(membersAt.get(i) ?? []), m]);
        }
    });
    const usable = new Set<number>();
    freeComponent(graph, start, { x1: x1 - grow, z1: z1 - grow, x2: x2 + grow, z2: z2 + grow }, i => {
        for (const m of membersAt.get(i) ?? []) usable.add(m);
        return usable.size * 2 >= tiles.length;
    });
    return usable.size;
}

/**
 * Check 4, stand connectivity (audit E4): a site with a stand some set reaches whose stand's free walk component
 * (freeComponent, bounded to the site's roam grown by twice the kind's SITE_RADIUS: usableFrom) holds a use tile
 * (useTiles) of fewer
 * than half its members, or, for a kind that takes its products to a bank (distance.ts SINKS), whose stand has no
 * nearest bank or one whose way asks more than any member's own way in does: place.ts standTile takes the
 * walkable candidate nearest the centre, which can be a pocket the members are not in. A member is a feature with
 * a use tile some walk gets to: one used from nowhere (a duck mid-pond, a banker behind the counter) is no stand's
 * to reach. A member's way in is the sets of its use tiles joined with what using the site asks, in the context its
 * nearest sinks were searched under, as the site's reach is the stand's (build.ts addReach). One finding per site.
 */
export function standConnectivity(world: StandWorld, input: StandInput): Finding[] {
    const { graph, collision, reach } = input;
    const key = keyOf(world);
    const sites = world.sites.filter(s => s.stand && s.reach.length > 0);
    const walled = collision.walled ?? (<T>(f: () => T): T => f());
    const uses = walled(() =>
        sites.map(s => useTiles(s, world, input).flatMap(ts => (ts.some(reach.reached) ? [ts] : []))),
    );
    /** The sets of the members' ways in. */
    const waysIn = (site: StandWorld['sites'][number], tiles: readonly Tile[][]): string[][] => {
        const gated = input.use?.(site) ?? [[]];
        const context = input.context ?? ((set: readonly string[]) => [...set]);
        return tiles.flatMap(ts => joinUse(reach.setsAny(ts), gated, graph.quests).map(context));
    };
    return graph.within(() =>
        sites.flatMap((site, n) => {
            const stand = site.stand!;
            const start = graph.index.of(stand.level, stand.x, stand.z);
            const tiles = uses[n]!;
            if (start < 0 || !tiles.length) return [];
            const wrong: string[] = [];
            const usable = usableFrom(graph, site, start, tiles);
            if (usable !== undefined && usable * 2 < tiles.length)
                wrong.push(`${usable} of ${tiles.length} members usable from the stand`);
            if (SINKS[site.kind]?.includes('bank')) {
                const bank = site.nearest?.bank;
                if (!bank) wrong.push('no bank from the stand');
                else if (!waysIn(site, tiles).some(w => dominates(bank.requires, w, graph.quests)))
                    wrong.push(
                        `its nearest bank ${bank.site} needs [${bank.requires.join(', ')}], more than any member's way in`,
                    );
            }
            if (!wrong.length) return [];
            return [
                { ids: [site.id], keys: [key(site)], detail: `${site.id} stand ${coord(stand)}: ${wrong.join('; ')}` },
            ];
        }),
    );
}
