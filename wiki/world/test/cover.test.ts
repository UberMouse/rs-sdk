import { describe, expect, test } from 'bun:test';
import { boxCover, COVER_MARGIN, coverOf } from '../cover';
import { box, boxCells, boxHeaders, coverCell, showsRoam } from '../render/common';
import type { Rect, Site } from '../types';

const rect = (x1: number, z1: number, x2: number, z2: number, level: number | null = 0): Rect =>
    level === null ? { x1, z1, x2, z2 } : { x1, z1, x2, z2, level };

const corners = (r: Rect) => [
    { x: r.x1, z: r.z1 },
    { x: r.x1, z: r.z2 },
    { x: r.x2, z: r.z1 },
    { x: r.x2, z: r.z2 },
];

// A plan's area holds a target within straight-line distance radius of its centre (conductor/lib/area.ts inArea).
const inArea = (c: { centre: { x: number; z: number }; radius: number }, t: { x: number; z: number }) =>
    Math.hypot(t.x - c.centre.x, t.z - c.centre.z) <= c.radius;

describe('box cell', () => {
    test('spans as x x1-x2, z z1-z2', () => {
        expect(box(rect(3200, 3400, 3210, 3405))).toBe('x 3200-3210, z 3400-3405');
    });
    test('a one-tile span is its coord, a one-tile box is the coord', () => {
        expect(box(rect(3200, 3400, 3200, 3405))).toBe('x 3200, z 3400-3405');
        expect(box(rect(3200, 3400, 3200, 3400))).toBe('(3200, 3400)');
    });
    test('names its level above 0, and a box of no one level', () => {
        expect(box(rect(3200, 3400, 3210, 3405, 2))).toBe('x 3200-3210, z 3400-3405 L2');
        expect(box(rect(3200, 3400, 3200, 3400, 1))).toBe('(3200, 3400) L1');
        expect(box(rect(3200, 3400, 3210, 3405, null))).toBe('x 3200-3210, z 3400-3405 every level');
    });
});

describe('area to copy', () => {
    test('an odd span centres on its middle tile', () => {
        // x 3200-3210 (11 tiles), z 3400-3404 (5 tiles): corners 5 and 2 off, hypot 5.39 -> 6.
        expect(boxCover(rect(3200, 3400, 3210, 3404), 0)).toEqual({
            centre: { level: 0, x: 3205, z: 3402 },
            radius: 6 + COVER_MARGIN,
        });
    });
    test('an even span rounds its centre up and reaches the far side', () => {
        // x 3200-3203 centre 3201.5 -> 3202, so the far corner is 2 off in x; z 3400-3401 -> 3401, 1 off.
        expect(boxCover(rect(3200, 3400, 3203, 3401), 0)).toEqual({
            centre: { level: 0, x: 3202, z: 3401 },
            radius: 3 + COVER_MARGIN,
        });
    });
    test('a one-tile box is the tile and the margin', () => {
        expect(boxCover(rect(3200, 3400, 3200, 3400), 0)).toEqual({
            centre: { level: 0, x: 3200, z: 3400 },
            radius: COVER_MARGIN,
        });
    });
    test("on the box's level, and the given level for a box of no one level", () => {
        expect(boxCover(rect(3200, 3400, 3200, 3400, 1), 0).centre.level).toBe(1);
        expect(boxCover(rect(3200, 3400, 3200, 3400, null), 2).centre.level).toBe(2);
    });
    test('every corner of a box is within the radius, with the margin to spare', () => {
        for (const r of [
            rect(3200, 3400, 3210, 3404),
            rect(3200, 3400, 3203, 3401),
            rect(2836, 3423, 2860, 3431),
            rect(3000, 3000, 3030, 3030),
            rect(3200, 3400, 3200, 3400),
        ]) {
            const c = boxCover(r, 0);
            for (const t of corners(r)) {
                expect(inArea(c, t)).toBe(true);
                expect(inArea({ ...c, radius: c.radius - COVER_MARGIN }, t)).toBe(true);
            }
        }
    });
    test('a square box needs more than its half-span: the area is a disc', () => {
        // Half-span 15 each way: the corners are 21.2 off, so a radius of 15 + margin would leave them out.
        expect(boxCover(rect(3000, 3000, 3030, 3030), 0).radius).toBe(22 + COVER_MARGIN);
    });
    test('coverOf reaches each tile of a scatter', () => {
        const tiles = [
            { level: 0, x: 2836, z: 3431 },
            { level: 0, x: 2860, z: 3426 },
            { level: 0, x: 2853, z: 3423 },
        ];
        const c = coverOf(tiles);
        expect(c.centre).toEqual({ level: 0, x: 2848, z: 3427 });
        for (const t of tiles) expect(inArea({ ...c, radius: c.radius - COVER_MARGIN }, t)).toBe(true);
    });
    test('prints the shape a plan area takes, with its level above 0', () => {
        expect(coverCell({ centre: { level: 0, x: 3205, z: 3402 }, radius: 9 })).toBe(
            '`{ x: 3205, z: 3402, radius: 9 }`',
        );
        expect(coverCell({ centre: { level: 1, x: 3205, z: 3402 }, radius: 9 })).toBe(
            '`{ x: 3205, z: 3402, radius: 9, level: 1 }`',
        );
    });
});

describe('site box cells', () => {
    const base = {
        id: 'pickpocket:town:0',
        kind: 'pickpocket',
        areaPath: [],
        centre: { level: 0, x: 3201, z: 3201 },
        bbox: rect(3200, 3200, 3202, 3202),
        stand: null,
        counts: {},
        features: [],
        f2p: false,
        multiway: false,
        wildernessLevel: 0,
        reach: [[]],
    } satisfies Site;
    const men: Site = { ...base, wander: 5, respawnTicks: 100, roam: rect(3195, 3195, 3207, 3207) };
    const tree: Site = { ...base, id: 'tree:town:0', kind: 'tree' };
    const spot: Site = { ...base, id: 'fishing-spot:town:0', kind: 'fishing-spot', wander: 0, roam: base.bbox };

    test('an npc site copies its roam, not its box', () => {
        expect(boxHeaders(true)).toEqual(['Box', 'Roam', 'Area to copy']);
        expect(boxCells(men, true)).toEqual([
            'x 3200-3202, z 3200-3202',
            'x 3195-3207, z 3195-3207',
            coverCell(boxCover(men.roam!, 0)),
        ]);
        expect(boxCover(men.roam!, 0).radius).toBe(9 + COVER_MARGIN);
    });
    test('a loc site copies its box, with no Roam column unless a site in the table has one', () => {
        expect(showsRoam([tree])).toBe(false);
        expect(boxHeaders(false)).toEqual(['Box', 'Area to copy']);
        expect(boxCells(tree, false)).toEqual(['x 3200-3202, z 3200-3202', '`{ x: 3201, z: 3201, radius: 5 }`']);
        expect(showsRoam([tree, men])).toBe(true);
        expect(boxCells(tree, true)[1]).toBe('-');
    });
    test("a fishing site shows no roam and takes the caller's pointer to its movement", () => {
        expect(showsRoam([spot])).toBe(false);
        expect(boxCells(spot, true, '[Movement](#movement)')).toEqual([
            'x 3200-3202, z 3200-3202',
            '-',
            '[Movement](#movement)',
        ]);
    });
});
