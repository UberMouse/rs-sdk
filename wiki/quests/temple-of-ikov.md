# Temple of Ikov

## Overview

| Detail | Info |
|--------|------|
| Difficulty | Experienced |
| Length | Long |
| Quest Points | 1 |

## Requirements

- 42 Thieving
- 40 Ranged
- Ability to defeat a level 84 enemy

## Items Needed

- Lit candle
- Pendant of Lucien (obtained during quest)
- Yew bow or better
- ~50 ice arrows (obtained during quest)
- 20 limpwurt roots
- Light equipment (weight below zero required)

## Rewards

- 1 Quest Point
- 10,500 Ranged XP
- 8,000 Fletching XP
- Pendant of Lucien (if siding with Lucien)

## Walkthrough

1. Speak to **Lucien** at the **Flying Horse Bar** west of Ardougne. He gives you the **Pendant of Lucien** and asks you to retrieve the Staff of Armadyl from the Temple of Ikov.
2. Bring a **lit candle** and enter the **Temple of Ikov** southeast of the Ranging Guild.

### Boots of Lightness

3. Explore the dungeon and pick up the **Boots of Lightness** at (2654,9767) in the south cave, behind a web (see Route notes). They are a ground spawn, not a quest reward: neither completion script gives them (`quest_ikov.rs2:60-76`). [server data, unverified in game 2026-10-23] They reduce your weight significantly.

### Bridge Crossing

4. You must cross a bridge that collapses if your weight is too high. Equip the Boots of Lightness and remove heavy gear so your weight is **below zero**. Cross the bridge.

### Lever Puzzle

5. Find the **lever piece** in the dungeon.
6. Install the lever piece on the lever mechanism and pull it to **unlock a gate** further in the temple.

### Ice Arrows

7. Search the **chests** in the armoury area to collect approximately **50 ice arrows**; only one chest at a time holds arrows, 1 to 5 per find, then it moves (`ikov_dungeon.rs2:115-121`). [server data, unverified in game 2026-10-23] You will need these for the upcoming fight.

### Fighting Lesarkus

8. Equip the ice arrows and a ranged weapon. Fight **Lesarkus** (level 84). He can only be damaged by **ice arrows** -- normal attacks will not work.

### Winelda's Teleport

9. Bring **20 limpwurt roots** to **Winelda** the witch. She casts a teleport spell to send you across the lava.

### The Choice

10. You reach the Staff of Armadyl and the **Guardians of Armadyl**. You must choose:
    - **Side with the Guardians**: Keep the staff safe and betray Lucien.
    - **Side with Lucien**: Take the staff and deliver it to Lucien for your reward.

## Key NPCs & Locations

| NPC / Location | Role | Location |
|----------------|------|----------|
| Lucien | Quest start | Flying Horse Bar, W of Ardougne |
| Temple of Ikov | Main quest dungeon | SE of Ranging Guild |
| Lesarkus | Level 84 boss (ice arrows only) | Temple of Ikov |
| Winelda | Teleports you across lava | Temple of Ikov |
| Guardians of Armadyl | Final choice NPCs | Temple of Ikov inner sanctum |
| Boots of Lightness | Key item for bridge crossing | Temple of Ikov basement |

## Route notes (questw5, plan not promoted)

Plan reached the Fire Warrior; the worker died there (see Fighting the Fire Warrior). Tags `[v 2026-10-24 questw5 local]` unless noted.

- **Lucien** at the Flying Horse Inn (2573,3321): choices "I'm a mighty hero!" then "That sounds like a laugh!". Pendant of lucien is worn.
- **Dungeon ladder** (2677,3405) down / (2677,9805) up. It is missing from the travel connectors ("No connector from level 0 (2677,9804) to (2655,3283)"): use `interact` Climb-up. A bank trip (ladder, East Ardougne bank (2655,3283), back) takes about 3 min.
- **Start room** (2654-2677, 9804-9815): lever bracket (2671,9804); stairs down (2651,9808) need a lit light source held, otherwise the player lands in the dark part. The south gate blocks the way east until the lever is pulled.
- **South cave**: landing (2641,9764); web (2654,9766) cut by using a Knife on it (or slashing), 50% per try; Boots of lightness (2654,9767) and a Knife (2653,9767) behind it; stairs up (2638,9763) lead to (2654,9809).
- **Fear gate** (2661-2662,9815): the Pendant of lucien must be worn to pass from the south. Skeletons (45, 5) and giant bats there are aggressive and cost a lot of food.
- **Lever item** at (2637,9819) behind the lava bridge (zone x 2648-2650, z 9828-9829; large doors (2645,9828/29)). The bridge needs total weight below zero: non-stackable pack plus worn items in grams. Boots of lightness worn -4536 g; yew shortbow 1361 g, swordfish 450 g, limpwurt root 7 g, lit candle 28 g; stackable arrows weigh nothing. 5 swordfish passed, 14 failed; a failure deals 20 damage and drops the player to (2646,9826).
- **Lever**: consumed when fitted to the bracket and must be pulled within 200 ticks. The bracket accepts it from (2672,9805) (a `talk` `use` step clicks the confirm through); pull from (2671,9805).
- **Ice-arrow chests**: six, at (2710,9850), (2719,9838), (2729,9850), (2738,9835), (2745,9821), (2747,9848). Open (animation), then Search; a closed chest reverts after 300 ticks; one chest holds arrows at a time, 1-5 per find, and it moves after a find. Chests sit in wall gaps and the north side is not approachable, so use the arrival side. "You search the chest, but find nothing." is the empty message. Ice spiders (61, 65 HP) stand near every chest; each fight took 2-4 min, food and hundreds of arrows.
- **Varp 28** holds the chest location: -1 on a fresh account, 0 in a save made by `library.ts generate`, and with 0 no chest ever had arrows. The start save sets `{28:-1}` (general note in `learnings/local-server.md`).
- **Trap lever** (2665,9855) needs Thieving 42: "Search for traps" ("You find a trap on the lever! You disable the trap.") then Pull; pulling without it drops the bot into a pit for 20 damage. Trap door (2648,9857) leads to the Fire Warrior corridor. Scorpions (14, 5) are near the lever room.
- **Winelda** at (2656-2658,9875); her teleport lands at (2664,9876). She needs the warrior defeated and 20 limpwurt roots held (20 slots).

## Fighting the Fire Warrior

- The warrior's name in the scripts is Fire Warrior of Lesarkus (level 84). Opening its door (2646,9870) spawns it at about (2646,9866) with "You will not pass!"; lesser demons (82) and a skeleton are further in.
- Its attack is magic: `~npc_cast_spell_with_forced_max_hit(^fire_blast, 4, 8)` (`quest_ikov/scripts/fire_warrior_of_leskarus.rs2:15-18`), so Protect from Magic applies. Hitpoints 59, attack/strength/defence 78, magic 62, rangedefence 35, magicdefence -7, attackrange 6 (`quest_ikov/configs/quest_ikov.npc:210-250`). [server data]
- It takes damage only from a ranged style with ice arrows worn, otherwise "Your puny weapons do nothing against me human!" (`skill_combat/scripts/npc/npc_combat.rs2:169`). [server data]
- Observed: hits of 2, 4, 5, 3, 4 about every 4 ticks. The bot (HP 90, Def 90, Ranged 90) fought from the corridor (2645,9867) with 12 ice arrows from a yew shortbow; `combat` ended out-of-ammo after 40 s, the plan moved on without checking HP and the bot died about 04:40Z at (2645,9867). Fired ice arrows land on the floor (11 at (2646,9866)/(2647,9867)) and can be picked up. Bring far more arrows and check HP before moving on.
