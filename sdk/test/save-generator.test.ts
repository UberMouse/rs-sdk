// createSaveData's varps, read back as the engine reads its version 6 save: by index, as many as the count says
// (conductor/lib/saves.ts decodeSave mirrors PlayerLoading.load).
import { describe, expect, test } from 'bun:test';
import { decodeSave } from '../../conductor/lib/saves';
import { createSaveData } from './utils/save-generator';

describe('createSaveData varps', () => {
    test('a varp past the 309 written by default survives the round trip', () => {
        const { varps } = decodeSave(createSaveData({ varps: { 20: 3, 365: 7 } }));
        expect(varps).toEqual({ 20: 3, 281: 1000, 365: 7 });
    });

    test('without custom varps, only the tutorial one is set', () => {
        expect(decodeSave(createSaveData({})).varps).toEqual({ 281: 1000 });
    });
});
