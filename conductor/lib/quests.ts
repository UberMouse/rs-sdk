// The quests of the quest tab: the id every `quest:<id>` token and every plan names, the display name the tab shows,
// and where the server keeps the quest's progress and what value means complete. Transcribed by hand from the server
// content (`update_questlist` in quests.rs2 and the quest constants); every row names its source lines, and
// quests.test.ts checks that each row's `questlist:<id>` line and its complete-value line say what the row says.
//
// The server never transmits a quest's varp to the client (they are `scope=perm` with no `transmit`, e.g.
// quest_imp/configs/quest_imp.varp), so the varp and `complete` columns document the content; they are NOT read at
// run time. What a bot can read is the quest tab: the login script colours every entry red (not started), yellow
// (started) or green (complete) with if_setcolour, and the client holds that colour (`BotWorldState.questTab`).
// `questProgress` reads it; it knows three states, not the stage number.
import type { BotWorldState } from '../../sdk/types';

/**
 * For a quest plan's `requires`: `questDone` reads the quest tab alone, and a state with no readable tab reads
 * 'none', so without this the plan would loop on a client that sends no tab instead of failing with a reason.
 */
export const QUEST_TAB_REQUIRED: Readonly<Record<string, (v: { state: Pick<BotWorldState, 'questTab'> }) => boolean>> =
    {
        'quest tab (state.questTab)': v => (v.state.questTab?.length ?? 0) > 0,
    };

/** What the quest tab shows of a quest: red, yellow or green. */
export type QuestProgress = 'none' | 'started' | 'done';

export interface QuestInfo {
    /** The text of the quest's tab entry (questlist.if), which is how the client's tab is matched to the quest. */
    name: string;
    /** The varp (or script) holding the progress, in the server content's own name. */
    varp: string;
    /** The value at which `update_questlist` colours the entry green (progress >= this); 0 is not started. */
    complete: number;
    /** Where `update_questlist` reads the quest (quests.rs2:<line>) and where `complete` is defined. */
    source: string;
    completeSource: string;
    /** A quirk of the source, if any. */
    note?: string;
}

const QUESTS_RS2 = 'server/content/scripts/general/scripts/quests.rs2';
const SCRIPTS = 'server/content/scripts/';

const q = (
    name: string,
    varp: string,
    complete: number,
    line: number,
    completeSource: string,
    note?: string,
): QuestInfo => ({
    name,
    varp,
    complete,
    source: `${QUESTS_RS2}:${line}`,
    completeSource: SCRIPTS + completeSource,
    ...(note ? { note } : {}),
});

