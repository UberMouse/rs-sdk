import { describe, expect, test } from 'bun:test';
import { ModelError, ProfileError, type Family } from '../model/family';
import { lootExpectation, lootRows, scaleByPlayercount, type GameData } from '../model/families/common';
import { runesPerEssence } from '../model/families/runecraft';
import { parseCatch, readSpots } from '../model/families/fishing';
import { buildFamilies, FAMILIES } from '../model/families/index';
import type { Profile } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';
import { parseConfigs } from '../sources/configs';
import { parseDbrows } from '../sources/dbrows';
import { WORLD_FORMAT, type Feature, type FeatureKind, type Site, type World } from '../types';

// Small copies of the real rows and scripts (families.real.test.ts checks the real ones still say this).
const DBROWS = `
[runecraft_earth]
table=runecraft_table
data=type,4
data=level,9
data=experience,65
data=rune,earthrune
data=talisman,earth_talisman
data=multiplier,26

[runecraft_death]
table=runecraft_table
data=type,13
data=level,65
data=experience,100
data=rune,deathrune
data=talisman,death_talisman

[normal_tree_table]
table=woodcutting_trees
data=tree,tree
data=levelrequired,0
data=productexp,250
data=product,logs
data=respawnrate,0
data=successchance,rune_axe,200,255

[yew_tree_table]
table=woodcutting_trees
data=tree,yewtree
data=levelrequired,60
data=productexp,1750
data=product,yew_logs
data=respawnrate,200
data=successchance,adamant_axe,12,37
data=successchance,rune_axe,14,44

[rune_essence_table]
table=mining_table
data=rock,blankrunestone
data=ore_name,rune stones
data=rock_output,blankrune
data=rock_level,1
data=rock_exp,50
data=rock_successchance,256,256

[copper_rock_table]
table=mining_table
data=rock,copperrock1
data=ore_name,copper
data=rock_output,copper_ore
data=rock_level,1
data=rock_exp,175
data=rock_successchance,128,400
data=rock_respawnrate,10

[iron_rock_table]
table=mining_table
data=rock,ironrock1
data=rock,loc_4982
data=ore_name,iron
data=rock_output,iron_ore
data=rock_level,15
data=rock_exp,350
data=rock_successchance,96,350
data=rock_respawnrate,20

[gem_rock]
table=mining_table
data=rock,gemrock
data=ore_name,gems
data=rock_level,40
data=rock_exp,650
data=rock_successchance,28,70
data=rock_respawnrate,200

[pickpocket_guard]
table=pickpocket
data=npc,guard1
data=level,40
data=experience,468
data=stun_ticks,8
data=stun_damage,2
data=success_chance,50,240
data=loot,coins,30,30,128

[stealing_bakery_stall]
table=stealing
data=loc,bakers_stall_stealing
data=level,5
data=experience,160
data=respawn_ticks,8
data=loot,cake,1,1,13,a cake
data=loot,bread,1,1,5,some bread
data=loot,chocolate_slice,1,1,2,a chocolate slice
data=loot_total,20

[cooking_generic_salmon]
table=cooking_generic
data=uncooked,raw_salmon
data=cooked,salmon
data=burnt,burntfish2
data=levelrequired,25
data=experience,900
data=successchance,68,392
data=successchance_cookomatic,78,402

[cooking_generic_meat]
table=cooking_generic
data=uncooked,raw_beef
data=cooked,cooked_meat
data=burnt,burnt_meat
data=levelrequired,1
data=experience,300
data=successchance,128,512
data=successchance_range,1,1
data=cantcookmessage_fire,

[cooking_generic_cake]
table=cooking_generic
data=uncooked,uncooked_cake
data=cooked,cake
data=burnt,burnt_cake
data=additional,cake_tin
data=levelrequired,40
data=experience,1800
data=successchance,0,0
data=cantcookmessage_fire,You can't cook that on a fire.

[magic_spell_superheat]
table=magic_spell_table
data=spell,^superheat_item
data=levelrequired,43
data=runesrequired,naturerune,1,firerune,4,null,null
data=experience,530

[magic_staff_fire]
table=magic_staff_table
data=staff,staff_of_fire
data=staff,lava_battlestaff
data=rune,firerune

[magic_staff_earth]
table=magic_staff_table
data=staff,staff_of_earth
data=staff,lava_battlestaff
data=rune,earthrune

[iron_platebody]
table=smithing
data=ifproduct,iron_platebody
data=product,iron_platebody
data=product_amount,1
data=levelrequired,33
data=bar,iron_bar
data=bar_amount,5

[iron_dart_tip]
table=smithing
data=ifproduct,iron_dart_tip
data=product,iron_dart_tip
data=product_amount,10
data=levelrequired,19
data=bar,iron_bar
data=bar_amount,1

[fletching_normal]
table=fletch_bow_table
data=log,logs
data=shafts,15
data=objchoices,shortbow,longbow
data=shortbow,unstrung_shortbow,5,50
data=longbow,unstrung_longbow,10,100

[fletching_willow]
table=fletch_bow_table
data=log,willow_logs
data=objchoices,willow_shortbow,willow_longbow
data=shortbow,unstrung_willow_shortbow,35,333
data=longbow,unstrung_willow_longbow,40,415

[stringing_willow_longbow]
table=fletching_table
data=item,unstrung_willow_longbow
data=product,willow_longbow,1
data=level,40
data=experience,415

[fletching_bronze_arrow]
table=fletching_table
data=item,bronze_arrowheads
data=metal,bronze
data=product,bronze_arrow,15
data=level,1
data=experience,13
`;

const OBJS = `
[adamant_pickaxe]
param=levelrequire,31
param=mining_rate,3
[rune_pickaxe]
param=levelrequire,41
param=mining_rate,2
[raw_trout]
param=fishing_struct,fishing_struct_trout
[raw_salmon]
param=fishing_struct,fishing_struct_salmon
[iron_ore]
param=smeltsto,iron_bar
[tin_ore]
param=smeltsto,bronze_bar
[gold_ore]
param=smeltsto,gold_bar
[coal]
[iron_bar]
param=smelting_struct,smelting_iron_bar
param=smithing_anvil_struct,smithing_iron_bar
[bronze_bar]
param=smelting_struct,smelting_bronze_bar
[gold_bar]
param=smelting_struct,smelting_gold_bar
[flax]
param=crafting_spinning_struct,flax
[wool]
param=crafting_spinning_struct,wool
[logs]
category=category_22
param=levelrequire,1
param=productexp,400
[willow_logs]
category=category_22
param=levelrequire,30
param=productexp,900
[unstrung_willow_longbow]
category=unstrung_bow
[bronze_arrowheads]
`;

const LOCS = `
[copperrock1]
category=mining_rock_normal
[ironrock1]
category=mining_rock_fast
[loc_4982]
category=mining_rock_normal
[blankrunestone]
[earth_altar]
param=rune_type,4
[death_altar]
param=rune_type,13
[lost_altar]
param=rune_type,99
[gemrock]
[range]
category=cooking_oven
[cooksquestrange]
category=cooking_oven
[fire]
category=cooking_fire
`;

