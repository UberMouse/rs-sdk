// The world's named areas, keyed by id; wiki/world/area-resolve.ts resolves a tile to them.
// Seeded by wiki/world/tools/seed-areas.ts from the world map labels, then curated by hand:
// - Each region is a few rects with its borders placed on the map (rivers, fences, the Wilderness
//   line), so a tile in no town still names the right kingdom. The Wilderness is the engine's box
//   (sources/zones.ts); the Kharidian Desert holds Al Kharid; Feldip Hills is the ogre land south of
//   Kandarin, and Yanille, Castle Wars and the places the seed put under it are Kandarin's. Regions
//   overlap only where an island region lies under a mainland region's rect: Crandor and Entrana
//   under Asgarnia's and Kandarin's, Tutorial Island under Asgarnia's, Miscellania under Kandarin's.
//   The island, being smaller, wins every tile both hold, its land included (area-resolve.ts).
// - A bank's leaf rect is its booths, bankers and chests plus one tile, so the trees, stalls and
//   shops beside it name the town instead.
// - Every site build.ts must place (its COVERED kinds) lies in an area; build.ts fails otherwise.
// - Each bank site has a leaf area named as players call it, and so do the mines, fishing spots and
//   tree groups agents name in learnings/ and wiki/skills/ (a note gives any other name in use).
// - Town rects are refitted where a bank or named spot sat outside the seed's square.
// - Instanced planes (z 4400-5000) and underground areas (z + 6400) are their own top-level areas,
//   named from their scripts and npcs. A note says when a name is descriptive rather than read from
//   the data, and names the way in where the connectors or scripts show it.
import type { Area, Rect } from './types';

/**
 * Rects approximating the diamond |x - cx| + |z - cz| <= r, for a fence built on the diagonals: bands
 * of three rows, each as wide as its row nearest the centre, so a band reaches at most two tiles past
 * the diamond at its ends (onto the fence, for a fence two tiles thick). The two tips, (cx, cz ± r),
 * get a tile each when the last band stops short of them.
 */
function diamond(cx: number, cz: number, r: number): Rect[] {
    const rects: Rect[] = [{ x1: cx - r, z1: cz - 1, x2: cx + r, z2: cz + 1 }];
    let reached = 1;
    for (let near = 2; near < r; near += 3) {
        const [half, far] = [r - near, Math.min(near + 2, r)];
        rects.push(
            { x1: cx - half, z1: cz + near, x2: cx + half, z2: cz + far },
            { x1: cx - half, z1: cz - far, x2: cx + half, z2: cz - near },
        );
        reached = far;
    }
    // The bands cover every row up to r - 1, and row r is the tip alone.
    if (reached < r) rects.push({ x1: cx, z1: cz + r, x2: cx, z2: cz + r }, { x1: cx, z1: cz - r, x2: cx, z2: cz - r });
    return rects;
}

