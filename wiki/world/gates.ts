// What the world index reads from curated tables because the scripts are too complex to read offline:
// quests whose journal calls the scan can't read, the procs that hold a loadout rule, transports the sail
// scripts don't give, the loc teleports to a dbrow's coords, the npc teleports to an enum's coords, the transports
// left out of scope, the locs a quest locks the use of, and every gate candidate confirmed or rejected. Every entry
// cites its script. The build reads these together with what it derives (sources/quests.ts, sources/loadout.ts,
// sources/transports.ts, sources/dbrow-teleports.ts, sources/npc-teleports.ts, sources/gate-scan.ts) and fails on a
// quest in neither, a quest override the scan no longer needs, a gate candidate GATES does not review, a GATES entry
// the scan no longer finds, a gate at odds with the scan without a why, an override (a rejection, or a gate with a
// why) whose scan digest no longer matches the scan's proposal, and a use gate on a config no feature is placed as.
import { GATE_LIST } from './gate-list';
import type { DbrowTeleport } from './sources/dbrow-teleports';
import type { CuratedCrossing } from './sources/curated-crossings';
import type { CuratedGate } from './sources/gate-scan';
import type { LoadoutProc } from './sources/loadout';
import type { NpcTeleport } from './sources/npc-teleports';
import type { QuestOverride } from './sources/quests';
import type { CuratedTransport } from './sources/transports';

/**
 * Every gate candidate the scan finds (sources/gate-scan.ts), confirmed as a gate with its requirements or
 * rejected with its kind and reason; the list is long, so it lives in gate-list.ts.
 */
export const GATES: readonly CuratedGate[] = GATE_LIST;

/**
 * Quests whose `~send_quest_progress` calls don't read as `(%varp, ^x_complete)` (sources/quests.ts), with
 * how a save shows each done: progress (the varp, or `bits` of it) >= complete, on the varp or any `or`.
 */
export const QUEST_OVERRIDES: readonly QuestOverride[] = [
    {
        id: 'blackarmgang',
        varp: 'blackarmgang',
        complete: '^blackarmgang_complete',
        or: [{ varp: 'phoenixgang', complete: '^phoenixgang_complete' }],
        source: 'general/scripts/quests.rs2:170',
        notes: 'Shield of Arrav is done with either gang: the journal passes %phoenixgang or %blackarmgang by which one the player joined.',
    },
    {
        id: 'cog',
        varp: 'cogquest',
        bits: [0, 3],
        complete: '^quest_cog_complete',
        source: 'quests/quest_cog/scripts/quest_cog.rs2:12',
        notes: 'The journal passes ~get_cog_progress, which is getbit_range(%cogquest, 0, 3).',
    },
    {
        id: 'elemental_workshop',
        varp: 'elemental_workshop_bits',
        bits: ['^elemental_workshop_complete', '^elemental_workshop_complete'],
        complete: 1,
        source: 'general/scripts/quests.rs2:257',
        notes:
            'Done when bit ^elemental_workshop_complete of %elemental_workshop_bits is set (testbit, as the quest points count reads it); ' +
            'the journal compares the whole bit field with 2^20 - 1 or 2 * 20, for its colour only.',
    },
    {
        id: 'haunted',
        varp: 'haunted',
        complete: '^haunted_complete',
        source: 'areas/area_draynor/scripts/veronica.rs2:17',
        notes: 'Veronica passes the literal 3, which is ^haunted_complete; the journal list passes the constant (general/scripts/quests.rs2:322).',
    },
    {
        id: 'ikov',
        varp: 'ikov',
        complete: '^ikov_completed_armadyl',
        source: 'general/scripts/quests.rs2:215',
        notes: 'Two endings: ^ikov_completed_armadyl (80) and ^ikov_completed_lucien (90); >= 80 is done either way.',
    },
    {
        id: 'itexam',
        varp: 'itexamlevel',
        bits: [0, 3],
        complete: '^itexam_complete',
        source: 'quests/quest_itexam/scripts/quest_itexam.rs2:15',
        notes:
            'The journal passes ~itexam_progress, which is getbit_range(%itexamlevel, 0, 3). Only those bits are ever set ' +
            '(~itexam_set_progress, quest_itexam.rs2:22), so the quest points count comparing the whole varp agrees (general/scripts/quests.rs2:242).',
    },
    {
        id: 'upass',
        varp: 'upass',
        complete: '^upass_complete',
        source: 'general/scripts/quests.rs2:233',
        notes:
            'One journal call passes the literal 1 while a bit of %ibanmulti marks the first stage (general/scripts/quests.rs2:358); ' +
            'done is %upass at ^upass_complete.',
    },
];

