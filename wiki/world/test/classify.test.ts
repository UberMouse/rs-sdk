import { describe, expect, test } from 'bun:test';
import { classifier } from '../classify';
import type { Config } from '../sources/configs';
import type { Callable, Trigger } from '../sources/triggers';

const trig = (file: string, on: 'loc' | 'npc', target: string, body = '', category = false, op = '1'): Trigger => ({
    file,
    on,
    op,
    target,
    category,
    body,
});

const c = classifier({
    locConfigs: new Map<string, Config>([
        ['yewtree', { name: ['Yew'] }],
        ['bankbooth', { name: ['Bank booth'] }],
        ['furnace1', { name: ['Furnace'], category: ['smithing_furnace'] }],
        ['tree_stump', { name: ['Tree stump'] }],
    ]),
    npcConfigs: new Map<string, Config>([
        ['banker1', { name: ['Banker'], category: ['bank_teller'] }],
        ['fishspot', { name: ['Fishing spot'], category: ['saltfish'] }],
    ]),
    dbrows: [{ row: 'yew_tree_table', table: 'woodcutting_trees', data: { tree: [['yewtree']] } }],
    triggers: [
        trig('interface_bank/scripts/bank_booth.rs2', 'loc', 'bankbooth', '\n@openbank;'),
        trig('skill_fishing/scripts/fishing_spots/saltfish.rs2', 'npc', 'saltfish', '', true),
    ],
});

describe('classifier', () => {
    test('a tree from its dbrow', () =>
        expect(c('loc', 'yewtree')).toEqual([{ kind: 'tree', subtype: 'yew', name: 'Yew' }]));
    test('a booth whose op reaches @openbank', () => expect(c('loc', 'bankbooth')[0]?.kind).toBe('bank'));
    test('a banker by category', () =>
        expect(c('npc', 'banker1')).toEqual([{ kind: 'bank', subtype: 'banker', name: 'Banker' }]));
    test('a furnace by category', () => expect(c('loc', 'furnace1')[0]?.kind).toBe('furnace'));
    test('a fishing spot by category trigger', () =>
        expect(c('npc', 'fishspot')).toEqual([{ kind: 'fishing-spot', subtype: 'saltfish', name: 'Fishing spot' }]));
    test('scenery is not a feature', () => expect(c('loc', 'tree_stump')).toEqual([]));
});

/** Classifies one config given only the data that rule needs. */
function classify(
    on: 'loc' | 'npc',
    config: string,
    cfg: Config,
    data: {
        triggers?: Trigger[];
        callables?: Callable[];
        dbrows?: { row: string; table: string; data: Record<string, string[][]> }[];
    } = {},
) {
    const configs = new Map([[config, cfg]]);
    return classifier({
        locConfigs: on === 'loc' ? configs : new Map(),
        npcConfigs: on === 'npc' ? configs : new Map(),
        dbrows: data.dbrows ?? [],
        triggers: data.triggers ?? [],
        callables: data.callables,
    })(on, config);
}

/** The one kind a config has, or null for scenery. */
function one(...args: Parameters<typeof classify>) {
    const out = classify(...args);
    expect(out.length).toBeLessThanOrEqual(1);
    return out[0] ?? null;
}

const label = (call: string, body: string): Callable => ({ file: 'f.rs2', call, body });

