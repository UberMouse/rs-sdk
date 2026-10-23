import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadWorld } from '../load';
import { expectedSwings, hitpointsXpPerKill, type Swing } from '../model/combat';
import { DEATH_SOURCE, readDeathTicks } from '../model/families/combat';
import { buildFamilies, readGameData } from '../model/families/index';
import { ModelError, ProfileError, type ActionModel } from '../model/family';
import { readEquipment } from '../model/items';
import { readNpcCombat } from '../model/npcs';
import { profileOf, readTools, type Profile } from '../model/profile';
import { resourceCap } from '../model/rate';
import { SKILLS, type Skill } from '../model/server';
import { SCRIPTS } from '../paths';
import type { Site } from '../types';

const data = readGameData();
const combat = buildFamilies(data).get('combat')!;
const world = loadWorld();
const tools = readTools(data.objs);
const npcs = readNpcCombat(data);
const equipment = readEquipment(data);

const profile = (levels: Partial<Record<Skill, number>>, worn: string[] = []): Profile =>
    profileOf(Object.fromEntries(SKILLS.map(s => [s, levels[s] ?? 1])) as Record<Skill, number>, { tools, worn });

const site = (id: string): Site => world.sites.find(s => s.id === id)!;

/** The model at `id` with every spawn's walk to each other spawn priced `run` ticks. */
function kill(id: string, params: { npc: string; style: string }, p: Profile, run: number): ActionModel {
    const s = site(id);
    return combat.model(
        s,
        params,
        p,
        world,
        combat.walks!(s, params, world).map(() => run),
    );
}

/**
 * E[npc swings landing] by an independent sum over P(S = s): the npc's swing j lands when (s - 1) x playerRate >=
 * 1 + trunc(npcRate / 2) + j x npcRate (npcSwingsPerKill's derivation), so N(s) counts those j.
 */
function npcSwingsBySum(swing: Swing, hp: number, playerRate: number, npcRate: number): number {
    const h = Math.trunc(npcRate / 2);
    const landed = (s: number) => {
        const room = (s - 1) * playerRate - 1 - h;
        return room < 0 ? 0 : Math.floor(room / npcRate) + 1;
    };
    let alive = new Map([[hp, 1]]);
    let sum = 0;
    for (let s = 1; alive.size && s < 10_000; s++) {
        const next = new Map<number, number>();
        for (const [left, p] of alive) {
            // A miss, or a hit's randominc(max) roll of 0..max, each hit roll 1/(max + 1).
            const each = swing.hit / (swing.max + 1);
            const add = (k: number, q: number) => next.set(k, (next.get(k) ?? 0) + q);
            add(left, p * (1 - swing.hit + each));
            for (let d = 1; d <= swing.max; d++) {
                if (d >= left) sum += p * each * landed(s);
                else add(left - d, p * each);
            }
        }
        alive = new Map([...next].filter(([, p]) => p > 1e-15));
    }
    return sum;
}

describe('the game data the hand-worked cases rest on', () => {
    test('npcs, the scimitars and the death delay', () => {
        const giant = npcs('giant');
        expect([giant.levels, giant.attackBonus, giant.strengthBonus, giant.defenceBonus.slash]).toEqual([
            { attack: 18, defence: 26, strength: 22, hitpoints: 35, ranged: 1, magic: 1 },
            18,
            16,
            0,
        ]);
        expect([giant.attackRate, giant.damageType, giant.respawnRate, giant.aiOverrides]).toEqual([
            6,
            'crush',
            60,
            [],
        ]);
        const moss = npcs('mossgiant');
        expect([moss.levels.attack, moss.levels.defence, moss.levels.strength, moss.levels.hitpoints]).toEqual([
            30, 30, 30, 60,
        ]);
        expect([moss.attackBonus, moss.strengthBonus, moss.defenceBonus.slash, moss.attackRate]).toEqual([
            33, 31, 0, 6,
        ]);
        const chicken = npcs('chicken');
        expect([chicken.levels.defence, chicken.levels.hitpoints, chicken.defenceBonus.crush]).toEqual([1, 3, -42]);
        expect([chicken.levels.strength, chicken.strengthBonus, chicken.respawnRate, chicken.retreat]).toEqual([
            1, -42, 50, 1,
        ]);
        const mith = equipment('mithril_scimitar');
        expect([mith.bonuses.slashattack, mith.bonuses.strengthbonus, mith.bonuses.crushdefence]).toEqual([21, 20, 0]);
        expect(mith.attackRate).toBe(4);
        const rune = equipment('rune_scimitar');
        expect([rune.bonuses.slashattack, rune.bonuses.strengthbonus, rune.attackRate]).toEqual([45, 44, 4]);
        expect(readDeathTicks(readFileSync(join(SCRIPTS, DEATH_SOURCE), 'utf8'))).toEqual({
            value: 4,
            at: `${DEATH_SOURCE}:23`,
        });
    });
});

