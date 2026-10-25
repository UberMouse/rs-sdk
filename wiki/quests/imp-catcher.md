# Imp Catcher

| Detail | Info |
|---|---|
| Difficulty | Novice |
| Quest points | 1 (`general/configs/quest.constant:104`) |
| Quest id (plans, `v.quest('imp')`) | `imp` |
| Reward | Amulet of accuracy, 875 Magic XP base = **21,875 Magic XP** at 25x (Magic 1 -> 44 on this server's level table) |

Script paths below are under `server/content/scripts/`. Everything on this page comes from the server
scripts and map data [server data, unverified in game 2026-10-23] unless it carries a `[v ...]` tag. The spawn lists
below were re-read against `maps/*.jm2` (npc id 708 lines) on 2026-10-23 and match; whether an imp stands on a spawn
tile at a given moment is a separate matter (next section).

## Requirements and hazards

- No quest or skill requirement: Mizgog's start dialog checks nothing (`areas/area_wizard_tower/scripts/wizard_mizgog.rs2:1-5`).
- Imps are level 2, 8 HP, not aggressive (no `huntmode`, `givechase=false`), with -42 attack and -37 strength bonuses
  (`_unpack/225/all.npc:5266-5294`): a combat-3 bot kills them; no food needed.
- Imps teleport: a hit that does not kill has a 1 in 10 chance to send the imp to a random tile up to 20 away
  (`npc/scripts/imp.rs2:10-23`), and out of combat for 8 ticks it may teleport every 50-200 ticks (`imp.rs2:1-8`). An
  imp at 4 HP or less runs from its attacker (`param=retreat,4`, `skill_combat/scripts/npc/npc_combat.rs2:12-14`).
- The Wizards' Tower top floor (Mizgog's floor) has a lesser demon (level 82, `huntmode=cowardly`) at (3110, 3157)
  level 2 (`learnings/hazards.md`). The SDK pathfinder finds no route from its spawn to the stairs landing (3104, 3161)
  or to Mizgog's spawn: it is shut in. [server data: collision probe 2026-10-23]
- Leaving the top floor with an `interact` task takes two `Climb-down` on Staircase: the first at (3104, 3160) level 2, the second at about (3103, 3159) level 1. Each `at` must carry the level of the floor the bot is on; an `at` with level 2 used from level 1 made the phase run twice and ended a plan "done" early. [v 2026-10-24 conductor3 local]
- Leaving the tower: a `walk` from the top floor (level 2) to a far destination fails `No path ... path ends 531 tiles
  away at (3103,3162)`. Walk to the ground floor (3109, 3168, 0) first, then make the long trip (then 230 s to Yanille).
  Mizgog's talk and start dialog from the top floor worked ("2 choices made"). [v 2026-10-23 questw6 local]

## Quest state

Varp `%imp` (id 160, `pack/varp.pack:161`; `quests/quest_imp/configs/quest_imp.varp:1`). The server never sends it to
the client: a plan sees only the quest tab colour (`v.quest('imp')`: none, started, done) and the inventory.

| Value | Constant | Set by | Plan sees |
|---|---|---|---|
| 0 | `^imp_not_started` (`quest_imp/configs/quest_imp.constant:1`) | - | tab red |
| 1 | `^imp_started` (`quest_imp.constant:2`) | Mizgog, choice "Give me a quest please." (`wizard_mizgog.rs2:50`) | tab yellow |
| 2 | `^imp_complete` (`general/configs/quest.constant:37`) | Mizgog with all four beads held (`wizard_mizgog.rs2:8-16`, `quests/quest_imp/scripts/quest_imp.rs2:2`) | tab green, `v.questDone('imp')` |

## Steps

