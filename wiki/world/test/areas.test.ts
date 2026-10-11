import { describe, expect, test } from 'bun:test';
import { areaResolver } from '../area-resolve';
import { AREAS } from '../areas';

describe('AREAS', () => {
    test('pass the resolver validation', () => expect(() => areaResolver(AREAS)).not.toThrow());

    const resolve = areaResolver(AREAS);

    test('towns and their banks resolve under their kingdom', () => {
        expect(resolve({ level: 0, x: 3222, z: 3218 })).toEqual(['misthalin', 'lumbridge']);
        expect(resolve({ level: 0, x: 3094, z: 3491 })).toEqual(['misthalin', 'edgeville', 'edgeville-bank']);
        expect(resolve({ level: 0, x: 2989, z: 3355 })).toEqual(['asgarnia', 'falador']);
        expect(resolve({ level: 0, x: 2947, z: 3368 })).toEqual(['asgarnia', 'falador', 'falador-west-bank']);
    });

    test('the Wilderness starts at z 3520 east of x 2943, as the engine has it (sources/zones.ts)', () => {
        expect(resolve({ level: 0, x: 3100, z: 3520 })).toEqual(['wilderness']);
        expect(resolve({ level: 0, x: 3100, z: 3519 })).toEqual(['misthalin']);
        expect(resolve({ level: 0, x: 2944, z: 3600 })).toEqual(['wilderness']);
        expect(resolve({ level: 0, x: 2943, z: 3600 })).toEqual(['asgarnia']);
    });

    test('Al Kharid is in the desert, past the fence', () => {
        expect(resolve({ level: 0, x: 3269, z: 3167 })).toEqual(['kharidian-desert', 'al-kharid', 'al-kharid-bank']);
        expect(resolve({ level: 0, x: 3267, z: 3227 })).toEqual(['misthalin']);
        expect(resolve({ level: 0, x: 3277, z: 3227 })).toEqual(['kharidian-desert', 'toll-gate']);
    });

    test('the Ranging Guild is the diamond inside its barricade; Hemenster is the contest town west of it', () => {
        const guild = ['kandarin', 'ranging-guild'];
        expect(resolve({ level: 0, x: 2678, z: 3434 })).toEqual(guild); // the leatherworker
        expect(resolve({ level: 0, x: 2652, z: 3428 })).toEqual(guild); // the west watchtower
        expect(resolve({ level: 2, x: 2668, z: 3444 })).toEqual(guild); // the north one, on top
        expect(resolve({ level: 0, x: 2658, z: 3438 })).toEqual(['kandarin']); // the guild door
        expect(resolve({ level: 0, x: 2652, z: 3426 })).toEqual(['kandarin']); // past the south-west fence
        expect(resolve({ level: 0, x: 2639, z: 3424 })).toEqual(['kandarin', 'hemenster']); // steel arrowtips chest
        expect(resolve({ level: 0, x: 2651, z: 3442 })).toEqual(['kandarin', 'hemenster']); // chicken pen
    });

    test('underground areas are their own top-level areas at z + 6400', () => {
        expect(resolve({ level: 0, x: 3043, z: 9745 })).toEqual(['dwarven-mine', 'mining-guild']);
        expect(resolve({ level: 0, x: 3043, z: 3345 })).toEqual(['asgarnia']);
    });
});
