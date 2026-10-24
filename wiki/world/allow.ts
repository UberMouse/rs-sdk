// The allowlists of the build checks (checks.ts): findings known and explained, each with a reason saying what is
// wrong and what fixes it, and a source, the map line of a feature the finding names (`maps/mX_Z.jm2:line` under
// server/content) or the script of the op that settles it. build.ts fails on a finding no entry allows, on an entry
// whose key names no one site (invalid) and on one no finding matches (stale: fixed now, or gone) or that repeats an
// earlier entry's match, so an entry goes when the refit it waits on lands.
import type { Allowed } from './checks';
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
