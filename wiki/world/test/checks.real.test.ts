// The build checks against the committed world.json, before allow.ts is applied: they find the audit's examples
// (conductor/docs/world-index-data-audit.md §1.4, §1.5), and the allowlists leave nothing and match every entry.
import { describe, expect, test } from 'bun:test';
import { NEAR_MISS_ALLOW, SPLIT_ALLOW } from '../allow';
import { COVERED } from '../build';
import { applyAllow, nearMissAreas, splitResources } from '../checks';
import { loadWorld } from '../load';
import { resolveSiteKeys, siteAt } from '../site-key';

const world = loadWorld();
const near = nearMissAreas(world, COVERED);
const split = splitResources(world, COVERED);

describe('near-miss areas', () => {
    test("finds Port Sarim's fireplace a tile north of its rect", () =>
        expect(near.find(f => f.detail.includes('outside port-sarim'))?.keys).toEqual([
            { kind: 'fire', at: { level: 0, x: 3024, z: 3245 } },
        ]));

    test("Port Sarim's shops west of its rect lie past the near-miss gap (audit D1), so it does not find them", () => {
        // Betty, Gerrant, Grum, Wydin and Brian.
        const shops = [
            siteAt('shop', 3012, 3259),
            siteAt('shop', 3013, 3225),
            siteAt('shop', 3013, 3248),
            siteAt('shop', 3014, 3204),
            siteAt('shop', 3028, 3250),
        ];
        const { ids, invalid } = resolveSiteKeys(shops, world);
        expect(invalid).toEqual([]);
        expect(near.filter(f => f.ids.some(id => [...ids.values()].includes(id)))).toEqual([]);
    });

    test("finds the Crafting Guild's interior east of its rect (audit D2)", () =>
        expect(
            near
                .filter(f => f.detail.includes('outside crafting-guild'))
                .map(f => f.keys[0]!.kind)
                .sort(),
        ).toEqual(['pottery-wheel', 'spinning-wheel', 'tanner', 'water-source']));
});

describe('split resources', () => {
    test('finds the Coal Trucks mine split at its rect', () =>
        expect(split.find(f => f.detail.includes('coal-trucks'))?.keys).toEqual([
            siteAt('rock', 2588, 3481),
            siteAt('rock', 2574, 3480),
        ]));

    test('finds the Rellekka flax split at its rect', () =>
        expect(split.find(f => f.detail.includes('rellekka'))?.keys).toEqual([
            siteAt('flax', 2614, 3635),
            siteAt('flax', 2616, 3646),
        ]));

    test('pairs by kind: rock 6, pickpocket 10, anvil 1, flax 1', () => {
        const byKind: Record<string, number> = {};
        for (const f of split) byKind[f.keys[0]!.kind] = (byKind[f.keys[0]!.kind] ?? 0) + 1;
        expect(byKind).toEqual({ anvil: 1, flax: 1, pickpocket: 10, rock: 6 });
    });
});

describe('allow.ts', () => {
    test('allows every finding, and each entry names its sites and matches one', () => {
        expect(applyAllow(near, NEAR_MISS_ALLOW, world)).toEqual({
            left: [],
            allowed: near.length,
            invalid: [],
            stale: [],
        });
        expect(applyAllow(split, SPLIT_ALLOW, world)).toEqual({
            left: [],
            allowed: split.length,
            invalid: [],
            stale: [],
        });
    });

    test('has a reason and a script or map line on every entry', () => {
        for (const e of [...NEAR_MISS_ALLOW, ...SPLIT_ALLOW]) {
            expect(e.reason.length).toBeGreaterThan(0);
            expect(e.source).toMatch(/^(maps\/m\d+_\d+\.jm2|[\w/]+\.rs2):\d+$/);
        }
    });
});
