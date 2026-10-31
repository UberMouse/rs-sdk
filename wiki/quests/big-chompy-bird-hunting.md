# Big Chompy Bird Hunting

## Overview

| Detail       | Info           |
|--------------|----------------|
| Difficulty   | Intermediate   |
| Length       | Short          |
| Quest Points | 2              |

## Requirements

### Skill Requirements

- 5 Fletching (checked for shafts, tips and arrows), 5 Crafting (checked for wolf bone tips), 30 Cooking (checked when cooking the chompy at the spit: `raw_chompy.rs2`) [server data, unverified in game 2026-10-24]
- 30 Ranged: no script in `quest_chompybird/` checks Fletching/Cooking/Ranged at the quest start; only the three above were found in the item scripts. [server data, unverified in game 2026-10-24]

## Items Needed

- Achey tree logs (obtainable during quest)
- Feathers
- Wolf bones (obtainable during quest)
- Ogre bellows (obtained during quest)

## Rewards

- 735 Ranged XP
- 262 Fletching XP
- 1,470 Cooking XP
- Ogre Bow

## Walkthrough

### Getting Started

Speak to Rantz, located southeast of Yanille in the ogre area. He wants you to help him hunt a Chompy bird for dinner.

### Crafting Ogre Arrows

1. Chop achey trees nearby to obtain achey tree logs.
2. Use a knife on the logs to create ogre arrow shafts.
3. Add feathers to the shafts.
4. Kill wolves in the area and collect their bones.
5. Use a chisel on the wolf bones to create bone arrow tips.
6. Attach the bone tips to the feathered shafts to complete the ogre arrows.

### Catching Bloated Toads

1. Obtain ogre bellows from Rantz.
2. Use the bellows on a swamp bubble to fill them with swamp gas.
3. Use the filled bellows on toads in the swamp to inflate them into bloated toads.

### Hunting the Chompy Bird

1. Drop the bloated toads in an open area as bait.
2. Speak to Rantz to receive the Ogre Bow.
3. Wait for a Chompy bird to land on the bait.
4. Kill the Chompy bird using the Ogre Bow and ogre arrows.

### Cooking the Chompy

1. Pluck the Chompy bird carcass to obtain raw Chompy meat.
2. Collect vegetables from the surrounding area (onion, cabbage, potato, tomato, or doogle leaves).
3. Use the raw Chompy and vegetables on the special fire (spit-roast) located north of Rantz.
4. Give the cooked Chompy to Rantz to complete the quest.

## Key NPCs & Locations

| NPC/Location          | Role                                    |
|-----------------------|-----------------------------------------|
| Rantz                 | Quest start, SE of Yanille              |
| Wolves                | Source of bones for arrow tips           |
| Swamp (near Rantz)    | Collect swamp gas and toads             |
| Spit-roast (N of Rantz) | Cook the Chompy bird                 |

## Server data (map and script read, not run)

All tagged [server data, unverified in game 2026-10-24] (worker questw3 read `server/content/scripts/quests/quest_chompybird/`, `skill_fletching/scripts/ogre_arrows.rs2`, maps m41_46, m40_46, m41_146; coordinates re-derived from the maps). The quest varp is `chompybird` (293, default 0).

### Places

| Thing | Tile |
|---|---|
| Rantz | (2630, 2981) |
| Spit roast | (2630, 2990) |
| Cave entrance `rantzogrecaveentrance` | (2629, 2998), leads to the cave at (2647, 9379) |
| Cave exit | (2646, 9377) |
| Bugs (cave) | (2640, 9391) |
| Fycie (cave) | (2650, 9393) |
| Ogre chest (cave) | (2637, 9398) |
| Swamp bubbles | (2597-2600, 2963-2967) |
| Swamp toads | (2595-2603, 2962-2970) |
| Wolves | (2602-2610, 2955-2967); bubbles, toads and wolves are one cluster 30 tiles west of Rantz |
| Achey trees | (2624-2629, 2948-2977), plus more further west (m40_46) |
| Bait zone | x2631-2639, z2962-2971 (`inzone 0_41_46_7_18 .. 0_41_46_15_27`) |

