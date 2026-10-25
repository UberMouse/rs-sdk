// The allowlists of the build checks (checks.ts): findings known and explained, each with a reason saying what is
// wrong and what fixes it, and a source, the map line of a feature the finding names (`maps/mX_Z.jm2:line` under
// server/content) or the script of the op that settles it. build.ts fails on a finding no entry allows, on an entry
// whose key names no one site (invalid; check 1's, one naming a config no map places) and on one no finding matches
// (stale: fixed now, or gone) or that repeats an earlier entry's match, so an entry goes when the refit it waits on
// lands.
import type { Allowed, ConfigAllowed, ConfigKey } from './checks';
import { siteAt, type SiteKey } from './site-key';

/** Where the area refits are planned: a reason ending "<this> refits the rect" waits on that work. */
const REFIT = 'conductor/docs/world-index-data-audit.md §2.5';

/** A site, by a feature's tile, the map line placing that feature, and the side of the area's rect it lies on. */
type Row = readonly [SiteKey, string, string];

const each = (reason: (side: string) => string, rows: readonly Row[]): Allowed[] =>
    rows.map(([key, source, side]) => ({ keys: [key], reason: reason(side), source }));

/**
 * The rect of `area` is a label square or a guess never fitted to what is in it (audit D), and the site is the
 * place's, just past the rect's `side` edge; the refits planned in REFIT fit it.
 */
const unfitted =
    (area: string) =>
    (side: string): string =>
        `${area}'s rect is not fitted to the place, and this site of it lies just ${side} of the rect: ${REFIT} refits the rect`;

/** A leaf rect drawn round one thing (a bank's booths, a resource, a course), beside a site of the place around it. */
const beside =
    (area: string, holds: string) =>
    (side: string): string =>
        `${area}'s rect holds only ${holds}, and this site, just ${side} of it, is none of it: it is the place around's, filed right, so nothing to fix`;