const STRUCTS = `
[fishing_struct_trout]
param=productexp,500
param=success_low,32
param=success_high,192
[fishing_struct_salmon]
param=productexp,700
param=success_low,16
param=success_high,96
[smelting_bronze_bar]
param=product,bronze_bar
param=levelrequired,1
param=productexp,62
param=ingredient,copper_ore
param=bar_count,1
param=ingredient_secondary,tin_ore
param=ingredient_secondary_count,1
[smelting_iron_bar]
param=product,iron_bar
param=levelrequired,15
param=productexp,125
param=ingredient,iron_ore
param=bar_count,1
[smelting_gold_bar]
param=product,gold_bar
param=levelrequired,40
param=productexp,225
param=ingredient,gold_ore
param=bar_count,1
[smithing_iron_bar]
param=levelrequired,15
param=xpperbar,250
[flax]
param=product,bow_string
param=levelrequire,10
param=productexp,150
param=ingredient,flax
[wool]
param=product,ball_of_wool
param=productexp,25
param=ingredient,wool
`;

// freshfish.rs2's lure trigger and continue label, cut down; memberfish's big net, whose roll is its own proc.
const FRESHFISH = `[opnpc4,_freshfish]
@fish_trout_salmon;

[label,fish_trout_salmon]
if (stat(fishing) < 20) {
    return;
}
if (~check_fish_equipment(fly_fishing_rod) = false) {
    return;
}
if (%action_delay < map_clock) {
    %action_delay = calc(map_clock + 4);
} else if (%action_delay = map_clock) {
    if (stat(fishing) >= 30) {
        ~fish_roll(raw_trout, raw_salmon, fly_fishing_rod, feather);
    } else {
        ~fish_roll(raw_trout, null, fly_fishing_rod, feather);
    }
}
p_opnpc(4);
`;
const MEMBERFISH = `[opnpc4,_memberfish] @fish_mackerel;
[label,fish_mackerel]
if (~check_fish_equipment(big_net) = false) {
    return;
}
if (%action_delay < map_clock) {
    %action_delay = calc(map_clock + 5);
} else if (%action_delay = map_clock) {
    ~fish_roll_big_net;
}
`;

const data: GameData = {
    dbrows: parseDbrows(DBROWS),
    objs: parseConfigs(OBJS),
    locs: parseConfigs(LOCS),
    structs: parseConfigs(STRUCTS),
    npcs: new Map(),
    params: new Map(),
    constants: new Map(),
    scripts: [
        ['skill_fishing/scripts/fishing_spots/freshfish.rs2', FRESHFISH],
        ['skill_fishing/scripts/fishing_spots/memberfish.rs2', MEMBERFISH],
    ],
};
const families = buildFamilies(data);
const family = (id: string): Family => families.get(id)!;
/** The families over `dbrows` in place of DBROWS. */
const withRows = (dbrows: string) => buildFamilies({ ...data, dbrows: parseDbrows(dbrows) });

/** A site of `kind` holding one feature per [config, subtype], and the world they are in. */
function at(kind: FeatureKind, features: [config: string, subtype: string][]): { site: Site; world: World } {
    const tile = { level: 0, x: 3200, z: 3200 };
    const fs: Feature[] = features.map(([config, subtype], id) => ({
        source: 'loc',
        id,
        config,
        tile,
        kind,
        subtype,
        name: config,
    }));
    const site: Site = {
        id: `${kind}:test:0`,
        kind,
        areaPath: [],
        centre: tile,
        bbox: { x1: 3200, z1: 3200, x2: 3200, z2: 3200 },
        stand: tile,
        counts: {},
        features: fs.map((_, i) => i),
        f2p: false,
        multiway: false,
        wildernessLevel: 0,
        reach: [[]],
    };
    const world: World = {
        format: WORLD_FORMAT,
        generatedFrom: '',
        areas: [],
        features: fs,
        sites: [site],
        npcSpawns: [],
        connectors: [],
        quests: [],
        loadoutRules: {},
        transports: [],
        gates: [],
        crossings: [],
        methods: [],
    };
    return { site, world };
}

/** Every skill at `level`, with the given tools. */
const profile = (level: number, tools: Partial<Profile> = {}): Profile => ({
    levels: Object.fromEntries(SKILLS.map(s => [s, level])) as Record<Skill, number>,
    axe: null,
    pickaxe: null,
    glory: false,
    worn: [],
    ...tools,
});

/** What running a family throws (it must throw). */
function thrown(id: string, where: { site: Site; world: World }, params: unknown, p: Profile): unknown {
    try {
        family(id).model(where.site, params, p, where.world);
    } catch (e) {
        return e;
    }
    throw new Error(`${id} modelled it`);
}

/** Runs a family, expecting a ModelError whose message matches `re` that is not a ProfileError: a site, param or data fault. */
function fails(id: string, where: { site: Site; world: World }, params: unknown, p: Profile, re: RegExp): void {
    const e = thrown(id, where, params, p);
    expect(e).toBeInstanceOf(ModelError);
    expect(e).not.toBeInstanceOf(ProfileError);
    expect((e as Error).message).toMatch(re);
}

/** Runs a family, expecting a ProfileError (the profile can't do it: a level, a tool) whose message matches `re`. */
function refuses(id: string, where: { site: Site; world: World }, params: unknown, p: Profile, re: RegExp): void {
    const e = thrown(id, where, params, p);
    expect(e).toBeInstanceOf(ProfileError);
    expect((e as Error).message).toMatch(re);
}

describe('helpers', () => {
    test('scaleByPlayercount is base - 1 at one player, truncated', () => {
        // player_count.rs2: scale(4000 - 1, 4000, 200) = 3999 * 200 / 4000 = 199.95, truncated to 199.
        expect(scaleByPlayercount(200)).toBe(199);
        expect(scaleByPlayercount(20)).toBe(19);
        // 2000 players and over halve it: 2000 * 200 / 4000 = 100.
        expect(scaleByPlayercount(200, 3000)).toBe(100);
    });

    test('lootExpectation: each row rolls (pickpocket) or the first win ends it (stall)', () => {
        // Rows rolled from the last up, out of 20: c (2) wins 2/20; b (5) 5/18; a (13) 13/13.
        const rows = [
            { obj: 'a', min: 1, max: 1, weight: 13 },
            { obj: 'b', min: 2, max: 4, weight: 5 },
            { obj: 'c', min: 1, max: 1, weight: 2 },
        ];
        // first: c 2/20; b reached 18/20 then 5/18 = 5/20, times a mean of (2+4)/2 = 3 is 15/20; a 13/20.
        const first = lootExpectation(rows, 20, 'first');
        expect(first.map(x => x.obj)).toEqual(['a', 'b', 'c']);
        expect(first[0]!.count).toBeCloseTo(13 / 20, 12);
        expect(first[1]!.count).toBeCloseTo(15 / 20, 12);
        expect(first[2]!.count).toBeCloseTo(2 / 20, 12);
        // each: c 2/20, b 5/18 * 3 = 15/18, a 13/13 = 1.
        const each = lootExpectation(rows, 20, 'each');
        expect(each[0]!.count).toBe(1);
        expect(each[1]!.count).toBeCloseTo(15 / 18, 12);
        expect(each[2]!.count).toBeCloseTo(2 / 20, 12);
        // A weight past what remains always wins: 128 remaining, then 0 for the next row.
        expect(
            lootExpectation(
                [
                    { obj: 'x', min: 1, max: 1, weight: 10 },
                    { obj: 'y', min: 1, max: 1, weight: 128 },
                ],
                128,
                'each',
            ),
        ).toEqual([
            { obj: 'x', count: 1 },
            { obj: 'y', count: 1 },
        ]);
    });
});

