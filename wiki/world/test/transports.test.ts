import { describe, expect, test } from 'bun:test';
import { parseConfigs } from '../sources/configs';
import { collectConstants } from '../sources/constants';
import { deriveLoadoutRule } from '../sources/loadout';
import {
    curatedTransports,
    deriveSails,
    outOfScopeSites,
    sailSites,
    type CuratedTransport,
    type SailInput,
} from '../sources/transports';
import { parseCallables, parseTriggers } from '../sources/triggers';
import type { Quest, Tile } from '../types';

// Sail scripts in the forms the game's use (interface_boat/scripts/sail.rs2, areas/area_port_sarim/scripts/
// sailors.rs2 and monk_of_entrana.rs2, areas/area_karamja/scripts/customs_officer.rs2 and captain_shanks.rs2,
// quests/quest_dragon/scripts/dragonslayer_ned.rs2), cut down to what decides a route.
const SAIL = `[proc,set_sail](string $place_name, string $start_mes, coord $destination, int $map_route, int $delay)
%journey_number = $map_route;
if_openmain(ship_journey);
p_delay($delay);
p_telejump($destination);
`;
const SAILORS = `[opnpc1,_sailor]
if(map_members = ^true & npc_type = captain_tobias) {
    if(inv_total(inv, trail_clue) > 0) {
        return;
    }
}
@karamja_sailor_dialogue("Karamja", 1_46_49_12_7, ^sail_port_sarim_to_karamja);

[label,karamja_sailor_dialogue](string $dest, coord $coord, int $ship_dest)
~chatnpc("<p,quiz>Do you want to go on a trip to <$dest>?");
def_int $option;
if (%dragonquest >= ^quest_dragon_spoken_to_oziach & %dragonquest < ^dragon_complete) {
    $option = ~p_choice3("I'd rather go to Crandor Isle.", 3, "Yes please.", 1, "No, thank you.", 2);
} else {
    $option = ~p_choice2("Yes please.", 1, "No, thank you.", 2);
}
switch_int ($option) {
    case 1 :
        if (inv_total(inv, coins) < 30) {
            return;
        }
        inv_del(inv, coins, 30);
        ~set_sail($dest, "and board the ship.", $coord, $ship_dest, 7);
    case 2 :
        ~chatplayer("<p,neutral>No, thank you.");
}
`;
const MONK = `[opnpc1,shipmonk]
if(map_members = ^false) {
    return;
}
def_int $option = ~p_choice2("No, not right now.", 1, "Yes, okay, I'm ready to go.", 2);
if($option = 2) {
    if(~has_entrana_restricted_items = true) {
        return;
    }
    ~set_sail("Entrana", "...", 1_44_52_18_3, ^sail_port_sarim_to_entrana, 13);
}

[proc,has_entrana_restricted_items]()(boolean)
if ((inv_totalcat(inv, weapon_axe) > 0 | inv_totalcat(worn, weapon_axe) > 0)
    | (inv_totalcat(inv, cannon_parts) > 0)
    | inv_totalcat(worn, armour_cape) > 0) {
    return(true);
}
return(false);
`;
const CUSTOMS = `[opnpc1,customs_officer]
@multi2("Can I journey on this ship?", customs_journey, "Does Karamja have unusual customs then?", customs_unusual);
[label,customs_unusual]
mes("no");
[label,customs_journey]
if (%hunt >= 2) {
    if (inv_total(inv, karamja_rum) > 0) {
        @customs_spot_inspection;
    }
    @customs_pay;
}
if (inv_total(inv, karamja_rum) > 0) {
    inv_del(inv, karamja_rum, 28);
    return;
}
@customs_pay;
[label,customs_spot_inspection]
inv_del(inv, karamja_rum, 28);
[label,customs_pay]
if (inv_total(inv, coins) < 30) {
    return;
}
inv_del(inv, coins, 30);
if(coordx(npc_coord) < 2815) {
    ~set_sail("Ardougne", "", 1_41_51_59_4, ^sail_brimhaven_to_ardougne, 7);
} else {
    ~set_sail("Port Sarim", "", 1_47_50_24_17, ^sail_karamja_to_port_sarim, 7);
}
[label,multi2](string $string1, label $label1, string $string2, label $label2)
def_int $choice = ~p_choice2($string1, 1, $string2, 2);
if ($choice = 1) jump($label1);
jump($label2);
`;
const SHANKS = `[opnpc1,captain_shanks]
if(%zombiequeen < ^zombiequeen_complete) {
    return;
}
if(inv_total(inv, shiloshipticket) = 0) {
    def_int $price = ~random_range(26, 45);
    if(inv_total(inv, coins) < $price) {
        return;
    }
    inv_del(inv, coins, $price);
    inv_add(inv, shiloshipticket, 1);
}
inv_del(inv, shiloshipticket, 1);
~set_sail_cairn(0_47_50_39_35, ^sail_cairn_to_port_sarim);

[proc,set_sail_cairn](coord $destination, int $map_route)
%journey_number = $map_route;
if(inv_total(inv, karamja_rum) > 0) {
    inv_del(inv, karamja_rum, ^max_32bit_int);
}
p_telejump($destination);
`;
const NED = `[opnpc1,dragonslayer_ned]
if ((%dragonquest = ^quest_dragon_ned_given_map | %dragonquest = ^quest_dragon_sailed_to_crandor) & coordy(coord) = 3) {
    %journey_number = ^sail_port_sarim_to_crandor;
    p_telejump(^crandor_tele_coord);
}
`;
// A condition in no requirement form, a route not in sail.constant, and a sail no npc op reaches.
const ODD = `[opnpc1,oddsailor]
if (testbit(%oddvarp, 2) = ^true) {
    ~set_sail("Odd", "", 0_50_50_1_1, 99, 1);
}
[queue,trawler_start]
%journey_number = 11;
p_teleport(0_30_30_0_0);
`;

