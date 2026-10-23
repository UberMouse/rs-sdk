import { describe, expect, test } from 'bun:test';
import {
    MELEE_STYLE_BONUS,
    combatLevel,
    combatRoll,
    effectiveLevel,
    expectedSwings,
    hitChance,
    hitpointsXpPerKill,
    maxHit,
    npcEffectiveLevel,
    styleXpPerKill,
    swingDamage,
    type Swing,
} from '../model/combat';

// Paths under server/content/scripts/. The hill giant (_unpack/225/all.npc:2968): attack 18, defence 26, strength 22,
// hitpoints 35, attackbonus 18, strengthbonus 16, defence bonuses 0. The chicken (all.npc:1025): 1/1/1, hitpoints 3,
// defence bonuses -42, attackbonus -47, strengthbonus -42. A Mithril scimitar: slash 21, strength 20.

describe('effective levels and rolls (combat.rs2:4-12, player_combat_stat.rs2:71-73)', () => {
    test('level*prayer/100 truncated, +8, + style; a prayer under 100 counts as 100', () => {
        // 40*115/100 = 46, + 8 + 3 = 57. 41*105/100 = 43.05 -> 43, + 8 = 51. max(100, 90) leaves 40.
        expect(effectiveLevel(40, 3, 115)).toBe(57);
        expect(effectiveLevel(41, 0, 105)).toBe(51);
        expect(effectiveLevel(40, 0, 90)).toBe(48);
        expect(effectiveLevel(40, MELEE_STYLE_BONUS.controlled.attack)).toBe(49);
    });

    test('an NPC: level + 9 (npc_combat_melee.rs2:5-6); a roll is eff*(bonus+64)', () => {
        // Giant defence (26+9)*(0+64) = 2240; chicken defence (1+9)*(-42+64) = 220.
        expect(combatRoll(npcEffectiveLevel(26), 0)).toBe(2240);
        expect(combatRoll(npcEffectiveLevel(1), -42)).toBe(220);
    });
});

describe('hitChance: randominc(A) > randominc(D)', () => {
    test('small rolls, by counting the pairs', () => {
        // A=2, D=1: of the 3x2 pairs (a,d), a>d holds for (1,0),(2,0),(2,1): 3/6. Formula 1 - 3/6.
        expect(hitChance(2, 1)).toBe(0.5);
        // A=1, D=2: only (1,0) of 2x3: 1/6. Formula 1/(2*3).
        expect(hitChance(1, 2)).toBeCloseTo(1 / 6, 12);
        // A=D=0: 0 > 0 never.
        expect(hitChance(0, 0)).toBe(0);
    });
});

describe('maxHit: (eff_str*(bonus+64) + 320)/640 truncated (combat.rs2:7-8)', () => {
    test('a hill giant hits the player for at most 4; a chicken for 0', () => {
        // (22+9)*(16+64) = 2480, + 320 = 2800, /640 = 4.375 -> 4. Chicken (1+9)*22 = 220, 540/640 -> 0.
        expect(maxHit(npcEffectiveLevel(22), 16)).toBe(4);
        expect(maxHit(npcEffectiveLevel(1), -42)).toBe(0);
    });
});

/** A player's swing at the hill giant with a Mithril scimitar (slash 21, str 20). */
function giantSwing(attack: number, strength: number, style: 'accurate' | 'aggressive'): Swing {
    const b = MELEE_STYLE_BONUS[style];
    const a = combatRoll(effectiveLevel(attack, b.attack), 21);
    return {
        hit: hitChance(a, combatRoll(npcEffectiveLevel(26), 0)),
        max: maxHit(effectiveLevel(strength, b.strength), 20),
    };
}

describe('the survey §2 hill giant rows (Mithril scimitar)', () => {
    test('Str 62, Att 40, aggressive: p 0.725, max 10, ~10.5 swings', () => {
        // A = (40+8)*85 = 4080, D = 2240: p = 1 - 2242/8162 = 0.72531. Str (62+8+3)*84 = 6132, 6452/640 -> 10.
        const s = giantSwing(40, 62, 'aggressive');
        expect(s.hit).toBeCloseTo(1 - 2242 / 8162, 12);
        expect(s.max).toBe(10);
        expect(expectedSwings(s, 35)).toBeCloseTo(10.48, 2);
    });

    test('Att 54, Str 70, accurate: p 0.797, max 10, ~9.5 swings', () => {
        // A = (54+8+3)*85 = 5525: p = 1 - 2242/11052 = 0.79714. Str (70+8)*84 = 6552, 6872/640 -> 10.
        const s = giantSwing(54, 70, 'accurate');
        expect(s.hit).toBeCloseTo(1 - 2242 / 11052, 12);
        expect(s.max).toBe(10);
        expect(expectedSwings(s, 35)).toBeCloseTo(9.53, 2);
    });

    test('the trained skill gets 40 tenths per HP whatever the accuracy (3,500 XP at a rate of 25)', () => {
        expect(styleXpPerKill('aggressive', giantSwing(40, 62, 'aggressive'), 35, 1000).strength).toBeCloseTo(1400, 9);
        expect(styleXpPerKill('accurate', giantSwing(54, 70, 'accurate'), 35, 1000).attack).toBeCloseTo(1400, 9);
    });

    test('Hitpoints gets a little under 13.3 per HP, from the per-hit truncation', () => {
        const hp = hitpointsXpPerKill(giantSwing(40, 62, 'aggressive'), 35, 1000);
        expect(hp).toBeLessThan(465.5);
        expect(hp).toBeGreaterThan(455);
    });
});