describe('hill giants, 9 spawns in the Edgeville dungeon', () => {
    const at = 'npc:edgeville-dungeon:8';
    const giant = { npc: 'giant', style: 'aggressive' };

    test('Attack 40, Strength 62, Defence 40, a mithril scimitar, aggressive (survey §2)', () => {
        // Attack roll (40 + 8) x (21 + 64) = 4080 against the giant's (26 + 9) x 64 = 2240:
        // 1 - 2242 / (2 x 4081). Max: (62 + 8 + 3) x (20 + 64) = 6132; (6132 + 320) / 640 = 10.
        const swing = { hit: 1 - 2242 / (2 * 4081), max: 10 };
        const m = kill(
            at,
            giant,
            profile({ attack: 40, strength: 62, defence: 40, hitpoints: 50 }, ['mithril_scimitar']),
            3,
        );
        // Runs of 3 fit in the 4-tick cooldown: E[swings] x 4 a kill, 41.9 (survey §2).
        expect(m.ticksPerAttempt).toBeCloseTo(expectedSwings(swing, 35) * 4, 9);
        expect(m.ticksPerAttempt).toBeCloseTo(41.9, 1);
        expect(m.freeTicks).toBe(0);
        // The drop 4 ticks after the killing swing, the take at 5, the run of 3 on: max(4, 8) - max(4, 3) = 4.
        expect(m.pickupTicks).toBe(4);
        // Aggressive pays 40 x hp tenths to Strength: 1400; Hitpoints trunc(13.3 d) a hit, at most 13.3 x 35.
        expect(m.xpTenths.strength).toBeCloseTo(1400, 9);
        expect(m.xpTenths.hitpoints).toBeCloseTo(hitpointsXpPerKill(swing, 35, 1000), 9);
        expect(m.xpTenths.hitpoints!).toBeLessThan(465.5);
        // The giant's swing: (18 + 9) x (18 + 64) = 2214 against (40 + 8) x 64 = 3072: 2214 / (2 x 3073) = 0.36;
        // max (22 + 9) x (16 + 64) = 2480, (2480 + 320) / 640 = 4, 2 a hit on average.
        const npcSwings = npcSwingsBySum(swing, 35, 4, 6);
        expect(m.damage).toBeCloseTo(npcSwings * (2214 / (2 * 3073)) * 2, 9);
        expect(m.damage).toBeCloseTo(4.55, 2);
        // Respawn 60 scales to trunc(3999 x 60 / 4000) = 59; back 4 + 59 - 1 = 62 after the killing swing, the
        // kill's success ending 4 after it: 58. The cap with one bot: 9 / (41.9 + 58), 0.09 kills a tick.
        expect(m.deplete).toEqual({ chance: 1, respawnTicks: 58 });
        expect(m.features).toBe(9);
        expect(resourceCap(m, 9)).toBeCloseTo(9 / (m.ticksPerAttempt + 58), 12);
        expect(m.attackRate).toBe(4);
        expect(m.products).toContainEqual({ obj: 'big_bones', count: 1 });
        // The kills that drop what is taken (ActionModel.pAnyOf): the big bones every kill (death_drop, giant.rs2:8);
        // a limpwurt root on $random 76-86 of random(128) (giant.rs2:51-52), 11/128.
        expect(m.pAnyOf!(new Set(['big_bones']))).toBeCloseTo(1, 12);
        expect(m.pAnyOf!(new Set(['limpwurt_root']))).toBeCloseTo(11 / 128, 12);
        expect(m.pAnyOf!(new Set(['limpwurt_root', 'big_bones']))).toBeCloseTo(1, 12);
        expect(m.retreat).toBeUndefined();
    });

    test('Attack 54, Strength 70, Defence 60, accurate, runs of 6', () => {
        // (54 + 8 + 3) x 85 = 5525: 1 - 2242 / (2 x 5526). Max (70 + 8) x 84 = 6552; 6872 / 640 = 10.
        const swing = { hit: 1 - 2242 / (2 * 5526), max: 10 };
        const m = kill(
            at,
            { npc: 'giant', style: 'accurate' },
            profile({ attack: 54, strength: 70, defence: 60, hitpoints: 60 }, ['mithril_scimitar']),
            6,
        );
        // Each run of 6 is 2 past the cooldown: E[swings] x 4 + 2 (survey §2: 38.1 before it).
        expect(m.freeTicks).toBe(2);
        expect(m.ticksPerAttempt).toBeCloseTo(expectedSwings(swing, 35) * 4 + 2, 9);
        expect(m.ticksPerAttempt - 2).toBeCloseTo(38.1, 1);
        // max(4, 4 + 1 + 6) - max(4, 6) = 5.
        expect(m.pickupTicks).toBe(5);
        expect(m.xpTenths.attack).toBeCloseTo(1400, 9);
        expect(m.xpTenths.strength).toBeUndefined();
        // Defence 60: (60 + 8) x 64 = 4352; 2214 / (2 x 4353).
        expect(m.damage).toBeCloseTo(npcSwingsBySum(swing, 35, 4, 6) * (2214 / (2 * 4353)) * 2, 9);
        // 58 less the 2 free ticks the kill's success already counts.
        expect(m.deplete!.respawnTicks).toBe(56);
        expect(resourceCap(m, 9)).toBeCloseTo(9 / (m.ticksPerAttempt + 56), 12);
    });
});