export const AREAS: readonly Area[] = [
    // Asgarnia. Its border with Misthalin runs at x 3064/3065 (Port Sarim and the Monastery west,
    // Barbarian Village and Draynor east); north of z 3519 east of x 2943 is the Wilderness.
    {
        id: 'asgarnia',
        name: 'Asgarnia',
        rects: [
            { x1: 2968, z1: 3090, x2: 3064, z2: 3467 },
            { x1: 2851, z1: 3206, x2: 2967, z2: 3467 },
            // The shore below Rimmington, down to the sea Karamja lies across (see Karamja).
            { x1: 2932, z1: 3190, x2: 2967, z2: 3205 },
            { x1: 2823, z1: 3468, x2: 3064, z2: 3519 },
            { x1: 2823, z1: 3520, x2: 2943, z2: 3708 },
        ],
    },
    {
        id: 'asgarnia-chaos-temple',
        name: 'Chaos Temple',
        parent: 'asgarnia',
        rects: [{ x1: 2922, z1: 3514, x2: 2943, z2: 3537 }],
    },
    {
        id: 'black-knights-fortress',
        name: "Black Knights' Fortress",
        parent: 'asgarnia',
        rects: [{ x1: 3006, z1: 3510, x2: 3029, z2: 3519 }],
    },
    { id: 'burthorpe', name: 'Burthorpe', parent: 'asgarnia', rects: [{ x1: 2871, z1: 3525, x2: 2918, z2: 3572 }] },
    {
        id: 'crafting-guild',
        name: 'Crafting Guild',
        parent: 'asgarnia',
        rects: [{ x1: 2909, z1: 3270, x2: 2932, z2: 3293 }],
    },
    {
        id: 'dark-wizards-tower',
        name: "Dark Wizards' Tower",
        parent: 'asgarnia',
        rects: [{ x1: 2895, z1: 3324, x2: 2918, z2: 3347 }],
    },
    {
        id: 'death-plateau',
        name: 'Death Plateau',
        parent: 'asgarnia',
        rects: [{ x1: 2853, z1: 3580, x2: 2876, z2: 3603 }],
    },
    {
        id: 'druids-circle',
        name: "Druids' Circle",
        parent: 'asgarnia',
        rects: [{ x1: 2913, z1: 3461, x2: 2936, z2: 3484 }],
    },
    {
        id: 'dwarven-mine-entrance',
        name: 'Dwarven Mine entrance',
        parent: 'asgarnia',
        rects: [{ x1: 3004, z1: 3429, x2: 3027, z2: 3452 }],
        notes: 'The world map\'s "Dwarven Mine" label, on Ice Mountain; the mine itself is the underground area dwarven-mine.',
    },
    { id: 'falador', name: 'Falador', parent: 'asgarnia', rects: [{ x1: 2935, z1: 3305, x2: 3025, z2: 3395 }] },
    {
        id: 'falador-east-bank',
        name: 'Falador East bank',
        parent: 'falador',
        rects: [{ x1: 3010, z1: 3352, x2: 3016, z2: 3355 }],
    },
    {
        id: 'falador-west-bank',
        name: 'Falador West bank',
        parent: 'falador',
        rects: [{ x1: 2944, z1: 3365, x2: 2950, z2: 3368 }],
    },
    { id: 'park', name: 'Falador Park', parent: 'falador', rects: [{ x1: 2993, z1: 3367, x2: 3016, z2: 3390 }] },
    {
        id: 'white-knights-castle',
        name: "White Knights' Castle",
        parent: 'falador',
        rects: [{ x1: 2949, z1: 3333, x2: 2972, z2: 3356 }],
    },
    {
        id: 'goblin-village',
        name: 'Goblin Village',
        parent: 'asgarnia',
        rects: [{ x1: 2951, z1: 3490, x2: 2974, z2: 3513 }],
    },
    {
        id: 'heros-guild',
        name: "Heroes' Guild",
        parent: 'asgarnia',
        rects: [{ x1: 2882, z1: 3489, x2: 2905, z2: 3512 }],
    },
    {
        id: 'ice-mountain',
        name: 'Ice Mountain',
        parent: 'asgarnia',
        rects: [{ x1: 2985, z1: 3463, x2: 3032, z2: 3510 }],
    },
    {
        id: 'melzars-maze',
        name: "Melzar's Maze",
        parent: 'asgarnia',
        rects: [{ x1: 2919, z1: 3236, x2: 2942, z2: 3259 }],
    },
    { id: 'monastery', name: 'Monastery', parent: 'asgarnia', rects: [{ x1: 3040, z1: 3465, x2: 3063, z2: 3488 }] },
    { id: 'port-sarim', name: 'Port Sarim', parent: 'asgarnia', rects: [{ x1: 3023, z1: 3197, x2: 3064, z2: 3244 }] },
    // Down to the shore at z 3190, where Rommik's Crafty Supplies (his spawn at (2946, 3205)) stands.
    { id: 'rimmington', name: 'Rimmington', parent: 'asgarnia', rects: [{ x1: 2945, z1: 3190, x2: 2990, z2: 3250 }] },
    {
        id: 'rimmington-mine',
        name: 'Rimmington mine',
        parent: 'rimmington',
        rects: [{ x1: 2965, z1: 3231, x2: 2990, z2: 3250 }],
    },
    { id: 'taverley', name: 'Taverley', parent: 'asgarnia', rects: [{ x1: 2888, z1: 3446, x2: 2911, z2: 3469 }] },
    {
        id: 'troll-stronghold',
        name: 'Troll Stronghold',
        parent: 'asgarnia',
        rects: [{ x1: 2823, z1: 3669, x2: 2846, z2: 3692 }],
    },
    { id: 'trollheim', name: 'Trollheim', parent: 'asgarnia', rects: [{ x1: 2880, z1: 3666, x2: 2903, z2: 3689 }] },
    {
        id: 'white-wolf-mountain',
        name: 'White Wolf Mountain',
        parent: 'asgarnia',
        rects: [{ x1: 2825, z1: 3468, x2: 2872, z2: 3515 }],
    },

    // Islands off Asgarnia. Each is smaller than the region rects around it, so it wins their tiles.
    { id: 'crandor', name: 'Crandor', rects: [{ x1: 2807, z1: 3239, x2: 2870, z2: 3302 }] },
    { id: 'entrana', name: 'Entrana', rects: [{ x1: 2818, z1: 3347, x2: 2881, z2: 3410 }] },

    // Feldip Hills, south of Kandarin: the ogres and chompy birds.
    {
        id: 'feldip-hills',
        name: 'Feldip Hills',
        rects: [
            { x1: 2373, z1: 2880, x2: 2735, z2: 3060 },
            { x1: 2340, z1: 2880, x2: 2372, z2: 3069 },
        ],
    },
    { id: 'gutanoth', name: 'Gutanoth', parent: 'feldip-hills', rects: [{ x1: 2516, z1: 3034, x2: 2539, z2: 3057 }] },

    // Kandarin, from Yanille and Castle Wars north to Rellekka; its border with Asgarnia runs at x
    // 2850/2851 (2822/2823 north of z 3467).
    {
        id: 'kandarin',
        name: 'Kandarin',
        rects: [
            { x1: 2373, z1: 3061, x2: 2735, z2: 3467 },
            { x1: 2736, z1: 3206, x2: 2850, z2: 3467 },
            { x1: 2373, z1: 3468, x2: 2822, z2: 3903 },
        ],
    },
    {
        id: 'barbarian-agility-course',
        name: 'Barbarian Outpost agility course',
        parent: 'kandarin',
        rects: [{ x1: 2527, z1: 3521, x2: 2550, z2: 3544 }],
    },
    {
        id: 'barbarian-outpost',
        name: 'Barbarian Outpost',
        parent: 'kandarin',
        rects: [{ x1: 2538, z1: 3551, x2: 2561, z2: 3574 }],
    },
    { id: 'battlefield', name: 'Battlefield', parent: 'kandarin', rects: [{ x1: 2510, z1: 3220, x2: 2533, z2: 3243 }] },
    {
        id: 'baxtorian-falls',
        name: 'Baxtorian Falls',
        parent: 'kandarin',
        rects: [{ x1: 2503, z1: 3450, x2: 2526, z2: 3473 }],
    },
    { id: 'beehives', name: 'Beehives', parent: 'kandarin', rects: [{ x1: 2755, z1: 3431, x2: 2778, z2: 3454 }] },
    {
        id: 'camelot-castle',
        name: 'Camelot Castle',
        parent: 'kandarin',
        rects: [{ x1: 2751, z1: 3493, x2: 2774, z2: 3516 }],
    },
    { id: 'castle-wars', name: 'Castle Wars', parent: 'kandarin', rects: [{ x1: 2400, z1: 3070, x2: 2450, z2: 3135 }] },
    {
        id: 'castle-wars-bank',
        name: 'Castle Wars bank chest',
        parent: 'castle-wars',
        rects: [{ x1: 2443, z1: 3082, x2: 2445, z2: 3084 }],
    },
    { id: 'catherby', name: 'Catherby', parent: 'kandarin', rects: [{ x1: 2779, z1: 3415, x2: 2832, z2: 3455 }] },
    {
        id: 'catherby-bank',
        name: 'Catherby bank',
        parent: 'catherby',
        rects: [{ x1: 2806, z1: 3441, x2: 2812, z2: 3445 }],
    },
    { id: 'coal-trucks', name: 'Coal Trucks', parent: 'kandarin', rects: [{ x1: 2588, z1: 3479, x2: 2611, z2: 3502 }] },
    {
        id: 'combat-training-camp',
        name: 'Combat Training Camp',
        parent: 'kandarin',
        rects: [{ x1: 2507, z1: 3358, x2: 2530, z2: 3381 }],
    },
    {
        id: 'east-ardougne',
        name: 'East Ardougne',
        parent: 'kandarin',
        rects: [{ x1: 2560, z1: 3255, x2: 2687, z2: 3345 }],
    },
    {
        id: 'ardougne-north-bank',
        name: 'Ardougne North bank',
        parent: 'east-ardougne',
        rects: [{ x1: 2613, z1: 3329, x2: 2620, z2: 3332 }],
    },
    {
        id: 'ardougne-south-bank',
        name: 'Ardougne South bank',
        parent: 'east-ardougne',
        rects: [{ x1: 2655, z1: 3279, x2: 2658, z2: 3287 }],
    },
    { id: 'zoo', name: 'Ardougne Zoo', parent: 'east-ardougne', rects: [{ x1: 2602, z1: 3261, x2: 2625, z2: 3284 }] },
    { id: 'fight-arena', name: 'Fight Arena', parent: 'kandarin', rects: [{ x1: 2582, z1: 3150, x2: 2605, z2: 3173 }] },
    {
        id: 'fishing-guild',
        name: 'Fishing Guild',
        parent: 'kandarin',
        rects: [{ x1: 2578, z1: 3385, x2: 2620, z2: 3430 }],
    },
    {
        id: 'fishing-guild-bank',
        name: 'Fishing Guild bank',
        parent: 'fishing-guild',
        rects: [{ x1: 2583, z1: 3417, x2: 2586, z2: 3423 }],
    },
    {
        id: 'fishing-platform',
        name: 'Fishing Platform',
        parent: 'kandarin',
        rects: [{ x1: 2763, z1: 3275, x2: 2786, z2: 3298 }],
    },
    { id: 'flax', name: 'Flax', parent: 'kandarin', rects: [{ x1: 2732, z1: 3433, x2: 2755, z2: 3456 }] },
    {
        id: 'fremennik-province',
        name: 'Fremennik Province',
        parent: 'kandarin',
        // The land south of Rellekka's palisade, the palisade line itself (z 3644-3645) and the strip
        // east of its south-east corner; the palisade's inside from x 2655 is Rellekka's (see there).
        rects: [
            { x1: 2655, z1: 3608, x2: 2702, z2: 3645 },
            { x1: 2691, z1: 3646, x2: 2702, z2: 3655 },
        ],
    },
    {
        id: 'golden-apple-tree',
        name: 'Golden Apple Tree',
        parent: 'kandarin',
        rects: [{ x1: 2753, z1: 3596, x2: 2776, z2: 3619 }],
    },
    {
        id: 'hemenster',
        name: 'Hemenster',
        parent: 'kandarin',
        rects: [
            { x1: 2624, z1: 3402, x2: 2650, z2: 3456 },
            { x1: 2651, z1: 3439, x2: 2660, z2: 3456 },
        ],
        notes: 'The Fishing Contest town west of the Ranging Guild, from the river (x 2623) to the guild fence: Morris at its gate (2643, 3440), the contest spots west of the fence at x 2642 and Grandpa Jack (2650, 3452) (quests/quest_fishingcompo). The world map label sits at the guild door.',
    },
    {
        id: 'keep-le-faye',
        name: 'Keep Le Faye',
        parent: 'kandarin',
        rects: [{ x1: 2758, z1: 3387, x2: 2781, z2: 3410 }],
    },
    {
        id: 'legends-guild',
        name: "Legends' Guild",
        parent: 'kandarin',
        rects: [{ x1: 2725, z1: 3362, x2: 2748, z2: 3385 }],
    },
    {
        id: 'legends-guild-bank',
        name: "Legends' Guild bank",
        parent: 'legends-guild',
        rects: [{ x1: 2730, z1: 3376, x2: 2734, z2: 3382, level: 2 }],
    },
    {
        id: 'lighthouse',
        name: 'Lighthouse',
        parent: 'kandarin',
        rects: [{ x1: 2502, z1: 3616, x2: 2525, z2: 3639 }],
        notes: 'Past the broken bridge (oploc1,horror_broken_bridge_left_spot, quests/quest_horror/scripts/quest_horror.rs2:63), which the player jumps, a failed jump still landing across (:102), or walks once Horror from the Deep has it mended; inside, the doorway needs Horror from the Deep done (quest_horror.rs2:3) and the stairs up are a script of their own (quest_horror.rs2:186, outside ladders+stairs/). The world index has the bridge and the stairs as scripted crossing rows (sources/gate-landings.ts), so the shop reads Horror from the Deep.',
    },
    {
        id: 'mcgrubors-wood',
        name: "McGrubor's Wood",
        parent: 'kandarin',
        rects: [{ x1: 2635, z1: 3468, x2: 2658, z2: 3491 }],
    },
    { id: 'necromancer', name: 'Necromancer', parent: 'kandarin', rects: [{ x1: 2657, z1: 3231, x2: 2680, z2: 3254 }] },
    { id: 'observatory', name: 'Observatory', parent: 'kandarin', rects: [{ x1: 2428, z1: 3139, x2: 2451, z2: 3162 }] },
    // The seed's square, refitted south and east to the town's brickwall buildings (the general store
    // at x 2653-2659, z 3149-3155, the smithy, the range houses at x 2630-2637) and the piers and
    // trawler east of them (x 2659-2685) in map squares m41_49 and m41_50. It stops short of the mine
    // to the south-west (x 2625-2641, z 3138-3153) and the trees around it, down to z 3145, which stay
    // Kandarin's.
    {
        id: 'port-khazard',
        name: 'Port Khazard',
        parent: 'kandarin',
        rects: [
            { x1: 2635, z1: 3178, x2: 2686, z2: 3212 },
            { x1: 2630, z1: 3156, x2: 2686, z2: 3177 },
            { x1: 2642, z1: 3146, x2: 2686, z2: 3155 },
        ],
    },
    {
        id: 'ranging-guild',
        name: 'Ranging Guild',
        parent: 'kandarin',
        rects: diamond(2668, 3428, 17),
        notes: "The grounds inside the guild's wooden barricade (wood_wall_barricadel in map square m41_53), a diamond whose inside is |x - 2668| + |z - 3428| <= 17 with a watchtower at each tip. The guild door (2658, 3438) is in its north-west side and needs 40 Ranged (minigames/game_ranging/scripts/ranging_guild_door.rs2).",
    },
    // The town inside its palisade (the viking_pike_defence locs), which runs from x 2604 along
    // z 3644-3655 on the south and up x 2688-2692 on the east; rockslides bound the west, and the north
    // stops at z 3712, below the rocky ground where the rock crabs lie. The seed's square missed the
    // market and its shops (x 2625-2647); its east edge, x 2695, is kept. East of x 2654 the palisade
    // runs along z 3644-3645 (the gate gap at x 2659-2665 between its terminator locs) and turns north
    // through (2687, 3646), (2691, 3648) and (2690, 3655), so the town takes z 3646-3655 up to x 2690
    // there (Lensa, Pontak and Sigli stand in it) and Fremennik Province keeps the land outside.
    {
        id: 'rellekka',
        name: 'Rellekka',
        parent: 'kandarin',
        rects: [
            { x1: 2604, z1: 3656, x2: 2695, z2: 3712 },
            { x1: 2604, z1: 3645, x2: 2654, z2: 3655 },
            { x1: 2655, z1: 3646, x2: 2690, z2: 3655 },
        ],
    },
    {
        id: 'seers-village',
        name: "Seers' Village",
        parent: 'kandarin',
        rects: [{ x1: 2690, z1: 3460, x2: 2745, z2: 3512 }],
    },
    {
        id: 'seers-village-bank',
        name: "Seers' Village bank",
        parent: 'seers-village',
        rects: [{ x1: 2720, z1: 3493, x2: 2730, z2: 3497 }],
    },
    {
        id: 'sinclair-mansion',
        name: 'Sinclair Mansion',
        parent: 'kandarin',
        rects: [{ x1: 2727, z1: 3539, x2: 2750, z2: 3562 }],
    },
    {
        id: 'sorcerers-tower',
        name: "Sorcerer's Tower",
        parent: 'kandarin',
        rects: [{ x1: 2706, z1: 3403, x2: 2729, z2: 3426 }],
    },
    {
        id: 'tree-gnome-stronghold',
        name: 'Tree Gnome Stronghold',
        parent: 'kandarin',
        rects: [{ x1: 2378, z1: 3380, x2: 2500, z2: 3528 }],
        notes: "The entrance gate (oploc1,gnome_areagate, areas/area_gnome/scripts/gnome_gate.rs2:2) lets a settled account through by a scripted forcemove, either way (:57, :59), while the collision data has it shut; gates.ts has it a temporary block, so the world index crosses it by scripted crossing rows (sources/gate-landings.ts), as it does the Grand Tree's doors (oploc1,treedoorl and treedoorr, gnome_gate.rs2:63), which move the player by script too.",
    },
    {
        id: 'gnome-agility-course',
        name: 'Gnome Stronghold agility course',
        parent: 'tree-gnome-stronghold',
        rects: [{ x1: 2469, z1: 3414, x2: 2492, z2: 3437 }],
    },
    {
        id: 'gnome-ball-field',
        name: 'Gnome Ball Field',
        parent: 'tree-gnome-stronghold',
        rects: [{ x1: 2389, z1: 3475, x2: 2412, z2: 3498 }],
    },
    {
        id: 'gnome-stronghold-bank',
        name: 'Gnome Stronghold south bank',
        parent: 'tree-gnome-stronghold',
        rects: [{ x1: 2442, z1: 3422, x2: 2449, z2: 3428, level: 1 }],
    },
    {
        id: 'grand-tree',
        name: 'Grand Tree',
        parent: 'tree-gnome-stronghold',
        rects: [{ x1: 2457, z1: 3492, x2: 2480, z2: 3515 }],
    },
    {
        id: 'grand-tree-bank',
        name: 'Grand Tree bank',
        parent: 'tree-gnome-stronghold',
        // Two booth rows, each a rect: the gnomes between them are the stronghold's.
        rects: [
            { x1: 2438, z1: 3486, x2: 2442, z2: 3490, level: 1 },
            { x1: 2447, z1: 3479, x2: 2451, z2: 3482, level: 1 },
        ],
    },
    {
        id: 'swamp',
        name: 'Swamp',
        parent: 'tree-gnome-stronghold',
        rects: [{ x1: 2407, z1: 3501, x2: 2430, z2: 3524 }],
    },
    {
        id: 'tree-gnome-village',
        name: 'Tree Gnome Village',
        parent: 'kandarin',
        // Down to z 3158 and out to x 2514 and 2547: the village's walled ground, with the general store
        // upstairs at (2527, 3161).
        rects: [{ x1: 2514, z1: 3158, x2: 2547, z2: 3185 }],
        notes: 'Entered through the loose railing (oploc1,treegnomelooserailing, areas/area_gnome/scripts/gnomevillage_fence.rs2:1), a squeeze with no condition, one tile either way; the world index has it as a scripted crossing row (sources/gate-landings.ts).',
    },
    {
        id: 'underground-pass-entrance',
        name: 'Underground Pass entrance',
        parent: 'kandarin',
        rects: [{ x1: 2431, z1: 3303, x2: 2454, z2: 3326 }],
        notes: 'The world map\'s "Underground Pass" label; the pass itself is the underground area underground-pass.',
    },
    {
        id: 'west-ardougne',
        name: 'West Ardougne',
        parent: 'kandarin',
        rects: [{ x1: 2500, z1: 3284, x2: 2547, z2: 3331 }],
    },
    { id: 'yanille', name: 'Yanille', parent: 'kandarin', rects: [{ x1: 2525, z1: 3061, x2: 2622, z2: 3114 }] },
    {
        id: 'wizards-guild',
        name: "Wizards' Guild",
        parent: 'yanille',
        rects: [{ x1: 2577, z1: 3065, x2: 2600, z2: 3088 }],
    },
    {
        id: 'yanille-bank',
        name: 'Yanille bank',
        parent: 'yanille',
        rects: [{ x1: 2613, z1: 3090, x2: 2616, z2: 3095 }],
    },

    // Karamja, with the shipyard on its south-east coast, and the Monkey Madness islands south of it.
    // Its north coast reaches z ~3205 by Brimhaven but only z ~3180 at Musa Point (x 2925); east of
    // x 2931, z 3190-3205 is sea and then the mainland shore below Rimmington (the collision data's
    // coastline runs from (2924, 3206) to (2966, 3190)), which is Asgarnia's.
    {
        id: 'karamja',
        name: 'Karamja',
        rects: [
            { x1: 2736, z1: 2880, x2: 2967, z2: 3189 },
            { x1: 2736, z1: 3190, x2: 2931, z2: 3205 },
            { x1: 2968, z1: 2880, x2: 3017, z2: 3089 },
        ],
    },
    {
        id: 'agility-arena',
        name: 'Agility Arena',
        parent: 'karamja',
        rects: [{ x1: 2803, z1: 3181, x2: 2826, z2: 3204 }],
    },
    { id: 'brimhaven', name: 'Brimhaven', parent: 'karamja', rects: [{ x1: 2755, z1: 3150, x2: 2802, z2: 3197 }] },
    { id: 'cairn-isle', name: 'Cairn Isle', parent: 'karamja', rects: [{ x1: 2752, z1: 2967, x2: 2775, z2: 2990 }] },
    {
        id: 'kharazi-jungle',
        name: 'Kharazi Jungle',
        parent: 'karamja',
        rects: [{ x1: 2832, z1: 2911, x2: 2855, z2: 2934 }],
    },
    {
        id: 'shilo-village',
        name: 'Shilo Village',
        parent: 'karamja',
        rects: [{ x1: 2825, z1: 2945, x2: 2872, z2: 3009 }],
    },
    {
        id: 'shilo-village-bank',
        name: 'Shilo Village bank',
        parent: 'shilo-village',
        rects: [{ x1: 2850, z1: 2953, x2: 2854, z2: 2956 }],
    },
    { id: 'ship-yard', name: 'Ship Yard', parent: 'karamja', rects: [{ x1: 2978, z1: 3043, x2: 3001, z2: 3066 }] },
    {
        id: 'tai-bwo-wannai',
        name: 'Tai Bwo Wannai',
        parent: 'karamja',
        rects: [{ x1: 2782, z1: 3054, x2: 2805, z2: 3077 }],
    },
    {
        id: 'ape-atoll',
        name: 'Ape Atoll',
        rects: [{ x1: 2688, z1: 2688, x2: 2815, z2: 2815 }],
        notes: "Marim and the Monkey Madness jungle (quests/quest_mm npcs). Reached by Monkey Madness's rides, which teleport from npc dialogue rather than a sail proc (gates.ts CURATED_CROSSINGS): Daero's blindfold to the glider hangar for a player past the quest's training (quests/quest_mm/scripts/mm_daero.rs2:235), Waydar's glider to Crash Island (mm_waydar.rs2:116), then Lumdo's boat (mm_lumdo.rs2:24).",
    },
    {
        id: 'crash-island',
        name: 'Crash Island',
        rects: [{ x1: 2880, z1: 2688, x2: 2943, z2: 2751 }],
        notes: 'Lumdo and Waydar (quests/quest_mm npcs).',
    },

    // Misthalin, east of Asgarnia and north of the Lumbridge Swamp; Al Kharid is in the Kharidian Desert
    // (the river, then the fence at x 3268).
    {
        id: 'misthalin',
        name: 'Misthalin',
        rects: [
            { x1: 3065, z1: 3136, x2: 3263, z2: 3519 },
            { x1: 3264, z1: 3220, x2: 3267, z2: 3330 },
            { x1: 3264, z1: 3331, x2: 3391, z2: 3519 },
        ],
    },
    {
        id: 'barbarian-village',
        name: 'Barbarian Village',
        parent: 'misthalin',
        rects: [{ x1: 3065, z1: 3395, x2: 3112, z2: 3450 }],
    },
    {
        id: 'barbarian-village-fishing',
        name: 'Barbarian Village fishing',
        parent: 'barbarian-village',
        rects: [{ x1: 3100, z1: 3420, x2: 3112, z2: 3438 }],
    },
    {
        id: 'champions-guild',
        name: "Champions' Guild",
        parent: 'misthalin',
        rects: [{ x1: 3189, z1: 3342, x2: 3212, z2: 3365 }],
    },
    {
        id: 'cooks-guild',
        name: "Cooks' Guild",
        parent: 'misthalin',
        rects: [{ x1: 3125, z1: 3425, x2: 3148, z2: 3448 }],
    },
    { id: 'dig-site', name: 'Dig Site', parent: 'misthalin', rects: [{ x1: 3353, z1: 3407, x2: 3376, z2: 3430 }] },
    {
        id: 'draynor-manor',
        name: 'Draynor Manor',
        parent: 'misthalin',
        rects: [{ x1: 3084, z1: 3321, x2: 3131, z2: 3368 }],
    },
    {
        id: 'draynor-village',
        name: 'Draynor Village',
        parent: 'misthalin',
        rects: [{ x1: 3075, z1: 3220, x2: 3143, z2: 3290 }],
    },
    {
        id: 'draynor-bank',
        name: 'Draynor bank',
        parent: 'draynor-village',
        rects: [{ x1: 3087, z1: 3241, x2: 3092, z2: 3246 }],
    },
    {
        id: 'draynor-fishing',
        name: 'Draynor fishing',
        parent: 'draynor-village',
        rects: [{ x1: 3083, z1: 3224, x2: 3086, z2: 3231 }],
    },
    {
        id: 'draynor-market',
        name: 'Draynor Market',
        parent: 'draynor-village',
        rects: [{ x1: 3078, z1: 3240, x2: 3101, z2: 3263 }],
    },
    {
        id: 'draynor-willows',
        name: 'Draynor willows',
        parent: 'draynor-village',
        rects: [{ x1: 3080, z1: 3225, x2: 3090, z2: 3239 }],
    },
    {
        id: 'jail',
        name: 'Draynor jail',
        parent: 'draynor-village',
        rects: [{ x1: 3114, z1: 3232, x2: 3137, z2: 3255 }],
    },
    { id: 'edgeville', name: 'Edgeville', parent: 'misthalin', rects: [{ x1: 3074, z1: 3464, x2: 3121, z2: 3511 }] },
    {
        id: 'edgeville-bank',
        name: 'Edgeville bank',
        parent: 'edgeville',
        rects: [{ x1: 3094, z1: 3488, x2: 3099, z2: 3494 }],
    },
    {
        id: 'exam-centre',
        name: 'Exam Centre',
        parent: 'misthalin',
        rects: [{ x1: 3349, z1: 3333, x2: 3372, z2: 3356 }],
    },
    {
        id: 'lumber-yard',
        name: 'Lumber Yard',
        parent: 'misthalin',
        rects: [{ x1: 3296, z1: 3495, x2: 3319, z2: 3518 }],
    },
    { id: 'lumbridge', name: 'Lumbridge', parent: 'misthalin', rects: [{ x1: 3168, z1: 3200, x2: 3262, z2: 3260 }] },
    {
        id: 'lumbridge-trees',
        name: 'Lumbridge trees',
        parent: 'lumbridge',
        rects: [{ x1: 3168, z1: 3206, x2: 3204, z2: 3245 }],
    },
    {
        id: 'lumbridge-swamp',
        name: 'Lumbridge Swamp',
        parent: 'misthalin',
        rects: [{ x1: 3136, z1: 3136, x2: 3263, z2: 3199 }],
    },
    {
        id: 'lumbridge-swamp-mine',
        name: 'Lumbridge Swamp mine',
        parent: 'lumbridge-swamp',
        rects: [{ x1: 3229, z1: 3153, x2: 3247, z2: 3171 }],
    },
    { id: 'river-lum', name: 'River Lum', parent: 'misthalin', rects: [{ x1: 3155, z1: 3338, x2: 3178, z2: 3361 }] },
    { id: 'varrock', name: 'Varrock', parent: 'misthalin', rects: [{ x1: 3172, z1: 3378, x2: 3295, z2: 3505 }] },
    { id: 'palace', name: 'Varrock Palace', parent: 'varrock', rects: [{ x1: 3201, z1: 3471, x2: 3224, z2: 3494 }] },
    {
        id: 'varrock-east-bank',
        name: 'Varrock East bank',
        parent: 'varrock',
        rects: [{ x1: 3251, z1: 3416, x2: 3257, z2: 3420 }],
    },
    {
        id: 'varrock-oaks',
        name: 'Varrock oaks',
        parent: 'varrock',
        rects: [{ x1: 3186, z1: 3454, x2: 3197, z2: 3465 }],
    },
    {
        id: 'varrock-west-bank',
        name: 'Varrock West bank',
        parent: 'varrock',
        rects: [{ x1: 3185, z1: 3435, x2: 3188, z2: 3447, level: 0 }],
    },
    {
        id: 'varrock-east-mine',
        name: 'Varrock East mine',
        parent: 'misthalin',
        rects: [{ x1: 3278, z1: 3356, x2: 3294, z2: 3374 }],
        notes: 'Called "SE Varrock mine" in learnings/mining.md and wiki/skills/mining.md.',
    },
    {
        id: 'varrock-west-mine',
        name: 'Varrock West mine',
        parent: 'misthalin',
        rects: [{ x1: 3168, z1: 3360, x2: 3188, z2: 3377 }],
    },
    {
        id: 'wizards-tower',
        name: "Wizards' Tower",
        parent: 'misthalin',
        rects: [{ x1: 3100, z1: 3141, x2: 3123, z2: 3164 }],
    },

    // The Kharidian Desert: Al Kharid and everything south and east of the Lumbridge river and the Al
    // Kharid fence.
    {
        id: 'kharidian-desert',
        name: 'Kharidian Desert',
        rects: [
            { x1: 3150, z1: 2880, x2: 3391, z2: 3135 },
            { x1: 3264, z1: 3136, x2: 3391, z2: 3219 },
            { x1: 3268, z1: 3220, x2: 3391, z2: 3330 },
        ],
    },
    {
        id: 'al-kharid',
        name: 'Al Kharid',
        parent: 'kharidian-desert',
        rects: [
            { x1: 3264, z1: 3138, x2: 3327, z2: 3219 },
            { x1: 3268, z1: 3220, x2: 3327, z2: 3230 },
        ],
    },
    {
        id: 'al-kharid-bank',
        name: 'Al Kharid bank',
        parent: 'al-kharid',
        rects: [{ x1: 3266, z1: 3163, x2: 3269, z2: 3170 }],
    },
    {
        id: 'al-kharid-river',
        name: 'Al Kharid river',
        parent: 'al-kharid',
        rects: [{ x1: 3264, z1: 3138, x2: 3280, z2: 3152 }],
        notes: 'Fishing spots on the river south of the bank.',
    },
    {
        id: 'al-kharid-mine',
        name: 'Al Kharid mine',
        parent: 'kharidian-desert',
        rects: [{ x1: 3290, z1: 3280, x2: 3310, z2: 3322 }],
    },
    {
        id: 'bedabin-camp',
        name: 'Bedabin Camp',
        parent: 'kharidian-desert',
        rects: [{ x1: 3158, z1: 3026, x2: 3181, z2: 3049 }],
    },
    {
        id: 'desert-mining-camp',
        name: 'Desert Mining Camp',
        parent: 'kharidian-desert',
        rects: [{ x1: 3279, z1: 3010, x2: 3302, z2: 3033 }],
    },
    {
        id: 'duel-arena',
        name: 'Duel Arena',
        parent: 'kharidian-desert',
        rects: [{ x1: 3328, z1: 3195, x2: 3391, z2: 3290 }],
    },
    {
        id: 'duel-arena-bank',
        name: 'Duel Arena bank',
        parent: 'duel-arena',
        rects: [{ x1: 3380, z1: 3268, x2: 3384, z2: 3271 }],
        notes: 'Fadli, and the two closed bank chests beside him that open into bank chests (minigames/game_duelarena/scripts/misc_locs.rs2).',
    },
    {
        id: 'shantay-pass',
        name: 'Shantay Pass',
        parent: 'kharidian-desert',
        rects: [{ x1: 3292, z1: 3105, x2: 3315, z2: 3137 }],
    },
    {
        id: 'shantay-pass-bank-chest',
        name: 'Shantay Pass bank chest',
        parent: 'shantay-pass',
        rects: [{ x1: 3308, z1: 3119, x2: 3310, z2: 3121 }],
        notes: 'Members only; opens the bank (areas/area_alkharid/scripts/shantay_chest.rs2).',
    },
    {
        id: 'toll-gate',
        name: 'Toll gate',
        parent: 'kharidian-desert',
        rects: [{ x1: 3268, z1: 3215, x2: 3289, z2: 3238 }],
    },

    // Morytania, east of the River Salve.
    { id: 'morytania', name: 'Morytania', rects: [{ x1: 3392, z1: 3136, x2: 3711, z2: 3583 }] },
    { id: 'canifis', name: 'Canifis', parent: 'morytania', rects: [{ x1: 3467, z1: 3463, x2: 3520, z2: 3510 }] },
    {
        id: 'canifis-bank',
        name: 'Canifis bank',
        parent: 'canifis',
        rects: [{ x1: 3512, z1: 3478, x2: 3515, z2: 3483 }],
    },
    {
        id: 'haunted-woods',
        name: 'Haunted Woods',
        parent: 'morytania',
        rects: [{ x1: 3555, z1: 3476, x2: 3578, z2: 3499 }],
    },
    {
        id: 'mort-myre-swamp',
        name: 'Mort Myre Swamp',
        parent: 'morytania',
        rects: [{ x1: 3415, z1: 3359, x2: 3462, z2: 3406 }],
    },
    { id: 'mortton', name: "Mort'ton", parent: 'morytania', rects: [{ x1: 3467, z1: 3257, x2: 3514, z2: 3304 }] },
    {
        id: 'river-salve',
        name: 'River Salve',
        parent: 'morytania',
        rects: [{ x1: 3398, z1: 3426, x2: 3421, z2: 3449 }],
    },
    { id: 'temple', name: 'Temple', parent: 'morytania', rects: [{ x1: 3409, z1: 3477, x2: 3432, z2: 3500 }] },
    {
        id: 'the-hollows',
        name: 'The Hollows',
        parent: 'morytania',
        rects: [{ x1: 3488, z1: 3372, x2: 3511, z2: 3395 }],
    },

    // Tirannwn, the elf lands west of the Arandar mountains.
    {
        id: 'tirannwn',
        name: 'Tirannwn',
        rects: [{ x1: 2152, z1: 3070, x2: 2372, z2: 3519 }],
        notes: "The world index's walk from the Lumbridge spawn reaches Isafdar through Regicide's forest crossings (oploc1,_regicide_cross_over, quests/quest_regicide/scripts/quest_regicide.rs2:389), and the Tyras camp's general store at (2194, 3140) over the woodspring trap at (2200, 3169) (oploc1,regicide_trap_woodspring, quest_regicide.rs2:31, an agility roll with no condition: a scripted crossing row). The crossing at the camp's west edge, regicide_cross_over3 at (2173, 3156), has no landing on walkable land (the build report's gate rows with no landing).",
    },
    { id: 'arandar', name: 'Arandar', parent: 'tirannwn', rects: [{ x1: 2316, z1: 3272, x2: 2363, z2: 3319 }] },
    { id: 'elf-camp', name: 'Elf Camp', parent: 'tirannwn', rects: [{ x1: 2184, z1: 3244, x2: 2207, z2: 3267 }] },
    { id: 'isafdar', name: 'Isafdar', parent: 'tirannwn', rects: [{ x1: 2219, z1: 3162, x2: 2266, z2: 3209 }] },
    {
        id: 'poison-waste',
        name: 'Poison Waste',
        parent: 'tirannwn',
        rects: [{ x1: 2229, z1: 3086, x2: 2252, z2: 3109 }],
    },
    { id: 'prifddinas', name: 'Prifddinas', parent: 'tirannwn', rects: [{ x1: 2213, z1: 3285, x2: 2260, z2: 3332 }] },
    { id: 'tyras-camp', name: 'Tyras Camp', parent: 'tirannwn', rects: [{ x1: 2168, z1: 3135, x2: 2191, z2: 3158 }] },

    // The Wilderness on the surface: the first box of wilderness_zones.dbrow (sources/zones.ts), cut at
    // the map's north edge.
    { id: 'wilderness', name: 'Wilderness', rects: [{ x1: 2944, z1: 3520, x2: 3391, z2: 3967 }] },
    {
        id: 'bandit-camp',
        name: 'Bandit Camp',
        parent: 'wilderness',
        rects: [{ x1: 3024, z1: 3677, x2: 3047, z2: 3700 }],
    },
    { id: 'bone-yard', name: 'Bone Yard', parent: 'wilderness', rects: [{ x1: 3234, z1: 3734, x2: 3257, z2: 3757 }] },
    {
        id: 'chaos-temple',
        name: 'Chaos Temple',
        parent: 'wilderness',
        rects: [{ x1: 3226, z1: 3598, x2: 3249, z2: 3621 }],
    },
    {
        id: 'dark-knight-fortress',
        name: "Dark Knights' Fortress",
        parent: 'wilderness',
        rects: [{ x1: 3018, z1: 3621, x2: 3041, z2: 3644 }],
    },
    {
        id: 'demonic-ruins',
        name: 'Demonic Ruins',
        parent: 'wilderness',
        rects: [{ x1: 3281, z1: 3872, x2: 3304, z2: 3895 }],
    },
    {
        id: 'deserted-keep',
        name: 'Deserted Keep',
        parent: 'wilderness',
        rects: [{ x1: 3144, z1: 3925, x2: 3167, z2: 3948 }],
    },
    {
        id: 'frozen-waste-plateau',
        name: 'Frozen Waste Plateau',
        parent: 'wilderness',
        rects: [{ x1: 2960, z1: 3907, x2: 2983, z2: 3930 }],
    },
    {
        id: 'graveyard-of-shadows',
        name: 'Graveyard of Shadows',
        parent: 'wilderness',
        rects: [{ x1: 3155, z1: 3661, x2: 3178, z2: 3684 }],
    },
    { id: 'lava-maze', name: 'Lava Maze', parent: 'wilderness', rects: [{ x1: 3067, z1: 3836, x2: 3090, z2: 3859 }] },
    { id: 'mage-arena', name: 'Mage Arena', parent: 'wilderness', rects: [{ x1: 3095, z1: 3921, x2: 3118, z2: 3944 }] },
    {
        id: 'pirates-hideout',
        name: "Pirates' Hideout",
        parent: 'wilderness',
        rects: [{ x1: 3031, z1: 3936, x2: 3054, z2: 3959 }],
    },
    {
        id: 'red-dragon-isle',
        name: 'Red Dragon Isle',
        parent: 'wilderness',
        rects: [{ x1: 3187, z1: 3812, x2: 3210, z2: 3835 }],
    },
    {
        id: 'rogues-castle',
        name: "Rogues' Castle",
        parent: 'wilderness',
        rects: [{ x1: 3274, z1: 3919, x2: 3297, z2: 3942 }],
    },
    { id: 'ruins', name: 'Ruins', parent: 'wilderness', rects: [{ x1: 2954, z1: 3685, x2: 2977, z2: 3708 }] },
    { id: 'ruins-2', name: 'Ruins', parent: 'wilderness', rects: [{ x1: 3152, z1: 3723, x2: 3175, z2: 3746 }] },
    {
        id: 'scorpion-pit',
        name: 'Scorpion Pit',
        parent: 'wilderness',
        rects: [{ x1: 3224, z1: 3933, x2: 3247, z2: 3956 }],
    },
    {
        id: 'the-forgotten-cemetery',
        name: 'The Forgotten Cemetery',
        parent: 'wilderness',
        rects: [{ x1: 2965, z1: 3741, x2: 2988, z2: 3764 }],
    },
    {
        id: 'wilderness-agility-course',
        name: 'Wilderness agility course',
        parent: 'wilderness',
        rects: [{ x1: 2993, z1: 3938, x2: 3016, z2: 3961 }],
    },

    // Smaller lands on the surface.
    {
        id: 'miscellania',
        name: 'Miscellania and Etceteria',
        rects: [{ x1: 2490, z1: 3835, x2: 2630, z2: 3910 }],
        notes: "The two islands of areas/area_miscellania. Reached by the longship from Rellekka once The Fremennik Trials is done (gates.ts CURATED_TRANSPORTS: its own sail proc, areas/area_miscellania/scripts/misc_sailor.rs2:13, which the sail scripts don't give).",
    },
    {
        id: 'miscellania-bank',
        name: 'Miscellania bank',
        parent: 'miscellania',
        rects: [{ x1: 2620, z1: 3894, x2: 2622, z2: 3896 }],
    },
    {
        id: 'tutorial-island',
        name: 'Tutorial Island',
        rects: [{ x1: 3053, z1: 3053, x2: 3149, z2: 3135 }],
        notes: "For new accounts only, so the world index's walk from the Lumbridge spawn never reaches the island, its bank or its caves (EXPECTED_UNREACHED in areas.ts says why).",
    },
    {
        id: 'tutorial-island-bank',
        name: 'Tutorial Island bank',
        parent: 'tutorial-island',
        rects: [{ x1: 3119, z1: 3123, x2: 3123, z2: 3126 }],
    },

    // Instanced planes north of the surface (z 4400-5000, level 0), each a map square or two that scripts
    // teleport into: the runecrafting altars, the essence mine, quest and minigame areas.
    {
        id: 'air-altar',
        name: 'Air altar',
        rects: [{ x1: 2816, z1: 4800, x2: 2879, z2: 4863 }],
        notes: 'Inside the air ruins.',
    },
    {
        id: 'mind-altar',
        name: 'Mind altar',
        rects: [{ x1: 2752, z1: 4800, x2: 2815, z2: 4863 }],
        notes: 'Inside the mind ruins.',
    },
    {
        id: 'water-altar',
        name: 'Water altar',
        rects: [{ x1: 2688, z1: 4800, x2: 2751, z2: 4863 }],
        notes: 'Inside the water ruins.',
    },
    {
        id: 'earth-altar',
        name: 'Earth altar',
        rects: [{ x1: 2624, z1: 4800, x2: 2687, z2: 4863 }],
        notes: 'Inside the earth ruins.',
    },
    {
        id: 'fire-altar',
        name: 'Fire altar',
        rects: [{ x1: 2560, z1: 4800, x2: 2623, z2: 4863 }],
        notes: 'Inside the fire ruins.',
    },
    {
        id: 'body-altar',
        name: 'Body altar',
        rects: [{ x1: 2496, z1: 4800, x2: 2559, z2: 4863 }],
        notes: 'Inside the body ruins.',
    },
    {
        id: 'law-altar',
        name: 'Law altar',
        rects: [{ x1: 2432, z1: 4800, x2: 2495, z2: 4863 }],
        notes: 'Inside the law ruins.',
    },
    {
        id: 'nature-altar',
        name: 'Nature altar',
        rects: [{ x1: 2368, z1: 4800, x2: 2431, z2: 4863 }],
        notes: 'Inside the nature ruins.',
    },
    {
        id: 'chaos-altar',
        name: 'Chaos altar',
        rects: [{ x1: 2240, z1: 4800, x2: 2303, z2: 4863 }],
        notes: 'Inside the chaos ruins.',
    },
    {
        id: 'death-altar',
        name: 'Death altar',
        rects: [{ x1: 2176, z1: 4800, x2: 2239, z2: 4863 }],
        notes: 'Inside the death ruins.',
    },
    {
        id: 'cosmic-altar',
        name: 'Cosmic altar',
        rects: [{ x1: 2112, z1: 4800, x2: 2175, z2: 4863 }],
        notes: 'Inside the cosmic ruins, which are in Zanaris.',
    },
    { id: 'rune-essence-mine', name: 'Rune essence mine', rects: [{ x1: 2880, z1: 4800, x2: 2943, z2: 4863 }] },
    {
        id: 'burthorpe-games-room',
        name: 'Burthorpe Games Room',
        rects: [{ x1: 2176, z1: 4928, x2: 2239, z2: 4991 }],
        notes: "minigames/game_gamesroom. Entered by the stairs in Burthorpe (board_game_stairs_grey_all at (2899, 3566), ladders+stairs/scripts/stairs.rs2:485), which land on one of six tiles at random (stairs.rs2:491), so sources/connectors.ts derives no landing: gates.ts CURATED_CROSSINGS has the stairs each way. The barmaid is traded with from up to 3 tiles off, across her bar (minigames/game_gamesroom/general/scripts/boardgames_barmaid.rs2:12), so the shop's stand is in front of it.",
    },
    {
        id: 'fisher-realm',
        name: 'Fisher Realm',
        rects: [
            { x1: 2624, z1: 4672, x2: 2687, z2: 4735 },
            { x1: 2752, z1: 4672, x2: 2815, z2: 4735 },
        ],
        notes: 'Holy Grail (quests/quest_grail): the restored realm with King Percival (m41_73) and the blighted one with the Fisher King (m43_73).',
    },
    {
        id: 'haunted-mine',
        name: 'Haunted Mine',
        rects: [
            { x1: 2688, z1: 4416, x2: 2815, z2: 4479 },
            { x1: 2688, z1: 4480, x2: 2751, z2: 4543 },
            { x1: 2752, z1: 4544, x2: 2815, z2: 4607 },
        ],
        notes: 'Haunted Mine quest (quests/quest_hauntedmine).',
    },
    {
        id: 'horror-from-the-deep',
        name: 'Horror from the Deep area',
        rects: [{ x1: 2432, z1: 4544, x2: 2495, z2: 4607 }],
        notes: 'quests/quest_horror npcs; descriptive name, not settled from the data.',
    },
    {
        id: 'legends-quest-cavern',
        name: "Legends' Quest cavern",
        rects: [{ x1: 2368, z1: 4672, x2: 2431, z2: 4735 }],
        notes: "Legends' Quest npcs (quests/quest_legends).",
    },
    {
        id: 'mage-arena-chamber',
        name: 'Mage Arena chamber',
        rects: [{ x1: 2496, z1: 4672, x2: 2559, z2: 4735 }],
        notes: "Below the Mage Arena; areas/area_mage_arena/scripts/chamber.rs2 places the god capes here. Its cellar, with the bank and the rune shop, is the landing of the ladder in the Mage Arena house at (3091, 3957) (oploc1,magearena_ladder_to_cellar, areas/area_mage_arena/scripts/mage_arena.rs2:1, the move at :6), with no condition: a scripted crossing row in the world index, outside ladders+stairs/. The god statues and the staff shop beyond are the sparkling pool's (oploc1,magearena_waterportal1 at (2541, 4719), mage_arena.rs2:15) once the Mage Arena miniquest is done (:59), a gate row in gates.ts.",
    },
    {
        id: 'mage-arena-bank',
        name: 'Mage Arena bank',
        parent: 'mage-arena-chamber',
        rects: [{ x1: 2533, z1: 4713, x2: 2535, z2: 4715 }],
        notes: 'Gundai.',
    },
    {
        id: 'regicide-camp',
        name: 'Regicide camp',
        rects: [{ x1: 2304, z1: 4544, x2: 2367, z2: 4607 }],
        notes: 'quests/quest_regicide/scripts/quest_regicide.rs2:542 teleports here; descriptive name.',
    },
    {
        id: 'tai-bwo-wannai-trio-area',
        name: 'Tai Bwo Wannai Trio area',
        rects: [{ x1: 2496, z1: 4544, x2: 2559, z2: 4607 }],
        notes: 'quests/quest_tbwt npcs and the karambwan spots; descriptive name.',
    },
    {
        id: 'watchtower-quest-area',
        name: 'Watchtower quest area',
        rects: [{ x1: 2880, z1: 4672, x2: 2943, z2: 4735 }],
        notes: 'A walled village with Yanille soldiers, the Dragon Inn bartender and the watchtower wizards; descriptive name, not settled from the data.',
    },

    // Underground, on level 0 at the surface x and z + 6400 (learnings/walking.md). Notes name the way in
    // where the data shows it.
    {
        id: 'ardougne-sewers',
        name: 'Ardougne Sewers',
        rects: [{ x1: 2560, z1: 9664, x2: 2687, z2: 9727 }],
        notes: 'Ladder up to East Ardougne at (2632, 3294) and to (2570, 3267); the Hazeel Cult npcs are in its west part.',
    },
    {
        id: 'asgarnian-ice-dungeon',
        name: 'Asgarnian Ice Dungeon',
        rects: [{ x1: 2984, z1: 9536, x2: 3071, z2: 9599 }],
        notes: 'Ladder up to Mudskipper Point at (3008, 3150).',
    },
    {
        id: 'brimhaven-dungeon',
        name: 'Brimhaven Dungeon',
        rects: [{ x1: 2624, z1: 9408, x2: 2767, z2: 9599 }],
        notes: "Through Saniboch's door near Brimhaven for 875 coins (areas/area_karamja/scripts/karam_dungeon.rs2).",
    },
    {
        id: 'clock-tower-dungeon',
        name: 'Clock Tower dungeon',
        rects: [{ x1: 2560, z1: 9600, x2: 2623, z2: 9663 }],
        notes: 'Ladders up to the Clock Tower south of Ardougne, (2566-2575, 3222-3255).',
    },
    {
        id: 'desert-mining-camp-mine',
        name: 'Desert Mining Camp mine',
        rects: [{ x1: 3264, z1: 9408, x2: 3327, z2: 9471 }],
        notes: 'Tourist Trap (quests/quest_desertrescue), below the Desert Mining Camp.',
    },
    {
        id: 'dig-site-dungeon',
        name: 'Dig Site dungeon',
        rects: [{ x1: 3328, z1: 9728, x2: 3391, z2: 9855 }],
        notes: 'The Dig Site quest (quests/quest_itexam).',
    },
    {
        id: 'dungeon-north-of-ardougne',
        name: 'Dungeon north of Ardougne',
        rects: [{ x1: 2560, z1: 9728, x2: 2623, z2: 9791 }],
        notes: 'Ladder up to a cellar at (2562, 3356); ogres and a blood-rune thieving chest. Descriptive name, not settled from the data.',
    },
    {
        id: 'dungeon-below-2556-3444',
        name: 'Dungeon below (2556, 3444)',
        rects: [{ x1: 2496, z1: 9792, x2: 2559, z2: 9855 }],
        notes: 'Ladder up at (2556, 3444); moss giants, skeletons and zombies. Descriptive name, not settled from the data.',
    },
    {
        id: 'dwarven-mine',
        name: 'Dwarven Mine',
        rects: [{ x1: 2944, z1: 9728, x2: 3071, z2: 9855 }],
        notes: 'Staircase up east of Falador at (3059, 3376) (learnings/walking.md); its other way out is on Ice Mountain (dwarven-mine-entrance).',
    },
    {
        id: 'mining-guild',
        name: 'Mining Guild',
        parent: 'dwarven-mine',
        rects: [{ x1: 3014, z1: 9728, x2: 3058, z2: 9756 }],
        notes: 'Mining 60 for its ladder and its door at (3046, 9756) (areas/area_falador/scripts/mining_guild.rs2).',
    },
    {
        id: 'edgeville-dungeon',
        name: 'Edgeville Dungeon',
        rects: [{ x1: 3072, z1: 9824, x2: 3151, z2: 10047 }],
        notes: 'Ladder up to Edgeville at (3096, 3467); its part at z >= 9920 is Wilderness (sources/zones.ts).',
    },
    {
        id: 'goblin-cave',
        name: 'Goblin cave',
        rects: [{ x1: 2560, z1: 9792, x2: 2623, z2: 9855 }],
        notes: 'Goblins; descriptive name, not settled from the data.',
    },
    {
        id: 'grand-tree-tunnels',
        name: 'Grand Tree tunnels',
        rects: [{ x1: 2432, z1: 9856, x2: 2495, z2: 9919 }],
        notes: 'Ladder up into the Grand Tree at (2463, 3497).',
    },
    {
        id: 'heroes-guild-mine',
        name: "Heroes' Guild mine",
        rects: [{ x1: 2880, z1: 9856, x2: 2943, z2: 9919 }],
        notes: "Ladder up into the Heroes' Guild at (2892, 3507).",
    },
    {
        id: 'karamja-volcano-dungeon',
        name: 'Karamja Volcano dungeon',
        rects: [{ x1: 2816, z1: 9536, x2: 2879, z2: 9599 }],
        notes: 'Below the volcano; lesser demons and deadly red spiders. Descriptive name, not settled from the data.',
    },
    {
        id: 'lava-maze-dungeon',
        name: 'Lava Maze dungeon',
        rects: [{ x1: 3008, z1: 10240, x2: 3071, z2: 10303 }],
        notes: 'Ladder in the Lava Maze at (3017, 3849) (ladders+stairs/scripts/ladders.rs2:109, the King Black Dragon entrance); Wilderness.',
    },
    {
        id: 'lumbridge-castle-cellar',
        name: 'Lumbridge castle cellar',
        rects: [{ x1: 3205, z1: 9612, x2: 3222, z2: 9630 }],
        notes: 'Ladder up into Lumbridge castle at (3209, 3216).',
    },
    {
        id: 'morytania-cave',
        name: 'Morytania cave',
        rects: [{ x1: 3392, z1: 9600, x2: 3455, z2: 9663 }],
        notes: 'Bats and copper and tin veins; descriptive name, not settled from the data.',
    },
    {
        id: 'rantzs-cave',
        name: "Rantz's cave",
        rects: [{ x1: 2624, z1: 9344, x2: 2687, z2: 9407 }],
        notes: 'Big Chompy Bird Hunting (quests/quest_chompybird).',
    },
    {
        id: 'shilo-village-quest-dungeon',
        name: 'Shilo Village quest dungeon',
        rects: [{ x1: 2880, z1: 9344, x2: 2943, z2: 9407 }],
        notes: 'quests/quest_zombiequeen npcs; descriptive name.',
    },
    {
        id: 'taverley-dungeon',
        name: 'Taverley Dungeon',
        rects: [{ x1: 2816, z1: 9664, x2: 2943, z2: 9855 }],
        notes: 'Ladder up south of Taverley at (2884, 3397).',
    },
    {
        id: 'troll-caves',
        name: 'Troll caves',
        rects: [{ x1: 2880, z1: 9984, x2: 2943, z2: 10047 }],
        notes: 'Trolls of quests/quest_troll and quests/quest_death; descriptive name.',
    },
    {
        id: 'tutorial-island-caves',
        name: 'Tutorial Island caves',
        rects: [{ x1: 3072, z1: 9472, x2: 3135, z2: 9535 }],
        notes: 'The mining and combat instructors of Tutorial Island.',
    },
    {
        id: 'underground-pass',
        name: 'Underground Pass',
        rects: [{ x1: 2304, z1: 9600, x2: 2495, z2: 9727 }],
        notes: 'Entered west of West Ardougne (underground-pass-entrance); quests/quest_upass npcs.',
    },
    {
        id: 'varrock-sewers',
        name: 'Varrock Sewers',
        rects: [{ x1: 3152, z1: 9840, x2: 3295, z2: 9919 }],
        notes: 'Ladders up into Varrock at (3237, 3458) and (3230, 3504).',
    },
    {
        id: 'white-wolf-mountain-caves',
        name: 'White Wolf Mountain caves',
        rects: [{ x1: 2816, z1: 9856, x2: 2879, z2: 9919 }],
        notes: 'Ladders up onto White Wolf Mountain at (2823-2859, 3507-3519); descriptive name.',
    },
    {
        id: 'witchaven-dungeon',
        name: 'Witchaven dungeon',
        rects: [{ x1: 2688, z1: 9664, x2: 2751, z2: 9727 }],
        notes: 'Ladder up near Witchaven at (2696, 3282); the Family Crest gold rocks (quests/quest_crest).',
    },
    {
        id: 'zanaris',
        name: 'Zanaris',
        rects: [{ x1: 3136, z1: 9472, x2: 3263, z2: 9599 }],
        notes: 'Members: the shed door in Lumbridge Swamp at (3202, 3169) with a dramen staff wielded (quests/quest_zanaris/scripts/quest_zanaris.rs2:89-99 teleports to (3220, 9592)).',
    },
    {
        id: 'zanaris-bank',
        name: 'Zanaris bank',
        parent: 'zanaris',
        rects: [{ x1: 3149, z1: 9576, x2: 3155, z2: 9581 }],
    },
];

