import { describe, expect, test } from 'bun:test';
import { readGameData } from '../model/families/index';
import { readBoneXp, readCombatStyles, readEquipment } from '../model/items';
import { NPC_DEFAULTS, readNpcCombat } from '../model/npcs';

const data = readGameData();
const npcs = readNpcCombat(data);
const equipment = readEquipment(data);
const styles = readCombatStyles(data);

describe('the seed NPCs (phase 4 survey §1.5 table; _unpack/225/all.npc)', () => {
    test('the engine defaults the readers fall back to', () => {
        expect(NPC_DEFAULTS.stat.value).toBe(1);
        expect(NPC_DEFAULTS.huntRange.value).toBe(0);
        expect(NPC_DEFAULTS.respawnRate.value).toBe(100);
        expect(NPC_DEFAULTS.visLevel.value).toBe(1);
    });

    test('chicken: 1/1/1/3, att -47 str -42 def -42, rate 4, stab, respawn 50, no hunt, vislevel 1, bones', () => {
        // all.npc:1025 sets hitpoints, respawnrate, vislevel and the bonuses; attackrate (4), death_drop (bones) and
        // the XP multiplier (1000) are the .param defaults.
        expect(npcs('chicken')).toEqual({
            npc: 'chicken',
            levels: { attack: 1, defence: 1, strength: 1, hitpoints: 3, ranged: 1, magic: 1 },
            attackBonus: -47,
            strengthBonus: -42,
            defenceBonus: { stab: -42, slash: -42, crush: -42, ranged: -42, magic: -42 },
            attackRate: 4,
            damageType: 'stab',
            huntMode: undefined,
            huntRange: 0,
            visLevel: 1,
            respawnRate: 50,
            deathDrop: 'bones',
            maxDealt: 1000,
            xpMultiplier: 1000,
            category: 'chicken',
            aiOverrides: [],
        });
    });

    test('giant (hill): 18/26/22/35, att 18 str 16 def 0, rate 6, crush, respawn 60, cowardly r2, vislevel 28', () => {
        expect(npcs('giant')).toEqual({
            npc: 'giant',
            levels: { attack: 18, defence: 26, strength: 22, hitpoints: 35, ranged: 1, magic: 1 },
            attackBonus: 18,
            strengthBonus: 16,
            defenceBonus: { stab: 0, slash: 0, crush: 0, ranged: 0, magic: 0 },
            attackRate: 6,
            damageType: 'crush',
            huntMode: 'cowardly',
            huntRange: 2,
            visLevel: 28,
            respawnRate: 60,
            deathDrop: 'big_bones',
            maxDealt: 1000,
            xpMultiplier: 1000,
            category: undefined,
            aiOverrides: [],
        });
    });

    test('mossgiant: 30/30/30/60, att 33 str 31 def 0, rate 6, crush, respawn 60, cowardly r2, vislevel 42', () => {
        const moss = npcs('mossgiant');
        expect(moss.levels).toEqual({ attack: 30, defence: 30, strength: 30, hitpoints: 60, ranged: 1, magic: 1 });
        expect([moss.attackBonus, moss.strengthBonus, moss.defenceBonus.crush]).toEqual([33, 31, 0]);
        expect([moss.attackRate, moss.damageType, moss.respawnRate]).toEqual([6, 'crush', 60]);
        expect([moss.huntMode, moss.huntRange, moss.visLevel, moss.deathDrop]).toEqual([
            'cowardly',
            2,
            42,
            'big_bones',
        ]);
        expect(moss.aiOverrides).toEqual([]);
    });

    test('AI overrides: a dragon by its own trigger, a witch by her category', () => {
        expect(npcs('green_dragon').aiOverrides).toEqual([
            { trigger: 'ai_opplayer2', at: 'npc/scripts/dragon.rs2:17' },
        ]);
        expect(npcs('witch1').aiOverrides[0]).toEqual({
            trigger: 'ai_opplayer2',
            at: 'areas/area_draynor/scripts/witch.rs2:5',
        });
    });

    test('every npc config reads', () => {
        for (const npc of data.npcs.keys()) expect(() => npcs(npc)).not.toThrow();
    });
});

describe('the scimitars (skill_combat/configs/melee/scimitars.obj)', () => {
    test('mithril: slash 21, str 20, rate 4 by default, Attack 20 (levelrequire/scripts/tier20.rs2:8)', () => {
        const mith = equipment('mithril_scimitar');
        expect(mith.bonuses).toEqual({
            stabattack: 5,
            slashattack: 21,
            crushattack: -2,
            magicattack: 0,
            rangeattack: 0,
            stabdefence: 0,
            slashdefence: 1,
            crushdefence: 0,
            magicdefence: 0,
            rangedefence: 0,
            strengthbonus: 20,
            prayerbonus: 0,
            rangebonus: 0,
        });
        expect([mith.wearpos, mith.attackRate, mith.attackRange, mith.category]).toEqual([
            ['righthand'],
            4,
            0,
            'weapon_slash',
        ]);
        expect(mith.wield).toEqual({ levels: { attack: 20 }, quests: [], at: 'levelrequire/scripts/tier20.rs2:8' });
    });

    test('rune: slash 45, str 44, rate 4 by default, Attack 40 (tier40.rs2:8)', () => {
        const rune = equipment('rune_scimitar');
        expect([rune.bonuses.stabattack, rune.bonuses.slashattack, rune.bonuses.strengthbonus]).toEqual([7, 45, 44]);
        expect([rune.wearpos, rune.attackRate, rune.category]).toEqual([['righthand'], 4, 'weapon_slash']);
        expect(rune.wield).toEqual({ levels: { attack: 40 }, quests: [], at: 'levelrequire/scripts/tier40.rs2:8' });
    });

    test("a scimitar's styles: weapon_slash_table, slash but for the stab controlled lunge (combat.dbrow)", () => {
        expect(styles('weapon_slash')).toEqual({
            table: 'weapon_slash_table',
            styles: [
                { kind: 'melee', style: 'accurate', damageType: 'slash' },
                { kind: 'melee', style: 'aggressive', damageType: 'slash' },
                { kind: 'melee', style: 'controlled', damageType: 'stab' },
                { kind: 'melee', style: 'defensive', damageType: 'slash' },
            ],
        });
    });

    test('quest-gated armour and two-handed slots', () => {
        expect(equipment('rune_platebody').wield).toMatchObject({ levels: { defence: 40 }, quests: ['dragonquest'] });
        expect(equipment('bronze_2h_sword').wearpos).toEqual(['righthand', 'lefthand']);
        // tier1.rs2:2 gates the bronze dagger by the Tutorial Island label, Attack 1 off the island.
        expect(equipment('bronze_dagger').wield?.levels).toEqual({ attack: 1 });
    });

    test('every wearable obj and its style table reads', () => {
        for (const [obj, cfg] of data.objs)
            if (cfg.wearpos) expect(() => styles(equipment(obj).category)).not.toThrow();
    });
});

describe('bone_exp (skill_prayer/configs/bones.obj)', () => {
    test('bones 45, big bones 150, dragon bones 720 tenths; a non-bone 0', () => {
        const bone = readBoneXp(data);
        expect([bone('bones'), bone('big_bones'), bone('dragon_bones'), bone('rune_scimitar')]).toEqual([
            45, 150, 720, 0,
        ]);
    });
});
