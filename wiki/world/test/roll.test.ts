import { describe, expect, test } from 'bun:test';
import { expectedTicks, lowestLevel, statRandomChance, statRandomRule } from '../roll';

describe('statRandomChance: the engine stat_random', () => {
    test('(low + 1)/256 at level 1, (high + 1)/256 at 99, and 99 past it', () => {
        expect(statRandomChance(1, 50, 200)).toBe(51 / 256);
        expect(statRandomChance(99, 50, 200)).toBe(201 / 256);
        expect(statRandomChance(120, 50, 200)).toBe(201 / 256);
    });

    test('between, each bound scaled and floored on its own: at 30, 35 + 59 + 1 = 95 of 256', () => {
        // floor(50 * 69 / 98) = 35, floor(200 * 29 / 98) = 59.
        expect(statRandomChance(30, 50, 200)).toBe(95 / 256);
    });

    test('a bound of 255 or more at 99 always succeeds; a value of 0 never does', () => {
        expect(statRandomChance(99, 0, 255)).toBe(1);
        expect(statRandomChance(99, 0, 400)).toBe(1);
        expect(statRandomChance(1, -1, 0)).toBe(0);
    });

    // PlayerOps.ts:596: value = floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1; chance value/256.
    test('yew with a rune axe (trees.dbrow:143, 14,44)', () => {
        // L1: 14 + 0 + 1 = 15. L50: floor(14*49/98) = 7, floor(44*49/98) = 22, so 30. L99: 0 + 44 + 1 = 45.
        expect(statRandomChance(1, 14, 44)).toBe(15 / 256);
        expect(statRandomChance(50, 14, 44)).toBe(30 / 256);
        expect(statRandomChance(99, 14, 44)).toBe(45 / 256);
    });

    test('gold rock (mine.dbrow:101, 7,75): at 50 each floor drops a half', () => {
        // L1: 7 + 0 + 1 = 8. L50: floor(3.5) = 3, floor(37.5) = 37, so 41, where the unfloored sum is 42. L99: 76.
        expect(statRandomChance(1, 7, 75)).toBe(8 / 256);
        expect(statRandomChance(50, 7, 75)).toBe(41 / 256);
        expect(statRandomChance(99, 7, 75)).toBe(76 / 256);
    });

    test('guard pickpocket (pickpocket.dbrow:77, 50,240)', () => {
        // L1: 50 + 0 + 1 = 51. L50: 25 + 120 + 1 = 146. L99: 0 + 240 + 1 = 241.
        expect(statRandomChance(1, 50, 240)).toBe(51 / 256);
        expect(statRandomChance(50, 50, 240)).toBe(146 / 256);
        expect(statRandomChance(99, 50, 240)).toBe(241 / 256);
    });

    test('a level over 99 rolls as 99', () => {
        // A boost to 105 caps at 99 (PlayerOps.ts:595): 45/256, as at 99.
        expect(statRandomChance(105, 14, 44)).toBe(45 / 256);
    });

    test('a value past 256 always succeeds', () => {
        // Beef (cooking_generic.dbrow:43, 128,512) at L50: 64 + 256 + 1 = 321 > every roll 0..255. L1: 129.
        expect(statRandomChance(50, 128, 512)).toBe(1);
        expect(statRandomChance(1, 128, 512)).toBe(129 / 256);
    });

    test("the pages' statement names the skill", () => {
        expect(statRandomRule('Thieving')).toContain('(low + 1)/256 at Thieving level 1');
    });
});

describe('lowestLevel', () => {
    test('the lowest level of the stat any set lets through; 1 for a set that asks none, or for none', () => {
        expect(lowestLevel([['skill:agility:30'], ['quest:x', 'skill:agility:50']], 'agility')).toBe(30);
        expect(lowestLevel([['skill:agility:30'], ['quest:x']], 'agility')).toBe(1);
        expect(lowestLevel([['skill:thieving:40']], 'agility')).toBe(1);
        expect(lowestLevel([], 'agility')).toBe(1);
    });
});

describe('expectedTicks: success plus (1 - p)/p times (fail + way back)', () => {
    test('hand-computed', () => {
        // 2 + (161/95) * (4 + 3) = 2 + 1127/95.
        expect(expectedTicks(2, 95 / 256, 4, 3)).toBeCloseTo(2 + 1127 / 95, 10);
        expect(expectedTicks(2, 0.5, 4, 0)).toBe(6);
        expect(expectedTicks(2, 0.25, 1, 1)).toBe(8);
    });

    test('a sure roll costs its success; one that never succeeds costs Infinity', () => {
        expect(expectedTicks(2, 1, 4, 3)).toBe(2);
        expect(expectedTicks(2, 0, 4, 3)).toBe(Infinity);
    });
});
