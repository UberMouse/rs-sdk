// Build checks for the classes of wrong data the world index audit found (conductor/docs/world-index-data-audit.md
// §2.2): each check returns findings that name their sites by SiteKey, a curated allowlist (allow.ts) leaves out the
// ones known and explained, and build.ts fails on what is left, and on an allowlist entry naming no site (invalid) or
// matching no finding (stale), as it does for EXPECTED_UNREACHED.
import { SITE_RADIUS } from './place';
import { resolveSiteKeys, siteKeyMatches, siteKeyName, type SiteKey, type SiteKeyWorld } from './site-key';
import type { Area, Feature, FeatureKind, Rect, Site, Tile } from './types';

/** The checks, by the id their report lines carry. */
export type CheckId = 'near-miss' | 'split';

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
function keyOf(world: SiteKeyWorld): (site: CheckWorld['sites'][number]) => SiteKey {
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
            const gap = Math.min(
                ...a.tiles.flatMap(s => b.tiles.map(t => (s.level === t.level ? cheb(s, t) : Infinity))),
            );
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