/** Check 2: sites 1-3 tiles outside a leaf area other than their own. */
export const NEAR_MISS_ALLOW: readonly Allowed[] = [
    ...each(unfitted('asgarnia-chaos-temple'), [[siteAt('altar', 2932, 3513), 'maps/m45_54.jm2:6102', 'south']]),
    ...each(unfitted('camelot-castle'), [[siteAt('altar', 2749, 3496, 1), 'maps/m42_54.jm2:10148', 'west']]),
    ...each(unfitted('burthorpe'), [
        [siteAt('anvil', 2918, 3573), 'maps/m45_55.jm2:6384', 'north'],
        [siteAt('fire', 2919, 3557), 'maps/m45_55.jm2:6413', 'east'],
    ]),
    ...each(unfitted('west-ardougne'), [
        [siteAt('anvil', 2499, 3332), 'maps/m39_52.jm2:4228', 'north-west'],
        [siteAt('water-source', 2548, 3321), 'maps/m39_51.jm2:6612', 'east'],
    ]),
    ...each(unfitted('troll-stronghold'), [[siteAt('fire', 2848, 3677), 'maps/m44_57.jm2:4591', 'east']]),
    ...each(unfitted('port-sarim'), [[siteAt('fire', 3024, 3245), 'maps/m47_50.jm2:7157', 'north']]),
    ...each(unfitted('black-knights-fortress'), [[siteAt('fire', 3030, 3514), 'maps/m47_54.jm2:5364', 'east']]),
    ...each(unfitted('agility-arena'), [[siteAt('fire', 2800, 3184), 'maps/m43_49.jm2:7030', 'west']]),
    ...each(unfitted('brimhaven'), [
        [siteAt('fire', 2791, 3199), 'maps/m43_49.jm2:6669', 'north'],
        [siteAt('shop', 2803, 3152), 'maps/m43_49.jm2:9216', 'east'],
    ]),
    ...each(unfitted('fishing-platform'), [
        [siteAt('fishing-spot', 2789, 3273), 'maps/m43_51.jm2:6352', 'east'],
        // Placed on level 1 with the bridge flag, so on level 0 (sources/maps.ts).
        [siteAt('range', 2763, 3274), 'maps/m43_51.jm2:5150', 'south'],
    ]),
    ...each(unfitted('mort-myre-swamp'), [[siteAt('fishing-spot', 3424, 3409), 'maps/m53_53.jm2:5698', 'north']]),
    ...each(unfitted('elf-camp'), [[siteAt('fishing-spot', 2210, 3237), 'maps/m34_50.jm2:5953', 'east']]),
    ...each(unfitted('rellekka'), [[siteAt('flax', 2614, 3635), 'maps/m40_56.jm2:4656', 'south']]),
    ...each(unfitted('battlefield'), [[siteAt('pickpocket', 2536, 3234), 'maps/m39_50.jm2:5787', 'east']]),
    // The Gnome Stronghold's sub-areas round the Grand Tree, whose gnomes, bars and shops stand between their rects.
    ...each(unfitted('grand-tree'), [
        [siteAt('pickpocket', 2465, 3490, 2), 'maps/m38_54.jm2:8899', 'south'],
        [siteAt('pickpocket', 2473, 3489), 'maps/m38_54.jm2:8829', 'south'],
        [siteAt('pickpocket', 2481, 3498, 2), 'maps/m38_54.jm2:8910', 'east'],
        [siteAt('shop', 2482, 3487, 1), 'maps/m38_54.jm2:8882', 'south-east'],
        [siteAt('shop', 2482, 3510, 1), 'maps/m38_54.jm2:8887', 'east'],
    ]),
    ...each(unfitted('gnome-ball-field'), [
        [siteAt('pickpocket', 2394, 3500, 1), 'maps/m37_54.jm2:6969', 'north'],
        [siteAt('pickpocket', 2394, 3506), 'maps/m37_54.jm2:6941', 'north'],
    ]),
    ...each(unfitted('swamp'), [[siteAt('shop', 2417, 3498, 1), 'maps/m37_54.jm2:6976', 'south']]),
    ...each(unfitted('palace'), [
        [siteAt('pickpocket', 3201, 3495, 1), 'maps/m50_54.jm2:11762', 'north'],
        [siteAt('pickpocket', 3204, 3496), 'maps/m50_54.jm2:11741', 'north'],
        [siteAt('range', 3221, 3497), 'maps/m50_54.jm2:7698', 'north'],
    ]),
    ...each(unfitted('exam-centre'), [
        [siteAt('pottery-oven', 3359, 3332), 'maps/m52_52.jm2:5464', 'south'],
        [siteAt('pottery-wheel', 3358, 3332), 'maps/m52_52.jm2:5438', 'south'],
    ]),
    // Its interior is east of the rect (audit D2).
    ...each(unfitted('crafting-guild'), [
        [siteAt('pottery-wheel', 2935, 3289), 'maps/m45_51.jm2:5281', 'east'],
        [siteAt('spinning-wheel', 2934, 3288, 1), 'maps/m45_51.jm2:5910', 'east'],
        [siteAt('tanner', 2934, 3284, 1), 'maps/m45_51.jm2:6227', 'east'],
        [siteAt('water-source', 2933, 3279), 'maps/m45_51.jm2:5221', 'east'],
    ]),
    ...each(unfitted('white-knights-castle'), [[siteAt('range', 2967, 3331), 'maps/m46_52.jm2:7543', 'south']]),
    ...each(unfitted('champions-guild'), [[siteAt('range', 3188, 3352), 'maps/m49_52.jm2:7743', 'west']]),
    ...each(unfitted('port-khazard'), [[siteAt('rock', 2640, 3151), 'maps/m41_49.jm2:5060', 'west']]),
    ...each(unfitted('desert-mining-camp'), [[siteAt('rock', 3303, 3021), 'maps/m51_47.jm2:4690', 'east']]),
    ...each(unfitted('arandar'), [[siteAt('rock', 2317, 3266), 'maps/m36_51.jm2:4268', 'south']]),
    ...each(unfitted('pirates-hideout'), [[siteAt('rock', 3055, 3944), 'maps/m47_61.jm2:5336', 'east']]),
    ...each(unfitted('taverley'), [
        [siteAt('shop', 2885, 3449), 'maps/m45_53.jm2:7639', 'west'],
        [siteAt('water-source', 2891, 3443), 'maps/m45_53.jm2:5396', 'south'],
    ]),
    ...each(unfitted('dwarven-mine-entrance'), [[siteAt('shop', 3011, 3453), 'maps/m47_53.jm2:5436', 'north']]),
    ...each(unfitted('tai-bwo-wannai'), [[siteAt('shop', 2781, 3057), 'maps/m43_47.jm2:6482', 'west']]),
    ...each(unfitted('tyras-camp'), [[siteAt('shop', 2194, 3140), 'maps/m34_49.jm2:6096', 'east']]),
    ...each(unfitted('bandit-camp'), [[siteAt('shop', 3025, 3701), 'maps/m47_57.jm2:6072', 'north']]),
    ...each(unfitted('sinclair-mansion'), [[siteAt('water-source', 2747, 3563), 'maps/m42_55.jm2:6015', 'north']]),
    ...each(unfitted('wizards-tower'), [[siteAt('water-source', 3116, 3167), 'maps/m48_49.jm2:5502', 'north']]),
    ...each(unfitted('cooks-guild'), [[siteAt('water-source', 3146, 3451), 'maps/m49_53.jm2:6396', 'north']]),
    // Near misses by design: a leaf drawn round one thing, beside a site of the place it sits in.
    ...each(beside('draynor-willows', 'the willows'), [[siteAt('bank', 3088, 3242), 'maps/m48_50.jm2:6682', 'north']]),
    ...each(beside('lumbridge-trees', 'the trees west of the castle'), [
        [siteAt('fire', 3205, 3220), 'maps/m50_50.jm2:6271', 'east'],
        [siteAt('pickpocket', 3206, 3219, 1), 'maps/m50_50.jm2:9741', 'east'],
        [siteAt('pickpocket', 3207, 3227), 'maps/m50_50.jm2:9674', 'east'],
        [siteAt('water-source', 3205, 3215), 'maps/m50_50.jm2:6263', 'east'],
    ]),
    ...each(beside('varrock-oaks', 'the oaks'), [
        [siteAt('water-source', 3190, 3468), 'maps/m49_54.jm2:5724', 'north'],
    ]),
    ...each(beside('duel-arena-bank', 'Fadli and the bank chests'), [
        [siteAt('shop', 3381, 3267), 'maps/m52_51.jm2:5040', 'south'],
    ]),
    ...each(beside('grand-tree-bank', 'its booths'), [
        [siteAt('pickpocket', 2443, 3502, 1), 'maps/m38_54.jm2:8853', 'east'],
    ]),
    ...each(beside('gnome-agility-course', 'the course'), [
        [siteAt('flax', 2466, 3412), 'maps/m38_53.jm2:5419', 'south'],
        [siteAt('pickpocket', 2470, 3399), 'maps/m38_53.jm2:6894', 'south'],
    ]),
    ...each(beside('coal-trucks', 'the mine'), [[siteAt('fire', 2609, 3476), 'maps/m40_54.jm2:5260', 'south']]),
    ...each(beside('lumbridge-swamp-mine', 'the mine'), [
        [siteAt('fire', 3237, 3151), 'maps/m50_49.jm2:5518', 'south'],
    ]),
    ...each(beside('toll-gate', 'the gate'), [[siteAt('shop', 3288, 3212), 'maps/m51_50.jm2:5594', 'south']]),
];

/**
 * A pair split at `area`'s edge, keyed by one feature of each site, the map line of the first, and `where` the rect
 * cuts the place.
 */
const split = (area: string, a: SiteKey, b: SiteKey, source: string, where: string): Allowed => ({
    keys: [a, b],
    reason: `one place clustered as two sites because ${area}'s rect, not fitted to it, cuts through it (${where}): ${REFIT} refits the rect`,
    source,
});