describe('rules', () => {
    test('a rock is a mining_table rock, its ore the subtype', () => {
        const dbrows = [
            { row: 'iron_rock_table', table: 'mining_table', data: { rock: [['ironrock1']], ore_name: [['iron']] } },
        ];
        expect(one('loc', 'ironrock1', { name: ['Rocks'] }, { dbrows })).toEqual({
            kind: 'rock',
            subtype: 'iron',
            name: 'Rocks',
        });
    });

    test('a tree row without _tree_table keeps the rest of its name', () => {
        const dbrows = [{ row: 'normal_tree_table', table: 'woodcutting_trees', data: { tree: [['tree']] } }];
        expect(one('loc', 'tree', {}, { dbrows })?.subtype).toBe('normal');
    });

    test('a fishing spot named by config is its own subtype; the fishing guild shop is not a spot', () => {
        const triggers = [trig('skill_fishing/scripts/fishing_spots/lavafish.rs2', 'npc', 'lavafish')];
        expect(one('npc', 'lavafish', {}, { triggers })).toMatchObject({ kind: 'fishing-spot', subtype: 'lavafish' });
        const guild = [trig('skill_fishing/scripts/fishing_guild.rs2', 'npc', 'master_fisher')];
        expect(one('npc', 'master_fisher', {}, { triggers: guild })).toBeNull();
    });

    test('@openbank one label deep counts; two labels deep does not', () => {
        const callables = [label('@talk_to_banker', '\n@openbank;'), label('@greet', '\n@talk_to_banker;')];
        const deep = (body: string) =>
            one('npc', 'fadli', { name: ['Fadli'] }, { triggers: [trig('a.rs2', 'npc', 'fadli', body)], callables });
        expect(deep('\n@talk_to_banker;')).toMatchObject({ kind: 'bank', subtype: 'banker' });
        expect(deep('\n@greet;')).toBeNull();
    });

    test('@openbank does not match a longer label name', () => {
        const triggers = [trig('a.rs2', 'loc', 'chest', '\n@openbank_tab;')];
        expect(one('loc', 'chest', {}, { triggers })).toBeNull();
    });

    test('a bank loc not named a booth is a chest', () => {
        const triggers = [trig('a.rs2', 'loc', 'thbankchest', '\n@openbank;')];
        expect(one('loc', 'thbankchest', { name: ['Shantay chest'] }, { triggers })?.subtype).toBe('chest');
    });

    test('a shop by ~openshop(<inv>, ...), directly or through a proc', () => {
        const triggers = [trig('a.rs2', 'loc', 'crate', '\n~openshop(duel_rottenfruitshop, 550, 1000, 1, "Shop");')];
        expect(one('loc', 'crate', {}, { triggers })).toMatchObject({ kind: 'shop', subtype: 'duel_rottenfruitshop' });
        const viaProc = [trig('a.rs2', 'npc', 'zaff', '\n~openshop_zaff;')];
        const callables = [label('~openshop_zaff', '\n~openshop(staffshop, 550, 1000, 20, "Zaff");')];
        expect(one('npc', 'zaff', {}, { triggers: viaProc, callables })?.subtype).toBe('staffshop');
    });

    test('a shopkeeper by ~openshop_activenpc opens its owned_shop param', () => {
        const triggers = [trig('shop/scripts/shop.rs2', 'npc', 'shop_keeper', ' ~openshop_activenpc;', true)];
        const cfg = { category: ['shop_keeper'], param: ['owned_shop,generalshop1'] };
        expect(one('npc', 'shopkeeper1', cfg, { triggers })).toMatchObject({ kind: 'shop', subtype: 'generalshop1' });
    });

    test('a tanner opens the tanning interface, one label deep', () => {
        const triggers = [trig('a.rs2', 'npc', 'tanner', '\n@tan_leather_choices;')];
        const callables = [label('@tan_leather_choices', '\nif_openmain(tanner);')];
        expect(one('npc', 'tanner', { name: ['Tanner'] }, { triggers, callables })).toEqual({
            kind: 'tanner',
            subtype: '',
            name: 'Tanner',
        });
    });

    test.each([
        ['anvil', 'anvil'],
        ['cooking_oven', 'range'],
        ['cooking_fire', 'fire'],
        ['spinning_wheel', 'spinning-wheel'],
        ['potters_wheel', 'pottery-wheel'],
        ['pottery_oven', 'pottery-oven'],
        ['sand_pit', 'sand-pit'],
        ['watersource', 'water-source'],
        ['prayer_altar', 'altar'],
    ])('a loc of category %s is a %s', (category, kind) => {
        expect(one('loc', 'x', { category: [category] })).toMatchObject({ kind, subtype: '' });
    });

    test('a station category on an npc is not a station', () => {
        expect(one('npc', 'x', { category: ['anvil'] })).toBeNull();
    });

    test('rc altars and ruins take their rune from runecraft_table by rune_type', () => {
        const dbrows = [{ row: 'runecraft_air', table: 'runecraft_table', data: { type: [['1']] } }];
        const altar = { category: ['rc_altar'], param: ['rune_type,1'] };
        expect(one('loc', 'air_altar', altar, { dbrows })).toMatchObject({ kind: 'rc-altar', subtype: 'air' });
        const ruins = { category: ['rc_ruins'], param: ['rune_type,1'] };
        expect(one('loc', 'airtemple_ruined', ruins, { dbrows })).toMatchObject({ kind: 'rc-ruins', subtype: 'air' });
    });

    test('stalls and thieving chests by their script directory', () => {
        const stall = [trig('skill_thieving/scripts/stalls/stealing.rs2', 'loc', 'tea_stall')];
        expect(one('loc', 'tea_stall', {}, { triggers: stall })).toMatchObject({ kind: 'stall', subtype: 'tea_stall' });
        const chest = [trig('skill_thieving/scripts/chest/trapped_chest.rs2', 'loc', 'chest_10_coins')];
        expect(one('loc', 'chest_10_coins', {}, { triggers: chest })).toMatchObject({
            kind: 'thieving-chest',
            subtype: 'chest_10_coins',
        });
        const door = [trig('skill_thieving/scripts/doors/locked_door.rs2', 'loc', 'loc_2550')];
        expect(one('loc', 'loc_2550', {}, { triggers: door })).toBeNull();
    });

    test('a pickpocket target', () => {
        const triggers = [trig('skill_thieving/scripts/pickpocketing/pickpocket.rs2', 'npc', 'man')];
        expect(
            one('npc', 'man', { name: ['Man'], op2: ['Attack'], param: ['attackbonus,1'] }, { triggers }),
        ).toMatchObject({
            kind: 'pickpocket',
            subtype: 'man',
        });
    });

    test('a ladder is a connector', () => {
        const triggers = [trig('ladders+stairs/scripts/ladders.rs2', 'loc', 'ladder')];
        expect(one('loc', 'ladder', {}, { triggers })).toMatchObject({ kind: 'connector', subtype: '' });
    });

    test('an attackable npc with combat stats is an npc; without either it is not', () => {
        expect(one('npc', 'goblin', { op2: ['Attack'], param: ['stabdefence,-5'] })).toMatchObject({
            kind: 'npc',
            subtype: 'goblin',
        });
        expect(one('npc', 'goblin', { op2: ['Attack'] })).toBeNull();
        expect(one('npc', 'goblin', { op1: ['Talk-to'], param: ['stabdefence,-5'] })).toBeNull();
    });

    test('kinds from ops of their own coexist, in rule order, even when a dialogue op offers both', () => {
        const triggers = [
            trig('a.rs2', 'npc', 'fadli', '\n@openbank;\n~openshop_activenpc;', false, '1'),
            trig('a.rs2', 'npc', 'fadli', '\n~openshop_activenpc;', false, '4'),
            trig('a.rs2', 'npc', 'fadli', '\n@openbank;', false, '3'),
        ];
        const cfg = { name: ['Fadli'], param: ['owned_shop,fadlishop'] };
        expect(classify('npc', 'fadli', cfg, { triggers })).toEqual([
            { kind: 'bank', subtype: 'banker', name: 'Fadli' },
            { kind: 'shop', subtype: 'fadlishop', name: 'Fadli' },
        ]);
    });

    test('two rules matching through the same op throw, naming both and the op', () => {
        const triggers = [
            trig('a.rs2', 'npc', 'fadli', '\n@openbank;\n~openshop(fadlishop, 1, 1, 1, "x");', false, '3'),
        ];
        expect(() => classify('npc', 'fadli', {}, { triggers })).toThrow(
            'npc:fadli matches rules bank, shop through op 3',
        );
    });

    test('a rule with no op of its own throws, though the other rule has one', () => {
        const triggers = [
            trig('a.rs2', 'npc', 'fadli', '\n@openbank;', false, '3'),
            trig('a.rs2', 'npc', 'fadli', '\n@openbank;\n~openshop(fadlishop, 1, 1, 1, "x");', false, '1'),
        ];
        expect(() => classify('npc', 'fadli', {}, { triggers })).toThrow(
            'npc:fadli matches rules bank, shop through op 1',
        );
    });

    test('a match by data, with no trigger to scope it, clashes with any other match', () => {
        const dbrows = [{ row: 'yew_tree_table', table: 'woodcutting_trees', data: { tree: [['yewtree']] } }];
        const cfg = { category: ['anvil'] };
        expect(() => classify('loc', 'yewtree', cfg, { dbrows })).toThrow('loc:yewtree matches rules tree, station');
    });
});