describe('woodcutting', () => {
    const yew = at('tree', [['yewtree', 'yew']]);

    test('yew with a rune axe at Woodcutting 60', () => {
        // trees.dbrow rune_axe 14,44. PlayerOps.ts stat_random at 60: floor(14*39/98) = floor(5.57) = 5,
        // floor(44*59/98) = floor(26.49) = 26, + 1 = 32: 32/256 = 1/8 a roll. woodcut.rs2:153-158 rolls every
        // 3 + 1 = 4 ticks; :184 depletes with random(8) = 0, 1/8; respawn ~scale_by_playercount(200) = 199.
        const m = family('woodcutting').model(yew.site, { tree: 'yew' }, profile(60, { axe: 'rune_axe' }), yew.world);
        expect(m).toEqual({
            ticksPerAttempt: 4,
            success: 32 / 256,
            xpTenths: { woodcutting: 1750 },
            products: [{ obj: 'yew_logs', count: 1 }],
            consumes: [],
            deplete: { chance: 1 / 8, respawnTicks: 199 },
            features: 1,
            tools: ['rune_axe'],
        });
    });

    test('a normal tree falls every log and stays down 120 + random(80), scaled', () => {
        // woodcut.rs2:171-174: respawnrate 0 makes it 120..199 and $deplete_chance 0 (random(0) = 0 always).
        // Scaled at one player each is x - 1, so the mean is (120 + 199)/2 - 1 = 158.5.
        const normal = at('tree', [['tree', 'normal']]);
        const m = family('woodcutting').model(normal.site, {}, profile(1, { axe: 'rune_axe' }), normal.world);
        expect(m.deplete).toEqual({ chance: 1, respawnTicks: 158.5 });
    });

    test('fails with a reason', () => {
        const rune = profile(60, { axe: 'rune_axe' });
        fails('woodcutting', yew, { tree: 'magic' }, rune, /has no tree magic/);
        refuses('woodcutting', yew, { tree: 'yew' }, profile(59, { axe: 'rune_axe' }), /needs woodcutting 60.*has 59/);
        refuses('woodcutting', yew, {}, profile(60), /needs an axe/);
        fails('woodcutting', yew, {}, profile(60, { axe: 'bronze_axe' }), /no successchance for bronze_axe/);
        fails('woodcutting', yew, { axe: 'rune_axe' }, rune, /no param axe/);
        fails('woodcutting', at('rock', [['ironrock1', 'iron']]), {}, rune, /rock site, not a tree site/);
        const mixed = at('tree', [
            ['yewtree', 'yew'],
            ['tree', 'normal'],
        ]);
        fails('woodcutting', mixed, {}, rune, /several tree subtypes \(normal, yew\): name one/);
    });
});

describe('mining', () => {
    const iron = at('rock', [['ironrock1', 'iron']]);
    const adamant = profile(60, { pickaxe: 'adamant_pickaxe' });

    test('iron with an adamant pickaxe at Mining 60, the gem roll included', () => {
        // mine.dbrow iron 96,350. stat_random at 60: floor(96*39/98) = floor(38.2) = 38, floor(350*59/98) =
        // floor(210.7) = 210, + 1 = 249: 249/256. The gem roll random(256) = 1 comes first and takes the swing
        // (mining.rs2:188-201), so an ore is (255/256)(249/256) = 63495/65536 an attempt. Adamant's mining_rate 3:
        // a roll every 4 ticks. A gem is 1/256 an attempt, then 2, 8, 16, 32 of 128 a diamond, ruby, emerald,
        // sapphire: a diamond per ore is (1/256)(2/128) / (63495/65536) = 4/63495. Respawn scale(3999, 4000, 20) = 19.
        const m = family('mining').model(iron.site, { rock: 'iron' }, adamant, iron.world);
        const success = 63495 / 65536;
        expect(m.ticksPerAttempt).toBe(4);
        expect(m.success).toBe(success);
        expect(m.xpTenths).toEqual({ mining: 350 });
        // One iron rock at the site shares the load; the pickaxe is the profile's.
        expect([m.features, m.tools]).toEqual([1, ['adamant_pickaxe']]);
        expect(m.successTicks).toBeUndefined();
        expect(m.deplete).toEqual({ chance: 1, respawnTicks: 19 });
        expect(m.products[0]).toEqual({ obj: 'iron_ore', count: 1 });
        expect(m.products.slice(1).map(g => g.obj)).toEqual([
            'uncut_diamond',
            'uncut_ruby',
            'uncut_emerald',
            'uncut_sapphire',
        ]);
        expect(m.products[1]!.count).toBeCloseTo(4 / 63495, 15);
        expect(m.products[4]!.count).toBeCloseTo(64 / 63495, 15);
    });

    test('a glory makes the gem roll random(86)', () => {
        // mining.rs2:189-193: an ore is (85/86)(249/256).
        const m = family('mining').model(iron.site, {}, { ...adamant, glory: true }, iron.world);
        expect(m.success).toBeCloseTo((85 / 86) * (249 / 256), 15);
    });

    test('a normal rock adds a tick per ore; essence never fails or depletes', () => {
        // get_ore_normal's p_delay(0) (mining.rs2:157); copper 128,400 at 60: 50 + 240 + 1 = 291, over 256: 1.
        const copper = at('rock', [['copperrock1', 'copper']]);
        const m = family('mining').model(copper.site, {}, adamant, copper.world);
        expect(m.successTicks).toBe(1);
        expect(m.success).toBe(255 / 256);
        expect(m.deplete).toEqual({ chance: 1, respawnTicks: 9 });
        // An iron rock of the normal category (loc_4982) runs get_ore_normal too.
        const normalIron = at('rock', [['loc_4982', 'iron']]);
        expect(family('mining').model(normalIron.site, {}, adamant, normalIron.world).successTicks).toBe(1);
        // get_ore_essence (mining.rs2:217-227): one essence a swing, every rune pickaxe swing of 2 + 1 ticks.
        const essence = at('rock', [['blankrunestone', 'rune stones']]);
        expect(
            family('mining').model(essence.site, {}, profile(41, { pickaxe: 'rune_pickaxe' }), essence.world),
        ).toEqual({
            ticksPerAttempt: 3,
            success: 1,
            xpTenths: { mining: 50 },
            products: [{ obj: 'blankrune', count: 1 }],
            consumes: [],
            tools: ['rune_pickaxe'],
        });
    });

    test('fails with a reason', () => {
        refuses('mining', iron, {}, profile(14, { pickaxe: 'adamant_pickaxe' }), /needs mining 15/);
        refuses('mining', iron, {}, profile(60), /needs a pickaxe/);
        refuses('mining', iron, {}, profile(40, { pickaxe: 'rune_pickaxe' }), /a rune_pickaxe needs mining 41/);
        fails('mining', iron, { rock: 'gold' }, adamant, /has no rock gold/);
        fails('mining', at('rock', [['gemrock', 'gems']]), {}, adamant, /gemrock \(category none\) is not modelled/);
        const mixed = at('rock', [
            ['ironrock1', 'iron'],
            ['loc_4982', 'iron'],
        ]);
        fails('mining', mixed, {}, adamant, /differ in label/);
    });
});

