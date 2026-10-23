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
- Walking Varrock to Reldo got `Stuck at (3212, 3438)` 8 times in the market square (see [walking](../../learnings/walking.md)); a plain `travel` to (3210,3470) got through in 7 s. [v 2026-10-23 questw4 local]
- Run 3 (combat 53, no prayer, 10 salmon) ate all 10 salmon, reached HP 15/49 and mined no ore; `travel` `flee:true` back to the ladder worked. With no food the low-HP guard only regenerates in place, so a Climb-up errand never ran. [v 2026-10-23 questw4 local]
- Unknown: how much food is needed with Protect from Melee, whether Prayer 43 lasts the round trip, and whether rock 0 or rock 2 is safer.
- Plan in progress (not promoted): draft `conductor/runs/questw4/plans/knights-sword.ts` is proven through enter-dungeon (squire-start, stash-bars, reldo, thurgo-pie, enter-dungeon); mine-blurite onward unproven. Start save `lib:knights-sword-start`: Att 40, Str 47, Def 40, HP 48, Prayer 43, Mining 10 (combat 55), steel scimitar, bronze pickaxe, redberry pie, 2 iron bars, 15 lobsters, at Lumbridge. [v 2026-10-23 questw4 local]
