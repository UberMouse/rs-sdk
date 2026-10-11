import { describe, expect, test } from 'bun:test';
import { areaResolver } from '../area-resolve';
import type { Area } from '../types';

const areas: Area[] = [
    { id: 'misthalin', name: 'Misthalin', rects: [{ x1: 3072, z1: 3136, x2: 3391, z2: 3519 }] },
    { id: 'varrock', name: 'Varrock', parent: 'misthalin', rects: [{ x1: 3172, z1: 3372, x2: 3295, z2: 3505 }] },
    {
        id: 'varrock-west-bank',
        name: 'Varrock West bank',
        parent: 'varrock',
        rects: [{ x1: 3180, z1: 3433, x2: 3191, z2: 3447, level: 0 }],
    },
];

describe('areaResolver', () => {
    const resolve = areaResolver(areas);

    test('deepest containing area, as a path', () =>
        expect(resolve({ level: 0, x: 3186, z: 3440 })).toEqual(['misthalin', 'varrock', 'varrock-west-bank']));

    test('a level-restricted rect does not hold other levels', () =>
        expect(resolve({ level: 1, x: 3186, z: 3440 })).toEqual(['misthalin', 'varrock']));

    test('outside every area', () => expect(resolve({ level: 0, x: 10, z: 10 })).toEqual([]));

    test('a child rect outside its parent is a build error', () =>
        expect(() =>
            areaResolver([
                ...areas,
                { id: 'bad', name: 'Bad', parent: 'varrock', rects: [{ x1: 0, z1: 0, x2: 5, z2: 5 }] },
            ]),
        ).toThrow(/bad/));

    test('rect edges are inclusive', () => {
        expect(resolve({ level: 0, x: 3191, z: 3447 })).toEqual(['misthalin', 'varrock', 'varrock-west-bank']);
        expect(resolve({ level: 0, x: 3192, z: 3447 })).toEqual(['misthalin', 'varrock']);
    });

    test('between siblings that overlap, the smaller wins', () => {
        const r = areaResolver([
            ...areas,
            { id: 'palace', name: 'Palace', parent: 'misthalin', rects: [{ x1: 3200, z1: 3470, x2: 3230, z2: 3500 }] },
        ]);
        expect(r({ level: 0, x: 3210, z: 3480 })).toEqual(['misthalin', 'palace']);
        expect(r({ level: 0, x: 3210, z: 3460 })).toEqual(['misthalin', 'varrock']);
    });

    test('an underground area is an ordinary rect at z + 6400', () => {
        const r = areaResolver([
            ...areas,
            {
                id: 'edgeville-dungeon',
                name: 'Edgeville Dungeon',
                rects: [{ x1: 3090, z1: 9860, x2: 3150, z2: 9990, level: 0 }],
            },
        ]);
        expect(r({ level: 0, x: 3100, z: 9900 })).toEqual(['edgeville-dungeon']);
        expect(r({ level: 0, x: 3100, z: 3500 })).toEqual(['misthalin']);
    });

    test('a child may span several parent rects that together hold it', () => {
        const parent: Area = {
            id: 'p',
            name: 'P',
            rects: [
                { x1: 0, z1: 0, x2: 9, z2: 9 },
                { x1: 10, z1: 0, x2: 19, z2: 9 },
            ],
        };
        const child: Area = { id: 'c', name: 'C', parent: 'p', rects: [{ x1: 5, z1: 2, x2: 14, z2: 7 }] };
        expect(areaResolver([parent, child])({ level: 0, x: 12, z: 5 })).toEqual(['p', 'c']);
    });

    test('an all-levels child needs a parent that holds every level', () => {
        const parent: Area = { id: 'p', name: 'P', rects: [{ x1: 0, z1: 0, x2: 9, z2: 9, level: 0 }] };
        const child: Area = { id: 'c', name: 'C', parent: 'p', rects: [{ x1: 1, z1: 1, x2: 2, z2: 2 }] };
        expect(() => areaResolver([parent, child])).toThrow(/'c'/);
        expect(() => areaResolver([parent, { ...child, rects: [{ ...child.rects[0]!, level: 0 }] }])).not.toThrow();
    });

    test('duplicate ids, a missing parent, a parent cycle and an inverted rect are build errors', () => {
        const p: Area = { id: 'p', name: 'P', rects: [{ x1: 0, z1: 0, x2: 9, z2: 9 }] };
        expect(() => areaResolver([p, p])).toThrow(/duplicate.*'p'/);
        expect(() => areaResolver([{ ...p, parent: 'nope' }])).toThrow(/'nope'/);
        expect(() =>
            areaResolver([
                { ...p, parent: 'q' },
                { ...p, id: 'q', parent: 'p' },
            ]),
        ).toThrow(/cycle/);
        expect(() => areaResolver([{ ...p, rects: [{ x1: 9, z1: 0, x2: 0, z2: 9 }] }])).toThrow(/'p'/);
    });
});
