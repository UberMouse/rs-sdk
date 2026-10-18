// The gate candidates the scan finds (sources/gate-scan.ts), each confirmed or rejected after reading its
// trigger and the procs it calls. gates.ts exports this as GATES; the build fails on a candidate missing
// here, an entry the scan no longer finds, a gate whose requirements, side or move differ from the
// scan's proposal unless `why` says what the scan misses, and an entry with a why (every rejection, and
// such a gate) whose `scan` digest is not the scan's proposal it was read against (sources/gate-scan.ts
// proposalDigest): when the proposal changes, read the trigger again and write the new digest.
//
// Kinds (sources/gate-scan.ts GateKind): `gate` a steady requirement; `side-effect` always passable, the
// check only advances a quest or picks a message; `temporary-block` shut only during a quest stage;
// `quest-window` open only between two stages (left out of the fill); `not-a-gate` the move is not passage
// a bot walks (inside a minigame, a transport out of scope, a quest step or a trap, a loc never placed);
// `unclear` the script's meaning is not settled here, with what is unclear. A gate's `from`, `oneWay`, `to`, `at`,
// `byConfig`, `stages` and `choices` are sources/gate-scan.ts CuratedGate's.
import type { CuratedGate, CuratedKind } from './sources/gate-scan';
import type { Side } from './types';

/** Requirement sets as written here: the sets joined by ` | `, each set's requirements by spaces. */
const sets = (requires: string | string[][]): string[][] =>
    typeof requires === 'string' ? (requires ? requires.split(' | ').map(set => set.split(' ')) : []) : requires;

/**
 * A gate. `requires` as `sets` writes them, or as arrays when one holds a space (`other:<text>`);
 * `byConfig` the same, `''` for a config whose locs pass free.
 */
const gate = (
    trigger: string,
    source: string,
    requires: string | string[][],
    more: {
        from?: Side;
        oneWay?: true;
        to?: string | Record<string, string>;
        why?: string;
        notes?: string;
        byConfig?: Record<string, string | string[][]>;
        stages?: Record<string, string>;
        at?: string[];
        choices?: string[];
        scan?: string;
    } = {},
): CuratedGate => {
    const { byConfig, ...rest } = more;
    return {
        trigger,
        kind: 'gate',
        requires: sets(requires),
        source,
        ...rest,
        ...(byConfig
            ? { byConfig: Object.fromEntries(Object.entries(byConfig).map(([config, r]) => [config, sets(r)])) }
            : {}),
    };
};

/** A candidate that is not a gate, or not settled, why, and the digest of the scan proposal it was read against. */
const no = (
    kind: Exclude<CuratedKind, 'gate'>,
    trigger: string,
    source: string,
    why: string,
    scan?: string,
): CuratedGate => ({
    trigger,
    kind,
    source,
    why,
    ...(scan !== undefined ? { scan } : {}),
});

