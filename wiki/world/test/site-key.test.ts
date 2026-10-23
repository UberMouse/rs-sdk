import { describe, expect, test } from 'bun:test';
import { resolveSiteKeys, siteKeyName, type SiteKey } from '../site-key';
import type { FeatureKind, Tile } from '../types';

const tile = (x: number, z: number, level = 0): Tile => ({ level, x, z });
const key = (kind: FeatureKind, t: Tile): SiteKey => ({ kind, at: t });

// Features 0..4; a site lists the ones it holds.
const features = [tile(10, 10), tile(11, 10), tile(20, 20), tile(20, 20, 1), tile(30, 30)].map(t => ({ tile: t }));
const world = {
    features,
    sites: [
        { id: 'tree:wood:0', kind: 'tree' as const, features: [0, 1] },
        // A rock on a tree's tile: the kind tells them apart.
        { id: 'rock:wood:0', kind: 'rock' as const, features: [0] },
        { id: 'tree:wood:1', kind: 'tree' as const, features: [2] },
        { id: 'tree:loft:0', kind: 'tree' as const, features: [3] },
        // Two sites holding the one tile.
        { id: 'fire:camp:0', kind: 'fire' as const, features: [4] },
        { id: 'fire:camp:1', kind: 'fire' as const, features: [4] },
    ],
};

describe('site keys', () => {
    test('a key names the site of its kind holding a feature on its tile, by any of the site’s features', () => {
        const keys = [
            key('tree', tile(10, 10)),
            key('tree', tile(11, 10)),
            key('rock', tile(10, 10)),
            key('tree', tile(20, 20)),
            key('tree', tile(20, 20, 1)),
        ];
        const { ids, invalid } = resolveSiteKeys(keys, world);
        expect(keys.map(k => ids.get(k))).toEqual([
            'tree:wood:0',
            'tree:wood:0',
            'rock:wood:0',
            'tree:wood:1',
            'tree:loft:0',
        ]);
        expect(invalid).toEqual([]);
    });

    test('a key matching no site, or two, is invalid, named with the sites it matches', () => {
        const keys = [
            key('tree', tile(12, 10)),
            key('rock', tile(11, 10)),
            key('tree', tile(10, 10, 1)),
            key('fire', tile(30, 30)),
        ];
        const { ids, invalid } = resolveSiteKeys(keys, world);
        expect(ids.size).toBe(0);
        expect(invalid).toEqual([
            'tree (12, 10, 0): no site holds it',
            'rock (11, 10, 0): no site holds it',
            'tree (10, 10, 1): no site holds it',
            'fire (30, 30, 0): sites fire:camp:0, fire:camp:1 hold it',
        ]);
    });

    test('a site with several features on the key’s tile is still one match', () => {
        const stacked = { features, sites: [{ id: 'bank:hall:0', kind: 'bank' as const, features: [2, 2] }] };
        const k = key('bank', tile(20, 20));
        expect(resolveSiteKeys([k], stacked).ids.get(k)).toBe('bank:hall:0');
    });

    test('a report names a key by kind and tile', () =>
        expect(siteKeyName(key('tree', tile(2731, 3487)))).toBe('tree (2731, 3487, 0)'));
});
