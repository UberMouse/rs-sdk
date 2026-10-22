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
