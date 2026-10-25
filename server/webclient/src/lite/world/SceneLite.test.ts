// Bridge (LinkBelow) locs: the server lowers a level-1 loc on a bridge tile to
// level 0 (GameMap.loadLocations); the scene must answer at the server's level.

import { describe, expect, test } from 'bun:test';

import '../dom-shim.js';

import { LocLayer } from '#/dash3d/LocLayer.js';

import type { LocIndex } from './LocIndex.js';
import { SceneLite } from './SceneLite.js';

const BRIDGE = { x: 3047, z: 3205 };
const GANGPLANK = (2593 << 7) | (10 << 2);
const RAW2 = (3000 << 7) | (10 << 2);
const LOW = (111 << 7) | (10 << 2);

/** Fake index: bridge flag at level 1 on BRIDGE; a deck loc at raw level 1, a loc under it at raw 0. */
function fakeIndex(): LocIndex {
    return {
        mapFlags: (level: number, x: number, z: number) => (level === 1 && x === BRIDGE.x && z === BRIDGE.z ? 2 : 0),
        lookup: (layer: LocLayer, level: number, x: number, z: number) => {
            if (layer !== LocLayer.GROUND || x !== BRIDGE.x || z !== BRIDGE.z) return 0;
            // Mask the level like LocIndex.packKey, so level 4 wraps to 0.
            const raw = level & 3;
            return raw === 1 ? GANGPLANK : raw === 0 ? LOW : raw === 2 ? RAW2 : 0;
        }
    } as unknown as LocIndex;
}

describe('SceneLite bridge locs', () => {
    const scene = new SceneLite(fakeIndex());
    scene.setBase(3000, 3150);
    const sx = BRIDGE.x - 3000;
    const sz = BRIDGE.z - 3150;

    test('a raw level 1 loc on a bridge tile is found at level 0', () => {
        expect((scene.sceneType(0, sx, sz) >> 14) & 0x7fff).toBe(2593);
    });

    test('the loc stored below the deck is dropped, as on the server', () => {
        // server level 1 reads raw 2 here, never the raw-0 loc below the deck
        expect((scene.sceneType(1, sx, sz) >> 14) & 0x7fff).toBe(3000);
        expect(scene.staticLocIdAt(LocLayer.GROUND, 0, BRIDGE.x, BRIDGE.z)).toBe(2593);
    });

    test('server level 3 on a bridge tile is empty, not the wrapped raw level 0', () => {
        expect(scene.sceneType(3, sx, sz)).toBe(0);
        expect(scene.staticLocIdAt(LocLayer.GROUND, 3, BRIDGE.x, BRIDGE.z)).toBe(0);
    });

    test('a non-bridge tile keeps raw levels', () => {
        expect(scene.sceneType(0, sx + 1, sz)).toBe(0);
    });

    test('an overlay entry at the server level wins', () => {
        scene.delLoc(0, BRIDGE.x, BRIDGE.z, 10);
        expect(scene.sceneType(0, sx, sz)).toBe(0);
    });
});