/**
 * Quests whose varp a script sets below a stage it was shown at (sources/quests.ts questVarpDecreases).
 * The build writes each reason on the quest's row in world.json (Quest.varpDecreases), so a reader of a
 * `quest:<id>>=<stage>` on it can see the stage may not stay; it fails on an id the quest table lacks.
 */
export const QUEST_VARP_EXCEPTIONS: Readonly<Record<string, string>> = {
    ball: 'quests/quest_ball/scripts/witch.rs2:25: the witch catching you at ^ball_unlocked_mousedoor sets %ballquest back to ^ball_started.',
};

/**
 * Loadout rules by id, each read from the proc that checks it (sources/loadout.ts), with what the proc's
 * true means: an edge that calls the proc and refuses a player it finds carrying something banned needs
 * `loadout:<id>`.
 */
export const LOADOUT_PROCS: Readonly<Record<string, LoadoutProc>> = {
    // Boarding for Entrana (areas/area_port_sarim/scripts/monk_of_entrana.rs2:26).
    entrana: { call: '~has_entrana_restricted_items', trueWhen: 'banned' },
    // Glarial's tomb, with the pebble (quests/quest_waterfall/scripts/quest_waterfall.rs2:44).
    glarials_tomb: { call: '~waterfall_can_enter_glarials_tomb', trueWhen: 'clear' },
    // Into the Mage Arena (areas/area_mage_arena/scripts/mage_arena.rs2:100).
    mage_arena: { call: '~can_enter_mage_arena', trueWhen: 'clear' },
};

/**
 * Transports the sail scripts don't give: boarded by talking to `npc`, at every spawn of it, or by using
 * `loc`, at every placed loc of it.
 */
export const CURATED_TRANSPORTS: readonly CuratedTransport[] = [
    {
        kind: 'cart',
        npc: 'brimhavencartdriver',
        to: '0_44_46_18_7',
        fare: 10,
        requires: ['coins:10', 'quest:zombiequeen'],
        source: 'areas/area_brimhaven/scripts/hajedy.rs2:43',
        paidAt: ['areas/area_brimhaven/scripts/hajedy.rs2:41'],
        notes:
            'Hajedy, Brimhaven to Shilo Village, refuses until Shilo Village is done (hajedy.rs2:17). The fare is 5% of the coins ' +
            'carried, at least 10 and at most 200 (~calc_shilocart_cost, hajedy.rs2:50): 10 with 200 coins or fewer.',
    },
    {
        kind: 'cart',
        npc: 'shilocartdriver',
        to: '0_43_50_24_14',
        fare: 10,
        requires: ['coins:10'],
        source: 'areas/area_shilo/scripts/vigroy.rs2:31',
        paidAt: ['areas/area_shilo/scripts/vigroy.rs2:29'],
        notes:
            'Vigroy, Shilo Village to Brimhaven; no quest check in the script (Shilo is behind the quest anyway). The fare is ' +
            'as Hajedy’s (~calc_shilocart_cost, areas/area_brimhaven/scripts/hajedy.rs2:50).',
    },
    {
        kind: 'sled',
        loc: 'trollromance_piste_walk_barrier_down',
        to: {
            '0_43_59_20_59': '0_43_59_38_18',
            '0_43_59_21_59': '0_43_59_38_18',
            '0_43_58_33_59': '0_43_58_42_7',
            '0_43_58_34_59': '0_43_58_42_7',
        },
        fare: 0,
        requires: ['item:trollromance_toboggon_waxed:worn', 'skill:agility:28'],
        source: 'quests/quest_troll_love/scripts/quest_troll_love.rs2:10',
        paidAt: [],
        notes:
            "Troll Romance's piste near Trollheim: sledding down needs 28 Agility and a waxed sled worn " +
            '(quest_troll_love.rs2:2, 6); the barrier picks the ride by loc_coord, each landing at its foot ' +
            '(~trollromance_first_sled_ride, quest_troll_love.rs2:219; ~trollromance_second_sled_ride, :288). The first ride ' +
            'crashes 1 time in 250 (random(250), :144) and drops the player at 0_43_59_47_18 instead.',
    },
    {
        // The Miscellania longship: its own sail proc (~misc_longship_sail, areas/area_miscellania/scripts/misc_sailor.rs2:13)
        // sets no %journey_number, so the sail scripts don't give it. The Rellekka sailor takes a player who finished The
        // Fremennik Trials (%viking = ^viking_complete, viking_sailor.rs2:14).
        kind: 'ship',
        npc: 'viking_sailor',
        to: '0_40_60_20_5',
        fare: 0,
        requires: ['quest:viking'],
        source: 'quests/quest_viking/scripts/viking_sailor.rs2:24',
        paidAt: [],
        notes: 'Rellekka to Miscellania, after "Let\'s go!" (viking_sailor.rs2:17); the landing is ^to_miscellania_tele_coord.',
    },
    {
        kind: 'ship',
        npc: 'misc_sailor',
        to: '0_41_57_5_44',
        fare: 0,
        requires: [],
        source: 'areas/area_miscellania/scripts/misc_sailor.rs2:11',
        paidAt: [],
        notes: 'Miscellania to Rellekka, after "Let\'s go!" (misc_sailor.rs2:4), with no check; the landing is ^from_miscellania_tele_coord.',
    },
];

