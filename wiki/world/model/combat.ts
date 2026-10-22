// The melee combat formulas (phase 4 survey §1.1-§1.3, §1.5-§1.7), as pure functions of levels, bonuses and NPC
// stats: the effective levels, the attack and defence rolls, the hit chance, the max hit, a swing's damage, the
// swings to a kill and the XP a kill pays. Paths are under server/content/scripts/ unless they name the engine.
// Integer steps truncate where the scripts' calc and scale do. The game data (NPC stats and params, worn bonuses)
// reaches these from the readers; the hit chance is not statRandomChance (roll.ts), a skilling roll.
import type { Skill } from './server';

/** A melee damage style, by its `^style_melee_*` constant. */
export type MeleeStyle = 'accurate' | 'aggressive' | 'defensive' | 'controlled';

/** Each melee style's attack, strength and defence bonus: skill_combat/scripts/combat.rs2:51-57. */
export const MELEE_STYLE_BONUS: Record<MeleeStyle, { attack: number; strength: number; defence: number }> = {
    accurate: { attack: 3, strength: 0, defence: 0 },
    aggressive: { attack: 0, strength: 3, defence: 0 },
    defensive: { attack: 0, strength: 0, defence: 3 },
    controlled: { attack: 1, strength: 1, defence: 1 },
};

/**
 * A player's effective level: `~combat_effective_stat` (combat.rs2:4-5) is `scale(max(100, prayer), 100, level)`,
 * truncated, then +8 and the style's bonus (skill_combat/scripts/player/player_combat_stat.rs2:71-73). `level` is the
 * current (boosted) level (:37-41); `prayer` is the percentage a prayer gives (105, 110, 115; :214-230), 100 for none.
 */
export function effectiveLevel(level: number, styleBonus: number, prayer = 100): number {
    return Math.trunc((level * Math.max(100, prayer)) / 100) + 8 + styleBonus;
}

/**
 * An NPC's effective level: no prayer and a fixed +9 ("'style bonus' of 1" on the +8) for its attack, strength and
 * defence (skill_combat/scripts/npc/npc_combat_melee.rs2:5-6,14-15; npc_combat.rs2:331-332).
 */
export function npcEffectiveLevel(level: number): number {
    return level + 9;
}

/** An attack or defence roll, and the strength product a max hit is taken from: `~combat_stat` (combat.rs2:11-12). */
export function combatRoll(effective: number, bonus: number): number {
    return effective * (bonus + 64);
}

/**
 * The chance a swing hits: it hits when `randominc(attack) > randominc(defence)` (player_combat.rs2:65 for the player,
 * npc_combat_melee.rs2:27 for an NPC), each `randominc(n)` uniform on 0..n (engine
 * engine/script/handlers/NumberOps.ts:37-40). Summed over the defence draw: with A > D, 1 - (D+2)/(2(A+1)); else
 * A/(2(D+1)).
 */
export function hitChance(attackRoll: number, defenceRoll: number): number {
    const [a, d] = [attackRoll, defenceRoll];
    return a > d ? 1 - (d + 2) / (2 * (a + 1)) : a / (2 * (d + 1));
}

/**
 * The melee max hit: `~combat_maxhit(~combat_stat(eff_strength, strengthbonus))` (player_combat_stat.rs2:94,99 for the
 * player, npc_combat_melee.rs2:2-8 for an NPC), `(product + 320) / 640` truncated (combat.rs2:7-8).
 */
export function maxHit(effectiveStrength: number, strengthBonus: number): number {
    return Math.trunc((combatRoll(effectiveStrength, strengthBonus) + 320) / 640);
}

/** One attacker's swings at one defender: the chance a swing hits, and the max hit. */
export interface Swing {
    hit: number;
    max: number;
}

/**
 * The damage one swing deals with `remaining` HP left: a hit rolls `randominc(max)`, 0..max uniform, so a hit can
 * deal 0 (player_melee.rs2:31); a miss deals 0. The damage is capped at the remaining HP (:32), so every roll at or
 * past it lands on `remaining`. Entry k is the chance of k damage, for k in 0..min(max, remaining).
 */
export function swingDamage(swing: Swing, remaining: number): number[] {
    const each = swing.hit / (swing.max + 1);
    const top = Math.min(swing.max, remaining);
    const dist = Array.from({ length: top + 1 }, () => each);
    dist[0] = 1 - swing.hit + each;
    dist[top] = (dist[top] ?? 0) + each * (swing.max - top);
    return dist;
}

/**
 * The expected total of `perSwing(d)` over the swings that take an NPC from `hp` to 0, each swing's capped damage d
 * drawn from swingDamage. A DP over the remaining HP h: V(0) = 0 and, solving for the 0-damage swings that leave h
 * as it is, V(h) = (Σ_d P(d)·perSwing(d) + Σ_{d≥1} P(d)·V(h-d)) / (1 - P(0)). Infinity when no swing can damage (a hit
 * chance or max hit of 0).
 */
