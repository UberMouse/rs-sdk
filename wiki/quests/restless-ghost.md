# The Restless Ghost

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Medium     |
| Quest Points | 1       |

## Requirements

None.

Recommended: Ability to evade a level 13 Skeleton.

## Items Needed

None.

## Rewards

- 1,125 Prayer XP

## Walkthrough

1. Speak to **Father Aerick** at the **Lumbridge Chapel** south of the castle. He asks for help with a ghost haunting the graveyard.
2. Travel south into the Lumbridge Swamp and speak to **Father Urhney** in his house. He gives you a **Ghostspeak amulet**.
3. Equip the Ghostspeak amulet and enter the graveyard behind the chapel. Open the coffin and speak to the **Restless Ghost**. He tells you his skull was stolen and taken to the Wizard Tower.
4. Travel to the **Wizard Tower** south of Draynor Village. Go down the ladder to the basement.
5. The **Skull** is a ground item in the basement room east of Sedridor, at (3120,9567); take it (there is no altar to search). Taking it with the ghost already spoken to summons a level 13 **Skeleton** that attacks.
6. Return to the graveyard coffin, open it, and use the skull on the open coffin (a closed one answers "Maybe I should open it first."). The ghost is laid to rest.

## Key NPCs & Locations

| NPC / Location         | Where                                        |
|------------------------|----------------------------------------------|
| Father Aerick          | Lumbridge Chapel, south of Lumbridge Castle   |
| Father Urhney          | House in Lumbridge Swamp                      |
| Restless Ghost         | Coffin in Lumbridge Chapel graveyard          |
| Ghost's skull          | Wizard Tower basement, ground item (3120,9567)|
| Skeleton (level 13)    | Wizard Tower basement (spawns on skull pickup if the ghost was spoken to; did not attack in the verified run)|

## Verified run (conductor2w5, local)

Plan `restless-ghost` (talk, interact, pickup tasks) did the whole quest in 301 s from Lumbridge (Prayer 15 start): **Prayer +28,125 XP** (1,125 base at 25x). Per phase: Aereck 19 s, Urhney 69 s (walk to the swamp house), wear amulet 1 s, open coffin 56 s (walk back), ghost 16 s, skull 65 s (walk, ladder down, take), coffin again 60 s (walk, ladder up), skull on coffin 16 s. [v 2026-10-16 conductor2w5 local] The main account ran it in 294 s (Prayer 50 -> 59, +28,125). [v 2026-10-16 conductor2 local]

| Step | Where | How |
|------|-------|-----|
| Father Aereck | (3244,3206) | choice "I'm looking for a quest!" |
| Father Urhney | (3235,3153) | "Father Aereck sent me to talk to you.", "He's got a ghost haunting his graveyard." gives the Ghostspeak amulet |
| Wear the amulet | inventory | option Wear |
| Coffin (named "Coffin", closed: Open/Search; open: Close/Search) | (3249,3192), stand (3248,3195) | Open; the Restless ghost appears for 100 ticks (script `npc_add(...,100)`), the coffin shuts again after 300 |
| Restless ghost | at the coffin, amulet worn | choice "Yep, now tell me what the problem is." |
| Skull | (3120,9567), via the Wizards' Tower ground floor ladder | pickup |
| Skull on the open coffin | graveyard | use-item-on-loc; click through the message boxes, the XP lands after them |

The first use right after opening the coffin can be discarded (the open animation is a delay); the `talk` task's retry covers it. The skeleton did not attack during the verified run. Scripts: `server/content/scripts/quests/quest_priest/scripts/{quest_priest,restless_ghost}.rs2`, `areas/area_lumbridge/scripts/father_{aereck,urhney}.rs2`.