/**
 * Loc teleports to a coord drawn from a dbrow (sources/dbrow-teleports.ts): which trigger, and which table and
 * columns it reads, so the coords and objs come from the dbrow. Each placed loc the trigger covers gets a
 * World.crossings row.
 */
export const DBROW_TELEPORTS: readonly DbrowTeleport[] = [
    {
        // A talisman on the runecrafting ruins: of category talismans (runecraft.rs2:20), the row's own talisman
        // (:29), refused on a free world for a members row (:33), then `p_delay(1)` (:44) and the jump. The row is
        // ~get_runecraft_data's db_find on the loc's rune_type (:174).
        trigger: 'oplocu,_rc_ruins',
        via: 'teleport',
        table: 'runecraft_table',
        key: { column: 'type', param: 'rune_type' },
        landings: 'enter_coord',
        use: { column: 'talisman', category: 'talismans' },
        members: 'members',
        source: 'skill_runecraft/scripts/runecraft.rs2:45',
    },
    {
        // A temple's exit portal: op1 with no check the row does not pass (runecraft.rs2:3) and no delay before the
        // jump, so it is priced as a scripted loc op move.
        trigger: 'oploc1,_rc_exit_portal',
        via: 'scripted',
        table: 'runecraft_table',
        key: { column: 'type', param: 'rune_type' },
        landings: 'exit_coord',
        source: 'skill_runecraft/scripts/runecraft.rs2:9',
    },
];

/**
 * Npc teleports to a coord drawn from an enum, and the loc back (sources/npc-teleports.ts): the label the npcs' ops
 * jump to and the lines it is read from, so the npcs, their ops and the coords come from the scripts and the enum.
 * Each spawn cluster of a caller's npc gets a World.crossings row, and each placed loc of the back trigger one per npc.
 */
export const NPC_TELEPORTS: readonly NpcTeleport[] = [
    {
        // The rune essence mine: Aubury's op4 and Sedridor's, Cromperty's, Distentor's and Brimstail's op3 jump here
        // with the coord to send the player back to (aubury.rs2:33, sedridor.rs2:45, wizard_cromperty.rs2:10,
        // wizard_distentor.rs2:16, brimstail.rs2:21). The npc talks, then `p_delay(4)` (:20) before the jump. The
        // portal goes back after `p_delay(1)` (:34) to %exit_essence_mine_coord, set at :8; it is null, and the
        // portal sends the player to Sedridor, only for one who never came in by an npc (:35).
        label: 'teleport_to_essence_mine',
        via: 'teleport',
        enum: 'essence_mine_teleports',
        requires: ['quest:runemysteries'],
        checkedAt: 'skill_runecraft/scripts/essence_mine.rs2:2',
        ring: 'skill_runecraft/scripts/essence_mine.rs2:24',
        source: 'skill_runecraft/scripts/essence_mine.rs2:25',
        back: {
            trigger: 'oploc1,blankrunestone_exit_portal',
            via: 'teleport',
            varp: 'exit_essence_mine_coord',
            ring: 'skill_runecraft/scripts/essence_mine.rs2:40',
            source: 'skill_runecraft/scripts/essence_mine.rs2:41',
        },
    },
];