| # | Who / what (config name) | Where (x, z, level) | Dialog choices, in order | Items | Moves the varp |
|---|---|---|---|---|---|
| 1 | NPC **Wizard Mizgog** (op Talk-to) | spawn (3103, 3163) level 2, Wizards' Tower top floor (`maps/m48_49.jm2:6252`); wanders | `Give me a quest!`, then `Give me a quest please.` (`wizard_mizgog.rs2:5`, `:42`) | none | 0 -> 1 |
| 2 | NPC **Imp**: kill until each bead colour has dropped once | see Imp spawns below | - | loot **Red bead**, **Yellow bead**, **Black bead**, **White bead** (ground items under the imp) | none |
| 3 | NPC **Wizard Mizgog** | as step 1 | none (continue pages only) | the four beads, one of each, consumed (`wizard_mizgog.rs2:12-15`) | 1 -> 2; Amulet of accuracy added, Magic XP (`quest_imp.rs2:2-6`) |

- The wrong choices are harmless: "Most of your friends are pretty quiet aren't they?" and "Give me a quest or else!" /
  "Just stop messing around and give me a quest!" end the talk with the varp still 0 (`wizard_mizgog.rs2:53-64`).
- Talking at stage 1 without all four beads changes nothing (`wizard_mizgog.rs2:21-27`).
- Recovery: a lost or dropped bead is just killed for again; beads do not exist in any shop stock (`.inv` configs) and
  only imps drop them (`drop tables/scripts/imp.rs2`). Bots do not trade, so drops are the only source.

## Bead drops

Every imp kill rolls `random(128)` once (`drop tables/scripts/imp.rs2:10-19`), after the always-drop Ashes, and only
for the player who did the most damage (`npc_findhero`, `imp.rs2:3`):

| Roll | Drop | Chance per kill |
|---|---|---|
| 0-4 | Black bead | 5/128 (3.9%) |
| 5-9 | Red bead | 5/128 |
| 10-14 | White bead | 5/128 |
| 15-19 | Yellow bead | 5/128 |
| 20-127 | other junk (bolts, wizard hat, hammer, ball of wool, mind talisman, ...) | 108/128 |

At most one bead per kill. Expected kills to hold all four colours (coupon collector, 4 colours at 5/128 each):
128/5 x (1 + 1/2 + 1/3 + 1/4) = **53.3 kills**; median 47, 90% done by 92 kills, 99% by 151. About 20/128 of kills
drop a bead, so a full run picks up ~8 beads, ~4 of them duplicates (one inventory slot each; they do not stack).

## Imp spawns

All 45 static imp spawns are npc `imp` (id 708, `pack/npc.pack:709`), one per tile, respawn 100 ticks, wander 25
tiles (`all.npc:5274-5277`). The clusters worth a trip (nearest bank and run ticks from `wiki/world.json`):

| Cluster | Imps | Spawn tiles | Map | Nearest bank | Requires |
|---|---|---|---|---|---|
| North of Yanille | 8 | (2595,3131) (2597,3120) (2606,3126) (2608,3134) (2614,3116) (2616,3126) (2621,3133) (2622,3118) | `maps/m40_48.jm2:9352-9365` | Yanille, 14-23 run ticks | - |
| South of Ardougne, north of Port Khazard | 9 | (2625,3203) (2625,3217) (2629,3233) (2630,3210) (2632,3202) (2633,3222) (2633,3243) (2639,3206) (2639,3230) | `maps/m41_50.jm2:5331-5339` | Ardougne South, 25-46 run ticks | - |
| Karamja, north-west of Brimhaven | 8 | (2832,3170) (2832,3177) (2837,3184) (2841,3163) (2849,3186) (2850,3165) (2857,3179) (2859,3177) | `maps/m44_49.jm2:5449-5458` | Ardougne South, 80-94 run ticks | 30 coins (boat) or The Grand Tree |
| South of Falador | 3 | (3009,3307) (3011,3314) (3015,3314) | `maps/m47_51.jm2:6933-6937` | Falador East, 26-29 run ticks | - |

Single imps (a few kills per respawn cycle only): Edgeville (3078,3499) 9 run ticks from Edgeville bank; (3073,3498),
(3078,3461), (3134,3487); Falador (2947,3329), (2951,3360); Varrock (3177,3405), (3213,3502), (3238,3390), (3246,3458);
north of Varrock (3234,3506), (3261,3514); Champions' Guild (3205,3355); Lumbridge (3217,3226); Draynor (3073,3250);
(3214,3281), (3240,3307); Kharidian Desert (3299,3273); Melzar's Maze (2941,3236, needs its keys).

