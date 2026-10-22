import { describe, expect, test } from 'bun:test';
import { ModelError } from '../model/family';
import { readBoneXp, readCombatStyles, readEquipment } from '../model/items';
import { NPC_DEFAULTS, readNpcCombat, readVisLevelDefault } from '../model/npcs';
import { paramInt } from '../model/params';
import { parseConfigs } from '../sources/configs';
import { collectConstants } from '../sources/constants';
import { parseDbrows } from '../sources/dbrows';
import { readWieldRequirements } from '../sources/levelrequire';

// Scripted game data, cut from the real files' shapes: a few params with their defaults, the damage-type constants,
// three npcs, a weapon and some armour, the levelrequire label shapes, and the style-table proc and rows.
const PARAMS = parseConfigs(`
[attackbonus]
type=int
default=0
[strengthbonus]
type=int
default=0
[stabdefence]
type=int
default=0
[slashdefence]
type=int
default=0
[crushdefence]
type=int
default=0
[rangedefence]
type=int
default=0
[magicdefence]
type=int
default=0
[stabattack]
type=int
default=0
[slashattack]
type=int
default=0
[crushattack]
type=int
default=0
[magicattack]
type=int
default=0
[rangeattack]
type=int
default=0
[prayerbonus]
type=int
default=0
[rangebonus]
type=int
default=0
[attackrange]
type=int
default=0
[attackrate]
type=int
default=4
[damagetype]
type=int
default=2
[death_drop]
type=namedobj
default=bones
[max_dealt]
type=int
default=1000
[combat_xp_multiplier]
type=int
default=1000
[bone_exp]
type=int
default=0
`);

const CONSTANTS = collectConstants([
    [
        'skill_combat/configs/combat_damagetypes.constant',
        '^stab_style = 0\n^slash_style = 1\n^crush_style = 2\n^ranged_style = 3\n^magic_style = 4\n^melee_style = 5\n',
    ],
    ['other.constant', '^other_two = 2\n'],
]);

const NPCS = parseConfigs(`
[hen]
category=fowl
hitpoints=3
respawnrate=50
param=attackbonus,-47
param=stabdefence,-42
param=damagetype,^stab_style

[brute]
vislevel=28
attack=18
defence=26
strength=22
hitpoints=35
huntrange=2
huntmode=cowardly
param=attackrate,6
param=attackbonus,18
param=strengthbonus,16
param=death_drop,big_bones
param=combat_xp_multiplier,25

[ghost]
category=fowl
vislevel=hide
param=death_drop,null
param=damagetype,^melee_style
`);

const AI = `[ai_opplayer2,_] gosub(npc_default_attack);
[ai_opplayer2,_fowl] npc_setmode(applayer2);
[ai_applayer2,_fowl] ~npc_rangeattack;
[ai_opplayer2,hen] @hen_ai;
`;

const data = {
    params: PARAMS,
    constants: CONSTANTS,
    npcs: NPCS,
    scripts: [['npc/scripts/fowl.rs2', AI]] as [string, string][],
};

describe('readNpcCombat', () => {
    const npcs = readNpcCombat(data);

    test('config stats and params, each lacking one its default', () => {
        // brute sets every stat but ranged and magic, which fall to NpcType.ts's 1; the defence params and max_dealt
        // fall to their .param defaults (0, 1000); attackrate is its own 6.
        expect(npcs('brute')).toEqual({
            npc: 'brute',
            levels: { attack: 18, defence: 26, strength: 22, hitpoints: 35, ranged: 1, magic: 1 },
            attackBonus: 18,
            strengthBonus: 16,
            defenceBonus: { stab: 0, slash: 0, crush: 0, ranged: 0, magic: 0 },
            attackRate: 6,
            // npc_combat.param's damagetype default is 2, which ^crush_style holds (^other_two, in another file, is not a
            // damage type).
            damageType: 'crush',
            huntMode: 'cowardly',
            huntRange: 2,
            visLevel: 28,
            respawnRate: 100, // NpcType.ts's respawnrate default: brute sets none
            deathDrop: 'big_bones',
            maxDealt: 1000,
            xpMultiplier: 25,
            category: undefined,
            aiOverrides: [],
        });
    });

    test('hen: the stab constant, the bones default, no hunt, the packed vislevel default', () => {
        const hen = npcs('hen');
        expect(hen.levels).toEqual({ attack: 1, defence: 1, strength: 1, hitpoints: 3, ranged: 1, magic: 1 });
        expect([hen.attackBonus, hen.strengthBonus, hen.defenceBonus.stab, hen.defenceBonus.slash]).toEqual([
            -47, 0, -42, 0,
        ]);
        expect([hen.damageType, hen.deathDrop, hen.respawnRate, hen.huntMode, hen.huntRange]).toEqual([
            'stab',
            'bones',
            50,
            undefined,
            0,
        ]);
        expect(hen.visLevel).toBe(NPC_DEFAULTS.visLevel.value);
    });

    test("AI overrides: the npc's own trigger beats its category's, which counts when it has none", () => {
        // hen's own [ai_opplayer2,hen] is the one run; its category fowl's applayer2 still applies. The global
        // [ai_opplayer2,_] is the default AI, not an override.
        expect(npcs('hen').aiOverrides).toEqual([
            { trigger: 'ai_opplayer2', at: 'npc/scripts/fowl.rs2:4' },
            { trigger: 'ai_applayer2', at: 'npc/scripts/fowl.rs2:3' },
        ]);
        expect(npcs('brute').aiOverrides).toEqual([]);
    });

    test('a damage type no npc defence covers, and a missing npc, are ModelErrors', () => {
        expect(() => npcs('ghost')).toThrow(/npc ghost has damage type \^melee_style/);
        expect(() => npcs('ghost')).toThrow(ModelError);
        expect(() => npcs('nobody')).toThrow(new ModelError('no npc nobody'));
    });

    test('vislevel hide is 0 and a null death_drop is none', () => {
        const ghost = readNpcCombat({ ...data, npcs: parseConfigs(NPCS_TEXT_NO_MELEE) })('ghost');
        expect([ghost.visLevel, ghost.deathDrop]).toEqual([0, undefined]);
    });

    test("the packer's vislevel fallback is read with its line", () => {
        const text =
            'a\n            if (!vislevel) {\n                // TODO\n                client.p1(95);\n                client.p2(7);\n';
        expect(readVisLevelDefault('NpcConfig.ts', text)).toEqual({ value: 7, at: 'NpcConfig.ts:2' });
        expect(() => readVisLevelDefault('NpcConfig.ts', 'nothing')).toThrow(/has it moved/);
    });
});

