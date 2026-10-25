# The Knight's Sword

| Detail     | Info          |
|------------|---------------|
| Difficulty | Intermediate  |
| Length     | Long          |
| Quest Points | 1          |

## Requirements

- 10 Mining
- Ability to evade level 57 Ice Warriors

## Items Needed

- Redberry pie for Thurgo
- 2 Iron bars

## Rewards

- 12,725 Smithing XP (`quest_squire.rs2:223`) [server data, unverified in game 2026-10-23]
- No sword: the Squire takes the blurite sword when you hand it over (`quest_squire.rs2:100`) [server data, unverified in game 2026-10-23]

## Walkthrough

1. Speak to the **Squire** at the **White Knights' Castle** in Falador. He has lost Sir Vyvin's sword and needs a replacement.
2. The Squire suggests speaking to **Reldo** in the **Varrock Palace Library**. Reldo tells you about an Imcando dwarf named Thurgo who lives south of Port Sarim.
3. Bring a **redberry pie** and travel to **Thurgo's** hut on the peninsula south of Port Sarim, near Mudskipper Point. Give him the pie to earn his trust.
4. Thurgo agrees to make a replacement sword but needs to see the original design. Return to Falador and go to **Sir Vyvin's room** on the 2nd floor of the White Knights' Castle. Search his **cupboard** to obtain the **portrait** of the sword. Do this while Sir Vyvin is not in the room.
5. Show the portrait to Thurgo. He requires a **blurite ore** and **2 iron bars** to forge the sword.
6. Enter the **cave** near Thurgo's hut. Navigate past level 57 **Ice Warriors** and mine a **blurite ore** from the blurite rocks at the end of the cave.
7. Return to Thurgo with the blurite ore and 2 iron bars. He smiths the sword.
8. Bring the completed sword to the Squire in Falador to finish the quest.

## Key NPCs & Locations

| NPC / Location          | Where                                       |
|-------------------------|----------------------------------------------|
| Squire                  | White Knights' Castle, Falador                |
| Reldo                   | Varrock Palace Library                        |
| Thurgo                  | Hut south of Port Sarim (Mudskipper Point)   |
| Sir Vyvin               | White Knights' Castle, 2nd floor              |
| Blurite cave            | Near Thurgo's hut, south of Port Sarim        |
| Ice Warriors (level 57) | Inside the blurite cave                       |

## Script and run notes

Quest varp `%squire` stages: 1 started, 2 spoken to Reldo, 3 pie given, 4 spoken to Thurgo, 5 looking for the portrait, 6 looking for blurite, 7 complete (`quest_squire.constant`, `quest.constant`). [server data, unverified in game 2026-10-23]