/** Every quest of the quest tab by id (the `questlist:<id>` component name of the content). */
export const QUESTS: Readonly<Record<string, QuestInfo>> = {
    runemysteries: q('Rune Mysteries Quest', 'runemysteries', 6, 306, 'general/configs/quest.constant:50'),
    doric: q("Doric's Quest", 'doricquest', 100, 307, 'general/configs/quest.constant:17'),
    cook: q("Cook's Assistant", 'cookquest', 2, 308, 'general/configs/quest.constant:12'),
    romeojuliet: q('Romeo & Juliet', 'rjquest', 100, 309, 'general/configs/quest.constant:49'),
    hetty: q("Witch's Potion", 'hetty', 3, 310, 'general/configs/quest.constant:33'),
    chompybird: q('Big Chompy Bird Hunting', 'chompybird', 65, 311, 'general/configs/quest.constant:10'),
    priest: q('The Restless Ghost', 'prieststart', 5, 312, 'general/configs/quest.constant:46'),
    squire: q("The Knight's Sword", 'squire', 7, 313, 'general/configs/quest.constant:55'),
    imp: q('Imp Catcher', 'imp', 2, 314, 'general/configs/quest.constant:37'),
    druid: q('Druidic Ritual', 'druidquest', 4, 315, 'general/configs/quest.constant:19'),
    gobdip: q('Goblin Diplomacy', 'goblinquest', 6, 316, 'general/configs/quest.constant:26'),
    sheep: q('Sheep Shearer', 'sheep', 22, 317, 'general/configs/quest.constant:53'),
    fluffs: q("Gertrude's Cat", 'fluffs', 6, 318, 'general/configs/quest.constant:25'),
    demon: q('Demon Slayer', 'demonstart', 30, 319, 'general/configs/quest.constant:15'),
    prince: q('Prince Ali Rescue', 'princequest', 110, 320, 'general/configs/quest.constant:48'),
    fortress: q("Black Knight's Fortress", 'spy', 4, 321, 'general/configs/quest.constant:9'),
    haunted: q('Ernest the Chicken', 'haunted', 3, 322, 'general/configs/quest.constant:29'),
    hunt: q("Pirate's Treasure", 'hunt', 4, 323, 'general/configs/quest.constant:34'),
    drunkmonk: q("Monk's Friend", 'drunkmonkquest', 80, 324, 'general/configs/quest.constant:21'),
    vampire: q('Vampire Slayer', 'vampire', 3, 325, 'general/configs/quest.constant:59'),
    totem: q('Tribal Totem', 'totemquest', 5, 326, 'general/configs/quest.constant:56'),
    fishingcompo: q('Fishing Contest', 'fishingcompo', 5, 327, 'general/configs/quest.constant:24'),
    scorpcatcher: q('Scorpion Catcher', 'scorpcatcher', 6, 328, 'general/configs/quest.constant:51'),
    zanaris: q('Lost City', 'zanaris', 6, 329, 'general/configs/quest.constant:61'),
    dragon: q('Dragon Slayer', 'dragonquest', 10, 330, 'general/configs/quest.constant:18'),
    blackarmgang: q(
        'Shield of Arrav',
        'blackarmgang',
        4,
        334,
        'general/configs/quest.constant:7',
        'the Phoenix Gang route (%phoenixgang, complete 10, quests.rs2:332) also colours this entry',
    ),
    elena: q('Plague City', 'elenaquest', 29, 336, 'general/configs/quest.constant:23'),
    seaslug: q('Sea Slug Quest', 'seaslugquest', 12, 337, 'general/configs/quest.constant:52'),
    arthur: q("Merlin's Crystal", 'arthur', 7, 338, 'general/configs/quest.constant:4'),
    tree: q('Tree Gnome Village', 'treequest', 9, 339, 'general/configs/quest.constant:57'),
    waterfall: q('Waterfall Quest', 'waterfall_quest', 10, 340, 'general/configs/quest.constant:60'),
    grail: q('Holy Grail', 'grail', 10, 341, 'general/configs/quest.constant:27'),
    ball: q("Witch's House", 'ballquest', 7, 342, 'general/configs/quest.constant:5'),
    murder: q('Murder Mystery', 'murderquest', 2, 343, 'general/configs/quest.constant:45'),
    itexam: q('Digsite Quest', '~itexam_progress', 9, 344, 'general/configs/quest.constant:38'),
    misc: q('Throne of Miscellania', 'misc_quest', 100, 345, 'general/configs/quest.constant:44'),
    hazeelcult: q('Hazeel Cult', 'hazeelcultquest', 9, 346, 'general/configs/quest.constant:31'),
    hero: q("Hero's Quest", 'heroquest', 15, 347, 'general/configs/quest.constant:32'),
    itgronigen: q('Observatory Quest', 'itgronigen', 7, 348, 'general/configs/quest.constant:39'),
    arena: q('Fight Arena', 'arenaquest', 14, 349, 'general/configs/quest.constant:3'),
    junglepotion: q('Jungle Potion', 'junglepotion', 12, 350, 'general/configs/quest.constant:41'),
    ikov: q('Temple of Ikov', 'ikov', 80, 351, 'general/configs/quest.constant:35'),
    biohazard: q('Biohazard', 'biohazard', 16, 352, 'general/configs/quest.constant:6'),
    sheepherder: q('Sheep Herder', 'sheepherderquest', 3, 353, 'general/configs/quest.constant:54'),
    mcannon: q('Dwarf Cannon', 'mcannon', 11, 354, 'general/configs/quest.constant:43'),
    cog: q('Clock Tower', '~get_cog_progress', 8, 355, 'general/configs/quest.constant:11'),
    grandtree: q('The Grand Tree', 'grandtree', 160, 356, 'general/configs/quest.constant:28'),
    upass: q(
        'Underground Pass',
        'upass',
        10,
        360,
        'general/configs/quest.constant:58',
        'shown started while a bit of ibanmulti is set (quests.rs2:358) and the varp is not complete',
    ),
    zombiequeen: q('Shilo Village', 'zombiequeen', 15, 362, 'general/configs/quest.constant:62'),
    crest: q('Family Crest', 'crestquest', 11, 363, 'general/configs/quest.constant:13'),
    desertrescue: q('The Tourist Trap', 'desertrescue', 30, 364, 'general/configs/quest.constant:16'),
    itwatchtower: q('Watch Tower', 'itwatchtower', 13, 365, 'general/configs/quest.constant:40'),
    legends: q('Legends Quest', 'legendsquest', 75, 366, 'general/configs/quest.constant:42'),
    elemental_workshop: q(
        'Elemental Workshop',
        'elemental_workshop_bits',
        20,
        367,
        'general/configs/quest.constant:22',
        'complete is the bit index tested in the varp (testbit), not a stage',
    ),
    priestperil: q('Priest in Peril', 'priestperil', 60, 368, 'general/configs/quest.constant:47'),
    druidspirit: q('Nature Spirit', 'druidspirit', 110, 369, 'general/configs/quest.constant:20'),
    death: q('Death Plateau', 'death_equiproom', 80, 370, 'general/configs/quest.constant:14'),
    troll: q('Troll Stronghold', 'troll_quest', 50, 371, 'general/configs/quest.constant:63'),
    troll_love: q(
        'Troll Romance',
        'troll_love',
        45,
        372,
        'quests/quest_troll_love/configs/quest_troll_love.constant:11',
    ),
    tbwt: q('Tai Bwo Wannai Trio', 'tbwt_main', 6, 373, 'general/configs/quest.constant:64'),
    mortton: q('Shades of Mortton', 'morttonquest', 85, 374, 'general/configs/quest.constant:67'),
    regicide: q('Regicide', 'regicide_quest', 15, 375, 'general/configs/quest.constant:65'),
    viking: q('The Fremennik Trials', 'viking', 10, 376, 'general/configs/quest.constant:68'),
    horror: q('Horror from the Deep', 'horrorquest', 10, 377, 'general/configs/quest.constant:69'),
    eadgar: q("Eadgar's Ruse", 'eadgar_quest', 110, 378, 'general/configs/quest.constant:66'),
    mm: q('Monkey Madness', 'mm_main', 9, 379, 'quests/quest_mm/configs/quest_mm.constant:10'),
    routequest: q('In Search of the Myreque', 'routequest', 105, 380, 'general/configs/quest.constant:70'),
    hauntedmine: q('Haunted Mine', 'hauntedmine', 11, 381, 'general/configs/quest.constant:30'),
};

/** The least a channel holds when if_setcolour set it (it keeps 5 bits per channel: 0xF8 or 0x00). */
const HIGH = 0x80;

/** What a quest-tab text colour (0xRRGGBB) means: red not started, yellow started, green complete; null otherwise. */
export function colourProgress(colour: number): QuestProgress | null {
    const red = ((colour >> 16) & 0xff) >= HIGH;
    const green = ((colour >> 8) & 0xff) >= HIGH;
    const blue = (colour & 0xff) >= HIGH;
    if (blue) return null;
    if (red && green) return 'started';
    if (green) return 'done';
    if (red) return 'none';
    return null;
}

/**
 * A quest's progress as the bot's quest tab shows it, or null when the quest is unknown or the state has no tab
 * (a client without `questTab`, or before the login script ran): null means unread, not "not started".
 */
export function questProgress(state: Pick<BotWorldState, 'questTab'>, id: string): QuestProgress | null {
    const info = QUESTS[id];
    if (!info || !state.questTab) return null;
    const entry = state.questTab.find(e => e.name === info.name);
    return entry ? colourProgress(entry.colour) : null;
}