/**
 * Sites no walk from the Lumbridge spawn reaches on purpose: one site by id, or every site in an area, its
 * child areas' included. build.ts leaves their sites out of the unreached report, and fails on an entry no
 * unreached site matches (one now reached, or gone).
 */
export type ExpectedUnreached = ({ area: string } | { site: string }) & {
    reason: string;
    /** The script line that keeps the player out, `file:line` under server/content/scripts. */
    source: string;
};

export const EXPECTED_UNREACHED: readonly ExpectedUnreached[] = [
    {
        area: 'tutorial-island',
        reason: 'the island and its bank are for new accounts only: finishing the tutorial telejumps the player to Lumbridge, and nothing takes them back',
        source: 'tutorial/scripts/tutorial.rs2:300',
    },
    {
        area: 'tutorial-island-caves',
        reason: "the island's caves, for new accounts only as the island is: finishing the tutorial telejumps the player to Lumbridge, and nothing takes them back",
        source: 'tutorial/scripts/tutorial.rs2:300',
    },
    {
        area: 'death-altar',
        reason: 'no way into the death temple: the only way into a temple is a talisman on its ruins, and the death ruins (skill_runecraft/configs/runecraft.loc:284) have no rc_ruins category, so this trigger is not theirs, and are never placed',
        source: 'skill_runecraft/scripts/runecraft.rs2:19',
    },
    {
        area: 'watchtower-quest-area',
        reason: "a copy of Yanille and the Watchtower whose ground and first floors no script puts a player on: the finished quest's ladder lands on its top floor, whose only way down is the ladder to the real tower (quest_itwatchtower.rs2:268)",
        source: 'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:263',
    },
    {
        area: 'tai-bwo-wannai-trio-area',
        reason: "the quest's hunt cutscene, which Tamayu takes the player on only while he hunts the Shaikahan (%tbwt_tamayu at ^tbwt_tamayu_slay_shaikahan or ^tbwt_tamayu_watched_cutscene, tbwt_tamayu.rs2:20), and which puts the player back beside him when it ends (:261, or :290 and :329 on the hunt that kills it)",
        source: 'quests/quest_tbwt/scripts/tbwt_tamayu.rs2:209',
    },
    {
        area: 'legends-quest-cavern',
        reason: "players do reach it in game, but no row expresses the way: behind the Kharazi Jungle shaman caves, which no walk reaches either, Charge Orb cast on the magic trial gate (a spell on a loc, oploct, skill_magic/scripts/spells/charge_orb.rs2:1, :16; the move at quest_legends.rs2:1551), then the winch's two loc ops: once a rope is tied on (quest_legends.rs2:1566), op1 on lg_winchdown_norope turns it into lg_winchdown_rope (:1556, :1559), and op1 on that climbs down (:1581)",
        source: 'quests/quest_legends/scripts/quest_legends.rs2:1618',
    },
    {
        area: 'horror-from-the-deep',
        reason: 'the lighthouse copy the quest plays in: a finished quest opens the real doorway instead (%horrorquest = ^horror_complete), and the door is locked to a player who never started it (quest_horror.rs2:48)',
        source: 'quests/quest_horror/scripts/quest_horror.rs2:3',
    },
    {
        area: 'regicide-camp',
        reason: 'the burning camp cutscene, played only at ^regicide_spoken_iorwerth2 (refused at ^regicide_killed_tyras and past), which puts the player back outside when it ends (quest_regicide.rs2:594)',
        source: 'quests/quest_regicide/scripts/quest_regicide.rs2:505',
    },
    // The Fisher Realm's blighted copy, the quest's: the whistle sends a player who gave Percival one to the restored
    // realm.
    ...[
        'range:fisher-realm:1',
        'tree:fisher-realm:8',
        'tree:fisher-realm:9',
        'tree:fisher-realm:10',
        'tree:fisher-realm:11',
    ].map((site): ExpectedUnreached => ({
        site,
        reason: "the blighted Fisher Realm, the quest's: the whistle takes a player who gave Percival one (%grail >= ^grail_given_whistle) to the restored realm",
        source: 'quests/quest_grail/scripts/quest_grail.rs2:38',
    })),
    {
        site: 'tree:fisher-realm:6',
        reason: "walled in by collision on the restored realm's south edge, past a drystone wall: no loc or npc op on or beside its pocket moves the player (the report's hints are its trees' own)",
        source: 'quests/quest_grail/scripts/quest_grail.rs2:41',
    },
    {
        site: 'pickpocket:rogues-castle:2',
        reason: "walled in on the castle's second floor: the stairs land beside their own loc, and the map places no door on that floor (maps/m51_61.jm2), so no walk gets from the landing to the rogues' room",
        source: 'ladders+stairs/scripts/stairs.rs2:249',
    },
    {
        site: 'tree:crash-island:1',
        reason: "walled in by collision south of the gliders' beach: no loc or npc op on or beside its pocket moves the player (the report's hints are its tree's own)",
        source: 'quests/quest_mm/scripts/mm_waydar.rs2:116',
    },
    // North Tirannwn and the forest north of the Arandar pass: one stretch of land the grand wall round Prifddinas
    // (grandwall1) and the forest close in.
    ...[
        'tree:kandarin:7',
        'tree:kandarin:8',
        ...[3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 23, 24, 25].map(i => `tree:tirannwn:${i}`),
        'tree:arandar:1',
        'tree:prifddinas:0',
    ].map((site): ExpectedUnreached => ({
        site,
        reason: "walled in round Prifddinas: the city's gates turn every player away (@prif_guard_halt, prif_city_guard.rs2:7), the wall's tower ladders only climb to the towers' tops, and no other loc or npc op is on or beside the land (the report calls it open, as the towers' empty upper floors read as land)",
        source: 'quests/quest_regicide/scripts/prif_city_guard.rs2:12',
    })),
    // The forest north of the Tree Gnome Stronghold, past its north fence (gnomefence).
    ...[5, 10, 13, 15, 17, 18, 23]
        .map(i => `tree:kandarin:${i}`)
        .concat(['tree:swamp:1', 'tree:swamp:3'])
        .map((site): ExpectedUnreached => ({
            site,
            reason: "walled in by collision north of the Tree Gnome Stronghold's fence (gnomefence, as maps/m37_54.jm2:4631): no loc or npc op on or beside its pocket moves the player (the report's hints are its trees' own)",
            source: 'skill_woodcutting/scripts/woodcut.rs2:1',
        })),
    ...['range:west-ardougne:0', 'water-source:kandarin:2'].map((site): ExpectedUnreached => ({
        site,
        reason: "in the mourner headquarters, whose door lets a player in only at two Biohazard stages wearing a doctor's gown (^biohazard_poisoned_stew, ^biohazard_found_distillator) and is locked at every other, the quest done included (doors.rs2:69)",
        source: 'areas/area_ardougne_west/scripts/doors.rs2:57',
    })),
    ...['tree:fight-arena:0', 'tree:fight-arena:1'].map((site): ExpectedUnreached => ({
        site,
        reason: 'inside the Fight Arena, whose door opens only at two of its stages (^arena_entered_ogre_fight, ^arena_defeated_ogre); after the quest it is locked, and a guard by it attacks the player (khazard_guard.rs2:132)',
        source: 'quests/quest_arena/scripts/quest_arena.rs2:95',
    })),
    // Locs no tile a walk gets to can use: walled in by collision, with no loc or npc op on or beside their pockets that
    // moves the player but their own; the reason names a loc or map flag that walls each, with its map square line.
    ...(
        [
            [
                'tree:asgarnia:6',
                "in the railed garden of Entrana's church, whose only op is a ladder up to a floor with no way down",
                'its south rail, woodenrailing at maps/m44_52.jm2:6673',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:asgarnia:23',
                'a dead tree all eight tiles beside which the map flags blocked',
                'f1, as maps/m45_55.jm2:3825',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:goblin-village:0',
                'a dead tree all eight tiles beside which the map flags blocked',
                'f1, as maps/m46_54.jm2:506',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:arandar:2',
                'a dead tree all eight tiles beside which the map flags blocked',
                'f1, as maps/m36_51.jm2:2633',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:arandar:3',
                'a dead tree used only from a nook the other dead trees close in',
                'deadtree6 at maps/m36_51.jm2:4925',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:taverley:1',
                "in a strip between two of the Witch's House garden's hedges, closed at both ends",
                'hedge at maps/m45_54.jm2:5352',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:kandarin:22',
                "a dead tree used only from a pit north of the lava's railings, whose rim the map flags blocked",
                'f1, as maps/m38_50.jm2:1849',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:wilderness:153',
                'in a field of lava whose lava tiles the map flags blocked',
                'f1, as maps/m51_60.jm2:2644',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:kharidian-desert:0',
                "in a fenced flower bed by the Exam Centre's south hedge",
                'fencing at maps/m52_52.jm2:4448',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:kharidian-desert:1',
                "in a fenced flower bed by the Exam Centre's south hedge",
                'fencing at maps/m52_52.jm2:5994',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'tree:exam-centre:2',
                "in a strip behind the Exam Centre's east hedge",
                'hedge at maps/m52_52.jm2:5877',
                'skill_woodcutting/scripts/woodcut.rs2:1',
            ],
            [
                'fire:kandarin:9',
                "a fireplace used only from a nook its room's table and chairs close in",
                'bigtable at maps/m40_50.jm2:4662',
                'skill_cooking/scripts/cooking.rs2:2',
            ],
            [
                'fire:east-ardougne:1',
                "Elena's house's cooking pot, used only from nooks the stairs, chairs and walls close in",
                'stairs at maps/m40_52.jm2:5505',
                'skill_cooking/scripts/cooking.rs2:2',
            ],
            [
                'pottery-wheel:east-ardougne:1',
                "two wheels whose forceapproach (east, turned with the loc to south) puts the tile they are used from under the house's wall and a table",
                'potters_wheels.loc:5; paintedbrickwall at maps/m40_51.jm2:7098, bigtable at :7101',
                'skill_crafting/scripts/pottery/pottery.rs2:8',
            ],
            [
                'pottery-wheel:misthalin:0',
                'a wheel whose forceapproach (east, turned to west) puts the tile it is used from in a nook a crate and a potted plant close in',
                'potters_wheels.loc:5; crate3 at maps/m52_52.jm2:5351, egypt_plantpotted at :5392',
                'skill_crafting/scripts/pottery/pottery.rs2:8',
            ],
        ] as const
    ).map(([site, why, wall, source]): ExpectedUnreached => ({
        site,
        reason: `walled in by collision: ${why} (${wall})`,
        source,
    })),
    // Decoration trees round the runecrafting temples, on land no walk from the temple a talisman lands in gets to.
    ...['tree:air-altar:0', 'tree:nature-altar:0', ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => `tree:water-altar:${i}`)].map(
        (site): ExpectedUnreached => ({
            site,
            reason: "decoration outside the temple: the ruins' teleport lands in the temple, and no walk from there gets beside the tree",
            source: 'skill_runecraft/scripts/runecraft.rs2:45',
        }),
    ),
];
