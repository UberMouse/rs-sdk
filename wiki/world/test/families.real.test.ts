import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadWorld } from '../load';
import { ModelError } from '../model/family';
import { readSpots } from '../model/families/fishing';
import { buildFamilies, readGameData } from '../model/families/index';
import { profileAt, readTools } from '../model/profile';
import { SCRIPTS } from '../paths';
import { first } from '../sources/configs';
import type { Site } from '../types';

const data = readGameData();
const families = buildFamilies(data);
const world = loadWorld();
const tools = readTools(data.objs);
const script = (file: string): string => readFileSync(join(SCRIPTS, file), 'utf8');
const row = (name: string) => data.dbrows.find(r => r.row === name)!.data;
const paramsOf = (map: ReadonlyMap<string, Record<string, string[]>>, name: string) => map.get(name)?.param ?? [];

/** The first site of `kind` whose id starts with `prefix` and that has `subtype`. */
function site(kind: Site['kind'], prefix: string, subtype: string): Site {
    const s = world.sites.find(x => x.kind === kind && x.id.startsWith(prefix) && subtype in x.counts);
    if (!s) throw new Error(`No ${kind} site ${prefix}* with ${subtype}`);
    return s;
}

describe('the game data the hand-worked cases rest on', () => {
    test('rows, structs and obj params', () => {
        const yew = row('yew_tree_table');
        expect(yew.successchance).toContainEqual(['rune_axe', '14', '44']);
        expect([yew.levelrequired, yew.productexp, yew.respawnrate]).toEqual([[['60']], [['1750']], [['200']]]);
        expect(row('normal_tree_table').respawnrate).toEqual([['0']]);
        const iron = row('iron_rock_table');
        expect([iron.rock_level, iron.rock_exp, iron.rock_successchance, iron.rock_respawnrate]).toEqual([
            [['15']],
            [['350']],
            [['96', '350']],
            [['20']],
        ]);
        expect(first(data.locs.get('ironrock1'), 'category')).toBe('mining_rock_fast');
        expect(first(data.locs.get('copperrock1'), 'category')).toBe('mining_rock_normal');
        expect(paramsOf(data.objs, 'adamant_pickaxe')).toEqual(
            expect.arrayContaining(['levelrequire,31', 'mining_rate,3']),
        );
        expect(paramsOf(data.objs, 'raw_trout')).toContain('fishing_struct,fishing_struct_trout');
        expect(paramsOf(data.objs, 'raw_salmon')).toContain('fishing_struct,fishing_struct_salmon');
        expect(paramsOf(data.structs, 'fishing_struct_trout')).toEqual(
            expect.arrayContaining(['productexp,500', 'success_low,32', 'success_high,192']),
        );
        expect(paramsOf(data.structs, 'fishing_struct_salmon')).toEqual(
            expect.arrayContaining(['productexp,700', 'success_low,16', 'success_high,96']),
        );
        const guard = row('pickpocket_guard');
        expect(guard.npc).toContainEqual(['guard1']);
        expect([guard.level, guard.experience, guard.stun_ticks, guard.stun_damage, guard.success_chance]).toEqual([
            [['40']],
            [['468']],
            [['8']],
            [['2']],
            [['50', '240']],
        ]);
        expect(guard.loot).toEqual([['coins', '30', '30', '128']]);
        const salmon = row('cooking_generic_salmon');
        expect([
            salmon.levelrequired,
            salmon.experience,
            salmon.successchance,
            salmon.successchance_cookomatic,
        ]).toEqual([[['25']], [['900']], [['68', '392']], [['78', '402']]]);
        expect(salmon.successchance_range).toBeUndefined();
        expect(first(data.locs.get('cooksquestrange'), 'category')).toBe('cooking_oven');
        const bakery = row('stealing_bakery_stall');
        expect([bakery.respawn_ticks, bakery.loot_total, bakery.experience]).toEqual([[['8']], [['20']], [['160']]]);
        const spell = row('magic_spell_superheat');
        expect([spell.spell, spell.levelrequired, spell.runesrequired, spell.experience]).toEqual([
            [['^superheat_item']],
            [['43']],
            [['naturerune', '1', 'firerune', '4', 'null', 'null']],
            [['530']],
        ]);
        expect(row('magic_staff_fire').staff).toContainEqual(['staff_of_fire']);
        expect(row('magic_staff_fire').rune).toEqual([['firerune']]);
        expect(row('magic_staff_fire').staff).toContainEqual(['lava_battlestaff']);
        expect(row('magic_staff_earth').staff).toContainEqual(['lava_battlestaff']);
        const plate = row('iron_platebody');
        expect([plate.product, plate.product_amount, plate.levelrequired, plate.bar, plate.bar_amount]).toEqual([
            [['iron_platebody']],
            [['1']],
            [['33']],
            [['iron_bar']],
            [['5']],
        ]);
        for (const [ore, bar] of [
            ['iron_ore', 'iron_bar'],
            ['tin_ore', 'bronze_bar'],
            ['gold_ore', 'gold_bar'],
        ] as const)
            expect(paramsOf(data.objs, ore)).toContain(`smeltsto,${bar}`);
        expect(paramsOf(data.objs, 'coal').some(x => x.startsWith('smeltsto,'))).toBe(false);
        expect(paramsOf(data.objs, 'iron_bar')).toEqual(
            expect.arrayContaining(['smelting_struct,smelting_iron_bar', 'smithing_anvil_struct,smithing_iron_bar']),
        );
        expect(paramsOf(data.structs, 'smelting_iron_bar')).toEqual(
            expect.arrayContaining([
                'product,iron_bar',
                'levelrequired,15',
                'productexp,125',
                'ingredient,iron_ore',
                'bar_count,1',
            ]),
        );
        expect(paramsOf(data.structs, 'smelting_bronze_bar')).toEqual(
            expect.arrayContaining([
                'productexp,62',
                'ingredient,copper_ore',
                'ingredient_secondary,tin_ore',
                'ingredient_secondary_count,1',
            ]),
        );
        expect(paramsOf(data.structs, 'smelting_gold_bar')).toEqual(
            expect.arrayContaining(['levelrequired,40', 'productexp,225', 'ingredient,gold_ore']),
        );
        expect(paramsOf(data.structs, 'smithing_iron_bar')).toEqual(
            expect.arrayContaining(['levelrequired,15', 'xpperbar,250']),
        );
    });

    test('the inline script values the families port', () => {
        const woodcut = script('skill_woodcutting/scripts/woodcut.rs2');
        expect(woodcut.split('%action_delay = calc(map_clock + 3);').length - 1).toBe(2);
        expect(woodcut).toContain('def_int $deplete_chance = 8; // 1/8 chance to deplete');
        expect(woodcut).toContain('$respawnrate = add(120, random(80));');
        const mining = script('skill_mining/scripts/mining.rs2');
        expect(mining).toContain('[oploc3,_mining_rock_normal] @mining_continue(get_ore_normal);');
        expect(mining).toContain('[oploc3,_mining_rock_fast] @mining_continue(get_ore_fast);');
        expect(mining).toContain('[oploc3,blankrunestone] @mining_continue(get_ore_essence);');
        expect(mining).toContain('%action_delay = calc(map_clock + $mining_rate);');
        expect(mining).toContain('$chance = 86;');
        // Only get_ore_normal holds the player after an ore (get_ore_gem_rock's is commented out).
        expect(mining.match(/^\s*p_delay\(0\);/gm)).toHaveLength(1);
        expect(mining).toContain('if ($rand < 2) return (uncut_diamond);\nif ($rand < 10) return (uncut_ruby);');
        expect(mining).toContain('if ($rand < 26) return (uncut_emerald);\nif ($rand < 58) return (uncut_sapphire);');
        const thieving = script('skill_thieving/scripts/thieving.rs2');
        const proc = (name: string): string => thieving.split(`[proc,${name}]`)[1]!.split('\n[')[0]!;
        expect(proc('pick_pocket').match(/p_delay\(0\);/g)).toHaveLength(1);
        expect(proc('fail_pick_pocket').match(/p_delay\(0\);/g)).toHaveLength(2);
        expect(proc('fail_pick_pocket')).toContain('%stunned = calc(map_clock + $stun_ticks);');
        expect(proc('steal_from_stall').match(/p_delay\(0\);/g)).toHaveLength(1);
        expect(proc('pick_pocket_check_for_reward')).toContain('def_int $reward_rarity_denominator = 128;');
        expect(script('skill_thieving/scripts/pickpocketing/pickpocket.rs2')).toContain(
            'if(%stunned > map_clock) {\n    return;\n}',
        );
        expect(script('skill_cooking/scripts/cooking.rs2').match(/p_delay\((\d+)\);/g)).toEqual(['p_delay(1);']);
        const superheat = script('skill_magic/scripts/spells/superheat.rs2');
        expect(superheat.match(/p_delay\((\d+)\);/g)).toEqual(['p_delay(1);']);
        expect(superheat).toContain('inv_del(inv, $ore1, 1);');
        const smelting = script('skill_smithing/scripts/smelting/smelting.rs2');
        expect(smelting).toContain(
            'weakqueue*(start_smelt_ore, calc(%action_delay - map_clock - 1))($struct, $count);',
        );
        expect(smelting).toContain('weakqueue*(smelting_ore, 3)($struct, $count);');
        expect(smelting).toContain('} else if (randominc(1) = 1) {');
        expect(smelting.split('%action_delay = add(map_clock, 1);').length - 1).toBe(2);
        expect(smelting).toContain('if (inv_total(worn, ring_of_forging) > 0 & map_members = ^true) {');
        expect(smelting).toContain(
            'if ($product = gold_bar & inv_total(worn, gauntlets_of_goldsmithing) > 0) {\n    $xp = scale(5, 2, $xp);',
        );
        expect(superheat).toContain(
            'if ($bar = gold_bar & inv_total(worn, gauntlets_of_goldsmithing) > 0) {\n    $smith_xp = scale(5, 2, $smith_xp);',
        );
        // The Make buttons stop at 10; more takes Make X's count dialog.
        expect(new Set(smelting.match(/@smelt_ore\(\w+, (\d+)\)/g)!.map(x => x.match(/(\d+)\)$/)![1]))).toEqual(
            new Set(['1', '5', '10']),
        );
        expect(smelting).toContain('[label,smelt_ore_makex](obj $bar)\np_countdialog;');
        const ring = script('general/scripts/enchanted_jewellry/ring_of_forging.rs2');
        expect(ring).toContain('if (%ring_of_forging >= 140) {');
        expect(ring).toContain('inv_del(worn, ring_of_forging, 1);');
        const smithing = script('skill_smithing/scripts/smithing/smithing.rs2');
        const anvil = smithing.split('[proc,smithing_anvil]')[1]!;
        expect(anvil.split('\n[')[0]!.match(/p_delay\((\d+)\);/g)).toEqual(['p_delay(1);', 'p_delay(2);']);
        // The anvil's buttons make 1, 5 or 10, with no Make X.
        expect(new Set(smithing.match(/@attempt_smithing\(last_item, (\d+)\)/g))).toEqual(
            new Set([
                '@attempt_smithing(last_item, 1)',
                '@attempt_smithing(last_item, 5)',
                '@attempt_smithing(last_item, 10)',
            ]),
        );
        expect(smithing).toContain(
            'case bronze_dart_tip, iron_dart_tip, steel_dart_tip, mithril_dart_tip, adamant_dart_tip, rune_dart_tip :\n         if (%desertrescue < ^desertrescue_learned_darts) {',
        );
        expect(script('general/scripts/player_count.rs2')).toContain(
            'return (scale(sub(4000, $playercount), 4000, $base));',
        );
    });

    test('the lure catch is read from freshfish.rs2', () => {
        expect(readSpots(data.scripts).get('freshfish')!.catches.get('fly_fishing_rod')).toEqual({
            tool: 'fly_fishing_rod',
            level: 20,
            delay: 4,
            fish1: 'raw_trout',
            fish2: { obj: 'raw_salmon', level: 30 },
            bait: 'feather',
            source: 'skill_fishing/scripts/fishing_spots/freshfish.rs2:59',
        });
    });
});

