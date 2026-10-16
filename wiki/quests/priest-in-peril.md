# Priest in Peril

| Detail     | Info     |
|------------|----------|
| Difficulty | Novice   |
| Length     | Medium   |
| Quest Points | 1 QP  |

## Requirements

- Completion of Rune Mysteries
- Ability to defeat two level 30 enemies

## Items Needed

- 50 unnoted rune essence (no pure essence in this revision; Drezel takes only unnoted rune essence)
- A bucket (2 gp, general store) and coins
- Weapon and armour
- Food

## Rewards

- 1 Quest Point
- 1,406 Prayer XP
- Wolfbane dagger
- Access to Morytania

## Walkthrough

1. Speak to **King Roald** in **Varrock Palace**. He asks you to check on the temple priest to the east.
2. Travel east to the **temple** on the border of Morytania. Knock on the large door.
3. Descend into the dungeon beneath the temple. Kill the **Temple Guardian Dog** that guards the passage.
4. Return upstairs to the temple and report back to **King Roald** in Varrock Palace.
5. The King is alarmed and sends you back. Return to the temple and kill the **Monk of Zamorak** (level 30) inside. He drops a **golden key**.
6. Go upstairs to the 3rd floor and talk to **Drezel**, who is imprisoned.
7. Use the golden key and iron key at the **monuments** in the dungeon to swap them, obtaining the correct key combination.
8. Unlock the cell to free **Drezel**.
9. Obtain **blessed water** from Drezel.
10. Use the blessed water on the **vampire coffin** in the dungeon to neutralise the threat.
11. Give **50 unnoted rune essence** (or pure essence) to Drezel to complete the quest.

## Key NPCs & Locations

| NPC / Location         | Where to Find                                    |
|------------------------|--------------------------------------------------|
| King Roald             | Varrock Palace                                   |
| Temple                 | East of Varrock Palace, on the Morytania border  |
| Temple Guardian Dog    | Dungeon beneath the temple                       |
| Monk of Zamorak        | Inside the temple (level 30)                     |
| Drezel                 | 3rd floor of the temple                          |
| Monuments              | Dungeon beneath the temple                       |

## Bot route (server scripts, `quests/quest_priestperil`, `areas/area_mausoleum`)

Reward: 35,150 Prayer XP at 25x (1,406 base) and the Wolfbane dagger. Steps 1-3 run on conductor2w5 (plan draft `conductor/runs/conductor2w5/plans/priest-in-peril.ts`) [v 2026-10-16 conductor2w5 local]; the rest is from the scripts [server data, unverified in game 2026-10-16].

1. King Roald (3222, 3476) starts it.
2. Knock-at on the temple Large door (3408, 3488/3489; stand west of it) and answer "Roald sent me" / "Sure". The `interact` knock leaves the dialog open, and a following `talk` phase with `npc` + `choices` and no `at` continues it.
3. Trapdoor (3405, 3507): Open, then Climb-down; the cellar ladder at (3405, 9907) climbs back up. Ghouls stand near (3416, 3509).
4. Kill the Temple guardian dog (45 HP, level 30) at (3405, 9902). It may be out of view from the ladder landing (3405, 9906).
5. Back to Roald, then kill a Monk of Zamorak (level 30; ground floor (3411, 3489), (3415, 3485)) until the Golden key drops.
6. Temple: spiral staircases (3417, 3484) / (3417, 3492) to level 1, ladder (3410, 3485) to level 2. Talk-through the Cell door (3415, 3489, level 2) to Drezel: "Tell me anyway" / "Yes".
7. Dungeon: use the bucket on the well (3423, 9890); use the Golden key on each of the 7 monuments (the one holding the Iron key swaps them). Gate door1 (3405, 9895) needs quest state >= 5, door2 (3431, 9897) >= 8.
8. Iron key on the Cell door, open it; Talk to Drezel with the bucket of murky water held to bless it; use the blessed water on the Coffin (3413, 3486, level 2); talk to Drezel.
9. Drezel in the dungeon (3440, 9895): hand over 50 unnoted rune essence to complete.