Seen in game (imps in view per cluster over two plan runs, 2026-10-23; imps wander and flee 25+ tiles from their spawn
tiles, so a small area leaves them outside):

| Cluster (looked from) | Imps seen | Where they were |
|---|---|---|
| Yanille north (2609,3125; also (2600,3122), (2614,3132), (2615,3124)) | 0 | only cows, a Khazard Guard and Hengrad |
| Falador south (3011,3312) | 0 | - |
| Draynor (3073,3252) | 0 | - |
| Lumbridge (3217,3228) | ~35 per run with a wide area | drift to x 3184-3211, z 3237-3252 |
| Varrock east (3238,3392) | 0-4 | mostly x 3190-3236, z 3264-3380 |
| Varrock west (3177,3405) | up to 23 | around (3179-3189, 3388-3394) |
| Varrock north (3246,3458) | 0-1 | - |
| Varrock edge (3213,3495) | up to 50 | x 3200-3218, z 3492-3517, beside the Wilderness boundary (z 3520): never hunt there |
| Ardougne south, Karamja | not visited | - |

Imps drift away from their spawn tiles and do not come back until killed, so on a server that has been up a while
the spawn clusters are empty and the imps are scattered: the Yanille, Falador-south and Draynor spawn tiles held 0 on
2026-10-23. The idle teleport moves an imp up to 20 tiles from where it stands, not from its spawn
(`npc_tele(map_findsquare(npc_coord, 0, 20, ...))`, `npc/scripts/imp.rs2:15-22`). Once it is more than `maxrange`
(27 = wanderrange 25 + 2) from its spawn, its wander steps back are invalid (`server/engine/src/engine/entity/Npc.ts:812`).
The 500-ticks-stuck reset that would send it home is cleared by every teleport, since a teleport counts as movement
(`Npc.ts:373-377,730`). A kill respawns the imp at its own spawn tile 100 ticks later. [server data 2026-10-24] Camping a
small area therefore waits for strays: a 175 s Lumbridge phase (radius 35) saw no imp in its area on any tick
(questw6 `2026-10-23T11-22-32-049Z-combat`). The Varrock imps that drift north to z 3492-3517 are at the Wilderness
edge, so cap areas there at z 3470.

Best measured method (promoted plan `imp-catcher`, `conductor/plans/imp-catcher.ts`): a camp phase at the Falador-south
spawn cluster, area (3012,3311) radius 55, `respawnWaitTicks: 600`, skill Strength, then a stray ring of radius 55-60
areas (Lumbridge (3205,3240) r60, Draynor (3073,3252) r55, Champions' Guild (3205,3355) r55, Varrock east (3235,3400)
r60, Edgeville (3085,3455) r55) that runs only when the camp ends empty; the ring was never needed. Start, leave-tower and
finish phases are the same as before. Final run (2026-10-23T23-25-56, camp phase 4,036 ticks = 1,406 s): ~33 kills in
23.4 min, ~85 kills/h, ~120 ticks per kill including respawn waits (estimated from 800 Strength XP per kill, not
counted). Plan done ("plan until met") in 1,470.8 s, +26,300 Strength, +8,635 Hitpoints, +21,875 Magic. It started
holding White + Red beads, so it is proven from that state; its start and leave-tower phases ran in the earlier run
2026-10-23T22-20-18. The ticks do not show whether kills were respawns on the camp tiles or strays, so that the spawn
camp is what works is unverified. [v 2026-10-24 conductor3 local]

