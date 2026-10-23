// The curated site keys against the committed world.json: each names one site, and the same sites when every site
// is renumbered.
import { describe, expect, test } from 'bun:test';
import { OVERRIDES } from '../../../conductor/lib/banks';
import { EXPECTED_UNREACHED } from '../areas';
import { loadWorld } from '../load';
import { resolveSiteKeys, type SiteKey } from '../site-key';
import type { Site, World } from '../types';

const world = loadWorld();
const keys: SiteKey[] = [
    ...EXPECTED_UNREACHED.flatMap(e => ('site' in e ? [e.site] : [])),
    ...OVERRIDES.map(([key]) => key),
];

/** A seeded generator in [0, 1) (mulberry32), so a failure reproduces. */
function random(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The world with each kind's site ids dealt out again to its sites in a shuffled order, as a reclustering might. */
function relabelled(w: World, seed: number): World {
    const next = random(seed);
    const byKind = new Map<string, Site[]>();
    for (const s of w.sites) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
    const id = new Map<Site, string>();
    for (const sites of byKind.values()) {
        const ids = sites.map(s => s.id);
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(next() * (i + 1));
            [ids[i], ids[j]] = [ids[j]!, ids[i]!];
        }
        sites.forEach((s, i) => id.set(s, ids[i]!));
    }
    return { ...w, sites: w.sites.map(s => ({ ...s, id: id.get(s)! })) };
}

/** Each key's site id. */
function resolved(w: World): string[] {
    const { ids, invalid } = resolveSiteKeys(keys, w);
    expect(invalid).toEqual([]);
    return keys.map(k => ids.get(k)!);
}

/** Each key's site, as the features it holds. */
function suppressed(w: World): number[][] {
    const byId = new Map(w.sites.map(s => [s.id, s]));
    return resolved(w).map(id => byId.get(id)!.features);
}

describe('the curated site keys', () => {
    test('EXPECTED_UNREACHED and the bank OVERRIDES each name one site, no two the same', () => {
        const { ids, invalid } = resolveSiteKeys(keys, world);
        expect(invalid).toEqual([]);
        expect(new Set(ids.values()).size).toBe(keys.length);
    });

    test('renumbering every site within its kind leaves the sites they name unchanged', () => {
        const before = suppressed(world);
        const ids = resolved(world);
        for (const seed of [1, 2, 3]) {
            const shuffled = relabelled(world, seed);
            // The shuffle does move the ids the keys resolve to.
            const moved = resolved(shuffled).filter((id, i) => id !== ids[i]);
            expect(moved.length).toBeGreaterThan(keys.length / 2);
            expect(suppressed(shuffled)).toEqual(before);
        }
    });
});