/** Check 3: same-config sites of one kind with features within the kind's radius, in different leaf areas. */
export const SPLIT_ALLOW: readonly Allowed[] = [
    split(
        'west-ardougne',
        siteAt('anvil', 2499, 3332),
        siteAt('anvil', 2501, 3330),
        'maps/m39_52.jm2:4228',
        'one anvil just north-west of the rect',
    ),
    split(
        'rellekka',
        siteAt('flax', 2614, 3635),
        siteAt('flax', 2616, 3646),
        'maps/m40_56.jm2:4656',
        'the field runs on south of the rect',
    ),
    split(
        'falador',
        siteAt('pickpocket', 2964, 3396),
        siteAt('pickpocket', 2962, 3381),
        'maps/m46_53.jm2:5945',
        'guards just north of the rect',
    ),
    split(
        'battlefield',
        siteAt('pickpocket', 2525, 3221),
        siteAt('pickpocket', 2508, 3209),
        'maps/m39_50.jm2:5736',
        'gnomes south and east of the rect, the nearest just south',
    ),
    split(
        'edgeville',
        siteAt('pickpocket', 3092, 3510),
        siteAt('pickpocket', 3085, 3518),
        'maps/m48_54.jm2:8449',
        'men just north of the rect',
    ),
    split(
        'gnome-ball-field',
        siteAt('pickpocket', 2391, 3476),
        siteAt('pickpocket', 2396, 3471),
        'maps/m37_54.jm2:6933',
        'children just south of the rect',
    ),
    // The Gnome Stronghold's gnomes round the Grand Tree, outside the grand-tree rect.
    split(
        'grand-tree',
        siteAt('pickpocket', 2457, 3498, 1),
        siteAt('pickpocket', 2443, 3502, 1),
        'maps/m38_54.jm2:8869',
        'gnomes just west of the rect, on level 1',
    ),
    split(
        'grand-tree',
        siteAt('pickpocket', 2458, 3497),
        siteAt('pickpocket', 2448, 3486),
        'maps/m38_54.jm2:8809',
        'gnomes just south-west of the rect',
    ),
    split(
        'grand-tree',
        siteAt('pickpocket', 2471, 3496),
        siteAt('pickpocket', 2473, 3489),
        'maps/m38_54.jm2:8827',
        'gnomes just south of the rect',
    ),
    split(
        'grand-tree',
        siteAt('pickpocket', 2474, 3498, 1),
        siteAt('pickpocket', 2474, 3490, 1),
        'maps/m38_54.jm2:8874',
        'gnomes just south and east of the rect, on level 1',
    ),
    split(
        'yanille',
        siteAt('pickpocket', 2545, 3116, 1),
        siteAt('pickpocket', 2544, 3112, 1),
        'maps/m39_48.jm2:7359',
        'watchmen just north of the rect, on level 1',
    ),
    split(
        'palace',
        siteAt('pickpocket', 3204, 3491, 1),
        siteAt('pickpocket', 3201, 3495, 1),
        'maps/m50_54.jm2:11763',
        'guards just north of the rect, on level 1',
    ),
    split(
        'arandar',
        siteAt('rock', 2324, 3272),
        siteAt('rock', 2317, 3266),
        'maps/m36_51.jm2:4413',
        'limestone just south of the rect',
    ),
    split(
        'coal-trucks',
        siteAt('rock', 2588, 3481),
        siteAt('rock', 2574, 3480),
        'maps/m40_54.jm2:4959',
        'most of the coal west of the rect',
    ),
    split(
        'desert-mining-camp',
        siteAt('rock', 3284, 3015),
        siteAt('rock', 3303, 3021),
        'maps/m51_47.jm2:4690',
        'tin just east of the rect',
    ),
    split(
        'shilo-village',
        siteAt('rock', 2820, 2998),
        siteAt('rock', 2825, 3001),
        'maps/m44_46.jm2:5729',
        'gem rocks just west of the rect',
    ),
    split(
        'pirates-hideout',
        siteAt('rock', 3052, 3946),
        siteAt('rock', 3055, 3944),
        'maps/m47_61.jm2:5336',
        'rocks just east of the rect',
    ),
    {
        keys: [siteAt('rock', 3035, 9764), siteAt('rock', 3028, 9737)],
        reason: "two places, split right: the Mining Guild's rocks are behind its door and ladder, which let in only a player with 60 Mining, so the Dwarven Mine's beside them are not the guild's",
        source: 'areas/area_falador/scripts/mining_guild.rs2:11',
    },
];

/** Where the stand rework is planned: a reason ending "<this> moves the stand" waits on that work. */
const RESTAND = 'conductor/docs/world-index-data-audit.md §2.4';

/** Sites, by a feature's tile, sharing one reason and one source. */
const all = (reason: string, source: string, keys: readonly SiteKey[]): Allowed[] =>
    keys.map(key => ({ keys: [key], reason, source }));

/** The stand's free walk is shut off from most of its members by `by`, a crossing that needs something. */
const shutOff = (by: string): string =>
    `the stand's free walk is shut off from most of its members by ${by}: ${RESTAND} moves the stand`;

/** The only way out of the place is `what`, a rolled crossing the distances could not price. */
const unpriced = (what: string): string =>
    `the only way out of here is ${what}, rolled, and the build could not price its failure's way back ` +
    `(distance.ts crossingTicks), so no stand here gets a nearest bank: nothing a stand fixes; pricing that way back does`;

/** The graph has no way out of the pocket the site is in, which `what` leads into. */
const closed = (what: string): string =>
    `the graph has no way out of the pocket ${what} leads into, so neither the stand nor any member gets a nearest ` +
    `bank: nothing a stand fixes; a way out the sources miss does`;

