// Npc movement over the real game data and the committed world.json: wander, respawn and scripted moves as the
// reader takes them from the configs and scripts, and the roam every npc cluster and npc site carries.
import { describe, expect, test } from 'bun:test';
import { loadWorld } from '../load';
import { readConfigs } from '../sources/configs';
import { readConstants } from '../sources/constants';
import { npcMovements, readMovementDefaults } from '../sources/npc-movement';
import { readScripts } from '../sources/triggers';
import type { NpcRoam, Rect } from '../types';

const world = loadWorld();
const movements = npcMovements(readConfigs('npc'), readScripts(), readMovementDefaults(), readConstants());
const npcSites = world.sites.filter(s => s.features.every(i => world.features[i]!.source === 'npc'));

describe('npcMovements', () => {
    test("reads the engine's defaults where NpcType.ts sets them", () => {
        const d = readMovementDefaults();
        expect([d.wanderRange.value, d.respawnRate.value, d.defaultMode, d.moveRestrict]).toEqual([
            5,
            100,
            'wander',
            'normal',
        ]);
    });

    test('a Knight of Ardougne wanders 15, and so do its clusters', () => {
        expect(movements.get('knight_of_ardougne')!.wander).toBe(15);
        const knights = world.npcSpawns.filter(c => c.config === 'knight_of_ardougne');
        expect(knights.length).toBeGreaterThan(0);
        expect(knights.every(c => c.wander === 15)).toBe(true);
    });

    test('imps teleport and Canifis citizens change type, on every cluster of theirs', () => {
        expect(movements.get('imp')!.moves).toEqual({ how: 'teleports', source: 'npc/scripts/imp.rs2:21' });
        const citizens = [...movements].filter(([name]) => /^canafis_(man|woman)\d$/.test(name));
        expect(citizens.length).toBe(6);
        for (const [, m] of citizens)
            expect(m.moves).toEqual({
                how: 'changes-type',
                source: 'areas/area_canifis/scripts/canafis_citizen.rs2:22',
            });
        const placed = world.npcSpawns.filter(c => c.config === 'imp' || /^canafis_(man|woman)\d$/.test(c.config));
        expect(placed.length).toBeGreaterThan(0);
        expect(placed.every(c => c.moves !== undefined)).toBe(true);
    });
});

const contains = (outer: Rect, inner: Rect): boolean =>
    outer.x1 <= inner.x1 && outer.z1 <= inner.z1 && outer.x2 >= inner.x2 && outer.z2 >= inner.z2;

describe('roam', () => {
    const roams: { name: string; bbox: Rect; roam: NpcRoam }[] = [
        ...world.npcSpawns.map(c => ({ name: `${c.config} ${c.centre.x},${c.centre.z}`, bbox: c.bbox, roam: c })),
        ...npcSites.map(s => ({ name: s.id, bbox: s.bbox, roam: s as NpcRoam })),
    ];

    test('every npc cluster and npc site carries one, holding its bbox, and equal to it at wander 0', () => {
        expect(npcSites.every(s => s.roam !== undefined)).toBe(true);
        const bad = roams.filter(
            ({ bbox, roam: r }) => !contains(r.roam, bbox) || (r.wander === 0 && !contains(bbox, r.roam)),
        );
        expect(bad.map(b => b.name)).toEqual([]);
    });

    test('a site holding a loc has none', () => {
        const withLoc = world.sites.filter(s => !npcSites.includes(s));
        expect(withLoc.filter(s => s.roam !== undefined).map(s => s.id)).toEqual([]);
    });

    test('nine in ten npc clusters wander past their bbox (the design doc, A3: 92.5% of 4537)', () => {
        const share = world.npcSpawns.filter(c => c.wander > 0).length / world.npcSpawns.length;
        expect(share).toBeGreaterThan(0.9);
        expect(share).toBeLessThan(0.95);
    });
});