describe('the §1.6 hill giant against the player (Defence 40, no armour)', () => {
    test('p 0.36, max 4', () => {
        // NPC A = (18+9)*(18+64) = 2214; player D = (40+8)*64 = 3072; A <= D: 2214/6146 = 0.36024.
        const a = combatRoll(npcEffectiveLevel(18), 18);
        const d = combatRoll(effectiveLevel(40, 0), 0);
        expect([a, d]).toEqual([2214, 3072]);
        expect(hitChance(a, d)).toBeCloseTo(2214 / 6146, 12);
        expect(maxHit(npcEffectiveLevel(22), 16)).toBe(4);
    });
});

describe('a chicken, unarmed, Attack and Strength 1, accurate', () => {
    // A = (1+8+3)*64 = 768, D = 220: p = 1 - 222/1538. Max (1+8)*64 = 576, 896/640 -> 1.
    const s: Swing = {
        hit: hitChance(combatRoll(effectiveLevel(1, 3), 0), combatRoll(npcEffectiveLevel(1), -42)),
        max: maxHit(effectiveLevel(1, 0), 0),
    };

    test('p and max', () => {
        expect(s.hit).toBeCloseTo(1 - 222 / 1538, 12);
        expect(s.max).toBe(1);
    });

    test('each swing deals 1 with chance p/2, so 3 HP takes 3/(p/2) swings', () => {
        expect(expectedSwings(s, 3)).toBeCloseTo(3 / (s.hit / 2), 9);
    });

    test('three hits of 1: 3*trunc(13.3) = 39 Hitpoints tenths, 3*40 = 120 Attack tenths', () => {
        expect(hitpointsXpPerKill(s, 3, 1000)).toBeCloseTo(39, 9);
        expect(styleXpPerKill('accurate', s, 3, 1000)).toEqual({ attack: expect.closeTo(120, 9) });
    });
});

describe('swingDamage: 0..max uniform on a hit, capped at the remaining HP', () => {
    test('p 0.5, max 4, 2 HP left: each roll 0.1; 0 takes the miss, 2 takes the rolls of 2, 3, 4', () => {
        const dist = swingDamage({ hit: 0.5, max: 4 }, 2);
        expect(dist.length).toBe(3);
        [0.6, 0.1, 0.3].forEach((p, i) => expect(dist[i]).toBeCloseTo(p, 12));
    });
});

describe('expectedSwings: the DP over remaining HP', () => {
    test('p 0.5, max 2: E(1) = 3/(2p) = 3, E(2) = (1 + (p/3)E(1))/(2p/3) = 4.5', () => {
        expect(expectedSwings({ hit: 0.5, max: 2 }, 1)).toBeCloseTo(3, 12);
        expect(expectedSwings({ hit: 0.5, max: 2 }, 2)).toBeCloseTo(4.5, 12);
    });

    test('no kill without damage', () => {
        expect(expectedSwings({ hit: 0.9, max: 0 }, 3)).toBe(Infinity);
        expect(expectedSwings({ hit: 0, max: 5 }, 3)).toBe(Infinity);
    });
});

describe('XP per kill: each hit truncated (combat.rs2:146-167)', () => {
    test('Hitpoints at 4 HP, max 4: 53 for one hit of 4, else 52; the first damaging hit is 4 a quarter of the time', () => {
        // trunc(13.3d): 13, 26, 39, 53. Any split of 4 into smaller hits sums to 52 tenths.
        expect(hitpointsXpPerKill({ hit: 0.6, max: 4 }, 4, 1000)).toBeCloseTo(52.25, 9);
    });

    test('a multiplier of 333 truncates each hit: 3 hits of 1 pay 3*trunc(13.32) = 39, not 39.96', () => {
        // scale(333, 1000, scale(400, 100, 10)) = trunc(333*40/1000) = 13.
        expect(styleXpPerKill('defensive', { hit: 0.5, max: 1 }, 3, 333)).toEqual({ defence: expect.closeTo(39, 9) });
    });

    test('controlled pays trunc(13.3d) to each of Attack, Strength and Defence', () => {
        const xp = styleXpPerKill('controlled', { hit: 0.6, max: 4 }, 4, 1000);
        expect(Object.keys(xp).sort()).toEqual(['attack', 'defence', 'strength']);
        expect(xp.attack).toBeCloseTo(52.25, 9);
    });
});

describe('combatLevel (combat_level.rs2:1-10)', () => {
    const fresh = { attack: 1, strength: 1, defence: 1, hitpoints: 10, prayer: 1, ranged: 1, magic: 1 };

    test('a new account is 3', () => {
        // 10*(1+10+0) = 110, melee 13*2 = 26: 136/40 -> 3.
        expect(combatLevel(fresh)).toBe(3);
    });

    test('a hill giant trainer: Att 40, Str 62, Def 40, HP 50, Prayer 31 is 59', () => {
        // 10*(40+50+15) = 1050, melee 13*102 = 1326: 2376/40 = 59.4 -> 59.
        expect(combatLevel({ ...fresh, attack: 40, strength: 62, defence: 40, hitpoints: 50, prayer: 31 })).toBe(59);
    });

    test('Ranged 9: scale(3, 2, 9) truncates to 13 before the 13x, so 6 (not the 7 an untruncated 13*1.5*9 gives)', () => {
        // 110 + 13*13 = 279, /40 -> 6. Untruncated: 110 + 175.5 = 285.5 -> 7.
        expect(combatLevel({ ...fresh, ranged: 9 })).toBe(6);
    });
});