/** Check 4: stands cut off from most of their members, or from a bank a member's own way in does not reach. */
export const STAND_ALLOW: readonly Allowed[] = [
    // Members cut off: the stand is on the wrong side of a crossing that needs something.
    {
        keys: [siteAt('npc', 2546, 3560)],
        reason: shutOff("the Barbarian Outpost's gate (Alfred Grimhand's Barcrawl), the stand outside it"),
        source: 'areas/area_barbarian_outpost/scripts/outpost_gate.rs2:2',
    },
    {
        keys: [siteAt('npc', 3196, 3352)],
        reason: shutOff("the Champions' Guild door (32 quest points)"),
        source: 'areas/area_varrock/scripts/champions_guild.rs2:1',
    },
    {
        keys: [siteAt('npc', 2525, 3334)],
        reason: shutOff("Rehnison's door (Plague City), the stand in a 39-tile pocket behind it"),
        source: 'quests/quest_elena/scripts/doors.rs2:97',
    },
    {
        keys: [siteAt('npc', 2923, 3251)],
        reason: shutOff("Melzar's Maze's door (Melzar's key)"),
        source: 'quests/quest_dragon/scripts/melzars_maze.rs2:14',
    },
    {
        keys: [siteAt('npc', 2659, 3438)],
        reason: shutOff("the Ranging Guild's door (40 Ranged)"),
        source: 'minigames/game_ranging/scripts/ranging_guild_door.rs2:17',
    },
    {
        keys: [siteAt('npc', 2930, 9699)],
        reason: shutOff("Taverley Dungeon's jail doors (the jail key)"),
        source: 'areas/area_taverly/dungeon/scripts/jail_doors.rs2:3',
    },
    {
        keys: [siteAt('npc', 2576, 9501)],
        reason: shutOff('a locked door (82 Thieving and a lockpick), the stand in a 24-tile pocket behind it'),
        source: 'skill_thieving/scripts/doors/locked_door.rs2:154',
    },
    {
        keys: [siteAt('npc', 3173, 3478)],
        reason: shutOff("Lucien's door (Temple of Ikov), the stand in front of it"),
        source: 'quests/quest_ikov/scripts/quest_ikov.rs2:2',
    },
    {
        keys: [siteAt('npc', 3187, 3959)],
        reason: shutOff('locked doors (23 Thieving and a lockpick)'),
        source: 'skill_thieving/scripts/doors/locked_door.rs2:154',
    },
    {
        keys: [siteAt('pickpocket', 2572, 3292, 1)],
        reason: shutOff('locked doors (61 Thieving)'),
        source: 'skill_thieving/scripts/doors/locked_door.rs2:154',
    },
    {
        keys: [siteAt('pickpocket', 2612, 3316)],
        reason: shutOff('a locked door (13 Thieving)'),
        source: 'skill_thieving/scripts/doors/locked_door.rs2:154',
    },
    {
        keys: [siteAt('tree', 2577, 3086)],
        reason: shutOff("the Wizards' Guild doors (66 Magic)"),
        source: 'areas/area_yanille/scripts/magic_guild.rs2:11',
    },
    {
        keys: [siteAt('tree', 2759, 3854)],
        reason: shutOff(
            "Trollweiss's slopes: the stand is on the toboggan run (a waxed toboggan worn), the summit's trees up the 15 Agility climb",
        ),
        source: 'quests/quest_troll_love/scripts/quest_troll_love.rs2:10',
    },
    // A forest chained whole (audit E2) across Tirannwn's Regicide crossings.
    ...all(
        shutOff("Tirannwn's Regicide crossings (stage 8 and 56 Agility)"),
        'quests/quest_regicide/scripts/quest_regicide.rs2:389',
        [siteAt('tree', 2154, 3111), siteAt('tree', 2242, 3211)],
    ),
    // Sites spanning West Ardougne's wall: their members inside it ask Biohazard, the stand is outside.
    ...all(
        shutOff("West Ardougne's wall doors (Biohazard done), the stand outside the wall"),
        'areas/area_ardougne_west/scripts/doors.rs2:26',
        [siteAt('npc', 2454, 3301), siteAt('tree', 2433, 3308)],
    ),
    // No bank: the way out is a rolled crossing the build could not price.
    ...all(unpriced("Edgeville Dungeon's monkey bars (15 Agility)"), 'skill_agility/scripts/shortcuts.rs2:153', [
        siteAt('npc', 3116, 9992),
        siteAt('npc', 3118, 9974),
    ]),
    ...all(
        unpriced("the climb up the Shilo Village cavern's waterfall rocks"),
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1043',
        [
            siteAt('npc', 2886, 9360),
            siteAt('npc', 2892, 9384),
            siteAt('npc', 2901, 9355),
            siteAt('npc', 2910, 9349),
            siteAt('npc', 2928, 9354),
            siteAt('npc', 2886, 9293),
            siteAt('npc', 2892, 9312),
            siteAt('npc', 2897, 9321),
            siteAt('npc', 2917, 9304),
            siteAt('npc', 2924, 9292),
            siteAt('npc', 2934, 9285),
            siteAt('npc', 2934, 9309),
            siteAt('npc', 2934, 9317),
            siteAt('npc', 2937, 9301),
            siteAt('tree', 2908, 9350),
            siteAt('tree', 2931, 9346),
            siteAt('tree', 2932, 9355),
        ],
    ),
    ...all(
        unpriced("the Yanille Agility Dungeon's balancing ledge (40 Agility) or monkey bars (57)"),
        'areas/area_yanille/scripts/agility_dungeon.rs2:31',
        [siteAt('npc', 2562, 9506)],
    ),
    // No bank: a pocket the graph has no way out of.
    ...all(
        closed("the Black Knights' Fortress's secret wall, whose crossing row goes one way,"),
        'quests/quest_blackknight/scripts/quest_blackknight.rs2:88',
        [
            siteAt('npc', 3014, 3516, 2),
            siteAt('npc', 3015, 3515, 1),
            siteAt('npc', 3023, 3512, 1),
            siteAt('npc', 3023, 3514, 2),
            siteAt('npc', 3026, 3507, 2),
        ],
    ),
    ...all(closed('the rope swing at (2705, 3209) (10 Agility)'), 'skill_agility/scripts/shortcuts.rs2:121', [
        siteAt('npc', 2691, 3215),
    ]),
    ...all(closed("Ape Atoll's hole under the crate"), 'quests/quest_mm/scripts/quest_mm.rs2:978', [
        siteAt('npc', 2767, 9163),
        siteAt('npc', 2776, 9163),
        siteAt('npc', 2800, 9162),
    ]),
    ...all(closed("the Haunted Mine's dark stairs"), 'quests/quest_hauntedmine/scripts/hauntedmine_darkstairs.rs2:50', [
        siteAt('rock', 2717, 4434),
        siteAt('rock', 2747, 4441),
        siteAt('rock', 2763, 4438),
        siteAt('rock', 2771, 4426),
        siteAt('rock', 2783, 4436),
        siteAt('rock', 2798, 4449),
    ]),
    {
        keys: [siteAt('tree', 3415, 3522)],
        reason: closed(
            'a one-way step (the collision lets (3456, 3519) step to (3455, 3520) and not back) north of the holy barrier',
        ),
        source: 'maps/m53_55.jm2:14016',
    },
    {
        keys: [siteAt('npc', 2509, 3087)],
        reason:
            "the way in is the Watchtower's rope swing with a rope tied on (consumed), the way out the swing back, which asks 10 Agility: " +
            'distance.ts takes no way asking more than the way in, so the stand has no nearest bank; nothing a stand fixes',
        source: 'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:290',
    },
];