Rates for comparison: ~85 kills/h camp above; ~30 kills/h for the earlier two-area
Lumbridge/Varrock camp (r35/r45, `respawnWaitTicks: 300`; 94 kills in all for four colours, ~53 expected, 90th
percentile ~92); ~19 kills/h for a ring of 10 small areas with `respawnWaitTicks` 0-60, where search and walking took
over 90% of the time (each empty area cost 32-120 s). Imp density on 2026-10-24 was far below 2026-10-23. A killed imp's
first idle teleport chance comes 70 ticks after spawn (all.npc `timer=70`, `imp.rs2` ai_timer 50%). [v 2026-10-24
conductor3 local]

- A harness SIGTERM under low system memory kills a background `run-task` (no RESULT line). A plan restarted afterwards
  resumes from the inventory and quest tab. [v 2026-10-24 conductor3 local]

Combat-task areas: `combat` attacks only targets inside `area`, and radius 22-35 areas left imps in view but outside the area on many idle ticks (Varrock west (3183,3395) r25: 32 ticks, imps 13-15 tiles from the bot; Edgeville (3085,3445) r25: 28 ticks; Lumbridge north (3225,3290) r30: 17 ticks, nearest 6 tiles). Use radius 50 or more, kept short of the Wilderness: `squareReachesWilderness` is a square test, so centre z + radius must stay below 3520 (Edgeville centre z 3455 r55 is accepted). [v 2026-10-24 conductor3 local, ticks of plan run 2026-10-23T22-20-18-422Z]

## Catalog coverage

| Step | Task | Params (sketch) | Notes |
|---|---|---|---|
| 1 start | `talk` | `{npc:"^Wizard Mizgog$", at:{x:3104,z:3162,level:2,tolerance:3}, choices:["^Give me a quest!$","^Give me a quest please"]}` (worked, proven; the finish talk with no choices also worked) | The walk climbs the Wizards' Tower stairs (`conductor/lib/connectors.ts` OVERRIDES, ungated rows; logs the lesser demon hazard). Those stairs were walked only in integration tests (`learnings/walking.md`). Anchor the first regex: "Give me a quest" also matches the "or else" option. |
| reach the imps | `travel` / `bank` | `{to:{x:3012,z:3311}}` | Falador south (the plan's camp); Yanille's tiles held no imps. |
| 2 beads | `combat` | `{target:"Imp", area:{x:3012,z:3311,radius:55}, respawnWaitTicks:600, loot:["Red bead","Yellow bead","Black bead","White bead"]}`, phase `until` all four `v.inv(...) > 0`, `onFail:"continue"` | With no imp in the area for 20 looks of 3 ticks the run fails `no free reachable Imp` (`conductor/tasks/combat.ts:40-41,291-292`); respawn is 100 ticks, so a small cluster needs `onFail:"continue"`. Teleporting and fleeing imps leave fights early; the task picks the next target. `combat` gave up `no free reachable Imp in the area` when the imps had wandered outside a small (radius 15-25) area; nothing showed it refusing a visible, reachable imp inside the radius. The plan idle rail ("phases make no progress") ended a hunt after ~3 empty phases; a long `respawnWaitTicks` (300-600) on the combat params fixed it (rail never fired in the proof runs). [v 2026-10-23 questw6 local] |
| 3 finish | `talk` | `{npc:"^Wizard Mizgog$", at:{x:3104,z:3162,level:2,tolerance:3}}` (no choices) | Plan `until: v => v.questDone('imp')`. |

No step needs a new task. Nice-to-have: a `loot` mode that skips an item already held (duplicate beads take slots).

## Library save for testing

None exists. Suggested (generated, `bun conductor/tools/library.ts generate`; varps can be set):

- `imp-catcher-beads`: varp 160 = 1, the four beads in the inventory (obj ids 1470 red, 1472 yellow, 1474 black,
  1476 white, `pack/obj.pack`), Attack/Strength/Defence 20, Hitpoints 20, a bronze scimitar worn, at the Wizards'
  Tower door outside (3109, 3168), level 0 (the door is at (3109, 3166)). Tests the finish talk and the tower stairs.
- `imp-catcher-yanille`: varp 160 = 1, no beads, same levels and weapon, at (2609, 3125) north of Yanille. Tests the
  bead hunt and its `until`.