describe('the families on the real world (hand-worked in families.test.ts)', () => {
    test('yew with a rune axe at Woodcutting 60', () => {
        const yew = site('tree', 'tree:', 'yew');
        const p = profileAt('woodcutting', 60, { tools });
        expect(p.axe).toBe('rune_axe');
        const m = families.get('woodcutting')!.model(yew, { tree: 'yew' }, p, world);
        expect([m.ticksPerAttempt, m.success, m.deplete]).toEqual([4, 32 / 256, { chance: 1 / 8, respawnTicks: 199 }]);
    });

    test('iron at Varrock East with an adamant pickaxe at Mining 60', () => {
        const iron = site('rock', 'rock:varrock-east-mine', 'iron');
        const p = { ...profileAt('mining', 60, { tools }), pickaxe: 'adamant_pickaxe' };
        const m = families.get('mining')!.model(iron, { rock: 'iron' }, p, world);
        expect([m.ticksPerAttempt, m.success, m.successTicks, m.deplete]).toEqual([
            4,
            63495 / 65536,
            undefined,
            { chance: 1, respawnTicks: 19 },
        ]);
    });

    test('trout and salmon at Lumbridge at Fishing 40', () => {
        const spot = site('fishing-spot', 'fishing-spot:lumbridge', 'freshfish');
        const m = families
            .get('fishing')!
            .model(spot, { tool: 'fly_fishing_rod' }, profileAt('fishing', 40, { tools }), world);
        expect([m.ticksPerAttempt, m.success, m.products]).toEqual([
            5,
            126 / 256,
            [
                { obj: 'raw_trout', count: 78 / 126 },
                { obj: 'raw_salmon', count: 48 / 126 },
            ],
        ]);
    });

    test('Falador guards at Thieving 40', () => {
        const guards = site('pickpocket', 'pickpocket:falador', 'guard1');
        expect(guards.areaPath).toContain('falador');
        const m = families
            .get('pickpocket')!
            .model(guards, { npc: 'guard1' }, profileAt('thieving', 40, { tools }), world);
        expect([m.ticksPerAttempt, m.success, m.failTicks, m.failDamage, m.products]).toEqual([
            2,
            126 / 256,
            9,
            2,
            [{ obj: 'coins', count: 30 }],
        ]);
    });

    test('salmon at Cooking 30: 164/256 on a fire, 173/256 on the Lumbridge cook-o-matic', () => {
        const p = profileAt('cooking', 30, { tools });
        const fire = world.sites.find(s => s.kind === 'fire')!;
        expect(families.get('cooking')!.model(fire, { food: 'raw_salmon' }, p, world).products[0]).toEqual({
            obj: 'salmon',
            count: 164 / 256,
        });
        const kitchen = world.sites.find(
            s => s.kind === 'range' && s.features.some(i => world.features[i]!.config === 'cooksquestrange'),
        )!;
        expect(kitchen.areaPath).toContain('lumbridge');
        expect(families.get('cooking')!.model(kitchen, { food: 'raw_salmon' }, p, world).products[0]).toEqual({
            obj: 'salmon',
            count: 173 / 256,
        });
    });

    test('superheat, smelting and smithing on a real furnace and anvil', () => {
        const p = profileAt('smithing', 43, { tools, worn: ['staff_of_fire'] });
        const furnace = world.sites.find(s => s.kind === 'furnace')!;
        const anvil = world.sites.find(s => s.kind === 'anvil')!;
        const heat = families.get('superheat')!.model(furnace, { ore: 'iron_ore' }, p, world);
        expect([heat.ticksPerAttempt, heat.xpTenths, heat.consumes]).toEqual([
            3,
            { magic: 530, smithing: 125 },
            [
                { obj: 'iron_ore', count: 1 },
                { obj: 'naturerune', count: 1 },
            ],
        ]);
        const smelt = families.get('smelting')!.model(furnace, { bar: 'iron_bar' }, p, world);
        expect([smelt.ticksPerAttempt, smelt.products]).toEqual([5, [{ obj: 'iron_bar', count: 0.5 }]]);
        const lava = families
            .get('superheat')!
            .model(furnace, { ore: 'iron_ore' }, { ...p, worn: ['lava_battlestaff'] }, world);
        expect(lava.consumes).toEqual(heat.consumes);
        const smith = families.get('smithing')!.model(anvil, { product: 'iron_platebody' }, p, world);
        expect([smith.ticksPerAttempt, smith.xpTenths, smith.batch, smith.tools]).toEqual([
            5,
            { smithing: 1250 },
            5,
            ['hammer'],
        ]);
    });
});