const FILES: [string, string][] = [
    ['interface_boat/scripts/sail.rs2', SAIL],
    ['sailors.rs2', SAILORS],
    ['monk.rs2', MONK],
    ['customs.rs2', CUSTOMS],
    ['shanks.rs2', SHANKS],
    ['ned.rs2', NED],
    ['odd.rs2', ODD],
];
const constants = collectConstants([
    [
        'interface_boat/scripts/sail.constant',
        [
            '^sail_port_sarim_to_entrana = 1',
            '^sail_port_sarim_to_crandor = 3',
            '^sail_port_sarim_to_karamja = 5',
            '^sail_karamja_to_port_sarim = 6',
            '^sail_brimhaven_to_ardougne = 8',
            '^sail_cairn_to_port_sarim = 13',
            '^sail_crandor_to_port_sarim = 4',
        ].join('\n'),
    ],
    [
        'quest.constant',
        [
            '^dragon_complete = 10',
            '^quest_dragon_spoken_to_oziach = 2',
            '^quest_dragon_ned_given_map = 8',
            '^quest_dragon_sailed_to_crandor = 9',
            '^crandor_tele_coord = 0_44_50_35_35',
            '^zombiequeen_complete = 15',
        ].join('\n'),
    ],
    ['engine.constant', '^true = 1\n^false = 0\n^max_32bit_int = 2147483647'],
]);
const npcConfigs = parseConfigs(
    [
        '[captain_tobias]\ncategory=sailor',
        '[seaman_lorris]\ncategory=sailor',
        '[shipmonk]',
        '[customs_officer]',
        '[captain_shanks]',
        '[dragonslayer_ned]',
        '[oddsailor]',
    ].join('\n'),
);
const at = (x: number, z: number, level = 0): Tile => ({ level, x, z });
const SPAWNS = [
    { config: 'captain_tobias', tile: at(3028, 3216) },
    { config: 'seaman_lorris', tile: at(3028, 3221) },
    { config: 'shipmonk', tile: at(3045, 3236) },
    { config: 'customs_officer', tile: at(2772, 3225) },
    { config: 'customs_officer', tile: at(2953, 3147) },
    { config: 'captain_shanks', tile: at(2763, 2961, 1) },
    { config: 'dragonslayer_ned', tile: at(2854, 3235) },
    { config: 'oddsailor', tile: at(3000, 3000) },
];
const quest = (id: string, varp: string, complete: number): Quest => ({
    id,
    varp,
    varpId: 1,
    complete,
    stages: {},
    source: '',
});
const INPUT: SailInput = {
    files: FILES,
    triggers: FILES.flatMap(([f, t]) => parseTriggers(f, t)),
    callables: FILES.flatMap(([f, t]) => parseCallables(f, t)),
    constants,
    npcConfigs,
    spawns: SPAWNS,
    quests: [quest('dragon', 'dragonquest', 10), quest('hunt', 'hunt', 4), quest('zombiequeen', 'zombiequeen', 15)],
    loadoutProcs: { entrana: { call: '~has_entrana_restricted_items', trueWhen: 'banned' } },
};
const sails = deriveSails(INPUT);
const rows = (npc: string) => sails.transports.filter(t => t.npc === npc);

