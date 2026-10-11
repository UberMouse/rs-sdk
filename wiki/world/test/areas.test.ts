import { describe, expect, test } from 'bun:test';
import { areaResolver } from '../area-resolve';
import { AREAS } from '../areas';

describe('AREAS', () => {
    test('pass the resolver validation', () => expect(() => areaResolver(AREAS)).not.toThrow());

    test('a few towns resolve under their kingdom', () => {
        const resolve = areaResolver(AREAS);
        expect(resolve({ level: 0, x: 3222, z: 3218 })).toEqual(['misthalin', 'lumbridge']);
        expect(resolve({ level: 0, x: 3094, z: 3491 })).toEqual(['misthalin', 'edgeville']);
        expect(resolve({ level: 0, x: 2989, z: 3355 })).toEqual(['asgarnia', 'falador']);
    });
});