/**
 * Check 5: a fishing movement enum feeding several sites, or a fishing site whose spots move out of its leaf area.
 * No enum feeds several sites today (place.ts joinShores merges each within its area and level).
 */
export const MOVING_ALLOW: readonly Allowed[] = [
    {
        keys: [siteAt('fishing-spot', 2855, 2973)],
        reason: `the shilo-village enum's first tile (2822, 2969) is 3 tiles west of the rect (x1 2825), in karamja, its parent, and no other leaf area: ${REFIT} refits the rect`,
        source: 'skill_fishing/configs/fishing_movement.enum:145',
    },
];

/** Configs sharing a reason, with the line of one's trigger. */
const configs = (reason: string, source: string, keys: readonly ConfigKey[]): ConfigAllowed => ({
    configs: [...keys],
    reason,
    source,
});

// Check 1's reasons. One naming a kind ("<kind>: 2.6") is a use the index should have: plan 2.6 of
// conductor/docs/world-index-data-audit.md adds the kind or fixes the rule, and the entry goes. The others say why
// the config is no feature.
const APE_STALL = 'ape atoll stall: 2.6, the stall rule reads only skill_thieving/scripts/stalls/ (audit B1)';
const ROCK_CAKE_STALL = 'rock-cake stall: 2.6, a stall outside skill_thieving/scripts/stalls/, as audit B1';
const WELL = 'well: 2.6, STATIONS maps category watersource but not well (audit B2)';
const SAND_PIT = 'sand pit: 2.6, a sand pit without category sand_pit, as audit B2';
const CROP = 'crop: 2.6, the pickable kind (audit C1)';
const PICKABLE = 'pickable: 2.6, the pickable kind (audit C2)';
const MILL = 'mill: 2.6, hopper and flour bin (audit C4)';
const LIVESTOCK = 'livestock: 2.6, shearing and milking (audit C5)';
const KEY_CHEST = 'key chest: no kind, and 2.6 plans none: each opening takes a key';
const DYES = 'dye maker: no kind, and 2.6 plans none';
const REPAIRS = 'repairs: no kind, and 2.6 plans none';
const DUMMY = 'combat dummy: no kind, and 2.6 plans none';
const MINIGAME = 'minigame: played by its own rules, no feature';
const CLUE_STEP = 'treasure trail step: a clue names the loc, no feature';
const TUTORIAL = 'tutorial island: bots skip it, no feature';
const EMPTY_ROCK = 'empty rock: param mining_rock_empty, no ore, no feature';
const CROSSING = 'door: a way through, which the gates read, not a feature';
const QUEST = 'quest one-off: no feature';
const QUEST_ITEM = 'quest item: repeatable, but it gives only an item a quest uses, no feature';
const QUEST_WATER =
    'quest water: the mausoleum well fills a bucket with murky water (bucket_murkywater), which only Priest in Peril uses, no feature';
const QUEST_PICKABLE =
    "quest herb: 2.6, the pickable kind (audit C2), asking Jungle Potion's stage for the herb (picked again after the quest)";
const CAT_BUYER = 'cat buyer: no kind, and 2.6 plans none: any cat for 100 death runes, repeatable, no quest gate';
const CHOMPY = 'chompy hunting: no kind, and 2.6 plans none: swamp gas, bloated toads and the spit roast, repeatable';
const BEEHIVE =
    'beehive: no kind, and 2.6 plans none: a bucket of wax once insect repellent clears the bees, repeatable, no quest gate';
const FLOUR_BARREL =
    "flour barrel: no kind, and 2.6 plans none: a pot of flour, repeatable once Murder Mystery's started";
const DIG_SITE = 'dig site finds: no kind, and 2.6 plans none: panning, the specimen trays and the soil, repeatable';
const PICKPOCKET_RULE =
    'pickpocket: the pickpocket rule reads only skill_thieving/scripts/pickpocketing/, as audit B1; doc §2.6 lists it';
const FURNACE =
    'furnace: 2.6, a smelting furnace (smelting.rs2 @use_furnace) without category smithing_furnace, as audit B2; doc §2.6 lists it';
const ELEMENTAL =
    'elemental workshop: no kind, and 2.6 plans none: lava, elemental bars and shields, repeatable after the quest';
const SKINNER =
    "monkey skinner: no kind, and 2.6 plans none: skin and bones per corpse, repeatable after Tamayu's part";
const GHAST = 'ghast: a druid pouch makes it fightable, a fight and no feature';
// Agility moves with no crossing in the reach graph: why the build has none.
const GATE_CANDIDATE =
    'passage, no feature, and no crossing: gate-list.ts keeps its trigger out of the gates, and deriveScriptedMoves leaves gate candidates to the gate list; doc §2.6 lists it';
const FREE_GATE_CONFIG =
    "passage, no feature, and no crossing: the gate row's free config (byConfig ''), which World.gates does not write; doc §2.6 lists it";
const NO_PASSAGE_READ =
    'passage, no feature, and no crossing: deriveScriptedMoves reads no passage from its moves, or settles no landing (the build report); doc §2.6 lists it';
/**
 * Check 1: placed configs whose triggers no rule claimed have a gather or processing shape. The entries naming a
 * kind are plan 2.6's to-do list.
 */