describe('deriveSails', () => {
    test('a sail through a shared label: the fare is the coins taken, cited with the sail call', () => {
        expect(rows('captain_tobias')).toEqual([
            {
                kind: 'ship',
                route: 'port_sarim_to_karamja',
                npc: 'captain_tobias',
                from: at(3028, 3216),
                to: at(2956, 3143, 1),
                source: 'sailors.rs2:23',
                fare: 30,
                requires: ['coins:30'],
                paidAt: ['sailors.rs2:22'],
            },
        ]);
        // The category's other npc boards the same route from its own spawn.
        expect(rows('seaman_lorris').map(t => [t.route, t.from, t.requires])).toEqual([
            ['port_sarim_to_karamja', at(3028, 3221), ['coins:30']],
        ]);
    });

    test('a members check and a loadout proc refusing are requirements; a dialogue choice is none', () =>
        expect(rows('shipmonk').map(t => [t.route, t.to, t.fare, t.requires])).toEqual([
            ['port_sarim_to_entrana', at(2834, 3331, 1), 0, ['loadout:entrana', 'members']],
        ]));

    test('npc_coord picks the route per spawn; a label passed to @multi2 is followed; a quest stage path is not minimal', () =>
        expect(rows('customs_officer').map(t => [t.route, t.from, t.to, t.requires])).toEqual([
            ['brimhaven_to_ardougne', at(2772, 3225), at(2683, 3268, 1), ['coins:30']],
            ['karamja_to_port_sarim', at(2953, 3147), at(3032, 3217, 1), ['coins:30']],
        ]));

    test('a quest check, a random fare counted at its most, and a ticket taken net of one bought', () =>
        expect(rows('captain_shanks').map(t => [t.route, t.source, t.fare, t.requires, t.paidAt, t.notes])).toEqual([
            [
                'cairn_to_port_sarim',
                'shanks.rs2:14',
                45,
                ['coins:45', 'quest:zombiequeen'],
                ['shanks.rs2:10'],
                'the fare is random, 26 to 45 coins (shanks.rs2:10): it counts as 45',
            ],
            // The ticket taken is the one the player brought: the line that takes it is cited.
            [
                'cairn_to_port_sarim',
                'shanks.rs2:14',
                0,
                ['consume:shiloshipticket:1', 'quest:zombiequeen'],
                ['shanks.rs2:13'],
                undefined,
            ],
        ]));

    test('a sail open only at one quest stage is a quest window: left out and reported with its condition', () => {
        expect(rows('dragonslayer_ned')).toEqual([]);
        expect(sails.windows).toEqual([
            'dragonslayer_ned (2854, 3235) -> port_sarim_to_crandor: `%dragonquest = ^quest_dragon_ned_given_map` (ned.rs2:2)',
            'dragonslayer_ned (2854, 3235) -> port_sarim_to_crandor: `%dragonquest = ^quest_dragon_sailed_to_crandor` (ned.rs2:2)',
        ]);
    });

    test('a condition in no form is other:, and a journey not in sail.constant has no route', () =>
        expect(rows('oddsailor')).toEqual([
            {
                kind: 'ship',
                npc: 'oddsailor',
                from: at(3000, 3000),
                to: at(3201, 3201),
                source: 'odd.rs2:3',
                fare: 0,
                requires: ['other:`testbit(%oddvarp, 2) = ^true` (odd.rs2:2)'],
                notes: 'journey 99 is not a route in interface_boat/scripts/sail.constant',
            },
        ]));

    test('rows come out by route, then npc and tiles', () =>
        expect(sails.transports.map(t => `${t.route ?? '-'} ${t.npc}`)).toEqual([
            '- oddsailor',
            'brimhaven_to_ardougne customs_officer',
            'cairn_to_port_sarim captain_shanks',
            'cairn_to_port_sarim captain_shanks',
            'karamja_to_port_sarim customs_officer',
            'port_sarim_to_entrana shipmonk',
            'port_sarim_to_karamja captain_tobias',
            'port_sarim_to_karamja seaman_lorris',
        ]));

    test('a sail site no npc op reaches is unreached; routes nothing sails are unused', () => {
        expect(sails.unreached).toEqual(['odd.rs2:6']);
        // Ned's route sails only in a quest window, so no transport has it.
        expect(sails.unusedRoutes).toEqual(['crandor_to_port_sarim', 'port_sarim_to_crandor']);
        expect(sails.underived).toEqual([]);
    });

    test('a construct the walker does not follow is reported, with the trigger', () => {
        const loop = `[opnpc1,oddsailor]\nwhile (true) {\n    ~set_sail("x", "", 0_50_50_1_1, 5, 1);\n}\n`;
        const files: [string, string][] = [...FILES.filter(([f]) => f !== 'odd.rs2'), ['odd.rs2', loop]];
        const r = deriveSails({
            ...INPUT,
            files,
            triggers: files.flatMap(([f, t]) => parseTriggers(f, t)),
            callables: files.flatMap(([f, t]) => parseCallables(f, t)),
        });
        expect(r.underived).toEqual(['oddsailor (odd.rs2:1): `while (true) {` (odd.rs2:2): a loop is not followed']);
        expect(r.unreached).toEqual(['odd.rs2:3']);
    });
});

