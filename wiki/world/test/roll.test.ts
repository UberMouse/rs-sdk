import { describe, expect, test } from 'bun:test';
import { expectedTicks, lowestLevel, statRandomChance, statRandomRule } from '../roll';

describe('statRandomChance: the engine stat_random', () => {
    test('(low + 1)/256 at level 1, (high + 1)/256 at 99, and 99 past it', () => {
        expect(statRandomChance(50, 200, 1)).toBe(51 / 256);
        expect(statRandomChance(50, 200, 99)).toBe(201 / 256);
        expect(statRandomChance(50, 200, 120)).toBe(201 / 256);
    });

    test('between, each bound scaled and floored on its own: at 30, 35 + 59 + 1 = 95 of 256', () => {
        // floor(50 * 69 / 98) = 35, floor(200 * 29 / 98) = 59.
        expect(statRandomChance(50, 200, 30)).toBe(95 / 256);
    });

    test('a bound of 255 or more at 99 always succeeds; a value of 0 never does', () => {
        expect(statRandomChance(0, 255, 99)).toBe(1);
        expect(statRandomChance(0, 400, 99)).toBe(1);
        expect(statRandomChance(-1, 0, 1)).toBe(0);
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