/** The gnome glider landings (areas/area_gnome/configs/glider.constant) by the button that flies to each. */
const GLIDERS = [
    { button: 'com_21', dest: '^gandius' },
    { button: 'com_22', dest: '^ta_quir_priw' },
    { button: 'com_23', dest: '^sindarpos' },
    { button: 'com_24', dest: '^lemanto_andra' },
    { button: 'com_25', dest: '^kar_hewo' },
] as const;
/**
 * Where a flight starts (~calc_gliderstart, gnome_glider.rs2:26): the box 8 tiles round the start's landing the player
 * stands in, by the line that checks it. Lemanto Andra is no start.
 */
const GLIDER_STARTS = [
    { dest: '^ta_quir_priw', box: ['3_38_54_25_37', '3_38_54_41_53'], line: 27 },
    { dest: '^gandius', box: ['0_46_46_19_17', '0_46_46_35_33'], line: 29 },
    { dest: '^kar_hewo', box: ['0_51_50_12_3', '0_51_50_28_19'], line: 31 },
    { dest: '^sindarpos', box: ['0_44_54_26_33', '0_44_54_42_49'], line: 33 },
] as const;
/** The gliders' landings, as glider.constant writes them. */
const GLIDER_LANDINGS: Readonly<Record<string, string>> = {
    '^gandius': '0_46_46_27_25',
    '^ta_quir_priw': '3_38_54_33_45',
    '^sindarpos': '0_44_54_34_41',
    '^lemanto_andra': '0_51_53_56_38',
    '^kar_hewo': '0_51_50_20_11',
};

/** The spirit trees' landings (areas/area_gnome/configs/spirit_tree.constant). */
const SPIRIT_TREES: Readonly<Record<string, string>> = {
    '^khazard_tree': '0_39_50_59_59',
    '^varrock_tree': '0_49_54_43_51',
    '^village_tree': '0_39_49_46_33',
    '^stronghold_tree': '0_38_53_29_52',
};
/** A spirit tree's menu (spirit_tree.rs2): its loc, the quest it asks, the line it asks it on, and its choices. */
const SPIRIT_TREE_MENUS = [
    {
        loc: 'ent',
        quest: 'quest:grandtree',
        checked: 2,
        menu: [
            ['Tree Gnome Village.', '^village_tree'],
            ['Forest north of Varrock.', '^varrock_tree'],
            ['Battlefield of Khazard.', '^khazard_tree'],
        ],
    },
    {
        loc: 'stronghold_ent',
        quest: 'quest:tree',
        checked: 26,
        menu: [
            ['Battlefield of Khazard.', '^khazard_tree'],
            ['Forest north of Varrock.', '^varrock_tree'],
            ['Gnome stronghold.', '^stronghold_tree'],
        ],
    },
] as const;

/**
 * Teleports and scripted moves no derivation gives, each checked against its script (sources/curated-crossings.ts):
 * Monkey Madness's rides to Ape Atoll and back, the spirit trees, the gnome gliders and the Fisher Realm's whistle.
 * Each spawn of the npc, placed loc or zone's tiles gets a World.crossings row.
 */
