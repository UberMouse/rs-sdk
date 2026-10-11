import { describe, expect, test } from 'bun:test';
import { isF2p, isMultiway, parseZoneCsv, wildernessLevel, zoneKey } from '../sources/zones';

describe('zones', () => {
    test('a tile maps to its 8x8 zone key', () => expect(zoneKey({ level: 0, x: 3209, z: 3220 })).toBe('0_50_50_8_16'));

    test('csv keys, comments skipped', () => {
        const z = parseZoneCsv('// haunted mine\n0_43_69_0_0\n');
        expect(z.has('0_43_69_0_0')).toBe(true);
        expect(z.size).toBe(1);
    });

    test('a csv line off the 8-tile grid keys the zone that holds it, as the engine does', () =>
        expect([...parseZoneCsv('1_50_50_10_17\n')]).toEqual(['1_50_50_8_16']));

    test('whitespace around a csv line is ignored, as loadCsvMap ignores it', () =>
        expect([...parseZoneCsv('0_43_69_0_0 \r\n  0_43_69_8_0\t\n')]).toEqual(['0_43_69_0_0', '0_43_69_8_0']));

    test('a malformed csv line throws, naming it', () =>
        expect(() => parseZoneCsv('0_43_69_0\n')).toThrow(/0_43_69_0/));

    test('f2p ignores the level; multiway does not', () => {
        const zones = { f2p: parseZoneCsv('0_50_50_8_16\n'), multiway: parseZoneCsv('0_50_50_8_16\n') };
        expect(isF2p(zones, { level: 2, x: 3209, z: 3220 })).toBe(true);
        expect(isMultiway(zones, { level: 0, x: 3209, z: 3220 })).toBe(true);
        expect(isMultiway(zones, { level: 2, x: 3209, z: 3220 })).toBe(false);
        expect(isF2p(zones, { level: 0, x: 3200, z: 3220 })).toBe(false);
    });

    test('wilderness level', () => {
        expect(wildernessLevel({ level: 0, x: 3100, z: 3519 })).toBe(0);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3520 })).toBe(1);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3527 })).toBe(1);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3528 })).toBe(2);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3903 })).toBe(48);
    });

    test('the wilderness x bounds are inclusive', () => {
        expect(wildernessLevel({ level: 0, x: 2943, z: 3600 })).toBe(0);
        expect(wildernessLevel({ level: 0, x: 2944, z: 3600 })).toBe(11);
        expect(wildernessLevel({ level: 0, x: 3391, z: 3600 })).toBe(11);
        expect(wildernessLevel({ level: 0, x: 3392, z: 3600 })).toBe(0);
    });

    test('upper floors of the surface wilderness count', () =>
        expect(wildernessLevel({ level: 3, x: 3100, z: 3520 })).toBe(1));

    test('the underground wilderness counts from its own south edge, on level 0 only', () => {
        expect(wildernessLevel({ level: 0, x: 3100, z: 9919 })).toBe(0);
        expect(wildernessLevel({ level: 0, x: 3100, z: 9920 })).toBe(1);
        expect(wildernessLevel({ level: 0, x: 3100, z: 9936 })).toBe(3);
        expect(wildernessLevel({ level: 1, x: 3100, z: 9936 })).toBe(0);
    });
});
