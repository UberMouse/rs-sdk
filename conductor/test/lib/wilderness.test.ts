import { describe, expect, test } from 'bun:test';
import { isInWilderness, squareReachesWilderness } from '../../lib/wilderness';

describe('isInWilderness', () => {
    test('the surface Wilderness: x 2944..3391, z 3520..6399, level 0', () => {
        expect(isInWilderness(0, 3100, 3520)).toBe(true);
        expect(isInWilderness(0, 3100, 3519)).toBe(false);
        expect(isInWilderness(1, 3100, 3600)).toBe(false);
        expect(isInWilderness(0, 3392, 3600)).toBe(false);
    });

    test('the Dwarven Mine under Falador (z 9776..9860) is not the Wilderness; the Edgeville dungeon (z >= 9920) is', () => {
        expect(isInWilderness(0, 2998, 9844)).toBe(false);
        expect(isInWilderness(0, 3058, 9776)).toBe(false);
        expect(isInWilderness(0, 3100, 9919)).toBe(false);
        expect(isInWilderness(0, 3100, 9920)).toBe(true);
    });
});

describe('squareReachesWilderness', () => {
    test('an area on the surface near the ditch, and one in the mine', () => {
        expect(squareReachesWilderness(3090, 3510, 15)).toBe(true);
        expect(squareReachesWilderness(3090, 3500, 15)).toBe(false);
        expect(squareReachesWilderness(2998, 9844, 15)).toBe(false);
        expect(squareReachesWilderness(3100, 9930, 5)).toBe(true);
    });
});
