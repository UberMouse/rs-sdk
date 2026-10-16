// What the world index reads from curated tables because the scripts are too complex to read offline:
// quests whose journal calls the scan can't read, the procs that hold a loadout rule, transports the sail
// scripts don't give, and the transports left out of scope. Every entry cites its script. The build reads
// these together with what it derives (sources/quests.ts, sources/loadout.ts, sources/transports.ts) and
// fails on a quest in neither, or an override the scan no longer needs.
import type { QuestOverride } from './sources/quests';
import type { CuratedTransport } from './sources/transports';

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
        notes: 'The journal passes ~itexam_progress, which is getbit_range(%itexamlevel, 0, 3).',
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
 * Quests whose varp a script sets below a stage it was shown at (sources/quests.ts questVarpDecreases),
 * so a `quest:<id>>=<stage>` gate on them is not safe: the reach fill must not assume the stage stays.
 */
export const QUEST_VARP_EXCEPTIONS: Readonly<Record<string, string>> = {
    ball: 'quests/quest_ball/scripts/witch.rs2:25: the witch catching you at ^ball_unlocked_mousedoor sets %ballquest back to ^ball_started.',
};

/**
 * Loadout rules by id, each read from the proc that checks it (sources/loadout.ts): an edge that calls
 * the proc and refuses when it returns true needs `loadout:<id>`.
 */
export const LOADOUT_PROCS: Readonly<Record<string, string>> = {
    entrana: '~has_entrana_restricted_items',
};

/** Transports the sail scripts don't give: boarded by talking to `npc`, at every spawn of it. */
export const CURATED_TRANSPORTS: readonly CuratedTransport[] = [
    {
        kind: 'cart',
        npc: 'brimhavencartdriver',
        to: '0_44_46_18_7',
        fare: 10,
        requires: ['coins:10', 'quest:zombiequeen'],
        source: 'areas/area_brimhaven/scripts/hajedy.rs2:43',
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
        notes:
            'Vigroy, Shilo Village to Brimhaven; no quest check in the script (Shilo is behind the quest anyway). The fare is ' +
            'as Hajedy’s (~calc_shilocart_cost, areas/area_brimhaven/scripts/hajedy.rs2:50).',
    },
];

/**
 * Transports neither derived nor curated yet, and why: the build report lists them, so the reach fill's
 * unreached report can be read against them. The sail sites among them (a `%journey_number` no npc op
 * reaches) are named by script so the build does not report them as unread.
 */
export const TRANSPORTS_OUT_OF_SCOPE: readonly { script: string; what: string; reason: string }[] = [
    {
        script: 'general_use/scripts/gangplank.rs2:8',
        what: 'gangplanks (loc categories gangplank_board, gangplank_disembark)',
        reason:
            'the sail routes land on a ship deck (level 1) and a gangplank loc moves the player to the quay; its landing is the ' +
            "player's tile shifted by a computed offset (calc on ~gangplank_dir_mod), a connector-like edge the reach fill needs",
    },
    {
        script: 'skill_runecraft/scripts/essence_mine.rs2:1',
        what: 'the rune essence mine teleport (Aubury, Sedridor, Cromperty, Distentor, Brimstail) and its exit portals',
        reason:
            'the landing is random among the essence_mine_teleports enum, and the portal returns to %exit_essence_mine_coord, ' +
            'the wizard the player came from; needs quest:runemysteries (essence_mine.rs2:2)',
    },
    {
        script: 'skill_runecraft/scripts/runecraft.rs2:27',
        what: 'runecrafting altar ruins and exit portals',
        reason: 'landings are random dbrow fields (runecraft_table enter_coord, exit_coord), and entry is using a talisman on the ruins (runecraft.rs2:19)',
    },
    {
        script: 'areas/area_gnome/scripts/gnome_glider.rs2:7',
        what: 'gnome gliders',
        reason: 'the destination is an interface button (glidermap), not an npc op',
    },
    {
        script: 'areas/area_gnome/scripts/spirit_tree.rs2:64',
        what: 'spirit trees',
        reason: 'loc ops whose destination is a menu choice; each tree needs its quest (spirit_tree.rs2:2)',
    },
    {
        script: 'areas/area_miscellania/scripts/misc_sailor.rs2:13',
        what: 'the Miscellania longship',
        reason: 'its own sail proc (~misc_longship_sail), not the interface_boat routes',
    },
    {
        script: 'minigames/game_trawler/scripts/trawler_start.rs2:36',
        what: 'the Fishing Trawler boat (journey 11)',
        reason: 'a minigame: its queue script ([queue,trawler_start]) sets it, not an npc op',
    },
    {
        script: 'minigames/game_trawler/scripts/trawler_win.rs2:44',
        what: 'the Fishing Trawler return (journey 12)',
        reason: 'a minigame: its queue script ([queue,trawler_player_win]) sets it, not an npc op',
    },
    {
        script: 'areas/area_ardougne_east/scripts/holgart_ardougne.rs2:91',
        what: 'Holgart’s boats to the fishing platform and back',
        reason: "Holgart's dialogue goes by %seaslugquest stage (holgart_ardougne.rs2:2): quest boats are out of scope",
    },
    {
        script: 'areas/area_yanille/scripts/magic_guild.rs2:19',
        what: 'the Magic Guild portals',
        reason: 'loc ops, not npc ops; the guild door needs 66 Magic (magic_guild.rs2:11), a gate for Task 2b',
    },
];
