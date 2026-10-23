// Curated references to sites. A site's id (`tree:kandarin:7`) is its ordinal within its kind and leaf area
// (place.ts buildSites), so any change to the clustering renumbers it, and a table naming that id would then name
// another site. A SiteKey names a site by one of its features' tiles instead: a feature belongs to exactly one site
// whatever clustering does to the others, where a site's bbox can overlap others (the largest tree site's spans 287×313
// tiles).
import type { Feature, FeatureKind, Site, Tile } from './types';

/** The one site of `kind` holding a feature whose tile is `at`. */
export interface SiteKey {
    kind: FeatureKind;
    at: Tile;
}

/** A key as reports name it: `tree (2731, 3487, 0)`. */
export const siteKeyName = (key: SiteKey): string => `${key.kind} (${key.at.x}, ${key.at.z}, ${key.at.level})`;

/** What a key is resolved against: the placed sites and the features they index. */
export interface SiteKeyWorld {
    sites: readonly Pick<Site, 'id' | 'kind' | 'features'>[];
    features: readonly Pick<Feature, 'tile'>[];
}

const slot = (kind: FeatureKind, t: Tile): string => `${kind} ${t.level} ${t.x} ${t.z}`;

/** Every site id `key` matches, for each key: one when it names a site, none or several when it does not. */
export function siteKeyMatches(world: SiteKeyWorld): (key: SiteKey) => string[] {
    const ids = new Map<string, string[]>();
    for (const s of world.sites)
        for (const i of s.features) {
            const k = slot(s.kind, world.features[i]!.tile);
            const at = ids.get(k);
            if (!at) ids.set(k, [s.id]);
            else if (!at.includes(s.id)) at.push(s.id);
        }
    return key => ids.get(slot(key.kind, key.at)) ?? [];
}

/** Why a key matching `ids` names no one site. */
export const unresolved = (ids: readonly string[]): string =>
    ids.length ? `sites ${ids.join(', ')} hold it` : 'no site holds it';

/**
 * Each key's site id, and the keys that name no one site: `invalid`, by siteKeyName with the ids of the sites
 * it matches when it matches several.
 */
export function resolveSiteKeys(
    keys: readonly SiteKey[],
    world: SiteKeyWorld,
): { ids: Map<SiteKey, string>; invalid: string[] } {
    const matches = siteKeyMatches(world);
    const ids = new Map<SiteKey, string>();
    const invalid: string[] = [];
    for (const key of keys) {
        const hit = matches(key);
        if (hit.length === 1) ids.set(key, hit[0]!);
        else invalid.push(`${siteKeyName(key)}: ${unresolved(hit)}`);
    }
    return { ids, invalid };
}