describe('fishing', () => {
    const lure = at('fishing-spot', [['fishing_spot_lure', 'freshfish']]);

    test('parseCatch reads a spot label; readSpots finds it by the spot subtype', () => {
        expect(parseCatch(FRESHFISH.split('\n\n')[1]!, 'f:4')).toEqual({
            tool: 'fly_fishing_rod',
            level: 20,
            delay: 4,
            fish1: 'raw_trout',
            fish2: { obj: 'raw_salmon', level: 30 },
            bait: 'feather',
            source: 'f:4',
        });
        // No ~fish_roll (big net's own proc): not a catch, and its tool is unmodelled.
        expect(parseCatch(MEMBERFISH, 'm:1')).toBeNull();
        // A roll loop with no level check is level 1 only for the listed shrimp net; any other fails.
        const noCheck = FRESHFISH.split('\n\n')[1]!.replace(/if \(stat\(fishing\) < 20\) \{\s*return;\s*\}\s*/, '');
        expect(() => parseCatch(noCheck, 'f:4')).toThrow(
            /f:4: fly_fishing_rod catch of raw_trout has no stat\(fishing\)/,
        );
        const shrimp = noCheck
            .replace(/fly_fishing_rod/g, 'net')
            .replace(/raw_trout/g, 'raw_shrimp')
            .replace(/feather/g, 'null');
        expect(parseCatch(shrimp, 's:1')!.level).toBe(1);
        const spots = readSpots(data.scripts);
        expect([...spots.get('freshfish')!.catches.keys()]).toEqual(['fly_fishing_rod']);
        expect(spots.get('freshfish')!.catches.get('fly_fishing_rod')!.source).toBe(
            'skill_fishing/scripts/fishing_spots/freshfish.rs2:4',
        );
        expect([...spots.get('memberfish')!.unmodelled]).toEqual(['big_net']);
    });

    test('trout and salmon fly fishing at Fishing 40', () => {
        // fishing.struct salmon 16,96: floor(16*59/98) = floor(9.63) = 9, floor(96*39/98) = floor(38.2) = 38, + 1 =
        // 48/256. Trout 32,192: floor(19.27) = 19, floor(76.41) = 76, + 1 = 96/256. ~fish_roll (fishing.rs2:46-72)
        // rolls salmon first, then trout on a miss: a catch is 48/256 + (208/256)(96/256) = 48/256 + 78/256 = 126/256
        // an attempt, salmon 48 and trout 78 of those 126. XP (48*700 + 78*500)/126 = 72600/126 tenths a catch.
        // The label resets %action_delay to map_clock + 4: a roll every 5 ticks. A feather goes per catch.
        const m = family('fishing').model(lure.site, { tool: 'fly_fishing_rod' }, profile(40), lure.world);
        expect(m.ticksPerAttempt).toBe(5);
        expect(m.success).toBe(126 / 256);
        expect(m.xpTenths.fishing).toBeCloseTo(72600 / 126, 10);
        expect(m.products).toEqual([
            { obj: 'raw_trout', count: 78 / 126 },
            { obj: 'raw_salmon', count: 48 / 126 },
        ]);
        expect(m.consumes).toEqual([{ obj: 'feather', count: 1 }]);
        expect(m.deplete).toBeUndefined();
    });

    test('under the salmon level only trout is rolled', () => {
        // At 29 the label passes fish2 = null. Trout at 29: floor(32*70/98) = floor(22.86) = 22, floor(192*28/98) =
        // floor(54.86) = 54, + 1 = 77/256.
        const m = family('fishing').model(lure.site, { tool: 'fly_fishing_rod' }, profile(29), lure.world);
        expect(m.success).toBe(77 / 256);
        expect(m.products).toEqual([{ obj: 'raw_trout', count: 1 }]);
        expect(m.xpTenths).toEqual({ fishing: 500 });
        expect(m.tools).toEqual(['fly_fishing_rod']);
    });

    test('fails with a reason', () => {
        refuses('fishing', lure, { tool: 'fly_fishing_rod' }, profile(19), /needs fishing 20/);
        fails('fishing', lure, { tool: 'harpoon' }, profile(40), /no harpoon catch \(modelled: fly_fishing_rod\)/);
        fails('fishing', lure, {}, profile(40), /needs a tool param/);
        fails('fishing', lure, { tool: 1 }, profile(40), /tool must be a string/);
        const big = at('fishing-spot', [['fishing_spot_big', 'memberfish']]);
        fails('fishing', big, { tool: 'big_net' }, profile(40), /big_net catch is not a ~fish_roll loop/);
    });
});

describe('pickpocket', () => {
    const guards = at('pickpocket', [
        ['guard1', 'guard1'],
        ['guard1', 'guard1'],
    ]);

    test('a Falador guard at Thieving 40', () => {
        // pickpocket.dbrow guard 50,240: floor(50*59/98) = floor(30.1) = 30, floor(240*39/98) = floor(95.5) = 95, + 1
        // = 126/256. An attempt's p_delay(0) (thieving.rs2:5) puts the next click 2 ticks on; a fail's two more
        // p_delay(0)s and the 8-tick stun put it 3 + 8 = 11 on, 9 more. 30 coins at 128/128 per success, 2 damage
        // per fail. Ticks per success: (2 + (130/256)*9)/(126/256) = (512 + 1170)/126 = 1682/126.
        const m = family('pickpocket').model(guards.site, { npc: 'guard1' }, profile(40), guards.world);
        expect(m).toEqual({
            ticksPerAttempt: 2,
            success: 126 / 256,
            xpTenths: { thieving: 468 },
            products: [{ obj: 'coins', count: 30 }],
            consumes: [],
            failTicks: 9,
            failDamage: 2,
        });
    });

    test('fails with a reason', () => {
        refuses('pickpocket', guards, {}, profile(39), /needs thieving 40/);
        // A malformed loot row, or a stun under a tick, fails naming its row rather than modelling NaN or a wrong cadence.
        expect(() => lootRows(parseDbrows('[r]\ntable=pickpocket\ndata=loot,coins,x,30,128')[0]!)).toThrow(
            /r has a malformed loot\[0\]: coins,x,30,128/,
        );
        const stunless = parseDbrows(DBROWS.replace('data=stun_ticks,8', 'data=stun_ticks,0'));
        const zero = buildFamilies({ ...data, dbrows: stunless }).get('pickpocket')!;
        expect(() => zero.model(guards.site, { npc: 'guard1' }, profile(40), guards.world)).toThrow(/stun_ticks 0/);
        fails('pickpocket', at('pickpocket', [['man', 'man']]), {}, profile(40), /no pickpocket row lists npc man/);
    });
});

