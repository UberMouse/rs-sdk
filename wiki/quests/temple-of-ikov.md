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

## Route (promoted plan `conductor/plans/temple-of-ikov.ts`)

Fresh load of `lib:temple-of-ikov-start` to quest done in one run of 2808 s (Armadyl ending), restart-safe (state from quest tab, items, position, nearby things). About 5 min Lucien/boots/lever/bank restock, 35 min chest sweep to 30 ice arrows, 6 min Fire Warrior through the walk to Varrock. [v 2026-10-31 questw5 local]

- **Start save**: East Ardougne by the Flying Horse Inn (2580,3320); Thieving 45, Ranged 90, Defence 90, HP 90, Prayer 99, Attack 60, Strength 60; yew shortbow and 1000 rune arrows worn; pack 5 swordfish (one slot each), lit candle, knife, 500 coins; bank 20 limpwurt roots and 25 swordfish; varp 28 -1. A lower profile (Thieving 42, Ranged 70+, Prayer 70+, Defence and HP about 70 with Protect from Melee) is believed to work but untested; combat level is not a gate. Prayer need: about 30 points for the warrior, 60 for the gate skeletons. [v 2026-10-31 questw5 local]
- **Lucien** at the Flying Horse Inn (2573,3321): choices "I'm a mighty hero!" then "That sounds like a laugh!". Pendant of lucien is worn. [v 2026-10-24 questw5 local]
- **Dungeon ladder** (2677,3405) down / (2677,9805) up. A bank trip (ladder, East Ardougne bank (2655,3283), ladder back) takes 1.5-3 min. [v 2026-10-31 questw5 local]
- **Start room** (2654-2677, 9804-9815): lever bracket (2671,9804); dark stairs down (2651,9808) need a lit light source held. [v 2026-10-31 questw5 local]
- **South cave**: landing (2641,9764); web (2654,9766) needs a Knife used on it, 50% per try (the plan does three uses in one `talk use` plus retry phases); Boots of lightness (2654,9767) and a Knife (2653,9767) behind it; stairs up (2638,9763) lead to (2654,9809). [v 2026-10-31 questw5 local]
- **Fear gate** (2661-2662,9815): the Pendant of lucien must be worn to pass. Skeletons (45, 5) and giant bats there are aggressive and cost food. [v 2026-10-31 questw5 local]
- **Lava bridge** (zone x 2648-2650, z 9828-9829): carried weight must be below zero. Boots of lightness worn -4536 g; yew shortbow 1361 g, swordfish 450 g, limpwurt root 7 g, lit candle 28 g; stackable ice arrows weigh nothing. 5 swordfish passed, 14 failed (20 damage, dropped to (2646,9826)). [v 2026-10-31 questw5 local]
- **Lever**: item at (2637,9819) behind the bridge. The bracket (2671,9804) takes it (from (2672,9805), a `talk` `use` step clicks the confirm); Pull within 200 ticks from (2671,9805); that opens the south gate (2661-2662,9803) to the chests. [v 2026-10-31 questw5 local]
- **Ice-arrow chests**: six, at (2710,9850), (2719,9838), (2729,9850), (2738,9835), (2745,9821), (2747,9848). Open (animation, 2 s), then Search; a search that finds nothing ("You search the chest, but find nothing.") costs 20 s. A closed chest reverts after 300 ticks; one chest holds arrows at a time, 1-5 per find, then it moves. Chests sit in wall gaps, the north side is not approachable. [v 2026-10-31 questw5 local]
- **Ice spiders** (61, 65 HP) sit within about 8 tiles of every chest and are the food sink: 19 swordfish down to 3 over about 30 min collecting 30 arrows. With 15+ swordfish Protect from Melee is not needed for them. [v 2026-10-31 questw5 local]
- **Varp 28** holds the chest location: -1 on a fresh account; with 0 no chest ever has arrows. Generated saves now start varps from a fresh account's defaults, so it is -1 unless the spec sets it (`learnings/local-server.md`). [v 2026-10-31 questw5 local]
- **Trap lever** (2665,9855) needs Thieving 42: "Search for traps" must finish before Pull; racing it dropped the bot into a pit for 20 damage. Then the trap door (2648,9857) leads to the Fire Warrior corridor. Scorpions (14, 5) are near the lever room. [v 2026-10-31 questw5 local]
- **Winelda** (2656-2658,9875): the first talk at ikov 40 with the choice "Yes I do!" sets 50; a second plain talk with 20 limpwurt roots (20 slots) takes them and teleports you to (2664,9876). A talk with a choice list at ikov 50 fails (that page has no choice). [v 2026-10-31 questw5 local]
- **Shiny key** at (2628,9859): pickup can fail once because of nearby lesser demons and skeletons; retry. [v 2026-10-31 questw5 local]
- **Secret wall** (2643,9892), "Wall" Push, leads to the Guardians of Armadyl (about 2636-2649, 9899-9912); the Staff of Armadyl is at (2638,9906). [v 2026-10-31 questw5 local]
- **Armadyl ending**: the Pendant of lucien must NOT be worn or the Guardians attack. Choices: "I seek the Staff of Armadyl.", "Lucien will give me a grand reward for it!", "You're right, it's time for my yearly bath.", "Ok! I'll help!". They give the Armadyl pendant, which must be worn to damage Lucien. [v 2026-10-31 questw5 local]
- **Exit**: ladder up at (2659,9892) lands in McGrubor's Wood near (2659,3491). The wood's gate (2649-2650,3469) is locked from inside; leave by the Loose Railing (2662,3500), "Squeeze-through" east from (2661,3500). The walk from there to Lucien takes about 3 min. [v 2026-10-31 questw5 local]
- **Lucien** (level 14, 17 HP) at (3176,3476) behind the door (3176,3481). His death with the Armadyl pendant worn completes the quest; the kill gave Ranged +264300 and Fletching +200000. [v 2026-10-31 questw5 local]

## Fighting the Fire Warrior

- Fire Warrior of Lesarkus (level 84 in the scripts). Opening its door (2646,9870) spawns it at (2646,9866) with "You will not pass!"; its death opens the door (ikov >= 40). Lesser demons (82) and a skeleton are further in. [v 2026-10-31 questw5 local]
- Its attack is magic (`~npc_cast_spell_with_forced_max_hit(^fire_blast, 4, 8)`, `fire_warrior_of_leskarus.rs2:15-18`). Protect from Magic (on through the combat task's `prayers`) stops the blast entirely: HP stayed full and the fight took about 1 min. Hitpoints 59, defence 78 (`quest_ikov.npc:210-250`). [v 2026-10-31 questw5 local]
- It takes damage only from a ranged style with ice arrows worn (`npc_combat.rs2:169`); about 30 ice arrows at Ranged 90 (ice arrows are steel-grade, rangebonus 16). Fired arrows land on the floor and can be picked up. [v 2026-10-31 questw5 local]
- Without prayer, 12 arrows and 2 swordfish at HP 90 ended in death at (2645,9867) (hits of 2-5 every 4 ticks). [v 2026-10-24 questw5 local]

## Gotchas (catalog gaps, not game facts)

- The dungeon ladder has no world connector: `travel` and `bank` from (2677,9804) fail with "No connector from level 0"; use `interact` Climb-up.
- `interact` returns on "an animation started" for ladders, chests and levers; use `unreachable: true`.
- `combat` chains through every spider in range after its attacker dies.
- The idle rail ends the plan on three failed web slashes.