const NPCS_TEXT_NO_MELEE = `
[ghost]
vislevel=hide
param=death_drop,null
`;

describe('paramInt', () => {
    test('a constant value is read; a param the game lacks is a ModelError', () => {
        const cfg = { param: ['damagetype,^slash_style', 'max_dealt,^nope'] };
        expect(paramInt(cfg, 'damagetype', data, 'x')).toBe(1);
        expect(() => paramInt(cfg, 'max_dealt', data, 'x')).toThrow(/no whole number in max_dealt \(\^nope\)/);
        expect(() => paramInt(cfg, 'speed', data, 'x')).toThrow(new ModelError('x: the game has no param speed'));
    });
});

// The levelrequire shapes: a plain label, two skills, a label forwarding its arguments, a quest proc called without
// parentheses, an inline quest check, and an iban-style label with literal levels.
const LEVELREQUIRE = `[label,levelrequire_attack](int $level, int $slot)
if (stat_base(attack) < $level) {
    mes("You need to have an attack level of <tostring($level)>.");
    return;
}
~equip($slot);

[label,levelrequire_attack_and_strength](int $attack_level, int $strength_level, int $slot)
if (stat_base(attack) < $attack_level | stat_base(strength) < $strength_level) {
    return;
}
~equip($slot);

[label,levelrequire_defence](int $level, int $slot)
if (stat_base(defence) < $level) {
    return;
}
~equip($slot);

[label,levelrequire_quest_defence](int $level, int $slot)
if (~levelrequire_quest = false) {
    return;
}
@levelrequire_defence($level, $slot);

[proc,levelrequire_quest]()(boolean)
if (%dragonquest < ^dragon_complete) {
    return(false);
}
return(true);

[label,levelrequire_staff](int $slot)
if (stat_base(magic) < 50) {
    return;
}
if (stat_base(attack) < 50) {
    return;
}
~equip($slot);
`;

const TIER = `// Melee
[opheld2,steel_blade] @levelrequire_attack(5, last_slot);
[opheld2,steel_halberd] @levelrequire_attack_and_strength(5, 3, last_slot);
[opheld2,steel_plate] @levelrequire_quest_defence(40, last_slot);
[opheld2,steel_staff] @levelrequire_staff(last_slot);
[opheld2,viking_blade]
if (%viking < ^viking_complete) {
    return;
}
@levelrequire_attack(30, last_slot);
[opheld2,bronze_blade] @tutorial_island_equip(last_slot);
`;

const TUTORIAL = `[label,tutorial_island_equip](int $slot)
if (~in_tutorial_island(coord) = true) {
    if (%tutorial < ^some_step) {
        return;
    }
}

@levelrequire_attack(1, $slot);
`;

const LEVEL_SCRIPTS: [string, string][] = [
    ['levelrequire/scripts/levelrequire.rs2', LEVELREQUIRE],
    ['levelrequire/scripts/tier5.rs2', TIER],
    ['tutorial/scripts/tutorial.rs2', TUTORIAL],
];

