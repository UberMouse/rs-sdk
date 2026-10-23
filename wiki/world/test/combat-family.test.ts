import { describe, expect, test } from 'bun:test';
import { combat, killGaps, MAX_SPAWNS, MAX_SWINGS, npcSwingsPerKill, readDeathTicks } from '../model/families/combat';
import type { GameData } from '../model/families/common';
import { ModelError, ProfileError } from '../model/family';
import type { Feature, Site } from '../types';

describe('death ticks', () => {
    test('npc_delay(n) puts the drop 2 + n + 1 ticks after the killing swing', () => {
        // Swing at T queues the damage, run at T + 1; the death queued then runs at T + 2; npc_delay(1) resumes at
        // T + 2 + 1 + 1 = T + 4, npc_del and the drop.
        expect(readDeathTicks('npc_setmode(none);\nnpc_arrivedelay;\nnpc_delay(1);\nnpc_del;\n')).toEqual({
            value: 4,
            at: 'skill_combat/scripts/npc/npc_death.rs2:3',
        });
        expect(readDeathTicks('npc_delay(3);').value).toBe(6);
        expect(() => readDeathTicks('npc_del;')).toThrow(/has the default moved/);
    });
});

describe('npc swings per kill', () => {
    // hp 1 and a swing that always hits for 0..1: a kill each swing with chance 1/2, so P(S > s) = 2^-s.
    const coin = { hit: 1, max: 1 };

    test('player rate 4, npc rate 6: the npc swings at T0 + 4 + 6j, landing when S > ceil((4 + 6j) / 4)', () => {
        // h = trunc(6 / 2) = 3. ceil((4 + 6j) / 4) = 1 + ceil(1.5j): 1 + 3m for j = 2m, 3 + 3m for j = 2m + 1.
        // Sum 2^-(1+3m) + 2^-(3+3m) = (1/2 + 1/8) / (1 - 1/8) = 5/7.
        expect(npcSwingsPerKill(coin, 1, 4, 6)).toBeCloseTo(5 / 7, 10);
    });

    test('player rate 6, npc rate 4: h = 2, ceil((3 + 4j) / 6)', () => {
        // j = 3m: ceil(2m + 1/2) = 2m + 1; j = 3m + 1, 3m + 2: 2m + 2. Sum 2^-(2m+1) + 2 x 2^-(2m+2) = 4^-m: 4/3.
        expect(npcSwingsPerKill(coin, 1, 6, 4)).toBeCloseTo(4 / 3, 10);
    });

    test('a swing that can never damage: Infinity', () => {
        expect(npcSwingsPerKill({ hit: 0, max: 5 }, 10, 4, 4)).toBe(Infinity);
        expect(npcSwingsPerKill({ hit: 0.5, max: 0 }, 10, 4, 4)).toBe(Infinity);
    });

    test('an attack rate under 1 tick is a ModelError, not an endless sum', () => {
        expect(() => npcSwingsPerKill(coin, 1, 4, 0)).toThrow(/the npc's attack rate 0 is under 1 tick/);
        expect(() => npcSwingsPerKill(coin, 1, -4, 4)).toThrow(/the player's attack rate -4/);
    });

    test('a kill whose tail runs past MAX_SWINGS is a ProfileError, never a cut sum', () => {
        // A swing damages with chance 1e-4 x 1/2: 10 HP take 2e5 swings on average, past the cap.
        const slow = { hit: 1e-4, max: 1 };
        expect(MAX_SWINGS).toBe(100_000);
        expect(() => npcSwingsPerKill(slow, 10, 4, 4)).toThrow(ProfileError);
        expect(() => npcSwingsPerKill(slow, 10, 4, 4)).toThrow(/runs past 100000 swings/);
    });
});

/** A site of n chickens on a row of tiles. */
const row = (n: number) => {
    const features = Array.from({ length: n }, (_, i) => ({ subtype: 'chicken', tile: { level: 0, x: i, z: 0 } }));
    const site = { id: 'npc:test:0', kind: 'npc', features: features.map((_, i) => i) };
    return { site: site as unknown as Site, world: { features: features as unknown as Feature[] } };
};

describe('spawn walks', () => {
    const family = combat({} as GameData);
    const params = { npc: 'chicken', style: 'accurate' };

    test('each spawn to every other up to MAX_SPAWNS; past it a ModelError', () => {
        const at = row(MAX_SPAWNS);
        expect(family.walks!(at.site, params, at.world)).toHaveLength(MAX_SPAWNS * (MAX_SPAWNS - 1));
        const past = row(MAX_SPAWNS + 1);
        expect(() => family.walks!(past.site, params, past.world)).toThrow(ModelError);
        expect(() => family.walks!(past.site, params, past.world)).toThrow(/65 spawns of the npc/);
    });
});

describe('kill gaps', () => {
    test('the run past the cooldown, and what a pickup adds, as the mean over the spawns', () => {
        // attackRate 4, deathTicks 4; runs 3, 6 and 0 (two spawns on a tile, at least 1): 3, 6, 1.
        // free: max(4, w) - 4 = 0, 2, 0: 2/3. pickup: max(4, 4 + 1 + w) - max(4, w) = 8 - 4, 11 - 6, 6 - 4 = 4, 5, 2: 11/3.
        const g = killGaps([3, 6, 0], 4, 4);
        expect(g.free).toBeCloseTo(2 / 3, 12);
        expect(g.pickup).toBeCloseTo(11 / 3, 12);
        // A slow weapon covers the run and the drop: attackRate 12 leaves none of either.
        expect(killGaps([3, 6], 12, 4)).toEqual({ free: 0, pickup: 0 });
    });
});
