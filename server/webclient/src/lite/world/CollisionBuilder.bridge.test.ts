// Bridge (LinkBelow) tiles: the zone overlay is keyed by SERVER level while the
// static index keeps raw file levels; collision must read each at its own level.

import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import '../dom-shim.js';

import LocType from '#/config/LocType.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import { LocLayer } from '#/dash3d/LocLayer.js';

import { buildCollision } from './CollisionBuilder.js';
import type { LocIndex } from './LocIndex.js';
import { SceneLite } from './SceneLite.js';

const BASE_X = 3000;
const BASE_Z = 3150;
const BRIDGE = { x: 3047, z: 3205 };
const PLAIN = { x: 3048, z: 3205 };
const CRATE = (7 << 7) | (10 << 2); // loc 7, shape 10 (centrepiece), angle 0

/** Raw level 1 crate on the bridge tile and on a plain tile; level 1 LinkBelow on the bridge tile only. */
function fakeIndex(): LocIndex {
    return {
        mapFlags: (level: number, x: number, z: number) => (level === 1 && x === BRIDGE.x && z === BRIDGE.z ? 2 : 0),
        lookup: (layer: LocLayer, level: number, x: number, z: number) => {
            if (layer !== LocLayer.GROUND || level !== 1) return 0;
            return (x === BRIDGE.x || x === PLAIN.x) && z === BRIDGE.z ? CRATE : 0;
        }
    } as unknown as LocIndex;
}

function build(scene: SceneLite): CollisionMap[] {
    const maps: (CollisionMap | null)[] = [null, null, null, null];
    buildCollision(fakeIndex(), BASE_X, BASE_Z, maps, scene.overlayEntries);
    return maps as CollisionMap[];
}

function blocked(maps: CollisionMap[], level: number, at: { x: number; z: number }): boolean {
    return maps[level].flags[CollisionMap.index(at.x - BASE_X, at.z - BASE_Z)] !== maps[level].flags[CollisionMap.index(10, 10)];
}

describe('CollisionBuilder bridge tiles', () => {
    const spy = spyOn(LocType, 'list').mockImplementation(() => ({ blockwalk: true, blockrange: true, active: false, width: 1, length: 1 }) as unknown as LocType);
    afterEach(() => spy.mockClear());

    test('a static raw level 1 loc lands on level 0 on a bridge tile, level 1 elsewhere', () => {
        const maps = build(new SceneLite(fakeIndex()));
        expect(BuildArea.LEVELS).toBe(4);
        expect(blocked(maps, 0, BRIDGE)).toBe(true);
        expect(blocked(maps, 1, BRIDGE)).toBe(false);
        expect(blocked(maps, 1, PLAIN)).toBe(true);
        expect(blocked(maps, 0, PLAIN)).toBe(false);
    });

    test('an overlay delete at the server level removes the bridge loc', () => {
        const scene = new SceneLite(fakeIndex());
        scene.setBase(BASE_X, BASE_Z);
        scene.delLoc(0, BRIDGE.x, BRIDGE.z, 10);
        const maps = build(scene);
        expect(blocked(maps, 0, BRIDGE)).toBe(false);
        expect(blocked(maps, 1, PLAIN)).toBe(true);
    });

    test('an overlay add at the server level lands on that level', () => {
        const scene = new SceneLite(fakeIndex());
        scene.setBase(BASE_X, BASE_Z);
        scene.addLoc(1, BRIDGE.x, BRIDGE.z - 1, 7, 10, 0);
        const maps = build(scene);
        // server level 1 on a plain tile is raw 1; the neighbour tile is not bridged
        expect(blocked(maps, 1, { x: BRIDGE.x, z: BRIDGE.z - 1 })).toBe(true);
    });

    test('an overlay add on the bridge tile at server level 0 blocks level 0', () => {
        const scene = new SceneLite(fakeIndex());
        scene.setBase(BASE_X, BASE_Z);
        scene.delLoc(0, BRIDGE.x, BRIDGE.z, 10);
        scene.addLoc(0, BRIDGE.x, BRIDGE.z, 7, 10, 0);
        expect(blocked(build(scene), 0, BRIDGE)).toBe(true);
    });
});