/** The sails of `text` as odd.rs2, in place of the fixtures' odd sailor. */
const sailsOf = (text: string, quests: readonly Quest[] = INPUT.quests) => {
    const files: [string, string][] = [...FILES.filter(([f]) => f !== 'odd.rs2'), ['odd.rs2', text]];
    return deriveSails({
        ...INPUT,
        files,
        triggers: files.flatMap(([f, t]) => parseTriggers(f, t)),
        callables: files.flatMap(([f, t]) => parseCallables(f, t)),
        quests,
    });
};

describe('deriveSails, on scripts of their own', () => {
    test('a stage of a varp that also completes a quest has no requirement form; its completion does', () => {
        const arrav: Quest = {
            ...quest('blackarmgang', 'blackarmgang', 4),
            or: [{ varp: 'phoenixgang', varpId: 2, complete: 10 }],
        };
        const r = sailsOf(
            `[opnpc1,oddsailor]
if (%phoenixgang >= 3) {
    ~set_sail("a", "", 0_50_50_1_1, 5, 1);
}
if (%phoenixgang >= 10) {
    ~set_sail("b", "", 0_50_50_2_2, 5, 1);
}
`,
            [...INPUT.quests, arrav],
        );
        expect(r.transports.filter(t => t.npc === 'oddsailor').map(t => t.requires)).toEqual([
            ['other:`%phoenixgang >= 3` (odd.rs2:2)'],
            ['quest:blackarmgang'],
        ]);
    });

    test('a quest varp `! 0` is the quest started; `! n` above 0 asks nothing', () => {
        const r = sailsOf(`[opnpc1,oddsailor]
if (%dragonquest ! 0) {
    ~set_sail("a", "", 0_50_50_1_1, 5, 1);
}
if (%dragonquest ! 4) {
    ~set_sail("b", "", 0_50_50_2_2, 5, 1);
}
`);
        expect(r.transports.filter(t => t.npc === 'oddsailor').map(t => t.requires)).toEqual([['quest:dragon>=1'], []]);
    });

    test('a trigger past MAX_PATHS is reported, and the sites it reached count as unreached', () => {
        const ifs = Array.from({ length: 9 }, (_, i) => `if (%v${i} = 1) { mes("a"); }`).join('\n');
        const r = sailsOf(`[opnpc1,oddsailor]\n${ifs}\n~set_sail("x", "", 0_50_50_1_1, 5, 1);\n`);
        expect(r.transports.filter(t => t.npc === 'oddsailor')).toEqual([]);
        expect(r.underived).toEqual(['oddsailor (odd.rs2:1): too many paths: odd.rs2:1 branches past 256 ways']);
        expect(r.unreached).toEqual(['odd.rs2:11']);
    });
});

test('sailSites: each call of a sail proc, and each %journey_number = outside one, in any script', () =>
    expect(sailSites(FILES, INPUT.callables)).toEqual([
        'customs.rs2:25',
        'customs.rs2:27',
        'monk.rs2:10',
        'ned.rs2:3',
        'odd.rs2:3',
        'odd.rs2:6',
        'sailors.rs2:23',
        'shanks.rs2:14',
    ]));

test('outOfScopeSites: listed sites leave the unreached; a listed site no longer unreached is stale', () =>
    expect(outOfScopeSites(['a.rs2:1', 'b.rs2:2'], ['b.rs2:2', 'c.rs2:3'])).toEqual({
        unreached: ['a.rs2:1'],
        stale: ['c.rs2:3'],
    }));

