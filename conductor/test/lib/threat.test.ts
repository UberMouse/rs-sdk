import { describe, expect, test } from 'bun:test';
import { isLowHp, LOW_HP_FRACTION, LOW_HP_MAX_FRACTION, lowHpFraction } from '../../lib/threat';
import { world } from '../world';

const at = (hp: number) => world().player({ maxHp: 49, hp }).build();

describe('lowHpFraction', () => {
    test('is one half for none or one attacker', () => {
        expect(lowHpFraction()).toBe(LOW_HP_FRACTION);
        expect(lowHpFraction(1)).toBe(LOW_HP_FRACTION);
    });

    test('rises with each further attacker and is capped', () => {
        expect(lowHpFraction(2)).toBeCloseTo(0.65);
        expect(lowHpFraction(3)).toBeCloseTo(0.8);
        expect(lowHpFraction(9)).toBe(LOW_HP_MAX_FRACTION);
    });
});

describe('isLowHp', () => {
    test('30/49 is fine alone and low against three', () => {
        expect(isLowHp(at(30))).toBe(false);
        expect(isLowHp(at(30), 1)).toBe(false);
        expect(isLowHp(at(30), 2)).toBe(true);
        expect(isLowHp(at(45), 3)).toBe(false);
        expect(isLowHp(at(38), 3)).toBe(true);
    });
});