describe('moss giants, 5 spawns in Kandarin', () => {
    test('Attack, Strength and Defence 60, a rune scimitar, aggressive', () => {
        // (60 + 8) x (45 + 64) = 7412 against (30 + 9) x 64 = 2496: 1 - 2498 / (2 x 7413). Max (60 + 8 + 3) x
        // (44 + 64) = 7668; 7988 / 640 = 12.
        const swing = { hit: 1 - 2498 / (2 * 7413), max: 12 };
        const m = kill(
            'npc:kandarin:108',
            { npc: 'mossgiant', style: 'aggressive' },
            profile({ attack: 60, strength: 60, defence: 60, hitpoints: 60 }, ['rune_scimitar']),
            2,
        );
        expect(m.ticksPerAttempt).toBeCloseTo(expectedSwings(swing, 60) * 4, 9);
        expect(m.xpTenths.strength).toBeCloseTo(2400, 9);
        expect(m.xpTenths.hitpoints).toBeCloseTo(hitpointsXpPerKill(swing, 60, 1000), 9);
        // The moss giant: (30 + 9) x (33 + 64) = 3783 against (60 + 8) x 64 = 4352: 3783 / (2 x 4353); max
        // (30 + 9) x (31 + 64) = 3705, 4025 / 640 = 6, 3 a hit.
        expect(m.damage).toBeCloseTo(npcSwingsBySum(swing, 60, 4, 6) * (3783 / (2 * 4353)) * 3, 9);
        expect(m.deplete).toEqual({ chance: 1, respawnTicks: 58 });
        expect(m.features).toBe(5);
        expect(resourceCap(m, 5)).toBeCloseTo(5 / (m.ticksPerAttempt + 58), 12);
    });
});