export const UNCLAIMED_ALLOW: readonly ConfigAllowed[] = [
    configs(APE_STALL, 'quests/quest_mm/scripts/aa_market.rs2:1', [
        'loc mm_stall_crafting',
        'loc mm_stall_food',
        'loc mm_stall_general',
        'loc mm_stall_magic',
        'loc mm_stall_scimitar',
    ]),
    configs(ROCK_CAKE_STALL, 'areas/area_yanille/scripts/ogre_trader.rs2:21', ['loc rockcounter_withcakes']),
    configs(WELL, 'general_use/scripts/water_sources.rs2:69', ['loc desertwell', 'loc well']),
    configs(SAND_PIT, 'areas/area_shilo/scripts/shilo_sandpit.rs2:4', ['loc sand1']),
    configs(CROP, 'general_use/scripts/pickables.rs2:43', ['loc cabbage', 'loc onion', 'loc potato', 'loc wheat']),
    configs(PICKABLE, 'areas/area_brimhaven/scripts/pineapple_plants.rs2:1', ['loc pineapple_plant']),
    configs(PICKABLE, 'areas/area_desert/scripts/kharidian_cactus.rs2:1', ['loc desert_cactus_full']),
    configs(PICKABLE, 'areas/area_karamja/scripts/banana_tree.rs2:1', ['loc bananatreefull', 'loc mm_bananatreefull']),
    configs(PICKABLE, 'quests/quest_mm/scripts/quest_mm.rs2:957', ['loc mm_pineapple_plant_one']),
    configs(QUEST_PICKABLE, 'quests/quest_junglepotion/scripts/quest_junglepotion.rs2:3', [
        'loc ardrigal_palm_full',
        'loc rogues_purse_cave_full',
        'loc sito_soil_full',
        'loc snake_vine_full',
        'loc volencia_moss_rock_full',
    ]),
    configs(PICKABLE, 'areas/area_miscellania/scripts/weed_herbs.rs2:10', [
        'loc misc_heather_dark',
        'loc misc_heather_light',
        'loc misc_heather_normal',
    ]),
    configs(MILL, 'general_use/scripts/windmills.rs2:94', [
        'loc hopper_ardougne',
        'loc hopper_lumbridge',
        'loc hopper_varrock',
        'loc hopper_zanaris',
        'loc millbase',
    ]),
    configs(LIVESTOCK, 'general_use/scripts/shear_sheep.rs2:5', ['npc sheepunsheered']),
    configs(LIVESTOCK, 'npc/scripts/cow_milking.rs2:1', ['npc cow']),
    configs(KEY_CHEST, 'areas/area_taverly/scripts/crystal_chest.rs2:6', ['loc crystal_chestclosed']),
    configs(KEY_CHEST, 'areas/area_wilderness/scripts/lava_maze.rs2:5', ['loc muddy_chestclosed']),
    configs(KEY_CHEST, 'areas/area_yanille/scripts/agility_dungeon.rs2:101', ['loc shuttwistedchest']),
    configs(DYES, 'areas/area_draynor/scripts/aggie.rs2:37', ['npc aggie']),
    configs(REPAIRS, 'areas/area_lumbridge/scripts/bob.rs2:19', ['npc bob', 'npc nurmof']),
    configs(DUMMY, 'areas/area_combat_training/scripts/combat_training_camp.rs2:45', ['loc biohazarddummy']),
    configs(DUMMY, 'areas/area_varrock/scripts/attack_dummy.rs2:1', ['loc sworddummy']),
    configs(CAT_BUYER, 'areas/area_ardougne_west/scripts/civilian.rs2:1', [
        'npc wantcat1',
        'npc wantcat2',
        'npc wantcat3',
    ]),
    configs(CHOMPY, 'quests/quest_chompybird/scripts/raw_chompy.rs2:14', ['loc chompybird_spitroast_empty']),
    configs(CHOMPY, 'quests/quest_chompybird/scripts/quest_chompybird.rs2:12', [
        'loc swampbubbles',
        'loc swampbubbles_swamp',
    ]),
    configs(CHOMPY, 'quests/quest_chompybird/scripts/swamp_toad.rs2:24', ['npc toad']),
    configs(BEEHIVE, 'areas/area_seers/scripts/bees.rs2:8', ['loc merlin_beehive']),
    configs(FLOUR_BARREL, 'quests/quest_murder/scripts/quest_murder.rs2:194', ['loc flourbarrel']),
    configs(DIG_SITE, 'quests/quest_itexam/scripts/area_digsite.rs2:5', ['loc panning_point']),
    configs(DIG_SITE, 'quests/quest_itexam/scripts/area_digsite.rs2:124', [
        'loc digdugupsoil1',
        'loc digdugupsoil2',
        'loc digdugupsoil3',
    ]),
    configs(DIG_SITE, 'quests/quest_itexam/scripts/area_digsite.rs2:513', ['loc specimen_tray']),
    configs(PICKPOCKET_RULE, 'quests/quest_itexam/scripts/digsite_workman.rs2:45', [
        'npc digworkman1',
        'npc digworkman2',
    ]),
    configs(ELEMENTAL, 'quests/quest_elemental_workshop/scripts/quest_elemental_workshop.rs2:150', [
        'loc elemental_workshop_furnace',
        'loc elemental_workshop_trough',
        'loc elemental_workshop_workbench',
    ]),
    configs(SKINNER, 'quests/quest_tbwt/scripts/tbwt_tamayu.rs2:27', ['npc tbwt_tamayu']),
    configs(GHAST, 'quests/quest_druidspirit/scripts/ghast.rs2:39', ['npc ghast_invis']),
    configs(QUEST_WATER, 'areas/area_mausoleum/scripts/well.rs2:8', ['loc priestperil_well']),
    configs(QUEST_ITEM, 'quests/quest_hauntedmine/scripts/hauntedmine_fungus.rs2:1', [
        'loc glowing_mushroom',
        'loc glowing_mushroom2',
    ]),
    configs(QUEST_ITEM, 'areas/area_vt/scripts/vt_council_workman.rs2:20', ['npc vt_council_workmen']),
    configs(QUEST_ITEM, 'quests/quest_regicide/scripts/quest_regicide.rs2:639', ['loc regicide_tar_collection']),
    configs(QUEST_ITEM, 'quests/quest_regicide/scripts/quest_regicide.rs2:672', ['loc regicide_loom']),
    configs(QUEST_ITEM, 'quests/quest_regicide/scripts/regicide_fractionalizing_still.rs2:4', [
        'loc regicide_fractionalizing_still',
    ]),
    configs(QUEST_ITEM, 'quests/quest_upass/scripts/quest_upass.rs2:421', ['loc upassdwarfbrewbarrel']),
    configs(QUEST_ITEM, 'quests/quest_viking/scripts/viking_peer.rs2:513', [
        'loc viking_seers_drain',
        'loc viking_seers_tap',
    ]),
    configs(FURNACE, 'quests/quest_regicide/scripts/quest_regicide.rs2:693', ['loc regicide_furnace']),
    configs(GATE_CANDIDATE, 'minigames/game_agilityarena/scripts/agilityarena.rs2:222', ['loc agilityarena_handholds']),
    configs(GATE_CANDIDATE, 'quests/quest_troll_love/scripts/quest_troll_love.rs2:1', [
        'loc trollromance_piste_walk_barrier_down',
    ]),
    configs(GATE_CANDIDATE, 'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:231', ['loc ttcellclimbrock1']),
    configs(GATE_CANDIDATE, 'quests/quest_upass/scripts/upass_obstacles.rs2:61', ['loc upass_pipe4']),
    configs(GATE_CANDIDATE, 'quests/quest_upass/scripts/upass_obstacles.rs2:330', ['loc upass_pipe6']),
    configs(FREE_GATE_CONFIG, 'skill_agility/scripts/shortcuts.rs2:115', ['loc tree_ropeswing2']),
    configs(NO_PASSAGE_READ, 'minigames/game_agilityarena/scripts/agilityarena.rs2:119', [
        'loc agilityarena_ropeswing',
    ]),
    configs(NO_PASSAGE_READ, 'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:244', [
        'loc ttcellclimbrock2',
        'loc ttcellclimbrock3',
        'loc ttcellclimbrock4',
    ]),
    configs(NO_PASSAGE_READ, 'skill_agility/scripts/shortcuts.rs2:228', [
        'loc zqrockjump1',
        'loc zqrockjump2',
        'loc zqrockjump3',
    ]),
    configs(QUEST, 'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:837', ['loc secretrubblebook']),
    configs(MINIGAME, 'areas/area_gnome/scripts/aluft_gianne.rs2:2', ['npc aluft_gianne']),
    configs(MINIGAME, 'minigames/game_gnomeball/scripts/gnomeball_shoot.rs2:1', ['loc goal_gnomeball_game']),
    configs(MINIGAME, 'minigames/game_mortton/scripts/mortton_catacombs.rs2:441', [
        'loc shadechest_black_black',
        'loc shadechest_black_bloodred',
        'loc shadechest_black_brown',
        'loc shadechest_black_crimson',
        'loc shadechest_black_purple',
        'loc shadechest_bronze_black',
        'loc shadechest_bronze_bloodred',
        'loc shadechest_bronze_brown',
        'loc shadechest_bronze_crimson',
        'loc shadechest_bronze_purple',
        'loc shadechest_silver_black',
        'loc shadechest_silver_bloodred',
        'loc shadechest_silver_brown',
        'loc shadechest_silver_crimson',
        'loc shadechest_silver_purple',
        'loc shadechest_steel_black',
        'loc shadechest_steel_bloodred',
        'loc shadechest_steel_brown',
        'loc shadechest_steel_crimson',
        'loc shadechest_steel_purple',
        'loc temple_pyre',
        'loc templewall_base',
        'loc templewallcorner_base',
    ]),
    configs(MINIGAME, 'minigames/game_ranging/scripts/target.rs2:2', ['loc loc_2513']),
    configs(MINIGAME, 'minigames/game_trawler/scripts/trawler_net.rs2:60', [
        'loc trawlernet_top_l',
        'loc trawlernet_top_r',
        'loc trawlernetland',
    ]),
    configs(CLUE_STEP, 'general_use/scripts/drawers.rs2:29', [
        'loc arena_hospital_drawers2',
        'loc chestclosed',
        'loc chestclosedgold',
        'loc drawers1',
        'loc drawers2',
        'loc drawers3',
    ]),
    configs(TUTORIAL, 'tutorial/scripts/skills/tut_mining.rs2:2', [
        'loc newbiecopperrock',
        'loc newbiedeadtree2',
        'loc newbierange',
        'loc newbietinrock',
        'loc newbietree',
        'loc newbietree2',
        'npc 0_48_48_newbiefishing',
    ]),
    configs(EMPTY_ROCK, 'skill_mining/scripts/mining.rs2:2', ['loc rocks1', 'loc rocks2', 'loc rocks3']),
    configs(CROSSING, 'areas/area_alkharid/scripts/shantay_pass.rs2:60', ['loc shantay_pass_henge_doorway']),
    configs(CROSSING, 'skill_thieving/scripts/doors/locked_door.rs2:37', [
        'loc east_ardy_sewer_gate_north',
        'loc east_ardy_sewer_gate_south',
        'loc loc_2550',
        'loc loc_2551',
        'loc loc_2554',
        'loc loc_2555',
        'loc loc_2556',
        'loc loc_2557',
        'loc loc_2558',
        'loc loc_2559',
    ]),
    configs(QUEST, 'areas/area_karamja/scripts/trufitus.rs2:2', ['npc trufitus']),
    configs(QUEST, 'areas/area_mausoleum/scripts/monuments.rs2:7', [
        'loc priestperil_grave_base1',
        'loc priestperil_grave_base2',
        'loc priestperil_grave_base3',
        'loc priestperil_grave_base4',
        'loc priestperil_grave_base5',
        'loc priestperil_grave_base6',
        'loc priestperil_grave_base7',
    ]),
    configs(QUEST, 'areas/area_shilo/scripts/yanni_salika.rs2:52', ['npc shiloantiques']),
    configs(QUEST, 'areas/area_varrock/scripts/bartender.rs2:110', [
        'npc bluemoon_bartender',
        'npc blurberry',
        'npc deadmans_bartender',
        'npc dragon_bartender',
        'npc flyinghorse_bartender',
        'npc foresters_bartender',
        'npc jollyboar_bartender',
        'npc risingsun_barmaid',
        'npc rustyanchor_bartender',
        'npc zambo',
    ]),
    configs(QUEST, 'areas/area_varrock/scripts/curator.rs2:42', ['npc curator']),
    configs(QUEST, 'areas/area_varrock/scripts/straven.rs2:13', ['npc straven']),
    configs(QUEST, 'areas/area_wizard_tower/scripts/sedridor.rs2:47', ['npc head_wizard']),
    configs(QUEST, 'quests/quest_biohazard/scripts/quest_biohazard.rs2:32', [
        'loc biowatchtower',
        'loc mournercauldron',
    ]),
    configs(QUEST, 'quests/quest_blackknight/scripts/quest_blackknight.rs2:91', ['loc blackknighthole']),
    configs(QUEST, 'quests/quest_death/scripts/death_guard_equiproom.rs2:40', ['npc death_guard_equiproom']),
    configs(QUEST, 'quests/quest_demon/scripts/demon_slayer.rs2:23', ['loc questdrain']),
    configs(QUEST, 'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:324', [
        'loc captain_siads_chest_closed',
        'loc cell_escape_window',
        'loc experimental_anvil',
        'loc miningcampgateclosedl',
        'loc miningcampgateclosedr',
        'loc thminebarrel_empty',
        'loc touristtrap_minecart',
        'npc al_shabim',
        'npc ana',
    ]),
    configs(QUEST, 'quests/quest_druid/scripts/quest_druid.rs2:14', ['loc cauldron_of_thunder']),
    configs(QUEST, 'quests/quest_druidspirit/scripts/quest_druidspirit.rs2:135', [
        'loc stonedisc_ds_nature',
        'loc stonedisc_ds_spirit',
    ]),
    configs(QUEST, 'quests/quest_eadgar/scripts/eadgar_zoo_keeper_aviary.rs2:62', [
        'loc eadgar_aviary_wall_hatch',
        'npc eadgar_troll_chief_cook',
    ]),
    configs(QUEST, 'quests/quest_fishingcompo/scripts/quest_fishingcompo.rs2:75', ['loc garlicpipe']),
    configs(QUEST, 'quests/quest_fluffs/scripts/quest_fluffs.rs2:195', ['npc gertrudescat']),
    configs(QUEST, 'quests/quest_grandtree/scripts/quest_grandtree.rs2:71', ['loc grandtree_chestclosed']),
    configs(QUEST, 'quests/quest_haunted/scripts/quest_haunted.rs2:81', ['loc hauntedfountain']),
    configs(QUEST, 'quests/quest_hauntedmine/scripts/hauntedmine_crystals.rs2:31', [
        'loc crystalcorner',
        'loc crystaledging',
        'loc largecrystals',
        'npc hauntedmine_boss_key',
    ]),
    configs(QUEST, 'quests/quest_horror/scripts/quest_horror.rs2:110', [
        'loc horror_broken_bridge_left_spot',
        'loc horror_broken_bridge_right_spot',
    ]),
    configs(QUEST, 'quests/quest_hunt/scripts/banana_crate.rs2:20', [
        'loc bananacrate',
        'loc piratechest',
        'npc redbeard_frank',
    ]),
    configs(QUEST, 'quests/quest_itexam/scripts/area_digsite.rs2:813', [
        'loc digbarrelclosed',
        'loc digblastbrick',
        'loc digchestclosed',
        'loc digwinch1',
        'loc digwinch2',
        'npc archaeological_expert',
    ]),
    configs(QUEST, 'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:354', [
        'loc shuttanothchest2',
        'loc tobanchest',
        'loc tree_ropeswing4_norope',
        'loc watchleverup',
        'npc city_guard',
        'npc grew',
        'npc og',
        'npc ogre_guard3',
        'npc ogre_shaman',
        'npc toban',
        'npc watchtower_wizard',
    ]),
    configs(QUEST, 'quests/quest_legends/scripts/quest_legends.rs2:1950', [
        'loc dragons_eye_rock',
        'loc fertilesoil',
        'loc heart_recess_empty',
        'loc lgancientwalldoor',
        'loc lglockpickgatebottoml',
        'loc lglockpickgatebottomr',
        'loc lqfirewall_diagonal',
        'loc lqfirewall_straight',
        'loc mine_test_boulder1',
        'loc mine_test_boulder2',
        'loc mine_test_boulder3',
        'loc sacred_water',
        'npc ungadulu_good',
    ]),
    configs(QUEST, 'quests/quest_mcannon/scripts/locs/mcannon_broken_cannon.rs2:1', [
        'loc broken_multicannon',
        'loc dwarf_multicannon1',
    ]),
    configs(QUEST, 'quests/quest_mm/scripts/quest_mm.rs2:1064', [
        'loc mm_iban_firewall_diagonal',
        'loc mm_iban_firewall_straight',
        'loc mm_jail_door',
    ]),
    configs(QUEST, 'quests/quest_mortton/scripts/quest_mortton.rs2:28', [
        'npc apothecary',
        'npc ulsquire_shauncy_afflicted',
    ]),
    configs(QUEST, 'quests/quest_priestperil/scripts/vampire_coffin.rs2:8', [
        'loc priestperil_coffin_noanim',
        'npc priestperiltrappedmonk',
    ]),
    configs(QUEST, 'quests/quest_regicide/scripts/quest_regicide.rs2:495', ['loc regicide_catapult']),
    configs(QUEST, 'quests/quest_scorpcatcher/scripts/quest_scorpcatcher.rs2:14', [
        'npc questscorpiona',
        'npc questscorpionb',
        'npc questscorpionc',
    ]),
    configs(QUEST, 'quests/quest_sheepherder/scripts/locs/sheepherder_furnace.rs2:1', ['loc plaguesheep_furnace']),
    configs(QUEST, 'quests/quest_tbwt/scripts/tbwt_tiadeche.rs2:31', ['npc tbwt_tiadeche', 'npc tbwt_tinsay']),
    configs(QUEST, 'quests/quest_troll/scripts/troll_stronghold_camp_guard.rs2:35', [
        'npc troll_prison_guard1',
        'npc troll_prison_guard2',
    ]),
    configs(QUEST, 'quests/quest_upass/scripts/quest_upass.rs2:348', [
        'loc bloodwell_upass',
        'loc cave_railings2',
        'loc cave_railings5',
        'loc cave_temple_altar',
        'loc cave_well',
        'loc cavewitch_door',
        'loc ibantomb_left',
        'loc ibantomb_right',
        'loc loc_2276',
        'loc obstical_rockswing_middle',
        'loc upass_logtrap_trigger',
        'loc upassshutchest1',
    ]),
    configs(QUEST, 'quests/quest_viking/scripts/viking_olaf.rs2:147', [
        'loc viking_musical_tree',
        'loc viking_seer_range',
        'loc viking_seers_mural',
        'loc viking_small_table_frozen',
    ]),
    configs(QUEST, 'quests/quest_waterfall/scripts/quest_waterfall.rs2:460', [
        'loc baxtorian_chalice_waterfall_quest',
        'loc statue_queen_waterfall_quest',
        'loc stonepillar_small_waterfall_quest',
    ]),
    configs(QUEST, 'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1399', [
        'loc thzq_tombrooml1',
        'loc thzq_tombroomr1',
        'loc zqdolmen',
        'loc zqtableraft',
    ]),
];
