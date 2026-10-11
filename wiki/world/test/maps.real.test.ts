import { describe, expect, test } from 'bun:test';
import { readPack } from '../sources/packs';
import { readAllMapSquares } from '../sources/maps';

describe('readAllMapSquares on the real maps', () => {
    const { locs } = readAllMapSquares();

    test('the Canifis booths, filed on level 1 over bridged tiles, come out on level 0', () => {
        expect(readPack('loc').name.get(2213)).toBe('bankbooth');
        const booths = locs.filter(l => l.id === 2213 && l.tile.x === 3513 && l.tile.z >= 3479 && l.tile.z <= 3482);
        expect(booths.map(b => b.tile)).toEqual([3479, 3480, 3481, 3482].map(z => ({ level: 0, x: 3513, z })));
    });
});