describe('readWieldRequirements', () => {
    const wield = readWieldRequirements(LEVEL_SCRIPTS);

    test('each label shape, with its arguments bound', () => {
        expect(wield.get('steel_blade')).toEqual({
            levels: { attack: 5 },
            quests: [],
            at: 'levelrequire/scripts/tier5.rs2:2',
        });
        expect(wield.get('steel_halberd')?.levels).toEqual({ attack: 5, strength: 3 });
        expect(wield.get('steel_plate')).toMatchObject({ levels: { defence: 40 }, quests: ['dragonquest'] });
        expect(wield.get('steel_staff')?.levels).toEqual({ magic: 50, attack: 50 });
        expect(wield.get('viking_blade')).toMatchObject({ levels: { attack: 30 }, quests: ['viking'] });
    });

    test("the Tutorial Island gate is its trailing levelrequire call: its island checks don't count", () => {
        expect(wield.get('bronze_blade')).toMatchObject({ levels: { attack: 1 }, quests: [] });
    });

    test('a gate calling a label it cannot follow throws naming its line', () => {
        expect(() =>
            readWieldRequirements([
                ...LEVEL_SCRIPTS,
                ['levelrequire/scripts/tier9.rs2', '\n[opheld2,odd] @levelrequire_unknown(9, last_slot);'],
            ]),
        ).toThrow('levelrequire/scripts/tier9.rs2:2: levelrequire calls @levelrequire_unknown');
    });
});

const OBJS = parseConfigs(`
[steel_blade]
wearpos=righthand
category=weapon_slash
param=slashattack,21
param=strengthbonus,20

[steel_2h]
wearpos=righthand
wearpos2=lefthand
category=weapon_heavy
param=attackrate,7

[steel_plate]
wearpos=torso
wearpos2=arms
param=slashdefence,30

[big_bones]
param=bone_exp,150

[logs]
cost=4
`);

describe('readEquipment', () => {
    const equipment = readEquipment({ ...data, objs: OBJS, scripts: LEVEL_SCRIPTS });

    test("a weapon's bonuses, the attackrate default of 4, and its wield level", () => {
        const blade = equipment('steel_blade');
        expect(blade.wearpos).toEqual(['righthand']);
        expect([blade.bonuses.slashattack, blade.bonuses.strengthbonus, blade.bonuses.stabattack]).toEqual([21, 20, 0]);
        expect([blade.attackRate, blade.attackRange, blade.category]).toEqual([4, 0, 'weapon_slash']);
        expect(blade.wield?.levels).toEqual({ attack: 5 });
    });

    test('every wearpos counts; an ungated obj has no wield requirement', () => {
        expect(equipment('steel_2h')).toMatchObject({
            wearpos: ['righthand', 'lefthand'],
            attackRate: 7,
            wield: undefined,
        });
        expect(equipment('steel_plate').wearpos).toEqual(['torso', 'arms']);
    });

    test('an obj with no wearpos, or none at all, is a ModelError', () => {
        expect(() => equipment('logs')).toThrow(new ModelError('obj logs cannot be worn: it has no wearpos'));
        expect(() => equipment('nothing')).toThrow(new ModelError('no obj nothing'));
    });
});

describe('readBoneXp', () => {
    test("bone_exp in tenths, or the param's default of 0", () => {
        const bone = readBoneXp({ ...data, objs: OBJS });
        expect([bone('big_bones'), bone('logs')]).toEqual([150, 0]);
    });
});

const COMBAT_RS2 = `[proc,combat_get_weapon_style_data](obj $weapon)(dbrow)
if ($weapon = null | (map_members = ^false & oc_members($weapon) = true)) {
    return(weapon_unarmed_table);
}
// return(enum(category, dbrow, combat_style_enum, oc_category($weapon)));
switch_category(oc_category($weapon)) {
    case weapon_slash : return(weapon_slash_table);
    case weapon_heavy : return(weapon_slash_table);
    case default : return(weapon_unarmed_table);
}
`;

const STYLE_ROWS = parseDbrows(`
[weapon_slash_table]
table=combat_style_table
data=damagestyle,^style_melee_accurate
data=damagestyle,^style_melee_controlled
data=damagetype,^slash_style
data=damagetype,^stab_style

[weapon_unarmed_table]
table=combat_style_table
data=damagestyle,^style_melee_aggressive
data=damagetype,^crush_style
`);

describe('readCombatStyles', () => {
    const styles = readCombatStyles({
        dbrows: STYLE_ROWS,
        constants: CONSTANTS,
        scripts: [['skill_combat/scripts/combat.rs2', COMBAT_RS2]],
    });

    test("a category's table, in button order", () => {
        expect(styles('weapon_slash')).toEqual({
            table: 'weapon_slash_table',
            styles: [
                { kind: 'melee', style: 'accurate', damageType: 'slash' },
                { kind: 'melee', style: 'controlled', damageType: 'stab' },
            ],
        });
        expect(styles('weapon_heavy').table).toBe('weapon_slash_table');
    });

    test('no weapon is the null check; an unlisted category the default', () => {
        expect(styles(undefined)).toEqual({
            table: 'weapon_unarmed_table',
            styles: [{ kind: 'melee', style: 'aggressive', damageType: 'crush' }],
        });
        expect(styles('weapon_odd').table).toBe('weapon_unarmed_table');
    });
});