describe('spinning, fletching, firemaking and flax picking (hand-worked in families.test.ts)', () => {
    test('the rows, structs and obj params they read', () => {
        expect(paramsOf(data.objs, 'flax')).toContain('crafting_spinning_struct,flax');
        expect(paramsOf(data.objs, 'wool')).toContain('crafting_spinning_struct,wool');
        expect(paramsOf(data.structs, 'flax')).toEqual(
            expect.arrayContaining(['product,bow_string', 'levelrequire,10', 'productexp,150', 'ingredient,flax']),
        );
        expect(paramsOf(data.structs, 'wool').some(x => x.startsWith('levelrequire,'))).toBe(false);
        expect(script('skill_combat/configs/combat.param')).toContain('[levelrequire]\ntype=int\ndefault=0');
        const normal = row('fletching_normal');
        expect([normal.log, normal.shafts]).toEqual([[['logs']], [['15']]]);
        const willow = row('fletching_willow');
        expect([willow.log, willow.shafts, willow.longbow]).toEqual([
            [['willow_logs']],
            undefined,
            [['unstrung_willow_longbow', '40', '415']],
        ]);
        const string = row('stringing_willow_longbow');
        expect([string.item, string.product, string.level, string.experience]).toEqual([
            [['unstrung_willow_longbow']],
            [['willow_longbow', '1']],
            [['40']],
            [['415']],
        ]);
        expect(first(data.objs.get('unstrung_willow_longbow'), 'category')).toBe('unstrung_bow');
        expect(first(data.objs.get('willow_logs'), 'category')).toBe('category_22');
        expect(paramsOf(data.objs, 'willow_logs')).toEqual(
            expect.arrayContaining(['levelrequire,30', 'productexp,900']),
        );
    });

    test('the inline script values they port', () => {
        const spin = script('skill_crafting/scripts/spinning/spinning.rs2');
        expect(spin).toContain('weakqueue*(crafting_spinning, 3)($obj, $struct, $amt, loc_type, loc_coord);');
        expect(spin).toContain('weakqueue*(crafting_spinning, 2)($spinning_obj, $struct, $amt, $loc, $coord);');
        expect(spin).toContain('if(loc_type = viking_spinningwheel) {\n    if(%viking < ^viking_complete) {');
        // ~skill_multi2_header and ~skill_multi3 return 1, 5 or 10, or Make X's count.
        const chat = script('interface_chat/scripts/chat.rs2');
        for (const proc of ['skill_multi2_header', 'skill_multi2', 'skill_multi3']) {
            const body = chat.split(`[proc,${proc}]`)[1]!.split('\n[')[0]!;
            expect(new Set(body.match(/return\(\$obj\d, (\w+)\)/g)!.map(x => x.match(/, (\w+)\)$/)![1]))).toEqual(
                new Set(['last_int', '10', '5', '1']),
            );
        }
        const cut = script('skill_fletching/scripts/cut_logs.rs2');
        expect(cut.split('%action_delay = add(map_clock, 2);').length - 1).toBe(2);
        expect(cut).toContain('weakqueue*(fletch_logs, sub(%action_delay, map_clock))');
        expect(cut).toContain('def_int $fletching_experience = multiply($shaft_count, 5);');
        const bows = script('skill_fletching/scripts/bows.rs2');
        expect(bows).not.toMatch(/p_delay|queue/);
        expect(bows).toContain('inv_del(inv, bow_string, 1);');
        const fire = script('skill_firemaking/scripts/firemaking.rs2');
        const inv = fire.split('[label,light_logs_inv]')[1]!.split('\n[')[0]!;
        expect(inv).toContain('stat_random(firemaking, 64, 512)');
        expect(inv.split('%action_delay = calc(map_clock + 3);').length - 1).toBe(1);
        expect(inv.split('%action_delay = calc(map_clock + 4);').length - 1).toBe(2);
        expect(inv).toContain('p_opobj(4);');
        const flax = script('general_use/scripts/pickables.rs2').split('[oploc2,flax]')[1]!.split('\n[')[0]!;
        expect(flax.match(/p_delay\((\d+)\);/g)).toEqual(['p_delay(0);']);
        expect(flax).toContain('inv_add(inv, flax, 1);');
        expect(flax).toContain('if (random(16) < 3) {\n        loc_del(10);');
    });

    test('on the real Seers wheel and flax field', () => {
        const p = profileAt('crafting', 40, { tools });
        const wheel = world.sites.find(s => s.id === 'spinning-wheel:seers-village:0')!;
        const spin = families.get('spinning')!.model(wheel, { obj: 'flax' }, p, world);
        expect([spin.ticksPerAttempt, spin.start, spin.xpTenths, spin.products]).toEqual([
            3,
            1,
            { crafting: 150 },
            [{ obj: 'bow_string', count: 1 }],
        ]);
        const rellekka = world.sites.find(s => s.id === 'spinning-wheel:rellekka:0')!;
        expect(families.get('spinning')!.model(rellekka, { obj: 'flax' }, p, world)).toEqual(spin);
        const field = world.sites.find(s => s.id === 'flax:flax:0')!;
        const pick = families.get('pick')!.model(field, {}, p, world);
        expect([pick.ticksPerAttempt, pick.deplete, pick.features]).toEqual([
            2,
            { chance: 3 / 16, respawnTicks: 10 },
            48,
        ]);
        const cut = families.get('fletching')!.model(field, { product: 'unstrung_willow_longbow' }, p, world);
        const strung = families.get('fletching')!.model(field, { product: 'willow_longbow' }, p, world);
        expect([cut.ticksPerAttempt, cut.xpTenths, strung.perTick, strung.consumes]).toEqual([
            3,
            { fletching: 415 },
            5,
            [
                { obj: 'unstrung_willow_longbow', count: 1 },
                { obj: 'bow_string', count: 1 },
            ],
        ]);
        const fire = families
            .get('firemaking')!
            .model(field, { log: 'willow_logs' }, profileAt('firemaking', 30, { tools }), world);
        expect([fire.ticksPerAttempt, fire.success, fire.xpTenths]).toEqual([4, 197 / 256, { firemaking: 900 }]);
    });
});