- Reldo's "What do you know about the Imcando dwarves?" option appears only at stage 1 (`reldo.rs2`). [server data, unverified in game 2026-10-23]
- Thurgo offers "Would you like a redberry pie?" only while a redberry pie is held (`thurgo_inquire`); Thurgo's talk at stage 2 is that path. [server data, unverified in game 2026-10-23]
- The Squire's status report ("I have found an Imcando dwarf but he needs a picture...") advances stage 4 to 5. [server data, unverified in game 2026-10-23]
- Sir Vyvin's cupboard is at (2984,3336) level 2, a closed loc: Open, then Search. Vyvin must be farther than 1 tile from the bot (`npc_find(coord, sir_vyvin, 1, 0)`), else he shouts and the search is refused. At stage 5 or later it gives a portrait whenever none is held in the inventory or bank (`cupboards.rs2`). [server data, unverified in game 2026-10-23]
- Thurgo takes the portrait at stage 5 (moving to 6); at stage 6 any talk goes straight to the sword check (blurite ore + 2 iron bars, else a refusal). [server data, unverified in game 2026-10-23]
- Cave: the Asgarnian Ice Dungeon. Entry ladder `Climb-down` at (3008,3150), stand (3009,3150), lands (3009,9550); exit `Climb-up` ladder (3008,9550). Blurite rocks are named "Rocks blurite ore": rock 0 (3049,9567) (`interact` Mine, `tile` (3049,9566)), rock 2 (3067,9582). The ice warriors and giants near it beat a combat-52 bot with 10 salmon; see [hazards](../../learnings/hazards.md). [v 2026-10-23 questw4 local]
- Drogo's Mining Emporium lists iron bars at 28 gp but had stock 0. [v 2026-10-23 questw4 local]
- Dialog choices that worked: Squire "life as a squire", "make a new sword", "would these dwarves", "give it a go"; Thurgo "redberry pie". Reldo's "Imcando" option exists only at stage 1. [v 2026-10-23 questw4 local]
- Thurgo's hut walls span x 2999-3002, z 3142-3146; the dungeon ladder stand tile (3009,3150) is outside the hut. The blurite rock is 40 tiles from the ladder. [v 2026-10-23 questw4 local]
- The start must hold the 2 iron bars and the redberry pie (buying bars at Drogo's failed: stock 0).
- Run 3 (combat 53, no prayer, 10 salmon) ate all 10 salmon, reached HP 15/49 and mined no ore; `travel` `flee:true` back to the ladder worked. With no food the low-HP guard only regenerates in place, so a Climb-up errand never ran. [v 2026-10-23 questw4 local]
- Run 4 (combat 55: Att 40, Str 47, Def 40, HP 49, Prayer 43, steel scimitar, 15 lobsters, Protect from Melee) died at rock 0 (stand (3049,9567)) to an Ice warrior (lvl 57). Several ice warriors and giants crowd the rock and attack at once: one mine-blurite phase took HP 49 -> 9 within seconds with 13 lobsters unused; the low-HP eat guard fired only at HP 16 and 4, one lobster ate (+12), the next eat failed ("Failed to eat Lobster") and the bot died; a flee `travel` started at HP 4 was too late. Protect from Melee at Prayer 43 ran out (`out-of-prayer`) after about 100 s of fighting, in which it killed several monsters (+6100 Strength xp, +2012 Hitpoints xp). So the combat-55 start is too weak for the mine at rock 0: the plan needs a stronger start save and an early flee exit (flee well above HP 16). [v 2026-10-23 questw4 local]
- `interact` Mine on the blurite rock without `expect` ends "done" on "You swing your pick at the rock." with no ore; use `expect: 'manage to mine'` to wait for the ore. [v 2026-10-23 questw4 local]
- Phase times (plan run): squire-start 113 s, stash-bars 22 s, reldo-approach 91 s, reldo 17 s, thurgo-pie 124 s, enter-dungeon ~10 s, mine-blurite 4-25 s, exit-dungeon 26 s, thurgo-ask 18 s, squire-report 15-75 s, cupboard open/search 10-22 s each, castle-down 11 s, bars-withdraw 23 s, thurgo-portrait 61 s, thurgo-sword 7 s, squire-finish 74 s. [v 2026-10-23 questw4 local]

## Pie prep (plan `ks-prep`)

`conductor/plans/ks-prep.ts` takes Smithing 1 to the quest start kit (redberry pie, 2 iron bars; 13 bronze bars banked) in ~10 min, 58 s on a rerun. [v 2026-10-24 conductor3 local]

- Wydin's food store, Port Sarim (3014,3204), sells Pot of flour (10 gp) and Redberries (3 gp): no Frenita/Yanille or berry-bush trip needed. [v 2026-10-24 conductor3 local]
- Pie dish: `crafting` product 'pie dish' with `fire:true` at the Barbarian Village potter's wheel (3086,3410), from 1 clay + a filled bucket or jug. Frenita (Yanille) is the only shop that sells one. [v 2026-10-24 conductor3 local]
- Pot of flour used on a bucket/jug of water opens a Bread/Pastry/Pizza/Pitta dough menu. The `items` combine answers it with `choice` (`{combine:{use:'^Pot of flour$', on:'^(Bucket|Jug) of water$', choice:'^Pastry dough'}}`, 0a936e225); without `choice` it fails naming the options. [v 2026-10-24 conductor3 local; choice v unit+itest 0a936e225]
- Rimmington mine (2980,3240) has tin, copper, iron and clay; the general store sells bucket and jug; sink (2966,3209); bronze bars from there take Smithing 1 to 20 ([smithing](../../learnings/smithing.md#xp-rates)). The Falador range at (3039,3366) cooked the pie. [v 2026-10-24 conductor3 local]

## Plan status

Measured safe start: the plan also finished from Smithing 20 at combat ~60 (Strength 59, HP 50) with 20 swordfish in 706 s. The ice dungeon fight was not lethal: HP 38/50 at check-in, 45/50 at the end, 18/20 swordfish left, and the flee-to-ladder phase fired once. So the minimum start lies between combat 55 (died) and combat ~60 with 20 swordfish. [v 2026-10-24 conductor3 local]

Plan `conductor/plans/knights-sword.ts` (promoted) runs from a fresh load of `lib:knights-sword-strong` to quest done in 761 s with no edits mid-run; the plain walk Falador -> Reldo takes 97 s (no waypoint since the walk door-stop fix). No ice monster attacked the strong start on any visit and none of its 20 swordfish were eaten, so its `defend`/flee path is untested and the real minimum start lies between it and the combat-55 start that died. `mine-blurite` with `onFail: continue` does not wait for a depleted rock: a run that finds it depleted ends "no phase applies" and a rerun after the respawn passes. [v 2026-10-24 questw4 local]

- Phase order that worked: squire-start, stash-bars, reldo-approach, reldo, thurgo-pie, eat-before-descent, enter-dungeon, mine-blurite (`expect: 'manage to mine'`, onFail continue), flee-to-ladder (travel flee, only when in combat in the dungeon), exit-dungeon, thurgo-ask, squire-report, cupboard-open, cupboard-search, castle-down, bars-withdraw, thurgo-portrait, thurgo-sword, squire-finish. No defend phase, no prayers.
- Start saves: `lib:knights-sword-strong` (Lumbridge (3222,3218); Att 60, Str 60, Def 65, HP 70, Prayer 43, Mining 10; full adamant helm/platebody/platelegs/kiteshield + rune scimitar worn; bronze pickaxe, redberry pie, 2 iron bars, 20 swordfish) finished the quest; on that visit no ice monster attacked during the mining and no swordfish was eaten, so the real minimum start is unknown. `lib:knights-sword-start` (combat 55: Att 40, Str 47, Def 40, HP 48, Prayer 43, steel scimitar, 15 lobsters) died at rock 0.
- The blurite rock stays depleted for a while after a mine: a re-run soon after got `no effect within 25 ticks` on `Mine`.
- Ice warrior (57) and ice giant (53) spawns at (3055,9567) and (3056,9566), plus warrior groups at (3046,9580), (3049,9590), (3053,9576). Their wander range is 3 (reaches x >= 3052, short of the stand tile (3049,9567)), but aggression/hunt range reaches the stand tile; no guaranteed safe tile found.
- `travel` climbs down into the dungeon, but `travel` from the dungeon to the surface fails ("No connector from level 0 (3049, 9567) to (3011, 3152)"); use `interact` Climb-up on the ladder (3008,9550) when the ore is held.
- Sir Vyvin's cupboard (level 2) offers Open when closed, then Search | Shut; Search before Open fails. After the portrait step a White Knight stands next to the cupboard; it did not attack.
- A bank walk from the castle's level 2 has no path ("No path to (3013,3355) from (2987,3341): no waypoints"); `travel` to the Squire on level 0 first (castle-down), then bank. A plan gate near the Squire must count level 2 near the cupboard as "at the Squire", or the plan walks back down after each cupboard step (two runs ended `phases make no progress` on cupboard-open/cupboard-search vs squire-report).