Vegetables: potato (2640, 2958), (2642, 2959); cabbage (2645, 2958); onions (2581-2586, 2965-2968); tomato ground spawn (2584, 2966); doogle leaves ground spawns (2560-2565, 2971-2973); equa leaves ground spawns (2639, 2952), (2648, 2963), (2649, 2956).

### Mechanics

- Shops: Bugs sells a knife and a chisel for 10 coins (once). Fycie sells 25 feathers for 50 coins (once). Neither checks inventory space (the goods drop on the floor).
- Arrows: a knife on an achey log gives 2-6 ogre arrow shafts. A chisel on a wolf bone gives 2-6 wolfbone arrowtips. Feathers (4 each, up to 24 per use) on shafts make flighted ("headless") arrows, at most 6 per use. Flighted arrows plus tips make up to 6 ogre arrows per use. Rantz wants 6 arrows the player made (a varp bit is set on the first ogre arrow made).
- Bellows: ogre bellows hold 3 loads of swamp gas. At most 3 bloated toads can be held; a 4th catch lets one escape.
- Placing bait: `[opheld1,bloated_toad]` (labelled "Drop") places it, only inside the bait zone while the quest is open (below the "shown toad" stage Rantz must have told you where). After the quest the zone is refused ("Rantz doesn't like it...") and bait works elsewhere in the three ogre-area map squares. Release (op 5) / Release All (op 4) frees toads. See `learnings/README.md` (Action semantics) for the SDK gotcha.
- A placed toad rolls a chompy spawn every 4 ticks at 20% and explodes on the 4th roll for 1-2 damage to players next to it (about 59% that a given toad spawns a chompy before it explodes).
- Rantz shoots and misses the first chompy while the stage is below 45; ask him for the bow ("Come on, let me have a go", "I'm actually quite strong"), then place another toad.
- The chompy bird's Attack is op 5; it needs the ogre bow in hand and ogre arrows in the quiver. Plucking (op 4 on the dead bird) gives raw chompy, bones and 10-29 feathers.
- Ogre chest: lift the rock with a Strength roll (`stat_random(strength, 30, 254)`); the bellows are inside.
- Flavours: random, set when you talk to each ogre after Rantz's cooking talk. Rantz: potato or onion. Bugs: equa leaves or cabbage. Fycie: tomato or doogle leaves. Cooking needs all three; `cook_chompy_quest` shows a message box if one is missing.
- A burn at the spit (`stat_random(cooking, 200, 255)`) wastes the chompy and needs another kill.
- On completion `%chompybird_kills` is reset to 0 (afterwards it counts kills).

### Route outline (as designed; the verified run is below)

1. Talk to Rantz ("Ok, I'll make you some 'stabbers'"), stage 5.
2. Buy a knife and chisel from Bugs.
3. Get achey logs and wolf bones; make the arrows; give Rantz 6.
4. Ask "How do we make the chompys come" (stage 15); lift the rock off the ogre chest and take the bellows.
5. Fill the bellows at the bubbles; inflate toads; show one to Rantz.
6. Place a toad in the bait zone; Rantz misses.
7. Ask him for the bow; place another toad; kill the chompy; pluck it.
8. Show it to Rantz; ask Fycie and Bugs their flavours; gather the vegetables; cook at the spit; hand it in.