test('the anvils, furnaces and spinning wheel a quest locks need it (gates.ts USE_GATES)', () => {
    const ids = ['anvil:asgarnia:1', 'anvil:rellekka:0', 'furnace:rellekka:0', 'spinning-wheel:rellekka:0'];
    expect(ids.map(id => world.sites.find(s => s.id === id)?.reach)).toEqual([
        [['quest:doric']],
        [['quest:viking']],
        [['quest:viking']],
        [['quest:viking']],
    ]);
});

test('every gathering and thieving site models at 99, or fails with a ModelError', () => {
    // At 99 with the best tools, no level or tool is missing: what is left is data the families don't model
    // (gem rocks, staged limestone, jungle trees no axe has a row for), each a ModelError, never a crash.
    const p = profileAt('thieving', 99, { tools });
    const spots = readSpots(data.scripts);
    const param = { tree: 'tree', rock: 'rock', pickpocket: 'npc', stall: 'stall' } as const;
    const by = { tree: 'woodcutting', rock: 'mining', pickpocket: 'pickpocket', stall: 'stall' } as const;
    /** The family runs at a site: each subtype, each modelled tool of a spot, salmon on a range or fire. */
    type Run = [family: string, params: unknown];
    const runsAt = (s: Site): Run[] => {
        const subs = Object.keys(s.counts);
        if (s.kind === 'fishing-spot')
            return subs.flatMap(spot =>
                [...(spots.get(spot)?.catches.keys() ?? [])].map((tool): Run => ['fishing', { spot, tool }]),
            );
        if (s.kind === 'range' || s.kind === 'fire') return [['cooking', { food: 'raw_salmon' }]];
        if (!(s.kind in by)) return [];
        const kind = s.kind as keyof typeof by;
        return subs.map((sub): Run => [by[kind], { [param[kind]]: sub }]);
    };
    let modelled = 0;
    for (const s of world.sites) {
        for (const [id, args] of runsAt(s)) {
            try {
                families.get(id)!.model(s, args, p, world);
                modelled++;
            } catch (e) {
                if (!(e instanceof ModelError)) throw e;
            }
        }
    }
    expect(modelled).toBeGreaterThan(1000);
});