describe('deriveLoadoutRule', () => {
    const proc = INPUT.callables.find(c => c.call === '~has_entrana_restricted_items')!;

    test('reads each category and where it is forbidden: carried, worn or both', () =>
        expect(deriveLoadoutRule(proc)).toEqual({
            forbidCategories: { armour_cape: 'worn', cannon_parts: 'carried', weapon_axe: 'both' },
            source: 'monk.rs2:13',
        }));

    const other = (body: string) => () => deriveLoadoutRule({ ...proc, body: `()(boolean)\n${body}` });

    test('an obj banned by name: forbidObjs', () =>
        expect(
            deriveLoadoutRule({
                ...proc,
                body: '()(boolean)\nif (inv_totalcat(inv, weapon_axe) > 0 | inv_total(inv, knife) > 0) { return(true); }\nreturn(false);',
            }),
        ).toEqual({
            forbidCategories: { weapon_axe: 'carried' },
            forbidObjs: { knife: 'carried' },
            source: 'monk.rs2:13',
        }));

    test('a proc that returns true when the player is clear, read with that polarity', () => {
        const clear = '()(boolean)\nif (inv_totalcat(worn, armour_body) > 0) { return(false); }\nreturn(true);';
        expect(deriveLoadoutRule({ ...proc, body: clear }, 'clear')).toEqual({
            forbidCategories: { armour_body: 'worn' },
            source: 'monk.rs2:13',
        });
        expect(() => deriveLoadoutRule({ ...proc, body: clear })).toThrow(
            'is not `if (<category terms>) { return(true); } return(false);`',
        );
    });

    test('a proc in another form fails, naming what it is', () => {
        expect(other('if (stat(magic) > 0) { return(true); }\nreturn(false);')).toThrow(
            '`stat(magic) > 0` (monk.rs2:14) is not inv_totalcat(inv|worn, <category>) > 0 or inv_total(inv|worn, <obj>) > 0',
        );
        expect(other('return(false);')).toThrow('is not `if (<category terms>) { return(true); } return(false);`');
    });
});

describe('curatedTransports', () => {
    const cart: CuratedTransport = {
        kind: 'cart',
        npc: 'customs_officer',
        to: '0_44_46_18_7',
        fare: 10,
        requires: ['coins:10', 'quest:zombiequeen'],
        source: 'cart.rs2:43',
        paidAt: ['cart.rs2:41'],
        notes: 'a cart',
    };

    test('one row per spawn of the npc, landing at the coord', () =>
        expect(curatedTransports([cart], SPAWNS).map(t => [t.from, t.to, t.requires])).toEqual([
            [at(2772, 3225), at(2834, 2951), ['coins:10', 'quest:zombiequeen']],
            [at(2953, 3147), at(2834, 2951), ['coins:10', 'quest:zombiequeen']],
        ]));

    test.each([
        [{ npc: 'nobody' }, 'the npc has no spawn'],
        [{ to: '(1, 2)' }, 'is not a coord literal'],
        [{ requires: ['quest:zombiequeen', 'coins:10'] }, 'write requires as ["coins:10","quest:zombiequeen"]'],
        [{ fare: 20 }, 'fare 20 is not its coins:<n>'],
    ])('%o is refused: %s', (change, why) =>
        expect(() => curatedTransports([{ ...cart, ...change }], SPAWNS)).toThrow(why),
    );

    // A ride boarded at a loc, each placed loc landing by its own tile (a sled run picked by loc_coord).
    const sled: CuratedTransport = {
        kind: 'sled',
        loc: 'barrier',
        to: { '0_43_59_20_59': '0_43_59_38_18', '0_43_58_33_59': '0_43_58_42_7' },
        fare: 0,
        requires: ['skill:agility:28'],
        source: 'sled.rs2:10',
        paidAt: [],
        notes: 'a sled',
    };
    const LOCS = [
        { config: 'barrier', tile: at(2772, 3835) },
        { config: 'barrier', tile: at(2785, 3771) },
        { config: 'gate', tile: at(3000, 3000) },
    ];

    test('one row per placed loc of the loc, landing by its tile, with no paidAt when nothing is paid', () => {
        const rides = curatedTransports([sled], SPAWNS, LOCS);
        expect(rides.map(t => [t.loc, t.npc, t.from, t.to])).toEqual([
            ['barrier', undefined, at(2772, 3835), at(2790, 3794)],
            ['barrier', undefined, at(2785, 3771), at(2794, 3719)],
        ]);
        expect(rides.every(t => !('paidAt' in t))).toBe(true);
    });

    test.each([
        [{ npc: 'customs_officer' }, 'give an npc or a loc'],
        [{ loc: undefined }, 'give an npc or a loc'],
        [{ loc: 'nothing' }, 'the loc is never placed'],
        [{ to: { '0_43_59_20_59': '0_43_59_38_18' } }, 'no landing for the loc at 0_43_58_33_59'],
        [{ to: '0_43_59_38_18' }, ''],
    ])('a loc ride with %o: %s', (change, why) => {
        const run = () => curatedTransports([{ ...sled, ...change }], SPAWNS, LOCS);
        if (why) expect(run).toThrow(why);
        else expect(run().map(t => t.to)).toEqual([at(2790, 3794), at(2790, 3794)]);
    });
});