export const CURATED_CROSSINGS: readonly CuratedCrossing[] = [
    // Monkey Madness. Every check on the way reads the quest's own varps (%mm_daero, %mm_lumdo, %mm_waydar), set on the
    // way through it and never set back, so a finished quest meets them: the rides need `quest:mm`. Daero takes a
    // player who finished the training after it (%mm_main = ^mm_complete_training, mm_daero.rs2:8) to the hangar,
    // where the code is broken (mm_daero.rs2:234), and talks of it from inside the hangars (the zones at :2).
    {
        via: 'teleport',
        trigger: 'opnpc1,mm_daero',
        act: { kind: 'npc-op', npc: 'mm_daero', op: 1 },
        where: {
            placed: {
                notIn: [
                    ['0_37_154_0_0', '0_37_154_63_63'],
                    ['0_40_70_0_0', '0_41_71_63_63'],
                ],
                at: 'quests/quest_mm/scripts/mm_daero.rs2:2',
            },
        },
        to: ['0_41_70_25_36'],
        requires: [['quest:mm>=10']],
        source: 'quests/quest_mm/scripts/mm_daero.rs2:235',
    },
    {
        // Waydar outside Crash Island (the hangars) flies there once %mm_daero = ^daero_complete (mm_waydar.rs2:5).
        via: 'teleport',
        trigger: 'opnpc1,mm_waydar',
        act: { kind: 'npc-op', npc: 'mm_waydar', op: 1, choices: ['Yes'] },
        where: { placed: { notIn: [['0_45_42_0_0', '0_45_42_63_63']], at: 'quests/quest_mm/scripts/mm_waydar.rs2:2' } },
        to: ['0_45_42_13_37'],
        requires: [['quest:mm']],
        source: 'quests/quest_mm/scripts/mm_waydar.rs2:116',
    },
    {
        // Waydar on Crash Island flies back to the Gnomeball pitch for a player past ^mm_shown_seal (mm_waydar.rs2:46).
        via: 'teleport',
        trigger: 'opnpc1,mm_waydar',
        act: { kind: 'npc-op', npc: 'mm_waydar', op: 1, choices: ['I need to return to your kingdom.'] },
        where: { placed: { in: ['0_45_42_0_0', '0_45_42_63_63'], at: 'quests/quest_mm/scripts/mm_waydar.rs2:2' } },
        to: ['0_37_54_25_10'],
        requires: [['quest:mm']],
        source: 'quests/quest_mm/scripts/mm_waydar.rs2:125',
    },
    {
        // Lumdo on Crash Island rows to Ape Atoll once %mm_lumdo = ^lumdo_travelled (mm_lumdo.rs2:18).
        via: 'teleport',
        trigger: 'opnpc1,mm_lumdo',
        act: { kind: 'npc-op', npc: 'mm_lumdo', op: 1 },
        where: {
            placed: {
                notIn: [
                    ['0_42_143_0_0', '2_42_143_63_63'],
                    ['0_43_42_0_0', '0_43_42_63_63'],
                ],
                at: 'quests/quest_mm/scripts/mm_lumdo.rs2:2',
            },
        },
        to: ['0_43_42_50_19'],
        requires: [['quest:mm']],
        source: 'quests/quest_mm/scripts/mm_lumdo.rs2:24',
    },
    {
        // Lumdo on Ape Atoll rows back to Crash Island with no check.
        via: 'teleport',
        trigger: 'opnpc1,mm_lumdo',
        act: { kind: 'npc-op', npc: 'mm_lumdo', op: 1 },
        where: { placed: { in: ['0_43_42_0_0', '0_43_42_63_63'], at: 'quests/quest_mm/scripts/mm_lumdo.rs2:5' } },
        to: ['0_45_42_14_38'],
        requires: [[]],
        source: 'quests/quest_mm/scripts/mm_lumdo.rs2:11',
    },
    // The spirit trees: each tree asks its quest (spirit_tree.rs2:2, :26, :50) and a members world (:65), and its menu
    // names the trees it sends the player to; the young trees send them to Tree Gnome Village only (:59).
    ...SPIRIT_TREE_MENUS.flatMap(({ loc, quest, menu }) =>
        menu.map(([choice, dest]): CuratedCrossing => ({
            via: 'teleport',
            trigger: `oploc1,${loc}`,
            act: { kind: 'loc-op', loc, op: 1, choices: ['Where can I go?', choice] },
            to: [SPIRIT_TREES[dest]!],
            requires: [['members', quest]],
            source: 'areas/area_gnome/scripts/spirit_tree.rs2:74',
        })),
    ),
    {
        via: 'teleport',
        trigger: 'oploc1,loc_1317',
        act: { kind: 'loc-op', loc: 'loc_1317', op: 1, choices: ['Yes please.'] },
        to: [SPIRIT_TREES['^village_tree']!],
        requires: [['members', 'quest:tree']],
        source: 'areas/area_gnome/scripts/spirit_tree.rs2:74',
    },
    // The gnome gliders: a pilot asked "Can you take me on the glider?" opens the map on a members world once The Grand
    // Tree is done (gnome_glider.rs2:116, :125); its buttons fly from the start the player stands at (~calc_gliderstart,
    // :26) to a landing round the button's, but only to or from Ta Quir Priw (:14), and not to the start itself (:10).
    ...GLIDER_STARTS.flatMap(start =>
        GLIDERS.filter(
            g => g.dest !== start.dest && (start.dest === '^ta_quir_priw' || g.dest === '^ta_quir_priw'),
        ).map((g): CuratedCrossing => ({
            via: 'teleport',
            trigger: `if_button,glidermap:${g.button}`,
            act: { kind: 'interface', component: `glidermap:${g.button}` },
            where: {
                placed: {
                    npc: 'gnomepilot',
                    in: start.box,
                    at: `areas/area_gnome/scripts/gnome_glider.rs2:${start.line}`,
                },
            },
            to: [GLIDER_LANDINGS[g.dest]!],
            ring: [0, 1, 0],
            requires: [['members', 'quest:grandtree']],
            source: 'areas/area_gnome/scripts/gnome_glider.rs2:22',
            notes: `Opened by the pilot's Talk-to and "Can you take me on the glider?" (gnome_glider.rs2:116).`,
        })),
    ),
    // The Fisher Realm: the whistle blown at the six heads takes a player who gave Percival one (%grail >=
    // ^grail_given_whistle, quest_grail.rs2:38) to the restored realm, and blown anywhere in the realm back out (:45).
    // It is not used up (quest_grail.rs2:36-49).
    {
        via: 'teleport',
        trigger: 'opheld1,magic_whistle',
        act: { kind: 'item-op', obj: 'magic_whistle', op: 1 },
        where: {
            zone: { in: ['0_42_50_52_34', '0_42_50_55_37'], at: 'quests/quest_grail/scripts/quest_grail.rs2:37' },
        },
        to: ['0_41_73_54_43'],
        requires: [['item:magic_whistle:held', 'members', 'quest:grail']],
        source: 'quests/quest_grail/scripts/quest_grail.rs2:41',
    },
    {
        via: 'teleport',
        trigger: 'opheld1,magic_whistle',
        act: { kind: 'item-op', obj: 'magic_whistle', op: 1 },
        where: {
            zone: {
                in: ['0_41_73_0_0', '2_43_73_63_63'],
                seed: '0_41_73_54_43',
                at: 'quests/quest_grail/scripts/quest_grail.rs2:45',
            },
        },
        to: ['0_42_50_53_35'],
        requires: [['item:magic_whistle:held', 'members']],
        source: 'quests/quest_grail/scripts/quest_grail.rs2:46',
    },
    // The Burthorpe Games Room stairs land at random: x by ~random_range(-1, 1), z by random(2) (stairs.rs2:489,
    // :513), round the coord each one's switch_coord case moves to; sources/connectors.ts reads no random landing.
    {
        via: 'scripted',
        trigger: 'oploc1,board_game_stairs_grey_all',
        act: { kind: 'loc-op', loc: 'board_game_stairs_grey_all', op: 1 },
        to: ['1_34_77_30_5'],
        draw: { x: [-1, 1], z: [0, 1] },
        requires: [[]],
        source: 'ladders+stairs/scripts/stairs.rs2:491',
    },
    {
        via: 'scripted',
        trigger: 'oploc1,board_game_stairs_grey_base2',
        act: { kind: 'loc-op', loc: 'board_game_stairs_grey_base2', op: 1 },
        to: ['0_45_55_19_44'],
        draw: { x: [-1, 1], z: [0, 1] },
        requires: [[]],
        source: 'ladders+stairs/scripts/stairs.rs2:515',
    },
    // Waterfall Quest: the Door (2566, 9901) between the pillar room and the corridor. The dungeon key used on it,
    // once the amulet is on the statue (%waterfall_quest >= ^waterfall_placed_amulet), moves the player to the raised
    // room's door (2604, 9901) in the chalice room (quest_waterfall.rs2:399-401), from either side [2026-10-24
    // conductor3w2 local: used from the pillar room side at stage 8, landed on (2604, 9901)]. The script tests the
    // door by `loc_coord = 0_40_154_6_46`, a tile north of where the map places it (0_40_154_6_45), and the move
    // happened all the same, so the entry names the placed tile. The way back is the derived Open of the Door
    // (2604, 9900) (:389).
    {
        via: 'scripted',
        trigger: 'oplocu,baxtorian_door_2_waterfall_quest',
        act: { kind: 'item-on-loc', obj: 'baxtorian_key_waterfall_quest', loc: 'baxtorian_door_2_waterfall_quest' },
        where: {
            placed: {
                tiles: ['0_40_154_6_45'],
                at: 'quests/quest_waterfall/scripts/quest_waterfall.rs2:399',
            },
        },
        to: ['0_40_154_44_45'],
        requires: [['item:baxtorian_key_waterfall_quest:held', 'quest:waterfall>=8']],
        source: 'quests/quest_waterfall/scripts/quest_waterfall.rs2:401',
    },
];