function perKill(swing: Swing, hp: number, perSwing: (damage: number) => number): number {
    // Every roll 1..max damages (a roll past the cap folds onto the cap), so the chance a swing damages is
    // hit*max/(max+1) whatever the remaining HP, without the cancellation of 1 - P(0) at a tiny hit chance.
    const damaging = (swing.hit * swing.max) / (swing.max + 1);
    if (!(damaging > 0)) return Infinity;
    const v = [0];
    for (let h = 1; h <= hp; h++) {
        let sum = 0;
        swingDamage(swing, h).forEach((p, d) => {
            sum += p * (perSwing(d) + (d > 0 ? (v[h - d] ?? 0) : 0));
        });
        v.push(sum / damaging);
    }
    return v[hp] ?? 0;
}

/** The expected swings to take an NPC from `hp` to 0 (swingDamage's distribution); Infinity when none can damage. */
export function expectedSwings(swing: Swing, hp: number): number {
    return perKill(swing, hp, () => 1);
}

/** Hitpoints' XP rate per 100 of damage*10, for every style (combat.rs2:167). */
const HITPOINTS_XP_RATE = 133;
/** The rate per 100 for accurate, aggressive and defensive melee, to the one skill the style trains (combat.rs2:145-150). */
const STYLE_XP_RATE = 400;
/** The rate per 100 for controlled melee, to each of Attack, Strength and Defence; written apart from Hitpoints' (combat.rs2:151-153). */
const CONTROLLED_XP_RATE = 133;

/**
 * The XP, in the script's tenths before XP_RATE, one hit of `damage` pays at `rate` per 100 (the constants below)
 * and the NPC's `combat_xp_multiplier` per 1000: `scale(mult, 1000, scale(rate, 100, damage*10))`, each scale
 * truncated (combat.rs2:89,146-167).
 */
function hitXp(damage: number, rate: number, multiplier: number): number {
    return Math.trunc((multiplier * Math.trunc((rate * damage * 10) / 100)) / 1000);
}

/**
 * The expected Hitpoints XP a kill pays, in tenths before XP_RATE: every hit pays `scale(133, 100, damage*10)`, so
 * trunc(13.3·d), whatever the style (combat.rs2:167), on the damage capped at the NPC's HP (player_melee.rs2:32-33).
 * `multiplier` is the NPC's `combat_xp_multiplier` param.
 */
export function hitpointsXpPerKill(swing: Swing, hp: number, multiplier: number): number {
    return perKill(swing, hp, d => hitXp(d, HITPOINTS_XP_RATE, multiplier));
}

/**
 * The expected XP a kill pays the skills a melee style trains, in tenths before XP_RATE (Hitpoints apart:
 * hitpointsXpPerKill): accurate, aggressive and defensive pay `scale(400, 100, damage*10)` to Attack, Strength or
 * Defence; controlled pays `scale(133, 100, ...)` to each of the three (combat.rs2:145-154). With the capped damage
 * summing to the NPC's HP, a single-skill style pays 40·hp at a multiplier of 1000, whatever the accuracy.
 */
export function styleXpPerKill(
    style: MeleeStyle,
    swing: Swing,
    hp: number,
    multiplier: number,
): Partial<Record<Skill, number>> {
    if (style === 'controlled') {
        const each = perKill(swing, hp, d => hitXp(d, CONTROLLED_XP_RATE, multiplier));
        return { attack: each, strength: each, defence: each };
    }
    const skill: Skill = style === 'accurate' ? 'attack' : style === 'aggressive' ? 'strength' : 'defence';
    return { [skill]: perKill(swing, hp, d => hitXp(d, STYLE_XP_RATE, multiplier)) };
}

/** The base levels the combat level is taken from. */
export interface CombatLevels {
    attack: number;
    strength: number;
    defence: number;
    hitpoints: number;
    prayer: number;
    ranged: number;
    magic: number;
}

/**
 * The combat level (player/scripts/combat_level.rs2:1-10), from base levels: `10*(def + hp + prayer/2)` plus the
 * largest of `13*(att + str)`, `13*scale(3, 2, ranged)` and `13*scale(3, 2, magic)`, over 40, each division truncated.
 */
export function combatLevel(l: CombatLevels): number {
    const base = 10 * (l.defence + l.hitpoints + Math.trunc(l.prayer / 2));
    const melee = 13 * (l.attack + l.strength);
    const ranged = 13 * Math.trunc((3 * l.ranged) / 2);
    const magic = 13 * Math.trunc((3 * l.magic) / 2);
    return Math.trunc((base + Math.max(melee, ranged, magic)) / 40);
}
