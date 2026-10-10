import { expect, test } from 'bun:test';
import { levelForXp, MAX_XP, xpForLevel } from '../../lib/xp';

test('xp table matches the engine (2^(level/10))', () => {
    expect([15, 30, 50, 70, 99].map(xpForLevel)).toEqual([1860, 7345, 32619, 133230, 998458]);
    expect(MAX_XP).toBe(998458);
    expect(xpForLevel(1)).toBe(0);
});

test('levelForXp: 7,500 XP is level 30', () => {
    expect(levelForXp(7500)).toBe(30);
    expect(levelForXp(7344)).toBe(29);
    expect(levelForXp(7345)).toBe(30);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(200_000_000)).toBe(99);
});
