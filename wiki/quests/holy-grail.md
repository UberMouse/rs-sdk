# Holy Grail

| Detail     | Info         |
|------------|--------------|
| Difficulty | Experienced  |
| Length     | Long         |
| Quest Points | 2 QP      |

## Requirements

- Completion of Merlin's Crystal
- 20 Attack
- Ability to defeat the Black Knight Titan (level 120)
- Recommended: 43 Prayer (Protect from Melee)

## Items Needed

- Excalibur (from Merlin's Crystal)
- Food and combat equipment

## Rewards

- 2 Quest Points
- 15,300 Defence XP
- 11,000 Prayer XP

## Walkthrough

1. Speak to **King Arthur** at **Camelot Castle**. He sends you on a quest to find the Holy Grail.
2. Go downstairs and consult **Merlin**. He advises you to seek out a holy man for guidance.
3. Visit **Brother Galahad** in his hermit shack west of **McGrubor's Woods**. He gives you a **Holy Table Napkin**.
4. Travel to **Entrana** and speak to the **High Priest** in the church. He directs you to speak with the **Crone** on the island.
5. Talk to the **Crone** on Entrana. She provides cryptic guidance about the location of the Fisher King's realm.
6. Return to **Brother Galahad** if you have not already received the Holy Table Napkin.
7. Travel to **Draynor Manor**. Go to the top floor and search to find **two Magic Whistles**.
8. Travel to **Brimhaven** on Karamja. Find the area with **gold-topped stilts** south of the town.
9. Stand under the stilts and blow the **Magic Whistle** to be teleported to the Fisher King's realm.
10. The **Black Knight Titan** (level 120) blocks your path. Defeat him using **Excalibur** -- he can only be harmed by this weapon. Protect from Melee is strongly recommended.
11. After defeating the titan, proceed forward and ring the **Grail Bell** to enter the Fisher King's castle.
12. Speak to the **Fisher King** inside. He tells you that his kingdom is dying and asks you to find his son, Sir Percival.
13. Return to **Camelot Castle** and speak to King Arthur. He tells you Sir Percival was last seen heading to the **Goblin Village**.
14. Pick up a **feather** from the table in Camelot (needed to identify yourself).
15. Travel to **Goblin Village** (north of Falador). Find **Sir Percival** trapped in a sack. Free him and tell him about his father.
16. Return to the **Fisher King's realm** using the Magic Whistle at Brimhaven.
17. Climb the staircase in the **east tower** of the castle. The **Holy Grail** is on the top floor.
18. Take the Holy Grail and return to **King Arthur** at Camelot to complete the quest.

## Key NPCs & Locations

| NPC / Location          | Where to Find                                      |
|-------------------------|---------------------------------------------------|
| King Arthur             | Camelot Castle                                     |
| Merlin                  | Camelot Castle (downstairs)                        |
| Brother Galahad         | Hermit shack, west of McGrubor's Woods             |
| High Priest             | Church on Entrana                                  |
| Crone                   | Entrana                                            |
| Draynor Manor           | North of Draynor Village (Magic Whistles on top floor) |
| Black Knight Titan      | Fisher King's realm (level 120, requires Excalibur) |
| Fisher King             | Fisher King's Castle                               |
| Sir Percival            | Goblin Village, north of Falador                   |
| Holy Grail              | East tower top floor, Fisher King's Castle         |

## After the quest

- The Magic Whistle (`magic_whistle`, members) still travels after the quest, and is not used up: blown on the
  six-heads spot on Karamja it takes the player to the restored Fisher Realm, and blown in the realm back to the heads.
  [v 2026-10-19 itest-fixture local]
- The script's side of it (quests/quest_grail/scripts/quest_grail.rs2:36-49): the spot is x 2740-2743, z 3234-3237; a
  player past `%grail >= ^grail_given_whistle` lands at (2678, 4715), inside an oak, and steps out of it; blown
  anywhere in the realm it lands at (2741, 3235).
- More whistles come from the Draynor Manor door on the top floor (`whistledoor`, quest_grail.rs2:30) only while
  carrying Brother Galahad's napkin, which he hands out only before the quest is done (from `^grail_spoken_crone`,
  areas/area_seers/scripts/brother_galahad.rs2:33, :74; once it is done he only makes tea, :2): after the quest a lost
  whistle and napkin are gone for good.
- The blighted Fisher Realm (the Fisher King's) is the quest's own: the whistle sends a player who gave Percival one to
  the restored realm (quest_grail.rs2:38).
