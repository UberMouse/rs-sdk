import { describe, expect, test } from 'bun:test';
import { classification, classifier, membersCode, type Classified } from '../classify';
import type { Config } from '../sources/configs';
import type { CourseDef } from '../sources/courses';
import type { Callable, Trigger } from '../sources/triggers';

const trig = (file: string, on: 'loc' | 'npc', target: string, body = '', category = false, op = '1'): Trigger => ({
    file,
    on,
    kind: 'op',
    op,
    target,
    category,
    line: 1,
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
        courses?: CourseDef[];
    } = {},
) {
    const configs = new Map([[config, cfg]]);
    return classifier({
        locConfigs: on === 'loc' ? configs : new Map(),
        npcConfigs: on === 'npc' ? configs : new Map(),
        dbrows: data.dbrows ?? [],
        triggers: data.triggers ?? [],
        callables: data.callables,
        courses: data.courses,
    })(on, config);
}

/** The one kind a config has, or null for scenery. */
function one(...args: Parameters<typeof classify>) {
    const out = classify(...args);
    expect(out.length).toBeLessThanOrEqual(1);
    return out[0] ?? null;
}

const label = (call: string, body: string): Callable => ({ file: 'f.rs2', call, line: 1, body });

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

    test('@openbank counts however many labels deep', () => {
        const callables = [label('@talk_to_banker', '\n@openbank;'), label('@greet', '\n@talk_to_banker;')];
        const via = (body: string) =>
            one('npc', 'fadli', { name: ['Fadli'] }, { triggers: [trig('a.rs2', 'npc', 'fadli', body)], callables });
        expect(via('\n@talk_to_banker;')).toMatchObject({ kind: 'bank', subtype: 'banker' });
        expect(via('\n@greet;')).toMatchObject({ kind: 'bank', subtype: 'banker' });
    });

    test('a label passed by name to a menu label runs through its jump($param)', () => {
        // The shape of @multi2 in interface_chat/scripts/chat.rs2 and the tutorial banker's menu.
        const callables = [
            label('@multi2', '(string $s1, label $l1, string $s2, label $l2)\nif ($c = 1) jump($l1);\njump($l2);'),
            label('@open_it', '\n@openbank;'),
            label('@no_thanks', '\n~chatplayer("No thanks.");'),
        ];
        const menu = (body: string) =>
            one('npc', 'banker', {}, { triggers: [trig('a.rs2', 'npc', 'banker', body)], callables });
        expect(menu('\n@multi2("Yes.", open_it, "No.", no_thanks);')?.kind).toBe('bank');
        expect(menu('\n@multi2("Yes.", no_thanks, "No.", no_thanks);')).toBeNull();
        // Only a bare name is bound: an expression argument leaves the parameter unbound.
        expect(menu('\n@multi2("Yes.", calc(1 + 1), "No.", no_thanks);')).toBeNull();
        expect(menu('\njump(open_it);')?.kind).toBe('bank');
    });

    test('a cycle of calls ends, with or without arguments', () => {
        const callables = [
            label('@a', '\n@b;'),
            label('@b', '\n@a;'),
            label('@loop', '(label $next)\n@loop($next);\n@loop(b);'),
        ];
        const triggers = [trig('a.rs2', 'loc', 'thing', '\n@a;\n@loop(a);')];
        expect(one('loc', 'thing', {}, { triggers, callables })).toBeNull();
    });

    test('@openbank below a bank side effect does not make a bank; another path to it does', () => {
        const callables = [
            label('@shantay_ill_pay_the_fine', '\n@fetch_coins;'),
            label('@fetch_coins', '\n@openbank;'),
            label('@bank_service', '\n@fetch_coins;'),
        ];
        const via = (body: string) =>
            classify('npc', 'shantay', {}, { triggers: [trig('a.rs2', 'npc', 'shantay', body)], callables });
        expect(via('\n@shantay_ill_pay_the_fine;')).toEqual([]);
        expect(via('\n@shantay_ill_pay_the_fine;\n@bank_service;')).toMatchObject([{ kind: 'bank' }]);
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

    test('an explicit ~openshop inv wins over the npc owned_shop param', () => {
        const triggers = [trig('a.rs2', 'npc', 'zaff', '\n~openshop(b, 550, 1000, 20, "Zaff");')];
        expect(one('npc', 'zaff', { param: ['owned_shop,a'] }, { triggers })?.subtype).toBe('b');
    });

    test('every inv the triggers open is a shop of its own, each once; owned_shop only when none is named', () => {
        // Razmire's Talk-to reaches two store labels (razmire_keelgan.rs2:240, :243); a third label repeats one.
        const triggers = [trig('a.rs2', 'npc', 'razmire', '\n@general;\n@building;\n@again;', false, '1')];
        const callables = [
            label('@general', '\n~openshop(generalstore, 400, 1300, 30, "General");'),
            label('@building', '\n~openshop(buildingstore, 650, 1050, 40, "Builders");'),
            label('@again', '\n~openshop(generalstore, 400, 1300, 30, "General");'),
        ];
        const cfg = { name: ['Razmire'], param: ['owned_shop,ownstore'] };
        expect(classify('npc', 'razmire', cfg, { triggers, callables })).toEqual([
            { kind: 'shop', subtype: 'buildingstore', name: 'Razmire' },
            { kind: 'shop', subtype: 'generalstore', name: 'Razmire' },
        ]);
    });

    test('an inv opened only on the branch a members world skips is no shop', () => {
        // zaff.rs2:15-18 opens staffshop in the else of `if(map_members = ^true)`; an `if (map_members = ^false)`
        // block is the free world's too. A test of map_members with anything else can run on either world.
        const body = [
            '',
            'if(map_members = ^true) {',
            '    ~openshop(members, 1, 1, 1, "M");',
            '} else if (%x = 1) {',
            '    ~openshop(free1, 1, 1, 1, "F");',
            '} else {',
            '    @free_label;',
            '}',
            'if (map_members = ^false) {',
            '    ~openshop(free2, 1, 1, 1, "F");',
            '} else {',
            '    ~openshop(members2, 1, 1, 1, "M");',
            '}',
            'if (map_members = ^false | %y = 1) {',
            '    ~openshop(either, 1, 1, 1, "E");',
            '}',
        ].join('\n');
        const triggers = [trig('a.rs2', 'npc', 'zaff', body, false, '3')];
        const callables = [label('@free_label', '\n~openshop(free3, 1, 1, 1, "F");')];
        expect(classify('npc', 'zaff', { name: ['Zaff'] }, { triggers, callables }).map(x => x.subtype)).toEqual([
            'either',
            'members',
            'members2',
        ]);
        // Blanking keeps every line and column.
        expect(
            membersCode(body)
                .split('\n')
                .map(l => l.length),
        ).toEqual(body.split('\n').map(l => l.length));
    });

    test('a call inside a // comment does not count; one in a string does not end the line', () => {
        const commented = [trig('a.rs2', 'loc', 'chest', '\n// @openbank;\n~x; // ~openshop(a, 1, 1, 1, "S");')];
        expect(one('loc', 'chest', {}, { triggers: commented })).toBeNull();
        const callables = [label('@old', '\n// @openbank;')];
        expect(one('loc', 'chest', {}, { triggers: [trig('a.rs2', 'loc', 'chest', '\n@old;')], callables })).toBeNull();
        const quoted = [trig('a.rs2', 'loc', 'chest', '\n~openshop(a, 1, 1, 1, "http://x");')];
        expect(one('loc', 'chest', {}, { triggers: quoted })?.kind).toBe('shop');
        const escaped = [trig('a.rs2', 'loc', 'chest', '\nmes("see \\"http://x\\""); @openbank;')];
        expect(one('loc', 'chest', {}, { triggers: escaped })?.kind).toBe('bank');
    });

    test('a call named in string text does not count; one interpolated into a string does', () => {
        const said = (body: string) => one('loc', 'chest', {}, { triggers: [trig('a.rs2', 'loc', 'chest', body)] });
        expect(said('\nmes("Ask ~openshop(a, 1, 1, 1) or @openbank.");')).toBeNull();
        expect(said('\nmes("You can now mine @dbl@Iron."); ~x("\\"@openbank");')).toBeNull();
        const callables = [label('~bank_name', '\n@openbank;')];
        const triggers = [trig('a.rs2', 'loc', 'chest', '\nmes("Welcome to <~bank_name(a)>!");')];
        expect(one('loc', 'chest', {}, { triggers, callables })?.kind).toBe('bank');
        // A string argument keeps its place, so the bare name after it is still bound to $l.
        const menu = [label('@menu', '(string $s, label $l)\njump($l);'), label('@open_it', '\n@openbank;')];
        const viaMenu = [trig('a.rs2', 'loc', 'chest', '\n@menu("Yes, (please), open it", open_it);')];
        expect(one('loc', 'chest', {}, { triggers: viaMenu, callables: menu })?.kind).toBe('bank');
    });

    test('a < in string text opens no interpolation, so the string still ends at its quote', () => {
        const said = (body: string) => one('loc', 'chest', {}, { triggers: [trig('a.rs2', 'loc', 'chest', body)] });
        expect(said('\nmes("HP < 10"); // @openbank;')).toBeNull();
        expect(said('\nmes("HP <10, or 1<2"); mes("Ask @openbank.");')).toBeNull();
        expect(said('\nmes("HP < 10"); @openbank;')?.kind).toBe('bank');
        // An interpolation holding a string of its own is still code.
        const callables = [label('~bank_name', '(string $s)\n@openbank;')];
        const triggers = [trig('a.rs2', 'loc', 'chest', '\nmes("<p,neutral>Hi <~bank_name("sir")>!");')];
        expect(one('loc', 'chest', {}, { triggers, callables })?.kind).toBe('bank');
    });

    test('two dbrows listing one tree throw, naming both rows', () => {
        const dbrows = [
            { row: 'a_tree_table', table: 'woodcutting_trees', data: { tree: [['oak']] } },
            { row: 'b_tree_table', table: 'woodcutting_trees', data: { tree: [['oak']] } },
        ];
        expect(() => classify('loc', 'oak', {}, { dbrows })).toThrow(/a_tree_table.*b_tree_table/);
    });

    test('a cached result cannot be mutated by a caller', () => {
        const triggers = [trig('a.rs2', 'loc', 'chest', '\n@openbank;')];
        const run = classifier({
            locConfigs: new Map([['chest', {}]]),
            npcConfigs: new Map(),
            dbrows: [],
            triggers,
        });
        const out = run('loc', 'chest');
        expect(() => (out as Classified[]).push({ kind: 'tree', subtype: '', name: '' })).toThrow();
        expect(() => ((out[0] as Classified).kind = 'tree')).toThrow();
        expect(run('loc', 'chest')).toHaveLength(1);
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

    test('a trapdoor in general_use/scripts/trapdoors.rs2 is a connector; the same in another file there is not', () => {
        const triggers = [trig('general_use/scripts/trapdoors.rs2', 'loc', 'trapdoor')];
        expect(one('loc', 'trapdoor', {}, { triggers })).toMatchObject({ kind: 'connector', subtype: '' });
        const other = [trig('general_use/scripts/trapdoors_old.rs2', 'loc', 'trapdoor')];
        expect(one('loc', 'trapdoor', {}, { triggers: other })).toBeNull();
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

/** A classifier over several configs of one type. */
const among = (on: 'loc' | 'npc', configs: [string, Config][], triggers: Trigger[], callables: Callable[] = []) =>
    classifier({
        locConfigs: on === 'loc' ? new Map(configs) : new Map(),
        npcConfigs: on === 'npc' ? new Map(configs) : new Map(),
        dbrows: [],
        triggers,
        callables,
    });

/** A shop on op1 that `op` turns into a bank booth. */
const shopTurningBank = (op: string): Trigger[] => [
    trig('a.rs2', 'loc', 'rock', '\n~openshop(rocks, 1, 1, 1, "Rocks");', false, '1'),
    trig('a.rs2', 'loc', 'rock', '\nloc_change(booth, 10);', false, op),
    trig('a.rs2', 'loc', 'booth', '\n@openbank;', false, '2'),
];

describe('type changes', () => {
    // The Duel Arena chests (minigames/game_duelarena/scripts/misc_locs.rs2, general_use/scripts/chests.rs2).
    const chests = among(
        'loc',
        [
            ['closed', { name: ['Closed chest'] }],
            ['open', { name: ['Open chest'] }],
        ],
        [
            trig('a.rs2', 'loc', 'closed', '\n~open_chest(open);', false, '1'),
            trig('a.rs2', 'loc', 'open', '\n@openbank;', false, '2'),
            trig('a.rs2', 'loc', 'open', '\n~open_chest(closed);', false, '3'),
        ],
        [label('~open_chest', '(loc $other_chest)\nloc_change($other_chest, 300);')],
    );

    test('a loc takes the kinds of the loc its op loc_changes it into, keeping its own name', () =>
        expect(chests('loc', 'closed')).toEqual([{ kind: 'bank', subtype: 'chest', name: 'Closed chest' }]));

    test('a change back to the config ends the walk', () =>
        expect(chests('loc', 'open')).toEqual([{ kind: 'bank', subtype: 'chest', name: 'Open chest' }]));

    test('an npc takes the kinds of the npc its op npc_changetypes it into', () => {
        const run = among(
            'npc',
            [
                ['afflicted', { name: ['Razmire'] }],
                ['keeper', { name: ['Razmire'] }],
            ],
            [
                trig('a.rs2', 'npc', 'afflicted', '\nnpc_changetype(keeper, 200);'),
                trig('a.rs2', 'npc', 'keeper', '\n~openshop(store, 400, 1300, 30, "Store");', false, '3'),
            ],
        );
        expect(run('npc', 'afflicted')).toEqual([{ kind: 'shop', subtype: 'store', name: 'Razmire' }]);
    });

    test('changed-into configs give every distinct shop they open, each once', () => {
        const run = among(
            'npc',
            [
                ['afflicted', { name: ['Razmire'] }],
                ['keeper', { name: ['Razmire'] }],
                ['other', { name: ['Razmire'] }],
            ],
            [
                trig('a.rs2', 'npc', 'afflicted', '\nnpc_changetype(keeper, 200);\nnpc_changetype(other, 200);'),
                trig('a.rs2', 'npc', 'keeper', '\n~openshop(a, 1, 1, 1, "A");\n~openshop(b, 1, 1, 1, "B");'),
                trig('a.rs2', 'npc', 'other', '\n~openshop(c, 1, 1, 1, "C");\n~openshop(a, 1, 1, 1, "A");'),
            ],
        );
        expect(run('npc', 'afflicted').map(x => x.subtype)).toEqual(['a', 'b', 'c']);
    });

    test('changed-into configs of another kind give it once, from the first walked, whatever their subtypes', () => {
        // One booth and one chest a loc turns into are one bank use; only a shop's subtype (its inv) splits.
        const run = among(
            'loc',
            [
                ['crate', { name: ['Crate'] }],
                ['booth', { name: ['Bank booth'] }],
                ['chest', { name: ['Bank chest'] }],
            ],
            [
                trig('a.rs2', 'loc', 'crate', '\nloc_change(booth, 10);\nloc_change(chest, 10);'),
                trig('a.rs2', 'loc', 'booth', '\n@openbank;'),
                trig('a.rs2', 'loc', 'chest', '\n@openbank;'),
            ],
        );
        expect(run('loc', 'crate')).toEqual([{ kind: 'bank', subtype: 'booth', name: 'Crate' }]);
    });

    test('a changed-into kind arrives through the op that makes the change, for the clash rule', () => {
        const configs: [string, Config][] = [
            ['rock', {}],
            ['booth', { name: ['Bank booth'] }],
        ];
        expect(among('loc', configs, shopTurningBank('3'))('loc', 'rock').map(x => x.kind)).toEqual(['shop', 'bank']);
        expect(() => among('loc', configs, shopTurningBank('1'))('loc', 'rock')).toThrow(
            'loc:rock matches rules shop, bank via booth through op 1',
        );
    });

    test('a kind the config already has adds nothing through a change', () => {
        const dir = 'skill_thieving/scripts/chest/trapped_chest.rs2';
        const run = among(
            'loc',
            [
                ['chest_10_coins', {}],
                ['looted', {}],
            ],
            [
                trig(dir, 'loc', 'chest_10_coins', '\nloc_change(looted, 50);'),
                trig(dir, 'loc', 'looted', '\nmes("Empty.");'),
            ],
        );
        expect(run('loc', 'chest_10_coins')).toMatchObject([{ kind: 'thieving-chest', subtype: 'chest_10_coins' }]);
    });

    test('turning into a monster does not make an npc an `npc`', () => {
        const run = among(
            'npc',
            [
                ['villager', { op1: ['Talk-to'] }],
                ['monster', { op2: ['Attack'], param: ['attackbonus,40'] }],
            ],
            [trig('a.rs2', 'npc', 'villager', '\nnpc_changetype(monster, 100);')],
        );
        expect(run('npc', 'villager')).toEqual([]);
        expect(run('npc', 'monster')).toMatchObject([{ kind: 'npc' }]);
    });

    test('a change into a config of the other type, or into an unknown one, is ignored', () => {
        const run = among(
            'loc',
            [['lever', {}]],
            [trig('a.rs2', 'loc', 'lever', '\nnpc_changetype(lever, 1);\nloc_change(nowhere, 1);')],
        );
        expect(run('loc', 'lever')).toEqual([]);
    });
});

/** A one-step course whose step is on `target`. */
const course = (name: string, target: string, category = false): CourseDef => ({
    course: name,
    varp: `${name}_course_progress`,
    lastStep: 1,
    lapBonus: 10,
    source: 'c.rs2:9',
    steps: [{ target, category, op: '1', step: 1, source: 'c.rs2:2' }],
});

describe('flax and agility courses', () => {
    test('flax: a pickables trigger that adds the obj flax; another pickable is no kind', () => {
        const pickables = 'general_use/scripts/pickables.rs2';
        const flax = trig(pickables, 'loc', 'flax', '\ninv_add(inv, flax, 1);', false, '2');
        expect(one('loc', 'flax', { name: ['Flax'] }, { triggers: [flax] })).toEqual({
            kind: 'flax',
            subtype: 'flax',
            name: 'Flax',
        });
        const onion = trig(pickables, 'loc', 'onion', '\ninv_add(inv, onion, 1);', false, '2');
        expect(one('loc', 'onion', {}, { triggers: [onion] })).toBeNull();
        // The same body in another script is not a pickable.
        expect(one('loc', 'flax', {}, { triggers: [{ ...flax, file: 'a.rs2' }] })).toBeNull();
    });

    test('an agility-course obstacle: a loc config or category with a step, its course the subtype', () => {
        expect(one('loc', 'log', { name: ['Log balance'] }, { courses: [course('gnome', 'log')] })).toEqual({
            kind: 'agility-course',
            subtype: 'gnome',
            name: 'Log balance',
        });
        expect(
            one('loc', 'rope', { category: ['ropes'] }, { courses: [course('barbarian', 'ropes', true)] }),
        ).toMatchObject({ kind: 'agility-course', subtype: 'barbarian' });
        // An npc of that name is not one.
        expect(one('npc', 'log', {}, { courses: [course('gnome', 'log')] })).toBeNull();
    });

    test('a loc moving two courses on throws', () =>
        expect(() => classify('loc', 'log', {}, { courses: [course('gnome', 'log'), course('wild', 'log')] })).toThrow(
            'loc:log moves on the laps of gnome, wild',
        ));
});

describe('unclaimed triggers', () => {
    const triggers = [
        trig('npc/scripts/cow.rs2', 'npc', 'cow', '\nstat_advance(attack, 40);', false, '2'),
        trig('npc/scripts/cow_milking.rs2', 'npc', 'cow', '\ninv_add(inv, bucket_milk, 1);', false, 'u'),
        trig('a.rs2', 'loc', 'closed', '\n~open_chest(open);', false, '1'),
        trig('a.rs2', 'loc', 'closed', '\nmes("Locked.");', false, '3'),
        trig('a.rs2', 'loc', 'open', '\n@openbank;', false, '2'),
    ];
    const run = classification({
        locConfigs: new Map<string, Config>([
            ['closed', { name: ['Closed chest'] }],
            ['open', { name: ['Open chest'] }],
            ['yewtree', { name: ['Yew'] }],
        ]),
        npcConfigs: new Map<string, Config>([['cow', { name: ['Cow'], op2: ['Attack'], param: ['attackbonus,1'] }]]),
        dbrows: [{ row: 'yew_tree_table', table: 'woodcutting_trees', data: { tree: [['yewtree']] } }],
        triggers,
        callables: [label('~open_chest', '(loc $other_chest)\nloc_change($other_chest, 300);')],
    });

    test("an attackable npc's Attack op is its kind's, its use-item op no rule's", () => {
        expect(run.classify('npc', 'cow').map(k => k.kind)).toEqual(['npc']);
        expect(run.unclaimed('npc', 'cow').map(t => t.op)).toEqual(['u']);
    });

    test('the op that changes a loc into a kind is claimed, its other ops not', () =>
        expect(run.unclaimed('loc', 'closed').map(t => t.op)).toEqual(['3']));

    test('a config a rule matched by data alone has no unclaimed trigger', () =>
        expect(run.unclaimed('loc', 'yewtree')).toEqual([]));

    test('reach gives a body and the bodies it calls, as code', () =>
        expect(run.reach('\n~open_chest(open); // not ~this')).toEqual([
            '\n~open_chest(open); ',
            '(loc open)\nloc_change(open, 300);',
        ]));
});
