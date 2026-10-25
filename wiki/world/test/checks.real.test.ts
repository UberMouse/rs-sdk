// The build checks against the committed world.json, before allow.ts is applied: they find the audit's examples
// (conductor/docs/world-index-data-audit.md §1.4, §1.5), and the allowlists leave nothing and match every entry.
import { describe, expect, test } from 'bun:test';
import { NEAR_MISS_ALLOW, SPLIT_ALLOW, STAND_ALLOW } from '../allow';
import { COVERED, useSets } from '../build';
import { applyAllow, nearMissAreas, splitResources, standConnectivity, type Finding } from '../checks';
import { reachCollision } from '../collision';
import { USE_GATES } from '../gates';
import { loadWorld } from '../load';
import { locSizes } from '../place';
import { fillReach, reachGraph } from '../reach';
import { resolveSiteKeys, siteAt, type SiteKey } from '../site-key';
import { readConfigs } from '../sources/configs';
import { readConstants } from '../sources/constants';
import { npcMovements, readMovementDefaults } from '../sources/npc-movement';
import { cameFromContext } from '../sources/npc-teleports';
import { readScripts } from '../sources/triggers';

const world = loadWorld();
const near = nearMissAreas(world, COVERED);
const split = splitResources(world, COVERED);
// As the build walks it: the graph over world.json's rows and the collision the SDK bundles, the fill from the
// Lumbridge spawn, the npc configs' movement, the use gates and the essence mine's came-from context.
const size = locSizes(readConfigs('loc'));
const movements = npcMovements(readConfigs('npc'), readScripts(), readMovementDefaults(), readConstants());
const graph = reachGraph({ world, collision: reachCollision, size });
const stand = standConnectivity(world, {
    graph,
    collision: reachCollision,
    size,
    reach: fillReach({ world, collision: reachCollision, size }, graph),
    movement: c => movements.get(c)!,
    use: useSets(world.features, USE_GATES),
    context: cameFromContext(world.crossings),
});

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

/** The stand finding naming the site a key names, or undefined. */
const of = (key: SiteKey): Finding | undefined => {
    const { ids, invalid } = resolveSiteKeys([key], world);
    expect(invalid).toEqual([]);
    return stand.find(f => f.ids[0] === ids.get(key));
};

describe('stand connectivity', () => {
    test("audit E4's fishing examples are gone: the cut-off spots are used from nowhere, or move to the stand's walk", () => {
        // fishing-spot:kandarin:1's seven others are loc_2027s no tile uses, so no stand's to reach;
        // fishing-spot:tirannwn:1's four spots move over one enum, beside a tile of which the stand's free walk gets.
        expect(of(siteAt('fishing-spot', 2504, 3498))).toBeUndefined();
        expect(of(siteAt('fishing-spot', 2210, 3237))).toBeUndefined();
        expect(stand.filter(f => f.keys[0]!.kind === 'fishing-spot')).toEqual([]);
    });

    test("Catherby's shore stand, out of Harry's shop since main's fix, sees its spots and a bank", () =>
        expect(of(siteAt('fishing-spot', 2836, 3431))).toBeUndefined());

    test('the tree stands with no bank: a Mort Myre pocket and the Shilo Village cavern', () =>
        expect(
            stand
                .filter(f => f.keys[0]!.kind === 'tree' && f.detail.includes('no bank'))
                .map(f => f.ids[0])
                .sort(),
        ).toEqual([
            'tree:morytania:3',
            'tree:shilo-village-quest-dungeon:0',
            'tree:shilo-village-quest-dungeon:1',
            'tree:shilo-village-quest-dungeon:2',
        ]));

    test('finds stands on the wrong side of a gated door from their members', () => {
        expect(of(siteAt('npc', 2546, 3560))?.detail).toBe(
            'npc:barbarian-outpost:0 stand (2554, 3559): 0 of 8 members usable from the stand',
        );
        expect(of(siteAt('tree', 2577, 3086))?.detail).toBe(
            'tree:wizards-guild:1 stand (2589, 3076): 8 of 17 members usable from the stand',
        );
    });

    test("audit E4's groups: 17 stands with members cut off, 37 with no bank or one asking more, none in both", () => {
        const cut = stand.filter(f => f.detail.includes('members usable from the stand'));
        const bank = stand.filter(f => /no bank from the stand|more than any member's way in/.test(f.detail));
        expect([cut.length, bank.length]).toEqual([17, 37]);
        expect(cut.filter(f => bank.includes(f))).toEqual([]);
        expect(stand.filter(f => f.detail.includes('MAX_WANDER'))).toEqual([]);
    });

    test('by kind: npc 37, rock 6, tree 9, pickpocket 2', () => {
        const kinds = new Map<string, number>();
        for (const f of stand) kinds.set(f.keys[0]!.kind, (kinds.get(f.keys[0]!.kind) ?? 0) + 1);
        expect(Object.fromEntries(kinds)).toEqual({ npc: 37, pickpocket: 2, rock: 6, tree: 9 });
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
        expect(applyAllow(stand, STAND_ALLOW, world)).toEqual({
            left: [],
            allowed: stand.length,
            invalid: [],
            stale: [],
        });
    });

    test('has a reason and a script or map line on every entry', () => {
        for (const e of [...NEAR_MISS_ALLOW, ...SPLIT_ALLOW, ...STAND_ALLOW]) {
            expect(e.reason.length).toBeGreaterThan(0);
            expect(e.source).toMatch(/^(maps\/m\d+_\d+\.jm2|[\w/]+\.rs2):\d+$/);
        }
    });
});