describe('stall', () => {
    const bakery = at('stall', [['bakers_stall_stealing', 'bakers_stall_stealing']]);

    test("a baker's stall: no roll, a weighted pick, empty for its respawn", () => {
        // stealing.dbrow: rolled from the last row, out of 20: chocolate 2/20, bread 5/18 of the 18/20 left = 5/20,
        // cake the rest, 13/20. The steal's p_delay(0) (thieving.rs2:70): 2 ticks a steal; the stall is empty
        // scale(3999, 4000, 8) = 7 ticks after each.
        const m = family('stall').model(bakery.site, {}, profile(5), bakery.world);
        expect(m.ticksPerAttempt).toBe(2);
        expect(m.success).toBe(1);
        expect(m.xpTenths).toEqual({ thieving: 160 });
        expect(m.deplete).toEqual({ chance: 1, respawnTicks: 7 });
        expect(m.products.map(x => x.obj)).toEqual(['cake', 'bread', 'chocolate_slice']);
        expect(m.products.map(x => x.count).reduce((a, b) => a + b)).toBeCloseTo(1, 12);
        expect(m.products[0]!.count).toBeCloseTo(13 / 20, 12);
        expect(m.products[1]!.count).toBeCloseTo(5 / 20, 12);
    });

    test('fails with a reason', () => {
        refuses('stall', bakery, {}, profile(4), /needs thieving 5/);
        const bad = parseDbrows(DBROWS.replace('data=loot,cake,1,1,13,a cake', 'data=loot,cake,1,,13,a cake'));
        const stall = buildFamilies({ ...data, dbrows: bad }).get('stall')!;
        expect(() => stall.model(bakery.site, {}, profile(5), bakery.world)).toThrow(/malformed loot\[0\]/);
        fails('stall', bakery, { stall: 'tea_stall' }, profile(5), /has no stall tea_stall/);
    });
});

