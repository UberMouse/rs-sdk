// createSaveData's varps, read back as the engine reads its version 6 save: by index, as many as the count says
// (conductor/lib/saves.ts decodeSave mirrors PlayerLoading.load).
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSaveData, freshVarpDefaults } from '../../../sdk/test/utils/save-generator';
import { decodeSave } from '../../lib/saves';

const defaults = freshVarpDefaults();
const nonInt = defaults.flatMap((v, i) => (v === -1 ? [i] : []));

/** The varps of a generated save that differ from a fresh account's value. */
function overrides(varps: Record<number, number>) {
    const out: Record<number, number> = {};
    for (let i = 0; i < Math.max(309, defaults.length, 366); i++) {
        const v = varps[i] ?? 0;
        if (v !== (defaults[i] ?? 0)) out[i] = v;
    }
    return out;
}

describe('createSaveData varps', () => {
    test('a varp past the 309 written by default survives the round trip', () => {
        const { varps } = decodeSave(createSaveData({ varps: { 20: 3, 365: 7 } }));
        expect(overrides(varps)).toEqual({ 20: 3, 281: 1000, 365: 7 });
    });

    test('without custom varps, only the tutorial one differs from a fresh account', () => {
        expect(overrides(decodeSave(createSaveData({})).varps)).toEqual({ 281: 1000 });
    });

    test('the Ikov ice-arrow chest varp (28, a coord) is -1 unless the spec sets it', () => {
        expect(defaults[28]).toBe(-1);
        expect(decodeSave(createSaveData({})).varps[28]).toBe(-1);
        expect(decodeSave(createSaveData({ varps: { 28: 0 } })).varps[28]).toBeUndefined();
        expect(decodeSave(createSaveData({ varps: { 28: 123 } })).varps[28]).toBe(123);
    });

    test('every non-int varp is -1 and every int varp 0 when unset', () => {
        expect(nonInt.length).toBeGreaterThan(5);
        const { varps } = decodeSave(createSaveData({}));
        for (const i of nonInt) expect(varps[i]).toBe(-1);
        expect(Object.keys(varps).length).toBe(nonInt.length + 1 - (nonInt.includes(281) ? 1 : 0));
    });
});

describe('freshVarpDefaults sym parsing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varp-sym-'));
    function sym(name: string, content: string) {
        const file = path.join(dir, name);
        fs.writeFileSync(file, content);
        return file;
    }

    test('reads int, string and other types', () => {
        const file = sym('ok.sym', '0\ta\tint\n1\tb\tcoord\n\n2\tc\tstring\n');
        expect(freshVarpDefaults(file)).toEqual([0, -1, 0]);
    });
    test('an empty file throws', () => {
        expect(() => freshVarpDefaults(sym('empty.sym', ''))).toThrow('no varp rows');
    });
    test('a garbage line throws', () => {
        expect(() => freshVarpDefaults(sym('bad.sym', '0\ta\tint\nnot a row\n'))).toThrow('not "id<TAB>name<TAB>type"');
    });
    test('a gap in the ids throws', () => {
        expect(() => freshVarpDefaults(sym('gap.sym', '0\ta\tint\n2\tc\tint\n'))).toThrow('id 1 is missing');
    });
});