/**
 * Transports neither derived nor curated, and why; the build report lists them. An entry with `sailSite`
 * names a sail site (sources/transports.ts sailSites) no npc op reaches, which the build then does not
 * fail on; the build fails on such an entry once its site is gone or an npc op reaches it.
 */
export const TRANSPORTS_OUT_OF_SCOPE: readonly { script: string; what: string; reason: string; sailSite?: true }[] = [
    {
        script: 'minigames/game_trawler/scripts/trawler_start.rs2:36',
        sailSite: true,
        what: 'the Fishing Trawler boat (journey 11)',
        reason: 'a minigame: its queue script ([queue,trawler_start]) sets it, not an npc op',
    },
    {
        script: 'minigames/game_trawler/scripts/trawler_win.rs2:44',
        sailSite: true,
        what: 'the Fishing Trawler return (journey 12)',
        reason: 'a minigame: its queue script ([queue,trawler_player_win]) sets it, not an npc op',
    },
    {
        script: 'areas/area_ardougne_east/scripts/holgart_ardougne.rs2:91',
        what: 'Holgart’s boats to the fishing platform and back',
        reason: "Holgart's dialogue goes by %seaslugquest stage (holgart_ardougne.rs2:2): quest boats are out of scope",
    },
];

/**
 * A loc config whose op script refuses a player without `requires` (one set, in requirements.ts's forms): a
 * site of its locs needs it to be used, on top of the walk there. The build adds it to the site's reach sets
 * (build.ts addReach) and fails on a config no feature is placed as.
 */
export interface UseGate {
    config: string;
    requires: string[];
    source: string;
}

/** Features a quest locks: their op scripts read the quest's varp before anything else. */
export const USE_GATES: readonly UseGate[] = [
    // %doricquest 0 or 10 refuses: done is the only stage past them (smithing.rs2:53-64).
    { config: 'doric_anvil', requires: ['quest:doric'], source: 'skill_smithing/scripts/smithing/smithing.rs2:53' },
    { config: 'viking_anvil', requires: ['quest:viking'], source: 'skill_smithing/scripts/smithing/smithing.rs2:66' },
    // Both the use-on op and the Smelt op (oploc2) check it.
    { config: 'viking_furnace', requires: ['quest:viking'], source: 'skill_smithing/scripts/smelting/smelting.rs2:2' },
    { config: 'viking_furnace2', requires: ['quest:viking'], source: 'skill_smithing/scripts/smelting/smelting.rs2:2' },
    // Both the use-on op and the Spin op (oploc2, :37-42) check it.
    {
        config: 'viking_spinningwheel',
        requires: ['quest:viking'],
        source: 'skill_crafting/scripts/spinning/spinning.rs2:2',
    },
];