describe('cooking', () => {
    const fire = at('fire', [['fire', '']]);

    test('salmon at Cooking 30 on a fire', () => {
        // cooking_generic.dbrow salmon 68,392: floor(68*69/98) = floor(47.88) = 47, floor(392*29/98) = 116, + 1 =
        // 164/256 cooked, 92/256 burnt (cooking.rs2:144-150). One item per click: p_delay(1) (:172) holds the player
        // two ticks, so the next click lands 3 ticks on. XP 900 per cooked one: 900 * 164/256 an item.
        const m = family('cooking').model(fire.site, { food: 'raw_salmon' }, profile(30), fire.world);
        expect(m).toEqual({
            ticksPerAttempt: 3,
            success: 1,
            xpTenths: { cooking: (900 * 164) / 256 },
            products: [
                { obj: 'salmon', count: 164 / 256 },
                { obj: 'burntfish2', count: 92 / 256 },
            ],
            consumes: [{ obj: 'raw_salmon', count: 1 }],
        });
    });

    test('the Lumbridge cook-o-matic and a range row use their own chances; 0,0 and 1,1 are fixed', () => {
        // cooking.rs2:138-140: cooksquestrange uses 78,402: floor(78*69/98) = floor(54.92) = 54, floor(402*29/98) =
        // floor(118.96) = 118, + 1 = 173/256. Ideal play takes the best loc of the site.
        const kitchen = at('range', [
            ['range', ''],
            ['cooksquestrange', ''],
        ]);
        const salmon = family('cooking').model(kitchen.site, { food: 'raw_salmon' }, profile(30), kitchen.world);
        expect(salmon.products[0]).toEqual({ obj: 'salmon', count: 173 / 256 });
        // A range uses successchance_range when the row has one (:117-122): 1,1 never burns.
        const range = at('range', [['range', '']]);
        const beef = family('cooking').model(range.site, { food: 'raw_beef' }, profile(1), range.world);
        expect(beef.products).toEqual([{ obj: 'cooked_meat', count: 1 }]);
        // On a fire the same row rolls 128,512: at 1, 128 + 0 + 1 = 129/256.
        expect(
            family('cooking').model(fire.site, { food: 'raw_beef' }, profile(1), fire.world).products[0]!.count,
        ).toBe(129 / 256);
        // 0,0 always burns (:144-145), still a 3-tick item, and its additional item comes either way (:192-194).
        const cake = family('cooking').model(range.site, { food: 'uncooked_cake' }, profile(40), range.world);
        expect(cake.xpTenths).toEqual({ cooking: 0 });
        expect(cake.products).toEqual([
            { obj: 'burnt_cake', count: 1 },
            { obj: 'cake_tin', count: 1 },
        ]);
    });

    test('fails with a reason', () => {
        refuses('cooking', fire, { food: 'raw_salmon' }, profile(24), /needs cooking 25/);
        fails('cooking', fire, { food: 'raw_shark' }, profile(99), /no cooking_generic row cooks raw_shark/);
        fails('cooking', fire, {}, profile(99), /needs a food param/);
        fails('cooking', fire, { food: 'uncooked_cake' }, profile(99), /can't be cooked on site fire:test:0/);
        fails('cooking', at('tree', [['tree', 'normal']]), { food: 'raw_salmon' }, profile(99), /not a range or fire/);
    });
});

describe('superheat', () => {
    // Cast in place: the site is wherever the step before stands.
    const rocks = at('rock', [['ironrock1', 'iron']]);

    test('iron with a staff of fire at Magic 43', () => {
        // superheat.rs2: iron_ore smeltsto iron_bar, its struct's ingredient iron_ore, one a cast (:35, :62);
        // p_delay(1) (:67) refuses the next OpHeldT for 2 ticks, so a cast every 3. magic_spells.dbrow:186-187:
        // 1 nature + 4 fire, 530 Magic tenths; the worn staff of fire (magic_staff_fire) zeroes the fire runes
        // (magic.rs2:53-88). Smithing: smelting_iron_bar's productexp 125 (:56-60). No fail roll.
        const p = profile(43, { worn: ['staff_of_fire'] });
        expect(family('superheat').model(rocks.site, { ore: 'iron_ore' }, p, rocks.world)).toEqual({
            ticksPerAttempt: 3,
            success: 1,
            xpTenths: { magic: 530, smithing: 125 },
            products: [{ obj: 'iron_bar', count: 1 }],
            consumes: [
                { obj: 'iron_ore', count: 1 },
                { obj: 'naturerune', count: 1 },
            ],
        });
    });

    test('without a staff the fire runes are spent; tin makes bronze from copper and tin', () => {
        // tin_ore smeltsto bronze_bar, whose struct's ingredient is copper_ore (:35) and secondary 1 tin (:61-65).
        const m = family('superheat').model(rocks.site, { ore: 'tin_ore' }, profile(43), rocks.world);
        expect(m.consumes).toEqual([
            { obj: 'copper_ore', count: 1 },
            { obj: 'tin_ore', count: 1 },
            { obj: 'naturerune', count: 1 },
            { obj: 'firerune', count: 4 },
        ]);
        expect(m.xpTenths).toEqual({ magic: 530, smithing: 62 });
    });

    test('a lava battlestaff, in the fire and the earth staff rows, saves the fire runes too', () => {
        // magic_staff_table: lava_battlestaff in magic_staff_fire and magic_staff_earth; ~staff_runes (magic.rs2:53-88)
        // frees every rune of the worn staff's rows. Superheat takes no earth: 1 nature is left.
        const m = family('superheat').model(
            rocks.site,
            { ore: 'iron_ore' },
            profile(43, { worn: ['lava_battlestaff'] }),
            rocks.world,
        );
        expect(m.consumes).toEqual([
            { obj: 'iron_ore', count: 1 },
            { obj: 'naturerune', count: 1 },
        ]);
        // A staff of earth stands in for earth only: the 4 fire are spent.
        const earth = family('superheat').model(
            rocks.site,
            { ore: 'iron_ore' },
            profile(43, { worn: ['staff_of_earth'] }),
            rocks.world,
        );
        expect(earth.consumes).toContainEqual({ obj: 'firerune', count: 4 });
    });

    test('gold with goldsmith gauntlets: scale(5, 2, 225) = 1125 / 2 = 562 tenths', () => {
        // superheat.rs2:57-58; SCALE is a * c / b truncated.
        const p = profile(43, { worn: ['gauntlets_of_goldsmithing'] });
        expect(family('superheat').model(rocks.site, { ore: 'gold_ore' }, p, rocks.world).xpTenths.smithing).toBe(562);
    });

    test('fails with a reason', () => {
        refuses('superheat', rocks, { ore: 'iron_ore' }, profile(42), /needs magic 43/);
        refuses(
            'superheat',
            rocks,
            { ore: 'iron_ore' },
            { ...profile(43), levels: { ...profile(43).levels, smithing: 14 } },
            /needs smithing 15/,
        );
        fails('superheat', rocks, { ore: 'coal' }, profile(99), /coal has no smeltsto/);
        fails('superheat', rocks, {}, profile(99), /needs an ore param/);
    });
});

describe('smelting', () => {
    const furnace = at('furnace', [['furnace', '']]);

    test('iron at a furnace: half the bars without a ring of forging', () => {
        // smelting.rs2: after a bar, start_smelt_ore is queued with delay 0 and smelting_ore with delay 3, both from
        // inside a queue (:164, :188): 1 + 4 = 5 ticks a bar. Iron fails on randominc(1) = 1 (:202): 1/2 a bar and
        // 125 / 2 tenths per ore; the fail still takes the ore (:192-196). The buttons make at most 10 (:53-91): a
        // larger load takes Make X, whose p_countdialog (:94) costs a tick a trip.
        const m = family('smelting').model(furnace.site, { bar: 'iron_bar' }, profile(15), furnace.world);
        expect(m).toEqual({
            ticksPerAttempt: 5,
            restart: { upTo: 10, ticks: 1 },
            success: 1,
            xpTenths: { smithing: 62.5 },
            products: [{ obj: 'iron_bar', count: 0.5 }],
            consumes: [{ obj: 'iron_ore', count: 1 }],
        });
        // A worn ring of forging skips the roll (:200-201): every ore a bar, 125 tenths. It melts at its 140th bar
        // (ring_of_forging.rs2:3-9): 1/140 of a ring an ore.
        const ring = family('smelting').model(
            furnace.site,
            { bar: 'iron_bar' },
            profile(15, { worn: ['ring_of_forging'] }),
            furnace.world,
        );
        expect([ring.products, ring.xpTenths, ring.consumes]).toEqual([
            [{ obj: 'iron_bar', count: 1 }],
            { smithing: 125 },
            [
                { obj: 'iron_ore', count: 1 },
                { obj: 'ring_of_forging', count: 1 / 140 },
            ],
        ]);
    });

    test('gold with goldsmith gauntlets: scale(5, 2, 225) = 562 tenths; no ring wear on any bar but iron', () => {
        // smelting.rs2:216-217. A ring worn while smelting gold is never asked for (:198).
        const worn = ['gauntlets_of_goldsmithing', 'ring_of_forging'];
        const m = family('smelting').model(furnace.site, { bar: 'gold_bar' }, profile(40, { worn }), furnace.world);
        expect([m.xpTenths, m.consumes]).toEqual([{ smithing: 562 }, [{ obj: 'gold_ore', count: 1 }]]);
        const bare = family('smelting').model(furnace.site, { bar: 'gold_bar' }, profile(40), furnace.world);
        expect(bare.xpTenths).toEqual({ smithing: 225 });
    });

    test('bronze takes a copper and a tin a bar', () => {
        const m = family('smelting').model(furnace.site, { bar: 'bronze_bar' }, profile(1), furnace.world);
        expect([m.consumes, m.products, m.xpTenths]).toEqual([
            [
                { obj: 'copper_ore', count: 1 },
                { obj: 'tin_ore', count: 1 },
            ],
            [{ obj: 'bronze_bar', count: 1 }],
            { smithing: 62 },
        ]);
    });

    test('fails with a reason', () => {
        refuses('smelting', furnace, { bar: 'iron_bar' }, profile(14), /needs smithing 15/);
        fails('smelting', furnace, { bar: 'iron_ore' }, profile(99), /iron_ore has no smelting struct/);
        fails('smelting', furnace, {}, profile(99), /needs a bar param/);
        fails('smelting', at('anvil', [['anvil', '']]), { bar: 'iron_bar' }, profile(99), /not a furnace/);
    });
});

describe('smithing', () => {
    const anvil = at('anvil', [['anvil', '']]);

    test('an iron platebody at Smithing 33', () => {
        // smithing.rs2 [proc,smithing_anvil]: p_delay(1) (:272) holds 2 ticks, p_delay(2) (:286) 3: 5 ticks a
        // product. XP bar_amount x xpperbar = 5 x 250 = 1250 tenths (:283). 5 bars a platebody, a hammer held
        // (:101-104). The buttons make 1, 5 or 10 (:1-36): each further 10 takes the bar used on the anvil at
        // t + clickTicks(2) = t + 4 after the last product, the button at t + 5 and its p_delay(1) to t + 7, 2 ticks
        // past the run's t + 5.
        expect(family('smithing').model(anvil.site, { product: 'iron_platebody' }, profile(33), anvil.world)).toEqual({
            ticksPerAttempt: 5,
            restart: { upTo: 10, ticks: 2, repeat: true },
            success: 1,
            xpTenths: { smithing: 1250 },
            products: [{ obj: 'iron_platebody', count: 1 }],
            consumes: [{ obj: 'iron_bar', count: 5 }],
            batch: 5,
            tools: ['hammer'],
        });
    });

    test('fails with a reason', () => {
        refuses('smithing', anvil, { product: 'iron_platebody' }, profile(32), /needs smithing 33/);
        refuses('smithing', anvil, { product: 'iron_platebody' }, profile(14), /working iron_bar needs smithing 15/);
        fails('smithing', anvil, { product: 'rune_platebody' }, profile(99), /no smithing row makes rune_platebody/);
        fails('smithing', anvil, {}, profile(99), /needs a product param/);
        // Dart tips wait on Tourist Trap's ^desertrescue_learned_darts (smithing.rs2:224-230).
        fails(
            'smithing',
            anvil,
            { product: 'iron_dart_tip' },
            profile(99),
            /iron_dart_tip not modelled: needs Tourist Trap/,
        );
        fails('smithing', at('furnace', [['furnace', '']]), { product: 'iron_platebody' }, profile(99), /not an anvil/);
    });
});

describe('spinning', () => {
    const wheel = at('spinning-wheel', [['spinningwheel', '']]);

    test('flax at a wheel at Crafting 10', () => {
        // spinning.rs2: the struct flax (oc_param(flax, crafting_spinning_struct)) makes a bow_string for 150 tenths
        // at Crafting 10 (:60-64, :102-105). After a string, @process_spin's weakqueue 2 from inside the queue
        // (:98, :110) runs 3 ticks on. The wheel's op opens the menu on the arrival tick A, the button comes at A + 1
        // and its weakqueue 3 from a dialog (:87) spins the first at A + 4: one tick over the cadence, once a trip.
        // ~skill_multi2_header's buttons make 1, 5 or 10 (chat.rs2:785-798): a larger load takes Make X's count
        // dialog, a tick a trip.
        expect(family('spinning').model(wheel.site, { obj: 'flax' }, profile(10), wheel.world)).toEqual({
            ticksPerAttempt: 3,
            start: 1,
            restart: { upTo: 10, ticks: 1 },
            success: 1,
            xpTenths: { crafting: 150 },
            products: [{ obj: 'bow_string', count: 1 }],
            consumes: [{ obj: 'flax', count: 1 }],
        });
        // Wool's struct names no levelrequire: the param's default 0 lets any level spin it.
        expect(family('spinning').model(wheel.site, { obj: 'wool' }, profile(1), wheel.world).xpTenths).toEqual({
            crafting: 25,
        });
    });

    test('fails with a reason', () => {
        refuses('spinning', wheel, { obj: 'flax' }, profile(9), /spinning flax needs crafting 10/);
        fails('spinning', wheel, { obj: 'logs' }, profile(99), /logs has no spinning struct/);
        fails('spinning', wheel, {}, profile(99), /needs an obj param/);
        fails('spinning', at('furnace', [['furnace', '']]), { obj: 'flax' }, profile(99), /not a spinning wheel/);
    });

    test("Rellekka's wheel spins as any other: its quest is in the site's reach (gates.ts USE_GATES)", () => {
        const viking = at('spinning-wheel', [['viking_spinningwheel', '']]);
        expect(family('spinning').model(viking.site, { obj: 'flax' }, profile(10), viking.world)).toEqual(
            family('spinning').model(wheel.site, { obj: 'flax' }, profile(10), wheel.world),
        );
    });
});

describe('fletching', () => {
    // Done in place: the site is wherever the step before stands.
    const trees = at('tree', [['willow_tree', 'willow']]);

    test('a willow longbow cut at Fletching 40, then strung', () => {
        // cut_logs.rs2: fletching_willow's longbow column, unstrung_willow_longbow at level 40 for 415 tenths
        // (:62-66, :73). After a log the queue sets %action_delay to the clock + 2 and queues the next that far on,
        // from inside the queue (:103-104, :83-86): 3 ticks a log; the knife's click at K opens the menu, the button
        // at K + 1 queues the first 2 on, from a dialog: K + 3, the cadence too. Make X past 10 costs a tick.
        expect(
            family('fletching').model(trees.site, { product: 'unstrung_willow_longbow' }, profile(40), trees.world),
        ).toEqual({
            ticksPerAttempt: 3,
            restart: { upTo: 10, ticks: 1 },
            success: 1,
            xpTenths: { fletching: 415 },
            products: [{ obj: 'unstrung_willow_longbow', count: 1 }],
            consumes: [{ obj: 'willow_logs', count: 1 }],
            tools: ['knife'],
        });
        // bows.rs2:35-42: stringing_willow_longbow, one bow and a bow string a use, 415 tenths, no delay: 5 OpHeldU a
        // tick (USER_EVENTS_PER_TICK), whole ticks of 5 bows.
        expect(family('fletching').model(trees.site, { product: 'willow_longbow' }, profile(40), trees.world)).toEqual({
            ticksPerAttempt: 1,
            perTick: 5,
            success: 1,
            xpTenths: { fletching: 415 },
            products: [{ obj: 'willow_longbow', count: 1 }],
            consumes: [
                { obj: 'unstrung_willow_longbow', count: 1 },
                { obj: 'bow_string', count: 1 },
            ],
        });
    });

    test('arrow shafts: 15 from a log, 15 x 5 = 75 tenths, at level 1', () => {
        // cut_logs.rs2:56-59, :68-71: fletching_normal's shafts 15.
        const m = family('fletching').model(
            trees.site,
            { product: 'arrow_shaft', log: 'logs' },
            profile(1),
            trees.world,
        );
        expect([m.products, m.xpTenths, m.consumes]).toEqual([
            [{ obj: 'arrow_shaft', count: 15 }],
            { fletching: 75 },
            [{ obj: 'logs', count: 1 }],
        ]);
    });

    test('fails with a reason', () => {
        refuses('fletching', trees, { product: 'unstrung_willow_longbow' }, profile(39), /needs fletching 40/);
        refuses('fletching', trees, { product: 'willow_longbow' }, profile(39), /needs fletching 40/);
        // A row with no shafts offers only its bows (cut_logs.rs2:37-41).
        fails('fletching', trees, { product: 'arrow_shaft', log: 'willow_logs' }, profile(99), /cuts no arrow_shaft/);
        fails('fletching', trees, { product: 'arrow_shaft' }, profile(99), /needs a log param/);
        fails(
            'fletching',
            trees,
            { product: 'unstrung_willow_longbow', log: 'logs' },
            profile(99),
            /is cut from willow_logs, not logs/,
        );
        // Arrows are in fletching_table too, but their item is no unstrung bow.
        fails('fletching', trees, { product: 'bronze_arrow' }, profile(99), /fletching makes no bronze_arrow/);
        fails('fletching', trees, {}, profile(99), /needs a product param/);
    });

    test('a bow two rows make fails the build of the family, naming both', () => {
        expect(() =>
            withRows(DBROWS.replace('data=shortbow,unstrung_willow_shortbow', 'data=shortbow,unstrung_longbow')),
        ).toThrow('fletch_bow_table cuts unstrung_longbow in both fletching_normal and fletching_willow');
        expect(() =>
            withRows(
                DBROWS.replace(
                    'data=item,bronze_arrowheads\ndata=metal,bronze\ndata=product,bronze_arrow,15',
                    'data=item,unstrung_willow_longbow\ndata=metal,bronze\ndata=product,willow_longbow,15',
                ),
            ),
        ).toThrow('fletching_table strings willow_longbow in both stringing_willow_longbow and fletching_bronze_arrow');
    });
});

describe('firemaking', () => {
    const trees = at('tree', [['willow_tree', 'willow']]);

    test('willow logs at Firemaking 30', () => {
        // firemaking.rs2: willow_logs' levelrequire 30 and productexp 900 (:81-86, :121). A roll every 4 ticks: the
        // click sets %action_delay 3 on and each roll 4 on (:103, :106, :114); a light's p_delay(0) push holds the
        // next click to 2 ticks after it, 2 short of the next roll. stat_random(firemaking, 64, 512) (:105) at 30:
        // floor(64 x 69 / 98) + floor(512 x 29 / 98) + 1 = 45 + 151 + 1 = 197, 197/256. The log is dropped and burnt,
        // nothing comes back to the inventory; a tinderbox is held (:93-96).
        expect(family('firemaking').model(trees.site, { log: 'willow_logs' }, profile(30), trees.world)).toEqual({
            ticksPerAttempt: 4,
            success: 197 / 256,
            xpTenths: { firemaking: 900 },
            products: [],
            consumes: [{ obj: 'willow_logs', count: 1 }],
            tools: ['tinderbox'],
        });
        // At 43: floor(64 x 56 / 98) + floor(512 x 42 / 98) + 1 = 36 + 219 + 1 = 256, every roll lights.
        expect(family('firemaking').model(trees.site, { log: 'willow_logs' }, profile(43), trees.world).success).toBe(
            1,
        );
    });

    test('fails with a reason', () => {
        refuses('firemaking', trees, { log: 'willow_logs' }, profile(29), /lighting willow_logs needs firemaking 30/);
        fails('firemaking', trees, { log: 'flax' }, profile(99), /flax is not a log a tinderbox lights/);
        fails('firemaking', trees, {}, profile(99), /needs a log param/);
    });
});

describe('pick', () => {
    const field = at('flax', [
        ['flax', 'flax'],
        ['flax', 'flax'],
        ['flax', 'flax'],
    ]);

    test('flax: a pick every 2 ticks, a plant gone 10 ticks 3 times in 16', () => {
        // pickables.rs2:56-74: p_delay(0) before the flax (:66) holds the next click to 2 ticks on; no XP; random(16)
        // < 3 (:71) deletes the plant for 10 ticks (:72). The site's 3 plants are worked in turn.
        expect(family('pick').model(field.site, {}, profile(1), field.world)).toEqual({
            ticksPerAttempt: 2,
            success: 1,
            xpTenths: {},
            products: [{ obj: 'flax', count: 1 }],
            consumes: [],
            deplete: { chance: 3 / 16, respawnTicks: 10 },
            features: 3,
        });
    });

    test('fails with a reason', () => {
        fails('pick', at('tree', [['tree', 'tree']]), {}, profile(99), /not a flax site/);
        fails('pick', field, { plant: 'wheat' }, profile(99), /has no flax wheat/);
    });
});

describe('runecraft', () => {
    const earth = at('rc-altar', [['earth_altar', 'earth']]);

    test('earth runes per essence at Runecraft 1, 26, 55 and 99', () => {
        // runecraft.rs2:80-83: level / multiplier + 1 in integers, earth's multiplier 26 (runecraft.dbrow).
        // 1 / 26 = 0, 26 / 26 = 1, 55 / 26 = 2, 99 / 26 = 3.
        expect([1, 26, 55, 99].map(l => runesPerEssence(l, 26))).toEqual([1, 2, 3, 4]);
        // 25 / 26 = 0 and 52 / 26 = 2: the counts step at 26, 52 and 78.
        expect([25, 51, 52, 77, 78].map(l => runesPerEssence(l, 26))).toEqual([1, 2, 3, 3, 4]);
        // No multiplier column: one rune an essence at any level.
        expect(runesPerEssence(99, undefined)).toBe(1);
    });

    test('earth at Runecraft 55: every essence in one op, 5 ticks a trip', () => {
        // The earth_altar's rune_type 4 is runecraft_earth's type (~get_runecraft_data, :173-176). One op binds all
        // the essence (:68, :94), then p_delay(3) (:99): the next click 3 + 2 = 5 ticks on, whatever the load. 65
        // tenths an essence (:95); 55 / 26 + 1 = 3 earth runes an essence. The talisman is held for the ruins.
        expect(family('runecraft').model(earth.site, {}, profile(55), earth.world)).toEqual({
            ticksPerAttempt: 5,
            perTick: 28,
            success: 1,
            xpTenths: { runecraft: 65 },
            products: [{ obj: 'earthrune', count: 3 }],
            consumes: [{ obj: 'blankrune', count: 1 }],
            tools: ['earth_talisman'],
        });
        expect(family('runecraft').model(earth.site, undefined, profile(9), earth.world).products).toEqual([
            { obj: 'earthrune', count: 1 },
        ]);
        expect(family('runecraft').model(earth.site, {}, profile(99), earth.world).products).toEqual([
            { obj: 'earthrune', count: 4 },
        ]);
    });

    test('a row with no multiplier makes one rune an essence', () => {
        const death = at('rc-altar', [['death_altar', 'death']]);
        expect(family('runecraft').model(death.site, {}, profile(99), death.world).products).toEqual([
            { obj: 'deathrune', count: 1 },
        ]);
    });

    test('fails with a reason', () => {
        // The level check (:62-66): earth needs 9.
        refuses('runecraft', earth, {}, profile(8), /crafting at earth_altar needs runecraft 9/);
        fails(
            'runecraft',
            at('rc-altar', [['lost_altar', 'lost']]),
            {},
            profile(99),
            /lost_altar has no runecraft_table/,
        );
        fails('runecraft', at('tree', [['tree', 'tree']]), {}, profile(99), /not an rc-altar/);
        fails('runecraft', earth, { rune: 'earth' }, profile(99), /runecraft has no param rune/);
    });
});

describe('registry', () => {
    test('every family is registered under its own id', () => {
        expect([...families.keys()]).toEqual(Object.keys(FAMILIES));
        for (const [id, f] of families) expect(f.id).toBe(id);
    });

    test('the kinds of site each family acts at', () => {
        expect(Object.fromEntries([...families].map(([id, f]) => [id, f.kinds]))).toEqual({
            agility: ['agility-course'],
            cooking: ['range', 'fire'],
            firemaking: [],
            fishing: ['fishing-spot'],
            fletching: [],
            mining: ['rock'],
            pick: ['flax'],
            pickpocket: ['pickpocket'],
            runecraft: ['rc-altar'],
            smelting: ['furnace'],
            smithing: ['anvil'],
            spinning: ['spinning-wheel'],
            stall: ['stall'],
            superheat: [],
            woodcutting: ['tree'],
        });
    });
});