describe('chickens, 9 spawns in Lumbridge', () => {
    test('level 1, unarmed, accurate', () => {
        // Unarmed punches crush (weapon_unarmed_table). (1 + 8 + 3) x 64 = 768 against (1 + 9) x (64 - 42) = 220:
        // 1 - 222 / (2 x 769). Max (1 + 8) x 64 = 576, 896 / 640 = 1: a swing deals 1 with chance hit / 2, so
        // 3 HP take 6 / hit swings.
        const hit = 1 - 222 / (2 * 769);
        const m = kill('npc:misthalin:38', { npc: 'chicken', style: 'accurate' }, profile({ hitpoints: 10 }), 6);
        // Unarmed swings every 4 (player_melee.rs2:56-57); runs of 6 are 2 past it.
        expect(m.attackRate).toBe(4);
        expect(m.ticksPerAttempt).toBeCloseTo((6 / hit) * 4 + 2, 9);
        // Accurate: 40 x 3 = 120 Attack tenths; three hits of 1, trunc(13.3) = 13 each, 39 Hitpoints.
        expect(m.xpTenths).toEqual({ attack: 120, hitpoints: 39 });
        // The chicken's max: (1 + 9) x (64 - 42) = 220, 540 / 640 = 0. It can't hurt anyone: no damage.
        expect(m.damage).toBeUndefined();
        expect(m.retreat).toBe(1);
        expect(m.products).toEqual([
            { obj: 'bones', count: 1 },
            { obj: 'feather', count: 5 },
            { obj: 'raw_chicken', count: 1 },
        ]);
        // Feathers on $rng 0-63 of random(128) (chicken.rs2:17-22): 1/2 of the kills; nothing drops coins.
        expect(m.pAnyOf!(new Set(['feather']))).toBeCloseTo(1 / 2, 12);
        expect(m.pAnyOf!(new Set(['coins']))).toBe(0);
        // Respawn 50 scales to 49: 4 + 49 - 1 - 4 - 2 = 46. The cap with one bot: 9 / (ticks + 46).
        expect(m.deplete).toEqual({ chance: 1, respawnTicks: 46 });
        expect(resourceCap(m, 9)).toBeCloseTo(9 / (m.ticksPerAttempt + 46), 12);
    });
});

describe('what is not modelled', () => {
    const chickens = site('npc:misthalin:38');
    const params = { npc: 'chicken', style: 'accurate' };
    const level1 = profile({ hitpoints: 10 });

    test('a target whose melee AI a script overrides', () => {
        const dragon = world.sites.find(s => s.kind === 'npc' && 'green_dragon' in s.counts)!;
        const run = () => combat.model(dragon, { npc: 'green_dragon', style: 'aggressive' }, level1, world, []);
        expect(run).toThrow(ModelError);
        expect(run).toThrow(/\[ai_opplayer2\] at npc\/scripts\/dragon.rs2:17/);
    });

    test("a worn obj that changes the roll against the npc's kind", () => {
        // player_combat.rs2:62-64: the crystalshard necklace scales the attack roll against an undead npc.
        const skeletons = site('npc:bone-yard:1');
        const worn = profile({ hitpoints: 10 }, ['crystalshard_necklace']);
        expect(() => combat.model(skeletons, { npc: 'skeleton_armed', style: 'accurate' }, worn, world, [])).toThrow(
            /crystalshard_necklace worn against npc skeleton_armed \(undead\) is not modelled/,
        );
    });

    test('a style the weapon lacks is the profile’s, not the record’s', () => {
        // The unarmed table has no controlled style.
        expect(() => kill('npc:misthalin:38', { npc: 'chicken', style: 'controlled' }, level1, 6)).toThrow(
            ProfileError,
        );
    });

    test('the spawn walks: priced, and each spawn reaching another', () => {
        expect(() => combat.model(chickens, params, level1, world)).toThrow(/needs its 72 spawn walks priced/);
        const walks: (number | null)[] = combat.walks!(chickens, params, world).map(() => 3);
        // The first spawn's 8 walks, none of them joined.
        walks.fill(null, 0, 8);
        expect(() => combat.model(chickens, params, level1, world, walks)).toThrow(/walks to no other spawn/);
    });

    test('a style is one of the four melee styles; the walks, priced before a style is picked, need none', () => {
        const walks = combat.walks!(chickens, { npc: 'chicken' }, world).map(() => 3);
        expect(walks).toHaveLength(72);
        expect(() => combat.model(chickens, { npc: 'chicken' }, level1, world, walks)).toThrow(ModelError);
        expect(() => combat.model(chickens, { npc: 'chicken', style: 'rapid' }, level1, world, walks)).toThrow(
            /one of accurate, aggressive/,
        );
    });

    test('walks: each spawn to every other, in spawn order', () => {
        const tiles = chickens.features.map(i => world.features[i]!.tile);
        const pairs = combat.walks!(chickens, params, world);
        expect(pairs).toHaveLength(9 * 8);
        expect(pairs.slice(0, 2)).toEqual([
            { from: tiles[0]!, to: tiles[1]! },
            { from: tiles[0]!, to: tiles[2]! },
        ]);
        expect(pairs[8]).toEqual({ from: tiles[1]!, to: tiles[0]! });
    });
});
