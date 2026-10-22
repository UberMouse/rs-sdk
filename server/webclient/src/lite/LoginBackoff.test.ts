import { expect, test } from 'bun:test';
import { loginJitterMs } from './LoginBackoff.js';

test('fleet delays spread attempts and respect disabled, invalid and capped settings', () => {
    expect([0, 0.25, 0.75].map(value => loginJitterMs(5000, () => value))).toEqual([0, 1250, 3750]);
    expect(loginJitterMs(0, () => 0.5)).toBe(0);
    expect(loginJitterMs(-1, () => 0.5)).toBe(0);
    expect(loginJitterMs(NaN, () => 0.5)).toBe(2500);
    expect(loginJitterMs(1e9, () => 0.5)).toBe(30000);
});