Library save `big-chompy-start`: (2631, 2976), 300 coins, Att 40, Str 54, Def 40, HP 47, Prayer 49, Crafting 85, Smithing 87, Fletching 5, Cooking 50, Ranged 30; mithril scimitar worn; pack 10 swordfish, bronze axe, 100 feathers, 5 wolf bones, and one each of potato, onion, cabbage, tomato, equa leaves, doogle leaves. Cooking is 50 because a spit-roast burn at 30 wasted the only chompy on one run. The wolves are level 64 and the combat task refuses them, so wolf bones come from the save; tomato, onion and doogle leaves lie in an aggressive ogre pen beside wolves, so the save holds them. [v 2026-11-01 questw3 local]

## Verified route (plan `conductor/plans/big-chompy-bird-hunting.ts`)

Fresh load of `lib:big-chompy-start` to quest done in one run, 724 s, on questw3. XP gained: Attack 6000, Hitpoints 2300, Ranged 19375, Cooking 37105, Woodcutting 2500, Fletching 8902, Crafting 1062. Final position (2632, 2980). [v 2026-11-01 questw3 local]

Phase seconds: chop-achey 47, catch-toad 90 (5 runs), wait-bait 100, shoot 162 (3 runs), retreat 62. The bait waits and the bait-and-shoot cycles dominate (a placed toad brings a chompy only about 59% of the time). [v 2026-11-01 questw3 local]

### Quest stages (varp `chompybird`, 293)

5 on starting with Rantz; 10 after Rantz takes 6 arrows; 15 after asking "How do we make the chompys come"; 25 after a toad is shown; then 30, 40 and 45 (Rantz misses and lends the bow); 50 on the kill; 55 after showing the chompy; 60 when cooked; then done. [v 2026-11-01 questw3 local]

### Places confirmed

- Rantz (2630, 2981); spit roast (2630, 2990); cave entrance (2629, 2998); cave chest (2637, 9398); Bugs (2640, 9391); Fycie (2650, 9393); achey trees within (2624-2629, 2948-2977); swamp toads and bubbles (2595-2603, 2962-2970). [v 2026-11-01 questw3 local]
- Bait zone x2631-2639 z2962-2971; a tile at z 2972 is outside it and placing does nothing there. [v 2026-11-01 questw3 local]
- Danger beside the swamp: see `learnings/hazards.md` (Feldip swamp row).

### Game behaviour seen

- Rantz, Fycie and Bugs offer "Talk", not "Talk-to". Bugs sells a knife and chisel for 10 coins. [v 2026-11-01 questw3 local]
- A single achey-tree chop gives "you get some" logs. [v 2026-11-01 questw3 local]
- Placing bait: the bloated toad item's "Drop" op, message "carefully place the bloated toad". The placed toad shows as the NPC "Bloated Toad" with no options, a tick or two later. [v 2026-11-01 questw3 local]
- The ogre bow needs ogre arrows in the quiver; a chompy takes several arrows. The ogre bow auto-retaliates on attackers and wastes arrows, so the plan re-wields the scimitar when no bait or chompy is near. [v 2026-11-01 questw3 local]
- A Chompy corpse lasts about 100 ticks. The kill dropped 3 Ogre arrows plus Raw chompy and Bones; plucking leaves the Raw chompy on the ground and puts feathers in the pack. [v 2026-11-01 questw3 local]
- Bugs's dialog page is not recorded in `recentDialogs`, so his seasoning request cannot be read back; the plan holds all six seasonings. Rantz asks potato or onion, Bugs equa leaves or cabbage, Fycie tomato or doogle leaves; cooking consumes the three named ones and leaves the rest. [v 2026-11-01 questw3 local]
- A burn consumed the seasonings and left a Ruined chompy, so a new chompy must be hunted. [v 2026-11-01 questw3 local]
- The cave chest's strength roll (`stat_random(strength, 30, 254)`, `ogre_chest.rs2:12`) fails often; the plan alternates a two-tile nudge walk so the idle rail does not end the run. [v 2026-11-01 questw3 local]
- The spit-roast success roll is `stat_random(cooking, 200, 255)` (`raw_chompy.rs2:69`, `:192`). [server data, unverified in game 2026-11-01]