export const GATE_LIST: readonly CuratedGate[] = [
    // areas/
    gate(
        'oploc1,border_gate_toll_left',
        'areas/area_alkharid/scripts/border_gate.rs2:28',
        'coins:10 | quest:prince>=100',
        {
            notes: 'The Al Kharid toll gate: 10 coins (border_gate.rs2:53), free from ^prince_saved; the guard forcemoves the player through either way.',
        },
    ),
    gate(
        'oploc1,border_gate_toll_right',
        'areas/area_alkharid/scripts/border_gate.rs2:28',
        'coins:10 | quest:prince>=100',
        {
            notes: 'The Al Kharid toll gate, as border_gate_toll_left.',
        },
    ),
    gate(
        'oploc1,shantay_pass_henge_doorway',
        'areas/area_alkharid/scripts/shantay_pass.rs2:79',
        'consume:shantay_pass:1 members',
        {
            from: 'north',
            choices: ["Yeah, that poster doesn't scare me!"],
            why:
                "The scan's crossing joins two moves: from the south the pass lets members out free (shantay_pass.rs2:70), and from the north it takes a Shantay pass (shantay_pass.rs2:96) and [queue,shantay_pass_enter] jumps the player to its literal, then three tiles south (shantay_pass.rs2:105, :109), one move, which the row stands for. So the gate is the pass from the north, not members alone. " +
                'The poster asks "Go into Desert?" only of a player holding no disclaimer (shantay_pass.rs2:84, :88). `npc_find(coord, shantay_guard_still, 5, 0)` (shantay_pass.rs2:76) finds the guard who stands beside the pass, so it gates nothing.',
            scan: 'ea523400',
        },
    ),
    no(
        'not-a-gate',
        'oploc1,shantay_prisondoor',
        'areas/area_alkharid/scripts/shantay_pass.rs2:48',
        "Shantay's jail door: shut only on a player Shantay has jailed (%shantay_jail_progress), who pays a fine to be let out; not passage a bot walks.",
        '2918299c',
    ),
    gate('oploc1,elenadoor2', 'areas/area_ardougne_east/scripts/doors.rs2:2', 'quest:elena', {
        why: 'The switch also opens at ^elena_complete_read_scroll, a stage after complete: quest:elena covers it.',
        scan: '95aaa8fb',
    }),
    gate('oploc1,mournerstewdoorup', 'areas/area_ardougne_west/scripts/doors.rs2:2', 'item:doctor_gown:worn', {
        from: 'far',
    }),
    gate('oploc1,ardougnewalldoor_left', 'areas/area_ardougne_west/scripts/doors.rs2:26', 'quest:biohazard'),
    gate('oploc1,ardougnewalldoor_right', 'areas/area_ardougne_west/scripts/doors.rs2:26', 'quest:biohazard'),
    gate('oploc1,bravekdoorshut', 'areas/area_ardougne_west/scripts/doors.rs2:19', 'quest:elena', {
        why: 'The switch opens from ^quest_elena_spoke_to_clerk through complete and ^elena_complete_read_scroll: quest:elena covers the settled account.',
        scan: '02515aab',
    }),
    no(
        'quest-window',
        'oploc1,mournerstewdoor',
        'areas/area_ardougne_west/scripts/doors.rs2:57',
        'Into the mourner headquarters only at ^biohazard_poisoned_stew or ^biohazard_found_distillator wearing a doctor gown; locked once the quest moves on (doors.rs2:69). Leaving is free.',
        'a25b6402',
    ),
    no(
        'not-a-gate',
        'oploc2,brimhavencart',
        'areas/area_brimhaven/scripts/hajedy.rs2:3',
        "The cart's Pay-fare opens Hajedy's dialogue, the cart transport gates.ts CURATED_TRANSPORTS already has.",
        '8da69f15',
    ),
    gate(
        'oploc1,lathastraining_gatel',
        'areas/area_combat_training/scripts/combat_training_camp.rs2:39',
        'quest:biohazard',
    ),
    gate(
        'oploc1,lathastraining_gater',
        'areas/area_combat_training/scripts/combat_training_camp.rs2:39',
        'quest:biohazard',
    ),
    gate(
        'oplocu,brasskeydoor',
        'areas/area_edgeville/scripts/edgeville_dungeon.rs2:6',
        'item:edgevilledungeonkey:held',
    ),
    gate('oploc1,miningguildladder', 'areas/area_falador/scripts/mining_guild.rs2:2', 'skill:mining:60'),
    gate('oploc1,miningguilddoor', 'areas/area_falador/scripts/mining_guild.rs2:11', 'skill:mining:60'),
    no(
        'temporary-block',
        'oploc1,gnome_areagate',
        'areas/area_gnome/scripts/gnome_gate.rs2:3',
        'Shut only while The Grand Tree is at ^grandtree_released_prison (leaving) or ^grandtree_obtained_lumber_order (entering); open otherwise.',
        '23e91af0',
    ),
    no(
        'not-a-gate',
        'oploc1,ent',
        'areas/area_gnome/scripts/spirit_tree.rs2:2',
        'A spirit tree: a transport with a menu of destinations, out of scope (gates.ts TRANSPORTS_OUT_OF_SCOPE).',
        '35e23222',
    ),
    no(
        'not-a-gate',
        'oploc1,stronghold_ent',
        'areas/area_gnome/scripts/spirit_tree.rs2:26',
        'A spirit tree: a transport, out of scope (gates.ts TRANSPORTS_OUT_OF_SCOPE).',
        'ef6f1af2',
    ),
    no(
        'not-a-gate',
        'oploc1,loc_1317',
        'areas/area_gnome/scripts/spirit_tree.rs2:50',
        'A spirit tree: a transport, out of scope (gates.ts TRANSPORTS_OUT_OF_SCOPE).',
        '62801eaa',
    ),
    gate('oploc1,karam_dungeon_stone1', 'areas/area_karamja/scripts/karam_dungeon.rs2:169', 'skill:agility:12', {
        notes: 'Brimhaven Dungeon stepping stones; a failed agility roll drops the player back (karam_dungeon.rs2:189).',
    }),
    gate(
        'oploc1,karam_dungeon_bamboo_logbalance1',
        'areas/area_karamja/scripts/karam_dungeon.rs2:247',
        'skill:agility:30',
    ),
    gate('oploc1,karam_dungeon_pipe', 'areas/area_karamja/scripts/karam_dungeon.rs2:289', 'skill:agility:34', {
        from: 'north',
    }),
    gate('oploc1,karam_dungeon_pipe2', 'areas/area_karamja/scripts/karam_dungeon.rs2:319', 'skill:agility:22', {
        from: 'south',
    }),
    gate('oploc1,dungeon_tree_closed', 'areas/area_karamja/scripts/karam_dungeon.rs2:66', 'coins:875', {
        to: '0_42_149_25_28',
        why: 'Saniboch takes 875 coins (karam_dungeon.rs2:9) and sets %karam_dungeon_varbit, which entering clears (karam_dungeon.rs2:73), so each entry is paid; the scan does not read the varp the payment sets.',
        scan: '89886c91',
    }),
    no(
        'side-effect',
        'oploc1,entranaladdertop',
        'areas/area_entrana/scripts/entrana_dungeon.rs2:2',
        "The ladder goes down only through the cave monk's warning (@cave_monk_chat, cave_monk.rs2:3), on the player choosing to go (cave_monk.rs2:13); one way, and it drains Prayer. The npc_find only finds the monk who says it.",
        '34fabf39',
    ),
    gate(
        'oploc1,_outpost_gate',
        'areas/area_barbarian_outpost/scripts/outpost_gate.rs2:2',
        [
            [
                "other:Alfred Grimhand's Barcrawl done (%barcrawl = ^barcrawl_complete, areas/area_barbarian_outpost/scripts/outpost_gate.rs2:2)",
            ],
        ],
        {
            why: 'Until the Barcrawl is done the guard by the gate (barbguard1, npc_find at outpost_gate.rs2:3) talks instead of opening it (@outpost_guard_talk, barbarian_outpost_guard.rs2:4); the scan reads neither the npc_find nor %barcrawl, a miniquest varp.',
            scan: 'aa535223',
        },
    ),
    ...[
        ['1', '10', 'east', '341d4c70'],
        ['2', '27', 'south', '91047b5a'],
        ['3', '22', 'west', 'e64b64a5'],
        ['4', '34', 'west', '72dc3f66'],
        ['5', '34', 'west', 'c120e950'],
    ].flatMap(([n, level, from, scan]) =>
        ['oploc1', 'oploc3'].map(op =>
            gate(
                `${op},karam_dungeon_vineblocking${n}`,
                `areas/area_karamja/scripts/karam_dungeon.rs2:${op === 'oploc1' ? 104 : 134}`,
                `category:weapon_axe:held skill:woodcutting:${level} | category:weapon_axe:worn skill:woodcutting:${level}`,
                {
                    from: from as Side,
                    why: 'The crossing is a jump between the tiles either side of the vine (@cross_vines), and only from its start tile (karam_dungeon.rs2:79-91) is it checked: the scan sees jumps to fixed tiles, not a crossing.',
                    scan,
                },
            ),
        ),
    ),
    gate('oploc1,zanarismarketdoor', 'areas/area_lostcity/scripts/doorman.rs2:11', 'consume:diamond:1', {
        notes: "Zanaris market: the doorman takes a diamond from outside; from inside it's free (doorman.rs2:29, 38).",
    }),
    no(
        'side-effect',
        'oploc1,zanarisladderout',
        'areas/area_lostcity/scripts/ladder_fairy.rs2:4',
        "The ladder out of Zanaris works through the attendant's dialogue (@fairy_ladder_attendant_talk, ladder_fairy.rs2:8), on the player choosing to leave; one way, to Al Kharid. The npc_findexact only finds the attendant who says it.",
        'd8d233a5',
    ),
    gate(
        'oploc1,magearena_scan',
        'areas/area_mage_arena/scripts/mage_arena.rs2:85',
        [
            [
                'loadout:mage_arena',
                'other:Mage Arena miniquest done (%magearena >= ^mage_arena_complete, areas/area_mage_arena/scripts/mage_arena.rs2:85)',
            ],
        ],
        {
            from: 'north',
            why: 'From the north the barrier checks the Mage Arena miniquest (%magearena, not a quest varp, which the scan does not read) and the arena loadout (~can_enter_mage_arena, gates.ts LOADOUT_PROCS); from the south it lets the player out free (mage_arena.rs2:95).',
            scan: '6f25d0ff',
        },
    ),
    ...(
        [
            ['oploc1,magearena_waterportal1', '0_39_73_13_17', 'e4ce3c0d'],
            ['oploc1,magearena_waterportal2', '0_39_73_46_46', '0486c9bd'],
        ] as const
    ).map(([trigger, to, scan]) =>
        gate(
            trigger,
            'areas/area_mage_arena/scripts/mage_arena.rs2:59',
            [
                [
                    'other:Mage Arena miniquest done (%magearena >= ^mage_arena_complete, areas/area_mage_arena/scripts/mage_arena.rs2:85)',
                ],
            ],
            {
                to,
                why: 'The sparkling pool jumps the player to the god chamber and back (@jump_in_sparkling_pool, mage_arena.rs2:76) only once the Mage Arena miniquest is done (%magearena, not a quest varp, which the scan does not read); before, the player steps in and back out with wet boots (:59). The scan sees both as moves, so proposes no requirement.',
                scan,
            },
        ),
    ),
    gate(
        'oploc1,monasteryladder',
        'areas/monastery/scripts/prayer_guild.rs2:6',
        [
            [
                "other:joined the monks' order (%prayer_guild = 1, set by Abbot Langley at areas/monastery/scripts/prayer_guild.rs2:32)",
                'skill:prayer:31',
            ],
        ],
        {
            why: 'Up the ladder only for members of the order: %prayer_guild, which Abbot Langley sets when the player joins with base Prayer 31 (prayer_guild.rs2:28-32); the scan does not read the varp.',
            scan: '2ca76188',
        },
    ),
    gate('oploc1,pip_underground_door1', 'areas/area_mausoleum/scripts/gates.rs2:8', 'quest:priestperil>=5'),
    gate('oploc1,pip_underground_door2', 'areas/area_mausoleum/scripts/gates.rs2:8', 'quest:priestperil>=8'),
    gate(
        'oploc1,pip_underground_wall_side_withportal',
        'areas/area_mausoleum/scripts/holy_barrier.rs2:2',
        'quest:priestperil>=61',
        {
            to: '0_53_54_31_29',
            notes: "The holy barrier into Morytania: open at ^priestperil_access_holy_barrier, set by talking to Drezel after the quest's completion (areas/area_mausoleum/scripts/drezel.rs2:134).",
        },
    ),
    gate('oploc1,paramayaladderup', 'areas/area_shilo/scripts/kaleb_paramaya.rs2:2', 'consume:paramayaticket:1'),
    no(
        'not-a-gate',
        'oploc2,shilocart',
        'areas/area_shilo/scripts/vigroy.rs2:3',
        "The cart's Pay-fare opens Vigroy's dialogue, the cart transport gates.ts CURATED_TRANSPORTS already has.",
        'ed6460a3',
    ),
    gate('oploc1,shilofurnacedoor', 'areas/area_shilo/scripts/yohnus.rs2:11', 'coins:20', { from: 'loc' }),
    gate('oplocu,dungeonjail', 'areas/area_taverly/dungeon/scripts/jail_doors.rs2:3', 'item:jail_key:held'),
    gate('oplocu,deepdungeondoor', 'areas/area_taverly/dungeon/scripts/jail_doors.rs2:10', 'item:dusty_key:held'),
    no(
        'side-effect',
        'oploc1,cauldrondoor',
        'areas/area_taverly/dungeon/scripts/prison_doors.rs2:6',
        'From outside, the first tries bring the suits of armour at 0_45_153_7_40 and 0_45_153_7_37 to life (prison_doors.rs2:6-19), each gone for 500 ticks; with both gone the door opens. The loc_find checks are on the suits, not on the player.',
        '35c101a9',
    ),
    no(
        'side-effect',
        'oploc1,cauldrondoor_l',
        'areas/area_taverly/dungeon/scripts/prison_doors.rs2:6',
        'The left door of cauldrondoor, the same label (prison_doors.rs2:26).',
        '35c101a9',
    ),
    gate('oploc1,_varrock_gate', 'areas/area_varrock/scripts/east_gate.rs2:5', 'members', {
        notes: 'Varrock east gate; between ^biohazard_given_distillator and ^biohazard_found_secret a guard searches the player first (east_gate.rs2:14), which only takes the Biohazard vials.',
    }),
    gate('oploc1,championdoor', 'areas/area_varrock/scripts/champions_guild.rs2:1', 'questpoints:32'),
    gate(
        'oploc2,herorockslide',
        'areas/area_white_wolf_mountain/scripts/white_wolf_mountain.rs2:20',
        'category:weapon_pickaxe:held skill:mining:50 | category:weapon_pickaxe:worn skill:mining:50',
    ),
    gate('oploc1,obstical_pipe4', 'areas/area_yanille/scripts/agility_dungeon.rs2:2', 'skill:agility:49'),
    no(
        'side-effect',
        'oploc1,trappedchaosaltar',
        'areas/area_yanille/scripts/agility_dungeon.rs2:128',
        'The prayer check only picks the message; praying always drops the player through the trapdoor.',
        '03241260',
    ),
    gate('oploc1,balancing_ledge3', 'areas/area_yanille/scripts/agility_dungeon.rs2:31', 'skill:agility:40'),
    gate('oploc1,climbingcaverocks1', 'areas/area_yanille/scripts/agility_dungeon.rs2:86', 'skill:agility:67', {
        to: '0_40_148_55_34',
    }),
    gate('oploc1,magicguild_door_l', 'areas/area_yanille/scripts/magic_guild.rs2:11', 'skill:magic:66', {
        from: 'loc',
    }),
    gate('oploc1,magicguild_door_r', 'areas/area_yanille/scripts/magic_guild.rs2:11', 'skill:magic:66', {
        from: 'loc',
    }),
    gate('oploc1,herodoor_l', 'areas/areas_heroes_guild/scripts/heroes_entrance.rs2:5', 'quest:hero', {
        why: "The parser stops at the label's brace-wrapped body (heroes_entrance.rs2:4); it opens at ^hero_complete, else Achietties talks.",
        scan: '57a0c6b5',
    }),
    gate('oploc1,herodoor_r', 'areas/areas_heroes_guild/scripts/heroes_entrance.rs2:5', 'quest:hero', {
        why: "The parser stops at the label's brace-wrapped body (heroes_entrance.rs2:4); it opens at ^hero_complete, else Achietties talks.",
        scan: '57a0c6b5',
    }),
    // doors/
    gate('oploc1,membergatel', 'doors/scripts/doubledoors.rs2:27', 'members'),
    gate('oploc1,membergater', 'doors/scripts/doubledoors.rs2:34', 'members'),
    // ladders+stairs/
    gate('oploc1,ladder', 'quests/quest_mcannon/scripts/locs/mcannon_ladders.rs2:2', 'quest:mcannon>=2', {
        at: ['0_40_53_10_49'],
        stages: { 'quest:mcannon>=2': '^mcannon_tasked_with_checking_guard_tower' },
        why: 'The generic ladder; at the Dwarf Guard Tower (0_40_53_10_49, ladders.rs2:52) the trap door opens only from ^mcannon_tasked_with_checking_guard_tower (@ladder_to_dwarf_remains), a loc_coord case the scan takes both ways.',
        scan: '83d1dd66',
    }),
    no(
        'not-a-gate',
        'oploc1,castlewars_topstair',
        'ladders+stairs/scripts/stairs.rs2:549',
        'Castle Wars stairs: the check stops a player carrying their own banner, inside the minigame.',
        '32f10f29',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_outsidestairs_saradomin_linked',
        'ladders+stairs/scripts/stairs.rs2:592',
        'Castle Wars stairs: the check stops a player carrying their own banner, inside the minigame.',
        '2e0b4022',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_outsidestairs_zamorak_linked',
        'ladders+stairs/scripts/stairs.rs2:611',
        'Castle Wars stairs: the check stops a player carrying their own banner, inside the minigame.',
        'fe8a10cd',
    ),
    // minigames/
    no(
        'not-a-gate',
        'oploc1,agilityarena_handholds',
        'minigames/game_agilityarena/scripts/agilityarena.rs2:223',
        'An obstacle inside the Brimhaven Agility Arena, a minigame.',
        '4fdff23e',
    ),
    gate('oploc1,agilityarena_ladderdown', 'minigames/game_agilityarena/scripts/agilityarena.rs2:2', 'coins:200', {
        why: "Cap'n Izzy takes 200 coins and sets ^agilityarena_paid (agilityarena_clerk.rs2:50, 73); leaving clears it with the pillar bits (agilityarena.rs2:29), so each entry is paid. The scan does not read the bit the payment sets.",
        scan: '02f61354',
    }),
    no(
        'not-a-gate',
        'oploc1,boardgames_draughts_ladderup_experienced',
        'minigames/game_gamesroom/boardgames_draughts/scripts/boardgames_draughts.rs2:1202',
        "The games room ladder up to the experienced players' floor, for a board game rank of 1500 (%boardgames_draughts_rank); inside a minigame.",
        '0ab41a55',
    ),
    no(
        'not-a-gate',
        'oploc1,boardgames_runelink_ladderup_experienced',
        'minigames/game_gamesroom/boardgames_runelink/scripts/boardgames_runelink.rs2:900',
        "The games room ladder up to the experienced players' floor, for a board game rank of 1500 (%boardgames_runelink_rank); inside a minigame.",
        'bae0c407',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_zamorak_exit',
        'minigames/game_castlewars/scripts/castlewars.rs2:66',
        'Castle Wars: leaves the game, inside the minigame.',
        '83d1dd66',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_saradomin_exit',
        'minigames/game_castlewars/scripts/castlewars.rs2:70',
        'Castle Wars: leaves the game, inside the minigame.',
        '83d1dd66',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_saradomin_quit',
        'minigames/game_castlewars/scripts/castlewars_locs.rs2:25',
        'Castle Wars: leaves the waiting room, inside the minigame.',
        '5acb4298',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_zamorak_quit',
        'minigames/game_castlewars/scripts/castlewars_locs.rs2:34',
        'Castle Wars: leaves the waiting room, inside the minigame.',
        '5acb4298',
    ),
    no(
        'not-a-gate',
        'oplocu,castlewars_saradomin_brokendoorr',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:162',
        'Castle Wars: repairing a broken door, inside the minigame.',
        '4b481186',
    ),
    no(
        'not-a-gate',
        'oplocu,castlewars_saradomin_brokendoorl',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:172',
        'Castle Wars: repairing a broken door, inside the minigame.',
        '4b481186',
    ),
    no(
        'not-a-gate',
        'oplocu,castlewars_zamorak_brokendoorr',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:182',
        'Castle Wars: repairing a broken door, inside the minigame.',
        'e7bcd67d',
    ),
    no(
        'not-a-gate',
        'oplocu,castlewars_zamorak_brokendoorl',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:192',
        'Castle Wars: repairing a broken door, inside the minigame.',
        'e7bcd67d',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_random_tele',
        'minigames/game_castlewars/scripts/castlewars.rs2:46',
        'Castle Wars: the lobby portal that joins a game on a random team, inside the minigame.',
        '09daae52',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_saradomin_tele',
        'minigames/game_castlewars/scripts/castlewars.rs2:26',
        "Castle Wars: the lobby portal that joins a game on Saradomin's team, inside the minigame.",
        '953773a1',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_zamorak_tele',
        'minigames/game_castlewars/scripts/castlewars.rs2:6',
        "Castle Wars: the lobby portal that joins a game on Zamorak's team, inside the minigame.",
        '151044eb',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_saradomin_brokendoorl',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:142',
        "Castle Wars: Saradomin's broken main door, which its team repairs, inside the minigame.",
        '2fa2f1e7',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_saradomin_brokendoorr',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:136',
        "Castle Wars: Saradomin's broken main door, which its team repairs, inside the minigame.",
        '2fa2f1e7',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_zamorak_brokendoorl',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:154',
        "Castle Wars: Zamorak's broken main door, which its team repairs, inside the minigame.",
        '2d244ac8',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_zamorak_brokendoorr',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:148',
        "Castle Wars: Zamorak's broken main door, which its team repairs, inside the minigame.",
        '2d244ac8',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_saradomin_spawndoor',
        'minigames/game_castlewars/scripts/castlewars_locs.rs2:1',
        "Castle Wars: Saradomin's spawn room door, for its own team, inside the minigame.",
        'abc375ce',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_saradomin_spawntrapdoor',
        'minigames/game_castlewars/scripts/castlewars_locs.rs2:56',
        "Castle Wars: Saradomin's spawn room trapdoor, for its own team, inside the minigame.",
        'abc375ce',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_zamorak_spawndoor',
        'minigames/game_castlewars/scripts/castlewars_locs.rs2:13',
        "Castle Wars: Zamorak's spawn room door, for its own team, inside the minigame.",
        'deb644ff',
    ),
    no(
        'not-a-gate',
        'oploc1,castlewars_zamorak_spawntrapdoor',
        'minigames/game_castlewars/scripts/castlewars_locs.rs2:43',
        "Castle Wars: Zamorak's spawn room trapdoor, for its own team, inside the minigame.",
        'deb644ff',
    ),
    no(
        'not-a-gate',
        'oploc2,castlewars_saradomin_maindoorl',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:29',
        "Castle Wars: attacking Saradomin's main door, inside the minigame.",
        'd1cdaf66',
    ),
    no(
        'not-a-gate',
        'oploc2,castlewars_saradomin_maindoorr',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:37',
        "Castle Wars: attacking Saradomin's main door, inside the minigame.",
        'd1cdaf66',
    ),
    no(
        'not-a-gate',
        'oploc2,castlewars_zamorak_maindoorl',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:45',
        "Castle Wars: attacking Zamorak's main door, inside the minigame.",
        'a47f13a0',
    ),
    no(
        'not-a-gate',
        'oploc2,castlewars_zamorak_maindoorr',
        'minigames/game_castlewars/scripts/castlewars_maindoor.rs2:53',
        "Castle Wars: attacking Zamorak's main door, inside the minigame.",
        'a47f13a0',
    ),
    no(
        'not-a-gate',
        'oploc5,duel_arena_top',
        'minigames/game_duelarena/scripts/duel_arena_lean.rs2:1',
        'Leaning on the Duel Arena wall to watch the fights: the player steps onto the wall (@lean_on_wall, duel_arena_lean.rs2:9-18); not passage.',
        '66aa916a',
    ),
    no(
        'not-a-gate',
        'oploc5,duel_arena_topwithflag',
        'minigames/game_duelarena/scripts/duel_arena_lean.rs2:2',
        'Leaning on the Duel Arena wall to watch the fights: the player steps onto the wall (@lean_on_wall, duel_arena_lean.rs2:9-18); not passage.',
        '66aa916a',
    ),
    no(
        'not-a-gate',
        'oploc5,duel_arena_top_aged',
        'minigames/game_duelarena/scripts/duel_arena_lean.rs2:3',
        'Leaning on the Duel Arena wall to watch the fights: the player steps onto the wall (@lean_on_wall, duel_arena_lean.rs2:9-18); not passage.',
        '66aa916a',
    ),
    no(
        'not-a-gate',
        'oploc5,duel_arena_top_aged_3',
        'minigames/game_duelarena/scripts/duel_arena_lean.rs2:4',
        'Leaning on the Duel Arena wall to watch the fights: the player steps onto the wall (@lean_on_wall, duel_arena_lean.rs2:9-18); not passage.',
        '66aa916a',
    ),
    no(
        'not-a-gate',
        'oploc5,duel_arena_top_aged_4',
        'minigames/game_duelarena/scripts/duel_arena_lean.rs2:5',
        'Leaning on the Duel Arena wall to watch the fights: the player steps onto the wall (@lean_on_wall, duel_arena_lean.rs2:9-18); not passage.',
        '66aa916a',
    ),
    no(
        'not-a-gate',
        'oploc1,flag_entrance_angled',
        'minigames/game_duelarena/scripts/duel_forfeit.rs2:8',
        "Forfeiting a duel: the Duel Arena's flags and trapdoor (@duel_forfeit, duel_forfeit.rs2:7) queue [queue,duel_finish], which puts the duellists outside the arena (~duel_reset_all, duel_arena_finish.rs2:75); inside the minigame, not passage a bot walks.",
        '57a0c6b5',
    ),
    no(
        'not-a-gate',
        'oploc1,flag_entrance2_angled',
        'minigames/game_duelarena/scripts/duel_forfeit.rs2:8',
        'Forfeiting a duel, as flag_entrance_angled.',
        '57a0c6b5',
    ),
    no(
        'not-a-gate',
        'oploc1,flag_entrancel_angled',
        'minigames/game_duelarena/scripts/duel_forfeit.rs2:8',
        'Forfeiting a duel, as flag_entrance_angled.',
        '57a0c6b5',
    ),
    no(
        'not-a-gate',
        'oploc1,flag_entrance2l_angled',
        'minigames/game_duelarena/scripts/duel_forfeit.rs2:8',
        'Forfeiting a duel, as flag_entrance_angled.',
        '57a0c6b5',
    ),
    no(
        'not-a-gate',
        'oploc1,arena_trapdoor',
        'minigames/game_duelarena/scripts/duel_forfeit.rs2:8',
        'Forfeiting a duel, as flag_entrance_angled.',
        '57a0c6b5',
    ),
    no(
        'not-a-gate',
        'oploc1,gate_gnomeball_game',
        'minigames/game_gnomeball/scripts/gnomeball.rs2:23',
        'Into the Gnome Ball field, a minigame; the hand-slot check only needs room to unequip what the player holds (gnomeball.rs2:23-31).',
        'bf2a786e',
    ),
    gate(
        'oploc1,shadelair_steeldoor',
        'minigames/game_mortton/scripts/mortton_catacombs.rs2:92',
        'category:category_113:held | category:category_114:held | category:category_115:held',
        { from: 'loc' },
    ),
    gate(
        'oploc1,shadelair_blackdoor',
        'minigames/game_mortton/scripts/mortton_catacombs.rs2:102',
        'category:category_114:held | category:category_115:held',
        { from: 'loc' },
    ),
    gate(
        'oploc1,shadelair_silverdoor',
        'minigames/game_mortton/scripts/mortton_catacombs.rs2:112',
        'category:category_115:held',
        { from: 'loc' },
    ),
    gate(
        'oploc1,shadelairentrancel',
        'minigames/game_mortton/scripts/mortton_catacombs.rs2:3',
        [
            [
                'category:category_112:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_113:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_114:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_115:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
        ],
        {
            to: '0_54_151_37_61',
            stages: { 'quest:mortton>=80': '^mortton_lit_pyre' },
            why: "Into the Shade catacombs with any shade key (~get_shadekeys_total, mortton_catacombs.rs2:134) once Razmire has told the player where the lair is, which he does from ^mortton_lit_pyre (razmire_keelgan.rs2:123-125); the scan reads neither the proc's sum nor the bit.",
            scan: 'ed8e6189',
        },
    ),
    gate(
        'oplocu,shadelairentrancel',
        'minigames/game_mortton/scripts/mortton_catacombs.rs2:23',
        [
            [
                'category:category_112:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_113:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_114:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_115:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
        ],
        {
            to: '0_54_151_37_61',
            stages: { 'quest:mortton>=80': '^mortton_lit_pyre' },
            why: "Into the Shade catacombs with any shade key (~get_shadekeys_total, mortton_catacombs.rs2:134) once Razmire has told the player where the lair is, which he does from ^mortton_lit_pyre (razmire_keelgan.rs2:123-125); the scan reads neither the proc's sum nor the bit.",
            scan: '903e6207',
        },
    ),
    gate(
        'oploc1,shadelairentrancer',
        'minigames/game_mortton/scripts/mortton_catacombs.rs2:44',
        [
            [
                'category:category_112:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_113:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_114:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_115:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
        ],
        {
            to: '0_54_151_37_61',
            stages: { 'quest:mortton>=80': '^mortton_lit_pyre' },
            why: "Into the Shade catacombs with any shade key (~get_shadekeys_total, mortton_catacombs.rs2:134) once Razmire has told the player where the lair is, which he does from ^mortton_lit_pyre (razmire_keelgan.rs2:123-125); the scan reads neither the proc's sum nor the bit.",
            scan: 'ed8e6189',
        },
    ),
    gate(
        'oplocu,shadelairentrancer',
        'minigames/game_mortton/scripts/mortton_catacombs.rs2:64',
        [
            [
                'category:category_112:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_113:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_114:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
            [
                'category:category_115:held',
                'other:asked Razmire where the Shade lair is (bit ^mortton_unlocked_shade_lair of %morttonmulti, quests/quest_mortton/scripts/razmire_keelgan.rs2:125)',
                'quest:mortton>=80',
            ],
        ],
        {
            to: '0_54_151_37_61',
            stages: { 'quest:mortton>=80': '^mortton_lit_pyre' },
            why: "Into the Shade catacombs with any shade key (~get_shadekeys_total, mortton_catacombs.rs2:134) once Razmire has told the player where the lair is, which he does from ^mortton_lit_pyre (razmire_keelgan.rs2:123-125); the scan reads neither the proc's sum nor the bit.",
            scan: '903e6207',
        },
    ),
    gate('oploc1,ranging_guild_door', 'minigames/game_ranging/scripts/ranging_guild_door.rs2:17', 'skill:ranged:40', {
        from: 'west',
        why: 'A diagonal door (shape 9): the check applies from its north-west side, outside the guild (x <= the loc and z >= it, ranging_guild_door.rs2:2), which Side names only by one compass point.',
        scan: '301318a8',
    }),
    // skill_*/
    gate('oploc1,barbarian_obstacle_pipe', 'skill_agility/scripts/barbarian_course.rs2:126', 'skill:agility:35', {
        from: 'north',
    }),
    gate('oploc1,castlecrumbly', 'skill_agility/scripts/shortcuts.rs2:2', 'members skill:agility:5', {
        from: 'west',
        oneWay: true,
        notes: 'Climbed west to east only: from the east the script refuses (shortcuts.rs2:6).',
    }),
    gate('oploc1,_island_rope_swing', 'skill_agility/scripts/shortcuts.rs2:121', 'skill:agility:10', {
        why: "The 10 Agility check skips tree_ropeswing2, the inner Brimhaven / Ogre Isle swing (shortcuts.rs2:121), a loc_type test the scan doesn't read.",
        byConfig: { tree_ropeswing2: '' },
        scan: '9289b7d8',
    }),
    gate('oploc1,_monkeybars', 'skill_agility/scripts/shortcuts.rs2:153', 'skill:agility:57', {
        why: "The level is the loc's agil_level_req param (57 in the Yanille agility dungeon, 15 in the Edgeville dungeon), which the scan doesn't read.",
        byConfig: { monkeybars_end2: 'skill:agility:57', loc_2320: 'skill:agility:15' },
        notes: 'Free from the bars at z 9489 and 9969 (shortcuts.rs2:153), so checked only from one end of each set.',
        scan: 'f546a955',
    }),
    gate('oploc1,watchshortcut', 'skill_agility/scripts/shortcuts.rs2:17', 'skill:agility:5'),
    gate('oploc1,mine_log_balance1', 'skill_agility/scripts/shortcuts.rs2:27', 'skill:agility:20'),
    gate('oploc1,loc_2309', 'skill_agility/scripts/wilderness_course.rs2:2', 'skill:agility:52'),
    gate('oploc1,obstical_pipe2', 'skill_agility/scripts/wilderness_course.rs2:53', 'skill:agility:49'),
    gate('oploc1,chefdoor', 'skill_cooking/scripts/cooking_guild.rs2:4', 'item:chefs_hat:worn skill:cooking:32', {
        from: 'far',
    }),
    gate(
        'oploc1,crafting_guild_door',
        'skill_crafting/scripts/crafting_guild/crafting_guild.rs2:3',
        'item:brown_apron:worn skill:crafting:40',
        { from: 'loc' },
    ),
    gate('oploc1,loc_2025', 'skill_fishing/scripts/fishing_guild.rs2:5', 'skill:fishing:68', { from: 'far' }),
    no(
        'not-a-gate',
        'oploc1,blankrunestone_exit_portal',
        'skill_runecraft/scripts/essence_mine.rs2:28',
        'The rune essence mine exit portal: a teleport back to the wizard the player came from, which gates.ts NPC_TELEPORTS gives as crossing rows.',
        '83d1dd66',
    ),
    no(
        'not-a-gate',
        'oplocu,_rc_ruins',
        'skill_runecraft/scripts/runecraft.rs2:20',
        'A talisman on the runecrafting ruins: a teleport to a coord of its runecraft_table row, which gates.ts DBROW_TELEPORTS gives as crossing rows.',
        '1208fd69',
    ),
    ...['chest_10_coins', 'chest_nature_rune', 'chest_50_coins', 'chest_blood_runes', 'chest_ardougne_castle'].map(
        (chest, i) =>
            no(
                'not-a-gate',
                `oploc2,${chest}`,
                `skill_thieving/scripts/chest/trapped_chest.rs2:${[19, 22, 25, 31, 34][i]}`,
                "A thieving chest: looting it can move the player to its dbrow's tele_coord (trapped_chest.rs2's ~disarm_trapped_chest), which is not passage.",
                '328f2c5c',
            ),
    ),
    ...[
        'loc_2550',
        'loc_2551',
        'east_ardy_sewer_gate_north',
        'east_ardy_sewer_gate_south',
        'loc_2554',
        'loc_2555',
        'loc_2556',
        'loc_2557',
        'loc_2558',
        'loc_2559',
    ].flatMap(door => [
        no(
            'not-a-gate',
            `oploc1,${door}`,
            'skill_thieving/scripts/doors/locked_door.rs2:102',
            'Open goes through only from the unlocked side, freely (~attempt_open_locked_door); the locked side crosses by Pick-lock, the gate (oploc2).',
            'f3b292dc',
        ),
    ]),
    ...(
        [
            ['loc_2550', 1, 'loc'],
            ['loc_2551', 16, 'loc'],
            ['east_ardy_sewer_gate_north', 31, 'loc'],
            ['east_ardy_sewer_gate_south', 31, 'loc'],
            ['loc_2554', 46, 'loc'],
            ['loc_2555', 61, 'loc'],
            ['loc_2556', 13, 'loc'],
            ['loc_2557', 23, 'loc'],
            ['loc_2558', 39, 'far'],
            ['loc_2559', 82, 'far'],
        ] as const
    ).flatMap(([door, level, from]) => {
        const tool = ['loc_2557', 'loc_2558', 'loc_2559'].includes(door) ? 'item:lockpick:held ' : '';
        const why =
            'The level, tool and which side is locked are fields of its locked_door dbrow (skill_thieving/configs/doors/locked_door.dbrow), which the scan does not read; from the unlocked side it is free.';
        return [
            gate(
                `oploc2,${door}`,
                'skill_thieving/scripts/doors/locked_door.rs2:154',
                `${tool}members skill:thieving:${level}`,
                { from, why, scan: 'fda40776' },
            ),
            ...(tool
                ? [
                      gate(
                          `oplocu,${door}`,
                          'skill_thieving/scripts/doors/locked_door.rs2:154',
                          `item:lockpick:held members skill:thieving:${level}`,
                          { from, why, scan: '0871505e' },
                      ),
                  ]
                : []),
        ];
    }),
    no(
        'not-a-gate',
        'oploc1,_rc_exit_portal',
        'skill_runecraft/scripts/runecraft.rs2:1',
        "A runecrafting temple's exit portal: a teleport to a coord of its runecraft_table row, which gates.ts DBROW_TELEPORTS gives as crossing rows.",
        '71c06a11',
    ),
    // quests/ (Fight Arena to Dragon Slayer)
    no(
        'quest-window',
        'oploc1,fightarena_door1',
        'quests/quest_arena/scripts/quest_arena.rs2:42',
        'Into the Fight Arena only mid-quest (Khazard armour from ^arena_obtained_armour, or sent to jail); once the quest is done the guards attack. Leaving is free.',
        '3f3ad327',
    ),
    no(
        'quest-window',
        'oplocu,arena_jeremydoor',
        'quests/quest_arena/scripts/quest_arena.rs2:79',
        "Jeremy's cell opens with the cell keys only at ^arena_given_khali_brew.",
        'f9772770',
    ),
    no(
        'quest-window',
        'oploc1,fightarena_door2',
        'quests/quest_arena/scripts/quest_arena.rs2:95',
        'The arena door opens only at Fight Arena stages (^arena_entered_ogre_fight, ^arena_defeated_ogre, or as the guards move the player); after the quest the guards attack.',
        '83f351b5',
    ),
    no(
        'not-a-gate',
        'oploc2,merlincrate_empty',
        'quests/quest_arthur/scripts/quest_arthur.rs2:3',
        "Hiding in Arhein's crate ships the player to Keep Le Faye from ^arthur_spoken_lancelot: a quest transport, out of scope.",
        '762298d7',
    ),
    no(
        'side-effect',
        'oploc1,jewellersdoor',
        'quests/quest_arthur/scripts/quest_arthur.rs2:211',
        'The Excalibur checks only spawn the lake beggar; the door always opens.',
        '83d1dd66',
    ),
    no(
        'quest-window',
        'oploc1,witchhousedoor',
        'quests/quest_ball/scripts/quest_ball.rs2:25',
        "Into the Witch's House only during the quest (from ^ball_started, not at ^ball_complete) with its door key; leaving is free.",
        '75e62830',
    ),
    no(
        'quest-window',
        'oplocu,witchhousedoor',
        'quests/quest_ball/scripts/quest_ball.rs2:25',
        "The door key on the Witch's House door: as oploc1, in only during the quest.",
        '75e62830',
    ),
    gate('oploc1,witchbackdoor', 'quests/quest_ball/scripts/quest_ball.rs2:120', 'quest:ball>=3'),
    gate('oploc1,witchsheddoor', 'quests/quest_ball/scripts/quest_ball.rs2:128', 'quest:ball>=6'),
    gate('oplocu,witchsheddoor', 'quests/quest_ball/scripts/quest_ball.rs2:135', 'item:witches_shedkey:held'),
    gate('oploc1,_ball_irongate', 'quests/quest_ball/scripts/quest_ball.rs2:34', 'item:leather_gloves:worn'),
    gate(
        'oploc1,guidordoor',
        'quests/quest_biohazard/scripts/quest_biohazard.rs2:7',
        'item:priest_gown:worn item:priest_robe:worn members quest:biohazard>=12',
        { from: 'loc' },
    ),
    gate(
        'oploc1,mournerquaters_gatel',
        'quests/quest_biohazard/scripts/quest_biohazard.rs2:135',
        'item:mournerkeytw:held',
        { from: 'loc' },
    ),
    gate(
        'oploc1,mournerquaters_gater',
        'quests/quest_biohazard/scripts/quest_biohazard.rs2:135',
        'item:mournerkeytw:held',
        { from: 'loc' },
    ),
    gate(
        'oplocu,mournerquaters_gatel',
        'quests/quest_biohazard/scripts/quest_biohazard.rs2:122',
        'item:mournerkeytw:held',
    ),
    gate(
        'oplocu,mournerquaters_gater',
        'quests/quest_biohazard/scripts/quest_biohazard.rs2:126',
        'item:mournerkeytw:held',
    ),
    gate(
        'oploc1,phoenixdoor',
        'quests/quest_blackarmgang/scripts/quest_blackarmgang.rs2:17',
        [['other:`%phoenixgang >= ^phoenixgang_joined` (quests/quest_blackarmgang/scripts/quest_blackarmgang.rs2:17)']],
        {
            from: 'far',
            notes: 'The Phoenix Gang hideout: joined the Phoenix Gang, a stage of %phoenixgang, which Shield of Arrav counts as an `or` varp (Quest.or) with no stage form.',
        },
    ),
    gate('oplocu,phoenixdoor2', 'quests/quest_blackarmgang/scripts/quest_blackarmgang.rs2:47', 'item:phoenixkey2:held'),
    gate(
        'oploc1,bkfortressdoor1',
        'quests/quest_blackknight/scripts/quest_blackknight.rs2:16',
        'item:bronze_med_helm:worn item:iron_chainbody:worn',
        { from: 'loc' },
    ),
    no(
        'side-effect',
        'oploc1,bkfortressdoor2',
        'quests/quest_blackknight/scripts/quest_blackknight.rs2:60',
        "From outside, the fortress guard warns the player off (@blackknight_banquet_hall_fortressguard, quest_blackknight.rs2:68) and the door opens on choosing to go in anyway (quest_blackknight.rs2:75), setting the Black Knights on them; the npc_find only puts the guard's warning first.",
        '7f42e466',
    ),
    no(
        'quest-window',
        'oploc1,loc_2854',
        'quests/quest_hazeelcult/scripts/quest_hazeelcult.rs2:73',
        "Hazeel Cult's secret passage opens only on the evil side, from ^hazeelcult_finished_side_task until the quest is done.",
        'd31098e9',
    ),
    no(
        'not-a-gate',
        'oploc1,hazeelsewerraft',
        'quests/quest_hazeelcult/scripts/quest_hazeelcult.rs2:11',
        'The Hazeel Cult sewer raft: where it lands depends on the sewer valves the player turns (a quest puzzle), and from anywhere but its start it drifts back to the entrance (quest_hazeelcult.rs2:12-15); not steady passage.',
        '61b3b6a3',
    ),
    gate(
        'oploc1,wydindoor',
        'quests/quest_hunt/scripts/food_store.rs2:6',
        [
            [
                'item:white_apron:worn',
                'other:employed by Wydin (bit ^hunt_fetch_rum of %hunt_store_employed, quests/quest_hunt/scripts/food_store.rs2:6)',
            ],
        ],
        {
            from: 'loc',
            why: "Into Wydin's back room only as his employee (a bit of %hunt_store_employed) wearing a white apron, when he is near (npc_find, food_store.rs2:5); the scan does not read the bit or the worn-slot test past the npc check.",
            scan: 'b6ff5ee9',
        },
    ),
    gate(
        'oploc1,blackarmdoor',
        'quests/quest_blackarmgang/scripts/quest_blackarmgang.rs2:101',
        'quest:blackarmgang>=3',
    ),
    no(
        'not-a-gate',
        'oploc1,famcrest_doori2h1',
        'quests/quest_crest/scripts/quest_crest.rs2:80',
        'Opens when Family Crest is done or its levers are set (bits of %crest_spells_levers_gauntlets), a puzzle any player can set.',
        '907bbc10',
    ),
    no(
        'not-a-gate',
        'oploc1,famcrest_doorh2g1',
        'quests/quest_crest/scripts/quest_crest.rs2:49',
        'A Family Crest lever puzzle door: which doors open depends on the levers the player sets (%crest_spells_levers_gauntlets); not steady passage.',
        'fe77fb56',
    ),
    no(
        'not-a-gate',
        'oploc1,famcrest_doorh2',
        'quests/quest_crest/scripts/quest_crest.rs2:59',
        'A Family Crest lever puzzle door: which doors open depends on the levers the player sets (%crest_spells_levers_gauntlets); not steady passage.',
        'f4c24239',
    ),
    no(
        'not-a-gate',
        'oploc1,famcrest_doorg2h1',
        'quests/quest_crest/scripts/quest_crest.rs2:69',
        'A Family Crest lever puzzle door: which doors open depends on the levers the player sets (%crest_spells_levers_gauntlets); not steady passage.',
        'e7d54edc',
    ),
    gate(
        'oploc1,death_climbingrocks_top',
        'quests/quest_death/scripts/quest_death.rs2:160',
        'item:death_climbingboots:worn',
    ),
    gate(
        'oploc1,death_climbingrocks_bottom',
        'quests/quest_death/scripts/quest_death.rs2:170',
        'item:death_climbingboots:worn',
    ),
    gate('oploc1,death_castledoor', 'quests/quest_death/scripts/quest_death.rs2:74', 'quest:death>=70'),
    gate('oploc1,death_harold_door', 'quests/quest_death/scripts/quest_death.rs2:15', 'quest:death>=20', {
        from: 'loc',
    }),
    gate(
        'oploc1,death_sherpa_door',
        'quests/quest_death/scripts/quest_death.rs2:48',
        [
            [
                'other:Death Plateau: spoken to Saba (~death_get_map >= ^death_spoken_saba, quests/quest_death/scripts/quest_death.rs2:56)',
            ],
            ['quest:death'],
        ],
        {
            from: 'far',
            why: "Into Tenzing's house once the Death Plateau map step (bits of %death_map, ~death_get_map at quest_death.rs2:204) reaches ^death_spoken_tenzing, or ^death_spoken_saba through Tenzing's dialogue (quest_death.rs2:56); the scan does not read the proc. Leaving is free (quest_death.rs2:48).",
            scan: '815829a6',
        },
    ),
    gate(
        'oploc1,death_sherpa_backdoor',
        'quests/quest_death/scripts/quest_death.rs2:65',
        [
            [
                "other:Death Plateau: Tenzing's map got (~death_get_map >= ^death_got_map, quests/quest_death/scripts/quest_death.rs2:65)",
            ],
            ['quest:death'],
        ],
        {
            from: 'loc',
            why: "Out of Tenzing's back door once the Death Plateau map step (~death_get_map, quest_death.rs2:204) reaches ^death_got_map; the scan does not read the proc. Coming in that way is free (quest_death.rs2:65).",
            scan: '2be0f920',
        },
    ),
    no(
        'quest-window',
        'oploc1,bedabin_tentdoor',
        'quests/quest_desertrescue/scripts/bedabin_nomad_guard.rs2:43',
        'The Bedabin tent opens only between gaining access (a bit of %desertrescue_map_mechanisms) and ^desertrescue_learned_darts.',
        '908142ac',
    ),
    no(
        'side-effect',
        'oploc2,cell_escape_window',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:203',
        "Bending the cell bar is a Strength roll, then the player squeezes through either way; the check read only stops a player carrying Ana's barrel.",
        '83d1dd66',
    ),
    gate(
        'oplocu,capt_siad_cell_door',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:281',
        'item:thcelldoorkey:held',
    ),
    no(
        'quest-window',
        'oploc2,loc_2682',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:359',
        "Riding the mine cart out of the camp only while Ana's rescue is set up (bit ^desertrescue_ready_rescue of %desertrescue_map_mechanisms).",
        '888cede9',
    ),
    no(
        'side-effect',
        'oploc2,touristtrap_minecart',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:826',
        'The mine cart between the barrel room and the mine always rides (after an agility roll); the stage check only advances the quest.',
        'b5123508',
    ),
    ...[
        'oploc1,miningcampgateclosedl',
        'oploc1,miningcampgateclosedr',
        'oplocu,miningcampgateclosedl',
        'oplocu,miningcampgateclosedr',
    ].map(trigger =>
        gate(trigger, 'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:119', 'item:metal_key:held', {
            why: 'The camp gates open either way with the metal key held (~open_desertcamp_gate); the guards searching the player (~desertcamp_guard_search) take the walker past its path bound.',
            notes: 'Leaving in slave clothes near a guard gets the player searched instead (quest_desertrescue.rs2:110).',
            scan: trigger.startsWith('oplocu,') ? 'f31e7783' : 'f31e7783',
        }),
    ),
    ...['oploc1,thttmineentrancel', 'oploc1,thttmineentrancer', 'oploc1,thttmineexitl', 'oploc1,thttmineexitr'].map(
        trigger =>
            gate(
                trigger,
                'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:425',
                'item:slave_boots:worn item:slave_robe:worn item:slave_shirt:worn',
                {
                    why: "The mine doors open either way in slave robes (~wearing_slave_robes, quest_desertrescue.rs2:465); the guards' search takes the walker past its path bound.",
                    scan: '6468318a',
                },
            ),
    ),
    gate(
        'oploc1,_desertrescue_minecave',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:473',
        'item:slave_boots:worn item:slave_robe:worn item:slave_shirt:worn quest:desertrescue>=17',
        {
            from: 'west',
            to: '0_51_147_22_7',
            why: "Deeper into the mine from the west in slave robes from ^desertrescue_given_pineapple (quest_desertrescue.rs2:480); back in robes, or free once the quest is done. The guards' search takes the walker past its path bound.",
            stages: { 'quest:desertrescue>=17': '^desertrescue_given_pineapple' },
            scan: 'f31e7783',
        },
    ),
    no(
        'not-a-gate',
        'oploc1,undergroundcellgatel',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:692',
        'The mining camp jail: out for 15 rocks; a player is only inside when the guards throw them in.',
        'c2b89c88',
    ),
    no(
        'not-a-gate',
        'oploc1,undergroundcellgater',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:692',
        'The mining camp jail: out for 15 rocks; a player is only inside when the guards throw them in.',
        'c2b89c88',
    ),
    gate(
        'oploc1,undergroundniceminel',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:862',
        'item:thgoodminekey:held',
        { from: 'south' },
    ),
    gate(
        'oploc1,undergroundniceminer',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:862',
        'item:thgoodminekey:held',
        { from: 'south' },
    ),
    gate(
        'oplocu,undergroundniceminel',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:870',
        'item:thgoodminekey:held',
    ),
    gate(
        'oplocu,undergroundniceminer',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:870',
        'item:thgoodminekey:held',
    ),
    no(
        'side-effect',
        'aploc2,ttcellclimbrock1',
        'quests/quest_desertrescue/scripts/quest_desertrescue.rs2:232',
        'The distance check only walks the player to the foot of the rocks first (quest_desertrescue.rs2:233); the climb itself follows a yes or no choice.',
        '2c0e7903',
    ),
    gate('oploc1,dragonsecretdoor', 'quests/quest_dragon/scripts/crandor.rs2:18', 'quest:dragon', {
        from: 'far',
        why: "From the Karamja volcano side (far, south of the wall) the secret door opens only once found from Elvarg's lair (%dragon_wall, crandor.rs2:13) or with Dragon Slayer done (:18); the lair is reached only by the quest's ship to Crandor, so an account that has not started the quest never found it. The scan takes %dragon_wall both ways, so it proposes a free crossing.",
        scan: '83d1dd66',
    }),
    no(
        'quest-window',
        'oploc1,elvarg_gate_right',
        'quests/quest_dragon/scripts/crandor.rs2:33',
        "Into Elvarg's lair only at ^quest_dragon_sailed_to_crandor; leaving is free.",
        'ad173300',
    ),
    no(
        'quest-window',
        'oploc1,elvarg_gate_left',
        'quests/quest_dragon/scripts/crandor.rs2:41',
        "Into Elvarg's lair only at ^quest_dragon_sailed_to_crandor; leaving is free.",
        'ad173300',
    ),
    no(
        'quest-window',
        'oploc1,dragonshipgangplank_on',
        'quests/quest_dragon/scripts/lady_lumbridge.rs2:2',
        'Boarding the Lady Lumbridge only from ^quest_dragon_bought_ship until Dragon Slayer is done.',
        'bc31dad1',
    ),
    no(
        'side-effect',
        'oploc1,dragonshipladdertop',
        'quests/quest_dragon/scripts/lady_lumbridge.rs2:35',
        "The ship's ladder always climbs; the quest stage picks which copy of the deck it lands on.",
        '7985fb35',
    ),
    no(
        'not-a-gate',
        'oplocu,shiphole',
        'quests/quest_dragon/scripts/lady_lumbridge.rs2:52',
        "Patching the Lady Lumbridge's hull with planks, a Dragon Slayer step, not passage.",
        '1b6d0297',
    ),
    gate('oploc1,dragon_slayer_magic_door', 'quests/quest_dragon/scripts/magic_door.rs2:4', 'quest:dragon', {
        why: "It opens once %dragon_oracle, a Dragon Slayer sub-varp the scan doesn't read, has the Oracle spoken to (magic_door.rs2:4); doing the quest needs the map piece behind it, so on a settled account quest:dragon meets it.",
        scan: '8f6e6bb8',
    }),
    gate('oplocu,melzardoor', 'quests/quest_dragon/scripts/melzars_maze.rs2:14', 'item:melzarkey:held'),
    ...['red', 'orange', 'yellow', 'blue', 'magenta', 'green'].map(colour =>
        gate(`oplocu,${colour}door`, 'quests/quest_dragon/scripts/melzars_maze.rs2:58', `consume:${colour}key:1`),
    ),
    gate(
        'oploc1,ctratgatec',
        'quests/quest_cog/scripts/locs/quest_cog_gates_and_levers.rs2:2',
        [
            [
                'other:the rats killed with the poisoned trough (bit ^quest_cog_rat_door_bit of %cogquest, set at quests/quest_cog/scripts/locs/quest_cog_food_trough.rs2:4)',
            ],
            ['quest:cog'],
        ],
        {
            why: 'The rat cage door opens once the rats are poisoned, a bit of %cogquest the quest sets and never clears; the scan does not read testbit. Doing the quest sets it.',
            scan: 'e26a9c31',
        },
    ),
    no(
        'side-effect',
        'oploc1,dragonshipladdertop2',
        'quests/quest_dragon/scripts/lady_lumbridge.rs2:96',
        'The map_blocked check only picks where the ladder lands when the tile under it is blocked (lady_lumbridge.rs2:96-98); the climb always happens.',
        '2b134f56',
    ),
    // quests/ (Nature Spirit to Horror from the Deep)
    gate(
        'oploc1,mortmyre_metalgateclosed_l',
        'quests/quest_druidspirit/scripts/quest_druidspirit.rs2:5',
        'quest:druidspirit>=1',
        {
            notes: 'The Mort Myre gate: shut until Nature Spirit is started.',
        },
    ),
    gate(
        'oploc1,mortmyre_metalgateclosed_r',
        'quests/quest_druidspirit/scripts/quest_druidspirit.rs2:5',
        'quest:druidspirit>=1',
        {
            notes: 'The Mort Myre gate: shut until Nature Spirit is started.',
        },
    ),
    no(
        'not-a-gate',
        'oplocu,stonedisc_ds_nature',
        'quests/quest_druidspirit/scripts/quest_druidspirit.rs2:140',
        "Using a Nature Spirit item on the stone; it only nudges the player off the spirit's tile, not passage.",
        '5ba10771',
    ),
    no(
        'not-a-gate',
        'oploc1,druidic_spirit_grotto',
        'quests/quest_druidspirit/scripts/quest_druidspirit.rs2:336',
        'Inside the grotto: summons Filliman to talk, not passage.',
        '8e61273b',
    ),
    gate(
        'oploc1,grotto_door_druidicspirit',
        'quests/quest_druidspirit/scripts/quest_druidspirit.rs2:94',
        'quest:druidspirit',
        {
            to: '1_53_152_50_6',
            notes: 'Mid-quest (from ^druidspirit_performed_ritual) it leads to the quest copy of the grotto instead (0_53_152_50_6).',
        },
    ),
    gate('oploc1,eadgar_storeroomdoor', 'quests/quest_eadgar/scripts/quest_eadgar.rs2:492', 'quest:eadgar>=100', {
        from: 'far',
        why: "Free from the loc's own tile (`coord = 0_44_157_53_37`, quest_eadgar.rs2:489), a test the scan does not name as a side.",
        scan: 'b047dbee',
    }),
    no(
        'not-a-gate',
        'oploc1,eadgar_crate_goutweed',
        'quests/quest_eadgar/scripts/quest_eadgar.rs2:550',
        "Taking goutweed from the Troll Stronghold storeroom crate, an Eadgar's Ruse step: a guard who sees it knocks the player out ([queue,troll_guard_knockout], quest_eadgar.rs2:570) and drops them elsewhere in the stronghold ([queue,troll_guard_teleport], quest_eadgar.rs2:588); a trap, not passage a bot walks.",
        '14278329',
    ),
    gate(
        'oplocu,elemental_workshop_oddwall_l',
        'quests/quest_elemental_workshop/scripts/quest_elemental_workshop.rs2:29',
        'item:elemental_workshop_key:held',
    ),
    gate(
        'oplocu,elemental_workshop_oddwall_r',
        'quests/quest_elemental_workshop/scripts/quest_elemental_workshop.rs2:29',
        'item:elemental_workshop_key:held',
    ),
    gate('oploc1,rehnisondoorshut', 'quests/quest_elena/scripts/doors.rs2:97', 'quest:elena>=21'),
    gate('oploc1,loc_2535', 'quests/quest_elena/scripts/doors.rs2:14', 'quest:elena', { from: 'loc' }),
    no(
        'quest-window',
        'oplocu,plaguemudpatch1',
        'quests/quest_elena/scripts/mud_patch.rs2:15',
        'Digging through to the West Ardougne sewer with a spade works once the patch is soaked (^quest_elena_mud_patch4, mud_patch.rs2:19) and only until Biohazard is started, when the ground is packed hard (mud_patch.rs2:15).',
        '384f4d90',
    ),
    no(
        'quest-window',
        'oplocu,plaguemudpatch2',
        'quests/quest_elena/scripts/mud_patch.rs2:15',
        'Digging through to the West Ardougne sewer with a spade works once the patch is soaked (^quest_elena_mud_patch4, mud_patch.rs2:19) and only until Biohazard is started, when the ground is packed hard (mud_patch.rs2:15).',
        '384f4d90',
    ),
    gate('oplocu,elenagateshut', 'quests/quest_elena/scripts/plaguehouse.rs2:22', 'item:elenakey:held'),
    gate('oploc1,elenagateshut', 'quests/quest_elena/scripts/plaguehouse.rs2:31', 'item:elenakey:held | quest:elena', {
        from: 'loc',
    }),
    gate('oploc1,plaguesewerpipe', 'quests/quest_elena/scripts/sewerpipe.rs2:5', 'item:gasmask:worn quest:elena', {
        to: '0_39_51_33_40',
        notes: 'The sewer pipe into West Ardougne; mid-quest it opens from ^quest_elena_opened_pipe with the gas mask too.',
    }),
    gate('oploc1,tunnelstairstop', 'quests/quest_fishingcompo/scripts/quest_fishingcompo.rs2:8', 'quest:fishingcompo', {
        to: '0_44_154_4_26',
        notes: 'The dwarven tunnel under White Wolf Mountain, west end.',
    }),
    gate(
        'oploc1,tunnelstairstop2',
        'quests/quest_fishingcompo/scripts/quest_fishingcompo.rs2:8',
        'quest:fishingcompo',
        {
            to: '0_44_154_60_22',
            notes: 'The dwarven tunnel under White Wolf Mountain, east end.',
        },
    ),
    gate(
        'oploc1,_hemenster_gate',
        'quests/quest_fishingcompo/scripts/quest_fishingcompo.rs2:37',
        'item:fishing_competition_pass:held',
        { from: 'east' },
    ),
    gate('oploc1,gertrudefence', 'quests/quest_fluffs/scripts/quest_fluffs.rs2:117', 'members', { from: 'south' }),
    gate('oploc1,merlinworkshop', 'quests/quest_grail/scripts/quest_grail.rs2:3', 'quest:grail>=1'),
    no(
        'side-effect',
        'oploc1,whistledoor',
        'quests/quest_grail/scripts/quest_grail.rs2:31',
        'The door always opens; the check only drops magic whistles for a Holy Grail player.',
        '83d1dd66',
    ),
    gate('oploc1,grandtree_trapdoorunder', 'quests/quest_grandtree/scripts/quest_grandtree.rs2:2', 'quest:grandtree'),
    gate('oploc1,_shipyard_gate', 'quests/quest_grandtree/scripts/quest_grandtree.rs2:113', 'quest:grandtree>=80'),
    gate('oploc1,grandtree_rootdoor', 'quests/quest_grandtree/scripts/quest_grandtree.rs2:155', 'quest:grandtree'),
    gate('oploc1,grandtree_climbtree', 'quests/quest_grandtree/scripts/quest_grandtree.rs2:25', 'skill:agility:25'),
    gate(
        'oploc1,grandtree_trapdoorclosed',
        'quests/quest_grandtree/scripts/quest_grandtree.rs2:54',
        'quest:grandtree>=130',
        { to: '0_38_154_59_8' },
    ),
    gate('oplocu,closet_door', 'quests/quest_haunted/scripts/quest_haunted.rs2:36', 'item:closet_key:held'),
    no(
        'not-a-gate',
        'oploc1,_haunted_door',
        'quests/quest_haunted/scripts/quest_haunted.rs2:168',
        "The Draynor Manor basement doors: which open depends on the levers the player sets (%ernestlever, Ernest the Chicken's puzzle, quest_haunted.rs2:168-172); not steady passage.",
        '57a0c6b5',
    ),
    gate(
        'oploc1,hauntedmine_rewarddoor_l',
        'quests/quest_hauntedmine/scripts/hauntedmine_crystals.rs2:8',
        'item:hauntedmine_reward_key:held',
    ),
    gate(
        'oploc1,hauntedmine_rewarddoor_r',
        'quests/quest_hauntedmine/scripts/hauntedmine_crystals.rs2:23',
        'item:hauntedmine_reward_key:held',
    ),
    gate(
        'oplocu,hauntedmine_rewarddoor_r',
        'quests/quest_hauntedmine/scripts/hauntedmine_crystals.rs2:18',
        'item:hauntedmine_reward_key:held',
    ),
    gate(
        'oplocu,hauntedmine_rewarddoor_l',
        'quests/quest_hauntedmine/scripts/hauntedmine_crystals.rs2:3',
        'item:hauntedmine_reward_key:held',
    ),
    gate(
        'oploc1,hauntedmine_dark_stairs_top',
        'quests/quest_hauntedmine/scripts/hauntedmine_darkstairs.rs2:36',
        'item:glowing_fungus:held | quest:hauntedmine>=8',
        {
            to: { '0_42_69_4_20': '0_43_69_6_38', '0_42_69_58_20': '0_43_69_59_38' },
            notes: 'Without the fungus (before ^hauntedmine_lightstairsfound) each stair leads only to a dark landing nearby (hauntedmine_darkstairs.rs2:39).',
        },
    ),
    ...['lift_side_l', 'lift_side_r', 'lift_back'].map(lift =>
        no(
            'temporary-block',
            `oploc1,${lift}`,
            'quests/quest_hauntedmine/scripts/hauntedmine_lift.rs2:11',
            'The Haunted Mine lift is shut only at ^hauntedmine_liftfound until it is powered; then it always runs.',
            '37d3099a',
        ),
    ),
    no(
        'side-effect',
        'aploc1,lift_flooded',
        'quests/quest_hauntedmine/scripts/hauntedmine_lift.rs2:46',
        'The distance check only makes a use from more than 4 tiles away do nothing (an aploc reaches from range); near the lift the player always rides it out (hauntedmine_lift.rs2:49-60).',
        '5b238fee',
    ),
    gate(
        'oploc1,grubordoor',
        'quests/quest_hero/scripts/locs/brimhaven_blackarm_hq.rs2:2',
        [
            [
                'other:`%blackarmgang = ^blackarmgang_complete` (quests/quest_hero/scripts/locs/brimhaven_blackarm_hq.rs2:2)',
                'quest:hero>=8',
            ],
        ],
        {
            notes: 'Shield of Arrav done with the Black Arm Gang in particular.',
        },
    ),
    gate(
        'oploc1,herokitchendoor',
        'quests/quest_hero/scripts/locs/brimhaven_restaurant.rs2:2',
        [
            [
                'other:`%phoenixgang = ^phoenixgang_complete` (quests/quest_hero/scripts/locs/brimhaven_restaurant.rs2:2)',
                'quest:hero>=3',
            ],
        ],
        {
            notes: 'Shield of Arrav done with the Phoenix Gang in particular.',
        },
    ),
    gate('oploc1,herokitchenpanel', 'quests/quest_hero/scripts/locs/brimhaven_restaurant.rs2:9', 'quest:hero>=4'),
    gate(
        'oploc1,garvdoor',
        'quests/quest_hero/scripts/locs/brimhaven_scarface_mansion.rs2:2',
        [
            [
                'other:`%blackarmgang >= ^blackarmgang_complete` (quests/quest_hero/scripts/locs/brimhaven_scarface_mansion.rs2:2)',
                'quest:hero>=10',
            ],
        ],
        {
            notes: 'Shield of Arrav done with the Black Arm Gang in particular.',
        },
    ),
    gate(
        'oplocu,pete_sidedoor',
        'quests/quest_hero/scripts/locs/brimhaven_scarface_mansion.rs2:46',
        'item:misc_key:held',
    ),
    gate(
        'oplocu,pete_treasuredoor',
        'quests/quest_hero/scripts/locs/brimhaven_scarface_mansion.rs2:62',
        'item:grip_keys:held quest:hero>=11',
    ),
    gate('oploc1,horror_lighthouse_doorway', 'quests/quest_horror/scripts/quest_horror.rs2:3', 'quest:horror', {
        why: "Only Horror from the Deep done crosses the door, from either side (quest_horror.rs2:3). The free crossing the scan reads from outside, with the door unlocked and the bridge mended (%horrorlighthouseentrance and the bridge varps, which it does not read, :22), teleports into the quest's copy of the lighthouse (0_38_71_13_51, :24) and steps on from there, not through this door.",
        scan: 'c6929dd7',
    }),
    gate('oploc1,horror_ladder_top', 'quests/quest_horror/scripts/quest_horror.rs2:172', 'quest:horror', {
        to: '1_39_156_22_10',
    }),
    gate('oploc1,horror_ladder_down', 'quests/quest_horror/scripts/quest_horror.rs2:172', 'quest:horror', {
        to: '1_39_156_22_10',
    }),
    no(
        'side-effect',
        'oploc1,horror_lighthouse_spiralstairs_middle',
        'quests/quest_horror/scripts/quest_horror.rs2:193',
        'The lighthouse stairs always climb; mid-quest they lead to the quest copy of the lighthouse.',
        '9050bc06',
    ),
    no(
        'side-effect',
        'oploc2,horror_lighthouse_spiralstairs_middle',
        'quests/quest_horror/scripts/quest_horror.rs2:202',
        'The lighthouse stairs always climb; mid-quest they lead to the quest copy of the lighthouse.',
        '0b09c479',
    ),
    no(
        'side-effect',
        'oploc1,horror_lighthouse_spiralstairs_top',
        'quests/quest_horror/scripts/quest_horror.rs2:211',
        'The lighthouse stairs always climb; mid-quest they lead to the quest copy of the lighthouse.',
        '13debaed',
    ),
    no(
        'not-a-gate',
        'oplocu,horror_lighthouse_cog_broken',
        'quests/quest_horror/scripts/quest_horror.rs2:246',
        'Repairing the lighthouse mechanism (Horror from the Deep), not passage.',
        '235d9bdd',
    ),
    gate('oploc1,horror_ladder_base', 'quests/quest_horror/scripts/quest_horror.rs2:291', 'quest:horror', {
        to: '0_39_56_14_60',
    }),
    gate(
        'oploc1,horror_far_right_door',
        'quests/quest_horror/scripts/quest_horror.rs2:309',
        [
            [
                'other:a fire, water, earth and air rune, a sword and an arrow placed in the strange wall (%horrorfire to %horrorarrow, quests/quest_horror/scripts/quest_horror.rs2:332)',
            ],
            ['quest:horror'],
        ],
        {
            from: 'south',
            oneWay: true,
            why: 'The strange wall opens once the six items are placed in it (varps the quest sets and never clears, @placeobj_horror_door at quest_horror.rs2:332); the scan does not read them. From the north it does not open (quest_horror.rs2:313).',
            scan: '2fc8c576',
        },
    ),
    gate('oploc1,ikov_dooroffearl', 'quests/quest_ikov/scripts/ikov_dungeon.rs2:17', 'item:ikov_pendantoflucien:worn', {
        from: 'far',
        why: 'Without the pendant a terror pushes the player back (p_exactmove, ikov_dungeon.rs2:24), which the scan reads as a crossing.',
        scan: '83d1dd66',
    }),
    gate('oploc1,ikov_dooroffearr', 'quests/quest_ikov/scripts/ikov_dungeon.rs2:17', 'item:ikov_pendantoflucien:worn', {
        from: 'far',
        why: 'Without the pendant a terror pushes the player back (p_exactmove, ikov_dungeon.rs2:24), which the scan reads as a crossing.',
        scan: '83d1dd66',
    }),
    no(
        'not-a-gate',
        'oploc1,ikov_traplever',
        'quests/quest_ikov/scripts/ikov_dungeon.rs2:141',
        'A lever: before ^ikov_disabled_trap pulling it drops the player into a pit; not passage.',
        'fa80742f',
    ),
    gate('oploc1,ikov_trapleverdoor', 'quests/quest_ikov/scripts/ikov_dungeon.rs2:171', 'quest:ikov>=30'),
    gate('oploc1,ikov_firewarriordoor', 'quests/quest_ikov/scripts/ikov_dungeon.rs2:178', 'quest:ikov>=40', {
        why: 'Before ^ikov_defeated_fire_warrior the warrior appears instead; the scan reads his entrance as a free move.',
        stages: { 'quest:ikov>=40': '^ikov_defeated_fire_warrior' },
        scan: '83d1dd66',
    }),
    gate('oploc1,ikov_shinykeydoor', 'quests/quest_ikov/scripts/ikov_dungeon.rs2:222', 'item:ikov_shinykey:held'),
    gate('oplocu,ikov_shinykeydoor', 'quests/quest_ikov/scripts/ikov_dungeon.rs2:230', 'item:ikov_shinykey:held'),
    gate('oploc1,ikov_luciendoor', 'quests/quest_ikov/scripts/quest_ikov.rs2:2', 'quest:ikov>=10'),
    gate(
        'oploc1,ikov_darkstairsdown',
        'quests/quest_ikov/scripts/ikov_dungeon.rs2:4',
        'category:light_source_lit:held',
        {
            to: '0_41_152_17_36',
        },
    ),
    gate(
        'oploc1,ikov_mendedleverdoorl',
        'quests/quest_ikov/scripts/ikov_dungeon.rs2:30',
        [
            [
                'other:the mended lever pulled (bit ^ikov_lever of %ikov_dungeon, set at quests/quest_ikov/scripts/ikov_dungeon.rs2:109)',
            ],
            ['quest:ikov'],
        ],
        {
            from: 'loc',
            why: 'The gate opens once the mended lever is pulled, a bit of %ikov_dungeon the quest sets and never clears; the scan does not read testbit. Leaving is free (ikov_dungeon.rs2:30).',
            scan: '8a372d2d',
        },
    ),
    gate(
        'oploc1,ikov_mendedleverdoorr',
        'quests/quest_ikov/scripts/ikov_dungeon.rs2:30',
        [
            [
                'other:the mended lever pulled (bit ^ikov_lever of %ikov_dungeon, set at quests/quest_ikov/scripts/ikov_dungeon.rs2:109)',
            ],
            ['quest:ikov'],
        ],
        {
            from: 'loc',
            why: 'The gate opens once the mended lever is pulled, a bit of %ikov_dungeon the quest sets and never clears; the scan does not read testbit. Leaving is free (ikov_dungeon.rs2:30).',
            scan: '8a372d2d',
        },
    ),
    gate('oploc1,digwinch1', 'quests/quest_itexam/scripts/area_digsite.rs2:617', 'quest:itexam>=6 skill:agility:10', {
        to: '0_52_152_42_36',
        why: 'The winch needs ~itexam_progress at ^itexam_mineshaft_permit (area_digsite.rs2:584), a computed progress the scan does not read, and the rope tied once (a bit of the progress varp).',
        stages: { 'quest:itexam>=6': '^itexam_mineshaft_permit' },
        scan: 'cf4af531',
    }),
    gate(
        'oplocu,digwinch1',
        'quests/quest_itexam/scripts/area_digsite.rs2:617',
        'item:rope:held quest:itexam>=6 skill:agility:10',
        {
            to: '0_52_152_42_36',
            why: 'A rope on the winch ties it (once) or climbs down; ~itexam_progress at ^itexam_mineshaft_permit is a computed progress the scan does not read.',
            stages: { 'quest:itexam>=6': '^itexam_mineshaft_permit' },
            scan: '414015c7',
        },
    ),
    gate('oploc1,digwinch2', 'quests/quest_itexam/scripts/area_digsite.rs2:617', 'quest:itexam>=6 skill:agility:10', {
        to: '0_52_152_42_36',
        why: 'The winch needs ~itexam_progress at ^itexam_mineshaft_permit, a computed progress the scan does not read, and the rope tied once; it lands as digwinch1 (@digsite_winch_teleport).',
        stages: { 'quest:itexam>=6': '^itexam_mineshaft_permit' },
        scan: '406d59c9',
    }),
    gate(
        'oplocu,digwinch2',
        'quests/quest_itexam/scripts/area_digsite.rs2:617',
        'item:rope:held quest:itexam>=6 skill:agility:10',
        {
            to: '0_52_152_42_36',
            why: 'A rope on the winch ties it (once) or climbs down; ~itexam_progress at ^itexam_mineshaft_permit is a computed progress the scan does not read.',
            stages: { 'quest:itexam>=6': '^itexam_mineshaft_permit' },
            scan: '17fa3d23',
        },
    ),
    no(
        'not-a-gate',
        'oplocu,digblastbrick',
        'quests/quest_itexam/scripts/area_digsite.rs2:714',
        "The Dig Site's blast: compound then a tinderbox used on the bricks, a quest step that blows the player clear (area_digsite.rs2:714); not passage.",
        'f84b615e',
    ),
    no(
        'side-effect',
        'oploc1,obs_dungeonladderdown',
        'quests/quest_itgronigen/scripts/quest_itgronigen.rs2:3',
        'The ladder always goes down; before the quest is done the assistant only warns.',
        'e2cd74bb',
    ),
    gate(
        'oplocu,_observatory_dungeon_gate',
        'quests/quest_itgronigen/scripts/quest_itgronigen.rs2:101',
        'item:keep_key:held',
    ),
    gate('oploc1,loc_2299', 'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:2', 'skill:agility:18', {
        to: '1_39_48_52_45',
    }),
    gate('oploc1,watchladderup', 'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:262', 'quest:itwatchtower', {
        to: '2_45_73_53_40',
    }),
    gate(
        'oploc1,ogreguardgate1',
        'quests/quest_itwatchtower/scripts/ogre_guard.rs2:4',
        [
            [
                "other:the Gu'Tanoth guard given a gold bar once (%gutanoth_gold, quests/quest_itwatchtower/scripts/ogre_guard.rs2:4)",
            ],
        ],
        {
            why: 'The guard lets the player through once %gutanoth_gold (not a quest varp) records a gold bar given; the scan does not read it.',
            scan: 'bc854eab',
        },
    ),
    gate(
        'oploc1,ogreguardgate1right',
        'quests/quest_itwatchtower/scripts/ogre_guard.rs2:4',
        [
            [
                "other:the Gu'Tanoth guard given a gold bar once (%gutanoth_gold, quests/quest_itwatchtower/scripts/ogre_guard.rs2:4)",
            ],
        ],
        {
            why: 'The guard lets the player through once %gutanoth_gold (not a quest varp) records a gold bar given; the scan does not read it.',
            scan: 'bc854eab',
        },
    ),
    gate(
        'oploc1,ogreguardgate2',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:277',
        'consume:gold_bar:1 | item:ogrerelic:held | quest:itwatchtower>=4',
    ),
    gate(
        'oploc1,ogreguardgate2right',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:277',
        'consume:gold_bar:1 | item:ogrerelic:held | quest:itwatchtower>=4',
    ),
    gate(
        'oplocu,tree_ropeswing4_norope',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:290',
        'consume:rope:1',
    ),
    gate(
        'oploc1,ganothbattlement',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:320',
        [
            [
                "other:the Gu'Tanoth market guard satisfied (bits of %itwatchtower_bits >= 2, quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:320)",
            ],
        ],
        {
            why: 'The battlement jump waits on a Watchtower sub-step held in bits of %itwatchtower_bits, which the scan does not read.',
            scan: 'a9fae0cd',
        },
    ),
    gate(
        'oploc1,tanothjump1',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:393',
        'coins:20 skill:agility:25',
        { to: '0_39_47_34_21' },
    ),
    no(
        'not-a-gate',
        'oploc1,watchleverup',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:518',
        'The Watchtower lever finishes the quest and moves the player once; not passage.',
        '1268ae3f',
    ),
    gate('oploc1,towerladder', 'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:88', 'quest:itwatchtower>=1'),
    gate(
        'oploc1,skavid_cave1',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:115',
        'category:light_source_lit:held item:skavidmap:held',
        {
            to: '0_39_147_2_10',
            why: "In only with the skavid map and a lit light source (~check_map_lightsource_tinderbox, quest_itwatchtower.rs2:100); without the map the player is turned back outside, without a light dropped in the dark cave (@teleport_dark_skavid_cave). The scan does not read the proc's result.",
            scan: 'f28b4196',
        },
    ),
    gate(
        'oploc1,skavid_cave2',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:126',
        'category:light_source_lit:held item:skavidmap:held',
        {
            to: '0_39_147_36_61',
            why: "In only with the skavid map and a lit light source (~check_map_lightsource_tinderbox, quest_itwatchtower.rs2:100); without the map the player is turned back outside, without a light dropped in the dark cave (@teleport_dark_skavid_cave). The scan does not read the proc's result.",
            scan: '21dbc974',
        },
    ),
    gate(
        'oploc1,skavid_cave3',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:137',
        'category:light_source_lit:held item:skavidmap:held',
        {
            to: '0_39_147_22_47',
            why: "In only with the skavid map and a lit light source (~check_map_lightsource_tinderbox, quest_itwatchtower.rs2:100); without the map the player is turned back outside, without a light dropped in the dark cave (@teleport_dark_skavid_cave). The scan does not read the proc's result.",
            scan: '399aa271',
        },
    ),
    gate(
        'oploc1,skavid_cave4',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:148',
        'category:light_source_lit:held item:skavidmap:held',
        {
            to: '0_39_147_2_43',
            why: "In only with the skavid map and a lit light source (~check_map_lightsource_tinderbox, quest_itwatchtower.rs2:100); without the map the player is turned back outside, without a light dropped in the dark cave (@teleport_dark_skavid_cave). The scan does not read the proc's result.",
            scan: 'bd3cc235',
        },
    ),
    gate(
        'oploc1,skavid_cave5',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:159',
        'category:light_source_lit:held item:skavidmap:held',
        {
            to: '0_39_147_8_33',
            why: "In only with the skavid map and a lit light source (~check_map_lightsource_tinderbox, quest_itwatchtower.rs2:100); without the map the player is turned back outside, without a light dropped in the dark cave (@teleport_dark_skavid_cave). The scan does not read the proc's result.",
            scan: 'c9be69a5',
        },
    ),
    gate(
        'oploc1,skavid_cave6',
        'quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:170',
        'category:light_source_lit:held item:skavidmap:held',
        {
            to: '0_39_147_26_3',
            why: "In only with the skavid map and a lit light source (~check_map_lightsource_tinderbox, quest_itwatchtower.rs2:100); without the map the player is turned back outside, without a light dropped in the dark cave (@teleport_dark_skavid_cave). The scan does not read the proc's result.",
            scan: '81b18d51',
        },
    ),
    ...['oploc1,_jungle_tree', 'oploc1,_jungle_bush'].map(trigger =>
        gate(
            trigger,
            'quests/quest_legends/scripts/jungle_tree.rs2:8',
            ['held', 'worn'].flatMap(axe =>
                ['held', 'worn'].flatMap(machete =>
                    ['item:thkaramjamap:held', 'item:thkaramjamapcomp:held', 'quest:legends'].map(map => [
                        `category:weapon_axe:${axe}`,
                        `item:machette:${machete}`,
                        map,
                    ]),
                ),
            ),
            {
                why: "Kharazi jungle: a map of the jungle unless Legends' Quest is done, an axe (~woodcutting_axe_checker) and a machete, each held or worn (jungle_tree.rs2:8, 12, 21); the woodcutting-table lookups take the walker past its path bound.",
                scan: 'c3c203cf',
            },
        ),
    ),
    gate('oploc1,legendsguilddoorl', 'quests/quest_legends/scripts/legends_door.rs2:5', 'quest:legends>=50'),
    gate('oploc1,legendsguilddoorr', 'quests/quest_legends/scripts/legends_door.rs2:5', 'quest:legends>=50'),
    gate('oploc1,legendsguildgatel', 'quests/quest_legends/scripts/legends_gate.rs2:17', 'quest:legends>=1', {
        from: 'loc',
    }),
    gate('oploc1,legendsguildgater', 'quests/quest_legends/scripts/legends_gate.rs2:17', 'quest:legends>=1', {
        from: 'loc',
    }),
    gate(
        'oploc1,lgshamancaverock3',
        'quests/quest_legends/scripts/quest_legends.rs2:311',
        'quest:legends>=6 skill:agility:50',
        { to: '0_43_145_21_61' },
    ),
    no(
        'side-effect',
        'oploc2,lqfirewall_straight',
        'quests/quest_legends/scripts/quest_legends.rs2:225',
        'Investigating the flames: from inside the octagram the player can always leap out (singed); walking through needs ^legends_defeated_nezikchened_fire, as oploc1.',
        '2527c1b6',
    ),
    no(
        'side-effect',
        'oploc2,lqfirewall_diagonal',
        'quests/quest_legends/scripts/quest_legends.rs2:225',
        'Investigating the flames: from inside the octagram the player can always leap out (singed); walking through needs ^legends_defeated_nezikchened_fire, as oploc1.',
        '2527c1b6',
    ),
    gate(
        'oplocu,lqfirewall_straight',
        'quests/quest_legends/scripts/quest_legends.rs2:280',
        'consume:goldbowlbless_pure:1 | item:goldbowlbless_pure:held',
    ),
    gate(
        'oplocu,lqfirewall_diagonal',
        'quests/quest_legends/scripts/quest_legends.rs2:280',
        'consume:goldbowlbless_pure:1 | item:goldbowlbless_pure:held',
    ),
    no(
        'not-a-gate',
        'oploc1,lg_winchdown_rope',
        'quests/quest_legends/scripts/quest_legends.rs2:1582',
        'Never placed: the winch (lg_winchdown_norope) turns into it for 30 ticks once a rope is tied (quest_legends.rs2:1559).',
        'f4788fb9',
    ),
    gate(
        'oploc1,legendsquest_force_barrier',
        'quests/quest_legends/scripts/quest_legends.rs2:1992',
        'quest:legends>=18',
        {
            why: 'The crossing is written as jumps to the tiles either side of the barrier (quest_legends.rs2:1997, 2001).',
            scan: '2a78fc3d',
        },
    ),
    gate(
        'oploc1,lgshamancaverock1',
        'quests/quest_legends/scripts/quest_legends.rs2:311',
        'quest:legends>=6 skill:agility:50',
        { to: '0_43_145_21_61' },
    ),
    gate(
        'oploc1,lgshamancaverock2',
        'quests/quest_legends/scripts/quest_legends.rs2:311',
        'quest:legends>=6 skill:agility:50',
        { to: '0_43_145_21_61' },
    ),
    gate(
        'oploc2,lglockpickgatebottoml',
        'quests/quest_legends/scripts/quest_legends.rs2:410',
        'item:lockpick:held skill:thieving:50',
        { from: 'loc' },
    ),
    gate(
        'oploc2,lglockpickgatebottomr',
        'quests/quest_legends/scripts/quest_legends.rs2:410',
        'item:lockpick:held skill:thieving:50',
        { from: 'loc' },
    ),
    gate(
        'oplocu,lglockpickgatebottoml',
        'quests/quest_legends/scripts/quest_legends.rs2:410',
        'item:lockpick:held skill:thieving:50',
        { from: 'loc' },
    ),
    gate(
        'oplocu,lglockpickgatebottomr',
        'quests/quest_legends/scripts/quest_legends.rs2:410',
        'item:lockpick:held skill:thieving:50',
        { from: 'loc' },
    ),
    gate('oploc1,lgstrengthtrialgatel', 'quests/quest_legends/scripts/quest_legends.rs2:457', 'skill:strength:50'),
    gate('oploc1,lgstrengthtrialgater', 'quests/quest_legends/scripts/quest_legends.rs2:457', 'skill:strength:50'),
    gate(
        'oploc1,_boulder_legends',
        'quests/quest_legends/scripts/quest_legends.rs2:524',
        'category:weapon_pickaxe:held skill:mining:52 | category:weapon_pickaxe:worn skill:mining:52',
    ),
    gate('oploc2,crumbled_wall', 'quests/quest_legends/scripts/quest_legends.rs2:587', 'skill:agility:50', {
        why: 'The level is checked from both sides before the jump, which is written as moves between fixed tiles (quest_legends.rs2:592).',
        scan: '534fd8ee',
    }),
    gate('oplocu,lgancientwalldoor', 'quests/quest_legends/scripts/quest_legends.rs2:661', 'quest:legends', {
        why: "The ancient wall opens once its runes are placed (bits of %legends_bits), a Legends' Quest puzzle the scan does not read; doing the quest places them.",
        scan: 'e88055a0',
    }),
    gate('oplocu,lg_gemplacerock', 'quests/quest_legends/scripts/quest_legends.rs2:785', 'quest:legends', {
        why: "The gems placed in the rock (a dbrow per gem and bits of %legends_bits) are a Legends' Quest puzzle the scan does not read; doing the quest places them.",
        scan: '744a9631',
    }),
    gate('oploc1,lqfirewall_straight', 'quests/quest_legends/scripts/quest_legends.rs2:199', 'quest:legends>=12'),
    gate('oploc1,lqfirewall_diagonal', 'quests/quest_legends/scripts/quest_legends.rs2:199', 'quest:legends>=12'),
    gate('oploc1,lgancientwalldoor', 'quests/quest_legends/scripts/quest_legends.rs2:619', 'quest:legends', {
        why: "The ancient wall opens once its runes are placed (bits of %legends_bits), a Legends' Quest puzzle the scan does not read; doing the quest places them.",
        scan: '168eb822',
    }),
    gate('oploc2,lgancientwalldoor', 'quests/quest_legends/scripts/quest_legends.rs2:631', 'quest:legends', {
        why: "The ancient wall opens once its runes are placed (bits of %legends_bits), a Legends' Quest puzzle the scan does not read; doing the quest places them.",
        scan: '168eb822',
    }),
    gate('oploc2,lg_gemplacerock', 'quests/quest_legends/scripts/quest_legends.rs2:752', 'quest:legends', {
        why: "The gems placed in the rocks (bits of %legends_bits) are a Legends' Quest puzzle the scan does not read; doing the quest places them.",
        scan: '6d25f100',
    }),
    no(
        'not-a-gate',
        'oploc3,_jungle_tree',
        'quests/quest_legends/scripts/jungle_tree.rs2:3',
        "Op3 is hidden on the jungle locs (quest_legends.loc:87, 118): only op1's chop loop reaches it (@chop_jungle, jungle_tree.rs2:79, then p_oploc(3), jungle_tree.rs2:168), and oploc1 is the gate.",
        '0c71c183',
    ),
    no(
        'not-a-gate',
        'oploc3,_jungle_bush',
        'quests/quest_legends/scripts/jungle_tree.rs2:4',
        "Op3 is hidden on the jungle locs (quest_legends.loc:87, 118): only op1's chop loop reaches it (@chop_jungle, jungle_tree.rs2:79, then p_oploc(3), jungle_tree.rs2:168), and oploc1 is the gate.",
        '0c71c183',
    ),
    no(
        'side-effect',
        'oploc1,mcannoncave',
        'quests/quest_mcannon/scripts/locs/mcannon_cave.rs2:6',
        'The cave always lets the player in; the check only advances Dwarf Cannon to ^mcannon_tasked_with_finding_gilobs_son.',
        '90ef2746',
    ),
    gate('oploc1,mcannondoor1', 'quests/quest_mcannon/scripts/locs/mcannon_doors.rs2:11', 'quest:mcannon>=6'),
    gate('oploc1,mcannondoor', 'quests/quest_mcannon/scripts/locs/mcannon_doors.rs2:3', 'quest:mcannon>=9'),
    gate(
        'oploc1,misc_ulby_throneroomdoor',
        'quests/quest_misc/scripts/misc_door_guard.rs2:2',
        [
            [
                'other:an audience granted by the door guard (%misc_grantedaudience = 1, quests/quest_misc/scripts/misc_door_guard.rs2:2)',
            ],
            ['quest:misc>=1'],
        ],
        {
            why: 'The throne room opens once Throne of Miscellania is started or the guard has granted an audience (%misc_grantedaudience, not a quest varp).',
            stages: { 'quest:misc>=1': '0+1' },
            scan: '83d1dd66',
        },
    ),
    gate(
        'oplocu,mm_double_springtrap_trigger',
        'quests/quest_mm/scripts/ape_atoll_dungeon.rs2:19',
        'item:woodplank:held',
    ),
    gate('oploc1,mm_bamboo_largedoor', 'quests/quest_mm/scripts/quest_mm.rs2:1114', 'category:mm_greegree:worn'),
    gate('oploc1,mm_bamboo_largedoor_left', 'quests/quest_mm/scripts/quest_mm.rs2:1114', 'category:mm_greegree:worn'),
    no(
        'side-effect',
        'oploc1,mm_jumping_square',
        'quests/quest_mm/scripts/quest_mm.rs2:1037',
        'Only a player wearing a monkey greegree is refused (quest_mm.rs2:1037), and taking it off lets them jump.',
        '570d9f72',
    ),
    gate(
        'oploc1,priestperiltempledoorl',
        'quests/quest_priestperil/scripts/temple_doors.rs2:10',
        'quest:priestperil>=4',
        { from: 'loc' },
    ),
    gate(
        'oploc1,priestperiltempledoorr',
        'quests/quest_priestperil/scripts/temple_doors.rs2:10',
        'quest:priestperil>=4',
        { from: 'loc' },
    ),
    no(
        'quest-window',
        'oploc2,priestperiltempledoorl',
        'quests/quest_priestperil/scripts/temple_doors.rs2:23',
        'Knocking: the monk inside answers only between ^priestperil_started and ^priestperil_return_to_drezel; afterwards Open (oploc1) lets the player in.',
        '62a4c4f0',
    ),
    no(
        'quest-window',
        'oploc2,priestperiltempledoorr',
        'quests/quest_priestperil/scripts/temple_doors.rs2:23',
        'Knocking: the monk inside answers only between ^priestperil_started and ^priestperil_return_to_drezel; afterwards Open (oploc1) lets the player in.',
        '62a4c4f0',
    ),
    gate('oploc1,pip_prisondoor', 'quests/quest_priestperil/scripts/trapped_drezel.rs2:33', 'quest:priestperil>=6'),
    gate('oploc2,pip_prisondoor', 'quests/quest_priestperil/scripts/trapped_drezel.rs2:61', 'quest:priestperil>=6'),
    gate('oplocu,alidoor', 'quests/quest_prince/scripts/quest_prince.rs2:35', 'item:princeskey:held quest:prince>=41', {
        from: 'north',
    }),
    gate(
        'oploc1,regicide_logbalance1_start',
        'quests/quest_regicide/scripts/quest_regicide.rs2:368',
        'skill:agility:45',
    ),
    gate(
        'oploc1,regicide_logbalance2_start',
        'quests/quest_regicide/scripts/quest_regicide.rs2:368',
        'skill:agility:45',
    ),
    gate(
        'oploc1,regicide_logbalance3_start',
        'quests/quest_regicide/scripts/quest_regicide.rs2:346',
        'skill:agility:45',
    ),
    gate(
        'oploc1,_regicide_cross_over',
        'quests/quest_regicide/scripts/quest_regicide.rs2:389',
        'quest:regicide>=8 skill:agility:56',
        {
            byConfig: { regicide_cross_over2_tyras_camp: 'quest:regicide>=9 skill:agility:56' },
            why: "From ^regicide_spoken_tracker2 with 56 Agility; the Tyras camp crossing (loc_type regicide_cross_over2_tyras_camp) waits for ^regicide_defeated_guard. The guard's attack takes the walker past its path bound.",
            stages: { 'quest:regicide>=9': '^regicide_defeated_guard' },
            scan: '6b5d3ebf',
        },
    ),
    no(
        'not-a-gate',
        'oplocu,regicide_catapult',
        'quests/quest_regicide/scripts/quest_regicide.rs2:496',
        'Firing the catapult at the Tyras camp, a Regicide step; not passage.',
        'f6e18e61',
    ),
    gate(
        'oploc1,overpass_gate_left',
        'quests/quest_regicide/scripts/regicide_arandar_gate_guard.rs2:5',
        'quest:regicide>=13',
    ),
    gate(
        'oploc1,overpass_gate_right',
        'quests/quest_regicide/scripts/regicide_arandar_gate_guard.rs2:5',
        'quest:regicide>=13',
    ),
    no(
        'side-effect',
        'oploc1,regicide_pitfall_corner',
        'quests/quest_regicide/scripts/quest_regicide.rs2:232',
        "Jumping a pit trap: the checks find the side of the pit the player is on and that the jump's start and landing are open tiles (@regicide_jump_pitfall, quest_regicide.rs2:239); the jump always happens.",
        '682f8cc0',
    ),
    no(
        'side-effect',
        'oploc1,regicide_pitfall_side',
        'quests/quest_regicide/scripts/quest_regicide.rs2:237',
        "Jumping a pit trap: the checks find the side of the pit the player is on and that the jump's start and landing are open tiles (@regicide_jump_pitfall, quest_regicide.rs2:239); the jump always happens.",
        '4cd722ab',
    ),
    gate(
        'oploc1,freedomfighterentrancer',
        'quests/quest_routequest/scripts/routequest_hollow.rs2:2',
        'quest:routequest>=55',
        { to: '0_54_153_44_19' },
    ),
    gate(
        'oploc1,freedomfighterentrancel',
        'quests/quest_routequest/scripts/routequest_hollow.rs2:2',
        'quest:routequest>=55',
        { to: '0_54_153_44_19' },
    ),
    no(
        'not-a-gate',
        'oploc1,route_rowboat',
        'quests/quest_routequest/scripts/routequest_morton.rs2:5',
        "The rowboat between Mort'ton and the Hollows (In Search of the Myreque): a quest boat, out of scope as gates.ts TRANSPORTS_OUT_OF_SCOPE says of quest boats.",
        'c7466624',
    ),
    gate(
        'oploc2,route_stalagmite_cave_entrace',
        'quests/quest_routequest/scripts/routequest_myreque.rs2:125',
        'quest:routequest>=80 skill:agility:25',
        {
            to: '0_54_153_49_40',
            stages: { 'quest:routequest>=80': '^routequest_ambush' },
            notes: 'Before ^routequest_ambush the cave leads to its pre-ambush copy on level 3 (routequest_myreque.rs2:129-135), a quest window.',
        },
    ),
    gate(
        'oploc1,thrttavernbasementfalsewall',
        'quests/quest_routequest/scripts/routequest_myreque.rs2:44',
        'quest:routequest>=90',
    ),
    gate(
        'oploc1,thrt_tavern_trap_door',
        'quests/quest_routequest/scripts/routequest_myreque.rs2:56',
        'quest:routequest>=97',
        { to: '0_54_153_21_53' },
    ),
    gate(
        'oploc1,swamp_bridge1',
        'quests/quest_routequest/scripts/routequest_hollow.rs2:103',
        [
            [
                'other:the three bridge boards repaired (%bridgerung1 to %bridgerung3, quests/quest_routequest/scripts/routequest_hollow.rs2:130)',
            ],
            ['quest:routequest'],
        ],
        {
            why: 'Each broken board gives way (routequest_hollow.rs2:103-121) until repaired with op5, varps the quest sets and never clears; the scan does not read them. Doing the quest repairs them.',
            scan: '7aa518cc',
        },
    ),
    no(
        'not-a-gate',
        'oploc5,swamp_bridge1',
        'quests/quest_routequest/scripts/routequest_hollow.rs2:126',
        'Repairing a bridge board (~routequest_try_fix_rung); not passage.',
        'aa6de989',
    ),
    no(
        'not-a-gate',
        'oploc1,spooky_tree_base_forbridge',
        'quests/quest_routequest/scripts/routequest_hollow.rs2:187',
        'A broken bridge board, there for 200 ticks after it gives way: op1 repairs it (~routequest_try_fix_rung); not passage.',
        '6c1d53be',
    ),
    gate('oploc1,scorpionwall', 'quests/quest_scorpcatcher/scripts/quest_scorpcatcher.rs2:47', 'quest:scorpcatcher>=2'),
    no(
        'temporary-block',
        'oploc1,slugladder',
        'quests/quest_seaslug/scripts/quest_seaslug.rs2:67',
        'Mid-quest (^seaslug_spoken_kent until complete) the fishermen stop a climber without a lit torch; otherwise the ladder always climbs.',
        'e7a042cd',
    ),
    gate(
        'oploc1,_sheepherder_gate',
        'quests/quest_sheepherder/scripts/locs/sheepherder_gate.rs2:3',
        'item:plague_jacket:worn item:plague_trousers:worn quest:sheepherder>=1',
    ),
    gate('oploc1,tbwt_bamboo_door', 'quests/quest_tbwt/scripts/quest_tbwt.rs2:69', 'quest:tbwt'),
    gate(
        'oploc1,khazard_stronghold_door',
        'quests/quest_tree/scripts/quest_tree.rs2:37',
        [['other:locked from outside at every stage (quests/quest_tree/scripts/quest_tree.rs2:37)']],
        {
            from: 'south',
            why: 'It opens only from inside (north, quest_tree.rs2:33); from outside it is locked whatever the quest stage, which the scan reads as a free side only.',
            scan: '83d1dd66',
        },
    ),
    gate('oploc1,khazzacklowwall', 'quests/quest_tree/scripts/quest_tree.rs2:49', 'quest:tree>=5', { from: 'south' }),
    gate(
        'oploc1,troll_climbingrocks',
        'quests/quest_troll/scripts/quest_troll.rs2:2',
        'quest:troll>=10 skill:agility:15',
        {
            notes: 'Climbing boots worn too, from the rocks at z 3611 (quest_troll.rs2:10).',
        },
    ),
    gate('oploc1,troll_stronghold_entrance', 'quests/quest_troll/scripts/quest_troll.rs2:109', 'quest:troll>=40', {
        to: '0_44_157_7_2',
        why: 'The secret door opens from ^troll_freed_godric, or once %troll_opened_back_exit (not a quest varp) records it opened from inside; the scan does not read that varp. It teleports into the stronghold (quest_troll.rs2:113).',
        stages: { 'quest:troll>=40': '^troll_freed_godric' },
        scan: '89eab116',
    }),
    gate(
        'oploc1,troll_mountain_shortcut_climbingrocks1',
        'quests/quest_troll/scripts/quest_troll.rs2:164',
        'skill:agility:15',
    ),
    gate(
        'oploc1,troll_mountain_shortcut_climbingrocks2',
        'quests/quest_troll/scripts/quest_troll.rs2:164',
        'skill:agility:15',
    ),
    gate('oploc1,troll_climbingrocks_top', 'quests/quest_troll/scripts/quest_troll.rs2:18', 'skill:agility:15'),
    gate(
        'oploc1,troll_stronghold_prison_door_closed',
        'quests/quest_troll/scripts/quest_troll.rs2:223',
        'consume:troll_key_prison:1 | quest:troll>=30',
    ),
    gate('oploc1,troll_climbingrocks_bottom', 'quests/quest_troll/scripts/quest_troll.rs2:46', 'skill:agility:15'),
    gate('oploc1,troll_stronghold_arena_exit_left', 'quests/quest_troll/scripts/quest_troll.rs2:94', 'quest:troll>=20'),
    gate(
        'oploc1,troll_stronghold_arena_exit_right',
        'quests/quest_troll/scripts/quest_troll.rs2:94',
        'quest:troll>=20',
    ),
    gate(
        'oploc1,troll_mad_eadgar_entrance',
        'quests/quest_troll/scripts/quest_troll.rs2:130',
        [
            ['other:Mad Eadgar freed (%troll_freed_eadgar, set at quests/quest_troll/scripts/quest_troll.rs2:334)'],
            ['quest:troll'],
        ],
        {
            to: '2_45_157_13_26',
            why: "Into Eadgar's upper cave once he is freed in Troll Stronghold, a varbit never cleared; before that the entrance leads to the lower cave (quest_troll.rs2:131). The scan does not read the varbit.",
            scan: '9228816a',
        },
    ),
    no(
        'not-a-gate',
        'oploc1,trollromance_piste_walk_barrier_down',
        'quests/quest_troll_love/scripts/quest_troll_love.rs2:2',
        "Sledding down Troll Romance's piste is a ride, not passage a bot walks: gates.ts CURATED_TRANSPORTS has the sled rides.",
        'df3c36f8',
    ),
    gate('oplocu,upass_mud', 'quests/quest_upass/scripts/quest_upass.rs2:211', 'item:spade:held', {
        to: '0_37_150_24_46',
    }),
    gate('oploc1,cave_railings5', 'quests/quest_upass/scripts/quest_upass.rs2:248', 'skill:thieving:50'),
    gate('oploc1,upass_unicorn_doorr', 'quests/quest_upass/scripts/quest_upass.rs2:322', 'quest:upass>=4', {
        to: '0_37_150_8_10',
    }),
    gate('oploc1,upass_unicorn_doorl', 'quests/quest_upass/scripts/quest_upass.rs2:322', 'quest:upass>=4', {
        to: '0_37_150_8_10',
    }),
    gate(
        'oploc1,upass_templedoor_closed_right',
        'quests/quest_upass/scripts/quest_upass.rs2:576',
        'quest:regicide>=2',
        {
            from: 'east',
            stages: { 'quest:regicide>=2': '^regicide_spoken_lathas' },
            notes: 'Before Underground Pass is done the door also lets in a player wearing the Zamorak robes and nothing else (quest_upass.rs2:586); once it is done the temple is in ruins (quest_upass.rs2:592), so that route is a quest window.',
        },
    ),
    gate('oploc1,upass_templedoor_closed_left', 'quests/quest_upass/scripts/quest_upass.rs2:576', 'quest:regicide>=2', {
        from: 'east',
        stages: { 'quest:regicide>=2': '^regicide_spoken_lathas' },
        notes: 'Before Underground Pass is done the door also lets in a player wearing the Zamorak robes and nothing else (quest_upass.rs2:586); once it is done the temple is in ruins (quest_upass.rs2:592), so that route is a quest window.',
    }),
    no(
        'quest-window',
        'oplocu,cave_temple_altar',
        'quests/quest_upass/scripts/quest_upass.rs2:653',
        'Throwing the completed doll of Iban into the pit, an Underground Pass step: only until Iban is defeated (%upass <= ^upass_confronted_iban, quest_upass.rs2:654).',
        '96018e02',
    ),
    gate(
        'oploc1,upass_caveentrance2',
        'quests/quest_upass/scripts/quest_upass.rs2:81',
        [
            [
                'other:Underground Pass started with King Lathas (bit ^upass_started_bit of %ibanmulti, quests/quest_upass/scripts/quest_upass.rs2:85) and Koftik spoken to at the entrance (%upass > ^upass_not_started, quests/quest_upass/scripts/quest_upass.rs2:89)',
                'quest:biohazard',
            ],
        ],
        {
            to: '0_38_151_62_52',
            why: "Besides Biohazard, the entrance needs the Underground Pass started (a bit of %ibanmulti), which the scan does not read, and then Koftik's first dialogue (%upass past ^upass_not_started, quest_upass.rs2:89-94), which the scan drops beside that bit.",
            scan: 'c5dd1979',
        },
    ),
    gate(
        'oplocu,upass_double_springtrap_trigger',
        'quests/quest_upass/scripts/upass_obstacles.rs2:195',
        'item:woodplank:held',
    ),
    no(
        'not-a-gate',
        'oploc1,upass_logtrap_trigger',
        'quests/quest_upass/scripts/upass_obstacles.rs2:233',
        'A trap: disarming it is a Thieving roll, failing sets it off; not passage.',
        '83d1dd66',
    ),
    no(
        'side-effect',
        'oploc1,upass_pipe6',
        'quests/quest_upass/scripts/upass_obstacles.rs2:351',
        'The pipe always lets the player through; from ^upass_killed_unicorn it carries them 26 tiles on instead of 1.',
        'b07ba6ca',
    ),
    gate('oplocu,obstical_rockswing_middle', 'quests/quest_upass/scripts/upass_obstacles.rs2:82', 'consume:rope:1', {
        to: '0_38_150_53_49',
    }),
    gate('oplocu,loc_2276', 'quests/quest_upass/scripts/upass_obstacles.rs2:88', 'consume:rope:1', {
        to: '0_38_150_53_49',
    }),
    gate(
        'aploc1,oldbridge_guiderope',
        'quests/quest_upass/scripts/upass_bridge.rs2:55',
        [
            [
                'category:weapon_bow:worn',
                'other:a lit arrow worn in the quiver (oc_param lit_arrow, quests/quest_upass/scripts/upass_bridge.rs2:54)',
            ],
        ],
        {
            from: 'east',
            to: '0_38_151_10_52',
            why: 'Shooting the bridge down needs a bow in the right hand (oc_category of the rhand obj, upass_bridge.rs2:53) and a lit arrow in the quiver (upass_bridge.rs2:59), values the scan cannot follow; only from the east and the northern rows (upass_bridge.rs2:34, 38), and a missed shot (a ranged roll) is tried again.',
            scan: '91760806',
        },
    ),
    gate(
        'oploc1,cave_well',
        'quests/quest_upass/scripts/quest_upass.rs2:122',
        [
            [
                'other:the four orbs of light destroyed (bits ^upass_orb1_bit to ^upass_orb4_bit of %ibanmulti, quests/quest_upass/scripts/quest_upass.rs2:122)',
            ],
            ['quest:upass'],
        ],
        {
            to: '0_37_150_55_60',
            why: 'The well takes the player down once the four orbs are destroyed, bits of %ibanmulti the quest sets and never clears; the scan does not read getbit_range. Doing the quest destroys them.',
            scan: 'd4cb50a2',
        },
    ),
    gate(
        'oploc1,cavetempledoor2l',
        'quests/quest_upass/scripts/quest_upass.rs2:399',
        [
            [
                "other:the three knights' badges and the unicorn horn thrown in the well (~upass_unicorn_door_unlocked, quests/quest_upass/scripts/quest_upass.rs2:340)",
            ],
            ['quest:upass'],
        ],
        {
            to: '1_33_73_61_53',
            why: "Through the temple door once the badges and the horn are in the well, bits of %ibanmulti the quest sets and never clears; the scan does not read the proc. The door's other placement leads back free (quest_upass.rs2:396).",
            scan: '6375a54a',
        },
    ),
    gate(
        'oploc1,cavetempledoor2r',
        'quests/quest_upass/scripts/quest_upass.rs2:399',
        [
            [
                "other:the three knights' badges and the unicorn horn thrown in the well (~upass_unicorn_door_unlocked, quests/quest_upass/scripts/quest_upass.rs2:340)",
            ],
            ['quest:upass'],
        ],
        {
            to: '1_33_73_61_53',
            why: "Through the temple door once the badges and the horn are in the well, bits of %ibanmulti the quest sets and never clears; the scan does not read the proc. The door's other placement leads back free (quest_upass.rs2:396).",
            scan: '6375a54a',
        },
    ),
    gate(
        'oploc1,cavewitch_door',
        'quests/quest_upass/scripts/kardia.rs2:2',
        [
            [
                "other:the cat dropped at the witch's door (bit ^upass_dropped_cat of %ibanmulti, set at quests/quest_upass/scripts/kardia.rs2:77)",
            ],
            ['quest:upass'],
        ],
        {
            why: "The witch's door opens once the cat is dropped to distract her, a bit of %ibanmulti the quest sets and never clears; until then she hurts the player (kardia.rs2:9-13). The scan does not read testbit. Doing the quest sets it.",
            scan: 'd5e632a4',
        },
    ),
    no(
        'side-effect',
        'oploc1,upass_last_out',
        'quests/quest_upass/scripts/quest_upass.rs2:702',
        'Koftik leads the player out after his dialogue (@koftik_whereami, koftik.rs2:133-143); the npc_find only finds him.',
        '41290923',
    ),
    no(
        'side-effect',
        'oploc1,upass_pipe4',
        'quests/quest_upass/scripts/upass_obstacles.rs2:63',
        'The check is an 8-tick cooldown after the player last used the pipe (%upass_area1_pipe_used, upass_obstacles.rs2:63-67); the pipe always lets them through.',
        '092bd33c',
    ),
    gate('oploc1,viking_fencegate_l', 'quests/quest_viking/scripts/quest_viking.rs2:5', 'quest:viking'),
    gate('oploc1,viking_fencegate_r', 'quests/quest_viking/scripts/quest_viking.rs2:5', 'quest:viking'),
    no(
        'quest-window',
        'oploc1,vt_mazeladdertopentrance',
        'quests/quest_viking/scripts/viking_hallifred.rs2:104',
        'The Fremennik Trials maze ladder leads into the trial only mid-quest.',
        '83bf3afa',
    ),
    no(
        'quest-window',
        'oploc1,viking_bard_backstage_door',
        'quests/quest_viking/scripts/viking_olaf.rs2:499',
        "Backstage at the longhall only mid-way through Olaf's trial (~get_viking_olaf_progress between ^olaf_not_started and ^olaf_complete, a sub-varp the scan does not read) with the enchanted lyre; once the trial or the quest is done the bouncer keeps the player out (viking_olaf.rs2:505). Leaving is free.",
        '4b958810',
    ),
    gate('oploc1,viking_seers_door2', 'quests/quest_viking/scripts/viking_peer.rs2:1036', 'item:viking_key:held', {
        from: 'far',
        oneWay: true,
        notes: "Unlocked from the far side only: from the door's own tile it stays locked (viking_peer.rs2:1036, :1039).",
    }),
    gate('oplocu,viking_seers_door2', 'quests/quest_viking/scripts/viking_peer.rs2:1042', 'item:viking_key:held', {
        from: 'far',
        oneWay: true,
        notes: "Unlocked from the far side only: from the door's own tile the key does nothing (viking_peer.rs2:1042).",
    }),
    no(
        'quest-window',
        'oploc1,viking_seers_door1',
        'quests/quest_viking/scripts/viking_peer.rs2:288',
        "Into the Seer's puzzle room only mid-trial, with an empty inventory; once the Seer's vote or the quest is done the player refuses (viking_peer.rs2:288). Leaving is free.",
        '5bd7c825',
    ),
    no(
        'quest-window',
        'oploc2,viking_warrior_ladder',
        'quests/quest_viking/scripts/viking_thorvald.rs2:134',
        "Down to Thorvald's trial only mid-trial; once his vote or the quest is done the player refuses.",
        '684dbf37',
    ),
    gate(
        'oplocu,glarials_tombstone_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:103',
        'item:glarials_pebble_waterfall_quest:held loadout:glarials_tomb',
        { to: '0_39_153_58_52' },
    ),
    gate(
        'oploc1,lograft_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:155',
        'quest:waterfall>=1',
        { to: '0_39_54_16_25' },
    ),
    gate(
        'aplocu,crossing_rock_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:214',
        'item:rope:held',
        {
            from: 'north',
            why: 'Thrown from the north bank, within 0_39_54_14_20..0_39_54_18_25 (quest_waterfall.rs2:218, 222), a zone the scan does not name as a side.',
            scan: 'edcdf4f5',
        },
    ),
    gate(
        'oplocu,overhanging_tree1_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:255',
        'item:rope:held',
        { to: '0_39_54_15_7' },
    ),
    gate(
        'oploc1,waterfall_ledge_door',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:267',
        'item:glarials_amulet_waterfall_quest:held | item:glarials_amulet_waterfall_quest:worn',
        { to: '0_40_154_15_5' },
    ),
    no(
        'not-a-gate',
        'oploc1,golrie_gate_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:333',
        "Open lets the player out only; in, the gate takes Golrie's key (oplocu).",
        '83d1dd66',
    ),
    gate(
        'oplocu,golrie_gate_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:352',
        'item:golrie_key_waterfall_quest:held',
    ),
    gate(
        'oplocu,baxtorian_door_2_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:393',
        'item:baxtorian_key_waterfall_quest:held',
    ),
    no(
        'not-a-gate',
        'oplocu,statue_queen_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:414',
        "Placing Glarial's amulet on the statue, a Waterfall Quest step; not passage.",
        '5eeca4ea',
    ),
    no(
        'not-a-gate',
        'oploc1,baxtorian_chalice_waterfall_quest',
        'quests/quest_waterfall/scripts/quest_waterfall.rs2:442',
        'Taking from the chalice floods the cavern and washes the player downstream (a trap); not passage.',
        '83612878',
    ),
    gate('oploc1,zanarisdoor', 'quests/quest_zanaris/scripts/quest_zanaris.rs2:93', 'item:dramen_staff:worn members', {
        from: 'far',
        to: '0_50_149_20_56',
    }),
    gate('oploc1,_shilo_woodengate', 'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:102', 'quest:zombiequeen'),
    gate('oploc1,_zqtombdoor', 'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1353', 'quest:zombiequeen>=12'),
    no(
        'quest-window',
        'oplocu,_zqtombdoor',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1403',
        'Bones placed in the tomb door, a Shilo Village step, only until ^zombiequeen_unlocked_tombdoor (quest_zombiequeen.rs2:1403); after that Open (oploc1,_zqtombdoor) is the gate.',
        '9e91bdd0',
    ),
    gate(
        'oploc1,zq_rashrocks',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1464',
        'item:zqdeadbeads:worn | quest:zombiequeen',
        { from: 'north', to: '0_45_148_48_39' },
    ),
    no(
        'not-a-gate',
        'oploc1,zqrashdolmen',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1509',
        "Searching Rashiliyia's dolmen, a Shilo Village quest step: it summons Nazastarool or gives up her remains, and its only move steps the player one tile back from the dolmen (quest_zombiequeen.rs2:1540-1541); not passage.",
        'b64efe9a',
    ),
    no(
        'not-a-gate',
        'oploc2,zqrashdolmen',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:1509',
        "Searching Rashiliyia's dolmen, a Shilo Village quest step: it summons Nazastarool or gives up her remains, and its only move steps the player one tile back from the dolmen (quest_zombiequeen.rs2:1540-1541); not passage.",
        'b64efe9a',
    ),
    no(
        'not-a-gate',
        'oploc1,_rashiliyia_tomb_door_opened',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:181',
        'Never placed: the closed tomb doors (category rashiliyia_tomb_door_closed) turn into it.',
        '37f28961',
    ),
    no(
        'not-a-gate',
        'oplocu,_rashiliyia_tomb_door_opened',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:181',
        'Never placed: the closed tomb doors (category rashiliyia_tomb_door_closed) turn into it.',
        '37f28961',
    ),
    no(
        'side-effect',
        'oploc1,hillsideexitclosedl',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:229',
        "Rashiliyia's tomb exit opens unless the player holds the bone key; the checks only summon her.",
        'a415e1d1',
    ),
    no(
        'side-effect',
        'oploc1,hillsideexitclosedr',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:229',
        "Rashiliyia's tomb exit opens unless the player holds the bone key; the checks only summon her.",
        'a415e1d1',
    ),
    no(
        'side-effect',
        'oplocu,hillsideexitclosedl',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:220',
        "Rashiliyia's tomb exit opens unless the player holds the bone key; the checks only summon her.",
        '716f6181',
    ),
    no(
        'side-effect',
        'oplocu,hillsideexitclosedr',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:220',
        "Rashiliyia's tomb exit opens unless the player holds the bone key; the checks only summon her.",
        '716f6181',
    ),
    gate(
        'oploc1,zombiequeengateclosedl',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:256',
        'item:zqdeadbeads:worn',
        { from: 'north', to: '0_45_148_49_43' },
    ),
    gate(
        'oploc1,zombiequeengateclosedr',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:256',
        'item:zqdeadbeads:worn',
        { from: 'north', to: '0_45_148_49_43' },
    ),
    gate('oploc1,_shilo_metalgate', 'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:30', 'quest:zombiequeen', {
        from: 'east',
    }),
    gate(
        'oploc2,ahzarhoon_entrance',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:331',
        'quest:zombiequeen>=7 skill:agility:32',
        { to: '0_45_146_18_57', stages: { 'quest:zombiequeen>=7': '^zombiequeen_entered_ah_za_rhoon' } },
    ),
    no(
        'not-a-gate',
        'oploc2,ahzarhoon_entrance_fissure',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:361',
        "Never placed: ahzarhoon_entrance turns into it for 50 ticks (quest_zombiequeen.rs2:333, 336), and that loc's own op is the gate.",
        '3f0aca9b',
    ),
    no(
        'not-a-gate',
        'oploc2,ahzarhoon_entrance_fissure_withrope',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:499',
        "Never placed: ahzarhoon_entrance turns into it for 50 ticks (quest_zombiequeen.rs2:333, 336), and that loc's own op is the gate.",
        '644dd009',
    ),
    gate('oploc1,zqclimbingrocks', 'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:527', 'skill:agility:15', {
        from: 'east',
        why: "Checked from the east only; the scan's side for it also names the loc's far tile.",
        scan: 'e6e52948',
    }),
    gate(
        'oploc2,zqrocks',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:619',
        [
            [
                'other:read the tattered scroll (bit ^zq_read_tattered_scroll of %zq_map_mechanisms, set at quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:866)',
                'skill:agility:32',
            ],
            ['quest:zombiequeen', 'skill:agility:32'],
        ],
        {
            to: '0_43_146_8_45',
            why: 'The crawl-way shows only once the tattered scroll is read (quest_zombiequeen.rs2:615), a bit of %zq_map_mechanisms the quest sets and never clears; the scan does not read testbit. Doing the quest reads it. The gated move is the teleport into the tomb (quest_zombiequeen.rs2:643); the crossing the scan also sees is the failed squeeze, which puts the player back (quest_zombiequeen.rs2:625-634).',
            scan: '7f1981be',
        },
    ),
    gate(
        'oploc1,combodoor',
        'quests/quest_totem/scripts/quest_totem.rs2:91',
        [
            [
                "other:the tribal door's combination lock solved (bit 0 of %handelmort_traps_disabled, set at quests/quest_totem/scripts/quest_totem.rs2:41)",
            ],
            ['quest:totem'],
        ],
        {
            why: 'The door opens once its combination lock (an interface, quest_totem.rs2:36-42) is solved; the bit stays set, since only an unsolved door opens the lock and clears it (quest_totem.rs2:61). The scan does not read testbit. Doing the quest solves it.',
            scan: 'b5e23844',
        },
    ),
    gate(
        'oploc1,totemtrapstairs',
        'quests/quest_totem/scripts/quest_totem.rs2:105',
        [
            ['quest:totem'],
            [
                'other:the trap on the stairs found (searching them, oploc2, sets bit 21 of %handelmort_traps_disabled, quests/quest_totem/scripts/quest_totem.rs2:130)',
                'skill:thieving:21',
            ],
        ],
        {
            to: '1_41_51_7_57',
            why: 'Up the stairs only once the trap is found by searching them (oploc2, Thieving 21, quest_totem.rs2:125), a bit never cleared; otherwise the player falls to ^totem_stairs_fail_coord and takes damage. The scan does not read testbit. Doing the quest finds it.',
            scan: '2137f984',
        },
    ),
    no(
        'not-a-gate',
        'oploc2,zqtableraft',
        'quests/quest_zombiequeen/scripts/quest_zombiequeen.rs2:655',
        'Making a ladder, raft or pole vault from the table, a Shilo Village quest step (quest_zombiequeen.rs2:660); not passage.',
        '7e9b0fbc',
    ),
    // tutorial/, macro events/
    no(
        'not-a-gate',
        'oploc1,_tutorial_gate',
        'tutorial/scripts/tut_doors_and_gates.rs2:21',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        '76cae40d',
    ),
    no(
        'not-a-gate',
        'oploc1,newbie_door1',
        'tutorial/scripts/tut_doors_and_gates.rs2:39',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        'c325bb28',
    ),
    no(
        'not-a-gate',
        'oploc1,newbie_door3',
        'tutorial/scripts/tut_doors_and_gates.rs2:62',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        '9994e619',
    ),
    no(
        'not-a-gate',
        'oploc1,newbie_door4',
        'tutorial/scripts/tut_doors_and_gates.rs2:77',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        'fde92548',
    ),
    no(
        'not-a-gate',
        'oploc1,newbieladdertop1',
        'tutorial/scripts/tut_doors_and_gates.rs2:92',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        '363d6efe',
    ),
    no(
        'not-a-gate',
        'oploc1,_tut_mining_exit',
        'tutorial/scripts/tut_doors_and_gates.rs2:111',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        'e503ea4e',
    ),
    no(
        'not-a-gate',
        'oploc1,_rat_pit_cage',
        'tutorial/scripts/tut_doors_and_gates.rs2:151',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        'ad999f11',
    ),
    no(
        'not-a-gate',
        'oploc1,newbieladder2',
        'tutorial/scripts/tut_doors_and_gates.rs2:201',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        '91c21f24',
    ),
    no(
        'not-a-gate',
        'oploc1,newbie_door6',
        'tutorial/scripts/tut_doors_and_gates.rs2:218',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        '2f84ca69',
    ),
    no(
        'not-a-gate',
        'oploc1,newbie_door7',
        'tutorial/scripts/tut_doors_and_gates.rs2:231',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        '1bcd40b6',
    ),
    no(
        'not-a-gate',
        'oploc1,newbie_door8',
        'tutorial/scripts/tut_doors_and_gates.rs2:244',
        "Tutorial Island: opens as the tutorial moves on (%tutorial, or its instructor's presence); bots skip the tutorial.",
        'da9822e5',
    ),
    no(
        'not-a-gate',
        'oploc1,_macro_maze_wall_door',
        'macro events/scripts/general/macro_event_maze.rs2:52',
        'The maze random event: its doors, inside the event.',
        '533e2243',
    ),
];
