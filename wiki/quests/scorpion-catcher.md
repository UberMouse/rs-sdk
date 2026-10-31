# Scorpion Catcher

## Overview

| Detail | Info |
|--------|------|
| Difficulty | Experienced |
| Length | Long |
| Quest Points | 1 |

## Requirements

- 31 Prayer (base level, for the monastery, `prayer_guild.rs2:28`) [server data, unverified in game 2026-10-23]
- The **Barcrawl** is checked only at the Barbarian Outpost gate (`outpost_gate.rs2:2`); Thormac's start check is commented out (`thormac.rs2:9-17`) [server data, unverified in game 2026-10-23]

## Items Needed

- Scorpion cage (obtained from Thormac)
- Dusty key (for Taverley Dungeon access, if needed)
- Armour
- Dragonfire shield or antifire shield
- Antipoison
- Food

## Rewards

- 1 Quest Point
- 6,625 Strength XP
- Thormac will enchant battlestaves into mystic staves (for 40,000 gp each)

## Walkthrough

1. Speak to **Thormac** at the Sorcerer's Tower south of Seers' Village. Three of his rare Kharid scorpions have escaped, and he needs you to recapture them using a special **scorpion cage**.

### Scorpion 1: Taverley Dungeon

2. Enter **Taverley Dungeon**. You may need the **Dusty Key** to access the deeper sections.
3. Navigate past dangerous monsters to the area between the **Black Demons** and **Poison Spiders**.
4. Use the scorpion cage on the first scorpion to capture it.
5. Bring antipoison for the nearby Poison Spiders and a dragonfire shield if passing Blue Dragons.

### Scorpion 2: Barbarian Outpost

6. Travel to the **Barbarian Outpost** north of the Bald Eagle waterfall.
7. The Barcrawl completion is required to enter the outpost.
8. Find and capture the second scorpion inside the outpost using the cage.

### Scorpion 3: Monastery

9. Travel to the **Monastery** north of Falador.
10. You need **31 Prayer** to climb to the upper floor where the scorpion is located.
11. Capture the third and final scorpion.

### Completion

12. Return to **Thormac** at the Sorcerer's Tower with all three scorpions in the cage.
13. He rewards you and offers to enchant battlestaves for you going forward.

## Verified route (plan `scorpion-catcher`)

Fresh load of `lib:scorpion-catcher-start` (Att/Str/Def 70, HP 75, Prayer 35, 15 swordfish, 2 Antipoison(3), Barcrawl varp 77 = 2) to quest done in 880 s, one run; walks are 750-800 s of that. Strength gained 165,625 at 25x. [v 2026-10-31 questw1 local]

- **Thormac** is on the Sorcerer's Tower top floor (level 3) about (2702,3405); travel finds no connector onto it: walk to (2698,3405 L2) and interact Ladder Climb-up at (2699,3405 L2); Climb-down on the way out. Dialog choices "What do you need", "in it for me", "Ok, I will"; the "how would I go about" branch hands the cage and closes the dialog. [v 2026-10-31 questw1 local]
- **Seer** (about (2716-2719,3485)): "I need to locate some scorpions" runs a scene that closes the dialog (about 9 ticks) and sets the hint varp; the second hint ("Where did you say that scorpion was again?") is not needed. The first hint (`scorpcatcher` = 2) gates the Old wall (`scorpionwall`). [v 2026-10-31 questw1 local]
- **Barbarian Outpost scorpion B** (2552,3570), catchable after the Barcrawl gate (gate walk about 110 s); no Wilderness on the route. [v 2026-10-31 questw1 local]
- **Taverley Dungeon scorpion A** (2877,9796) is in a pocket behind the "Old wall" secret door (2875,9799): Search it from (2876,9799), landing (2875,9798). The pathfinder treats the pocket as separate: search the wall (`unreachable:true`) both to enter and to leave. Dusty-key gate (`deepdungeondoor`, (2924,9803)): use the key on it then walk through; a plain walk fails "This gate is locked". The key's floor spawn (2900,9766) is unreachable from the ladder landing; get it from **Velrak** in the jail instead: kill a Jailer (spawn (2933,9693), level 47, 88 s) for the Jail key, use it on the Door (2931,9690) from (2930,9690) (the door at (2931,9694) is a decoy cell), then "know anywhere good", "Yes please". Poison spiders (64) and black demons lie between the gate and the wall and on the way back to the landing (2884,9797): drink antipoison before the wall and after the catch (poisoned to HP 41/75 in an unplanned run). Travel cannot chain across the Taverley ladder: stand at (2884,3399), descend, leave via waypoint (2884,9798). [v 2026-10-31 questw1 local]
- **Monastery scorpion C** (3059,3486): join Abbot Langley (3058,3484) at Prayer 35 base ("How do I get further..." then "Well can I join your order?", about 63 s). The ladder (3057,3483) has no connector to level 1: climb by interact. The scorpion wanders round the table (3059,3487) and is often unreachable from the doorway (3058,3486): alternate stands (3058,3486) and (3058,3488) with `unreachable:true` and onFail continue, eating between attempts so the idle rail sees progress (1-4 attempts). [v 2026-10-31 questw1 local]
- Cage item ids `scorpioncage*` 456-463 (456 empty, 457 A, 458 AB, 459 AC, 460 B, 461 BC, 462 C, 463 full). Reward 1 QP, Strength 6,625 base. [server data, unverified in game 2026-10-31]

## Key NPCs & Locations

| NPC / Location | Role | Location |
|----------------|------|----------|
| Thormac | Quest start and completion | Sorcerer's Tower, S of Seers' Village |
| Scorpion 1 | Capture target | Taverley Dungeon (between Black Demons and Poison Spiders) |
| Scorpion 2 | Capture target | Barbarian Outpost, N of waterfall |
| Scorpion 3 | Capture target | Monastery upper floor, N of Falador |
| Black Demons | Dangerous NPCs nearby | Taverley Dungeon |
| Poison Spiders | Dangerous NPCs nearby | Taverley Dungeon |
