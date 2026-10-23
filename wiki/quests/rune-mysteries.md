# Rune Mysteries

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Short      |
| Quest Points | 1       |

## Requirements

None.

## Items Needed

None.

## Rewards

- Access to the Rune Essence Mine via any Runecrafting teleport NPC

## Walkthrough

1. Speak to **Duke Horacio** on the 2nd floor of **Lumbridge Castle**. He shows you a strange talisman (an **air talisman**) and asks you to take it to the wizards for examination.
2. Travel to the **Wizard Tower** south of Draynor Village. Go down the ladder (ground loc (3104,3162), stand (3105,3162); basement at (3104,9576); see `learnings/walking.md`) to the basement and speak to the **Head Wizard** (Sedridor). He identifies the talisman and gives you a **research package** to deliver.
3. Take the research package to **Aubury** in his rune shop in southeast Varrock (behind the east bank).
4. Speak to Aubury. He gives you **research notes** in return.
5. Return to the Head Wizard at the Wizard Tower basement. Give him the research notes to complete the quest.
6. Both the Head Wizard and Aubury can now teleport you to the **Rune Essence Mine**.

## Key NPCs & Locations

| NPC / Location         | Where                                       |
|------------------------|----------------------------------------------|
| Duke Horacio           | Lumbridge Castle, 2nd floor                   |
| Head Wizard (Sedridor) | Wizard Tower, basement                        |
| Aubury                 | Rune shop, southeast Varrock (behind east bank) |
| Rune Essence Mine      | Accessed via teleport from Sedridor or Aubury |

## Dialog choices (verified)

Run by the `talk` task (plan `conductor/plans/rune-mysteries.ts`; whole quest took 321 s from Lumbridge; 342 s from the Lumbridge graveyard right after Restless Ghost, unchanged [v 2026-10-23 conductor3 local]). Choices, from `server/content/scripts/areas/{area_lumbridge/duke_horacio,area_wizard_tower/sedridor,area_varrock/aubury}.rs2`:

| NPC | Stand | Choices in order |
|-----|-------|------------------|
| Duke Horacio (level 1) | (3211,3221) | "Have you any quests for me?", "Sure, no problem." |
| Sedridor (basement) | (3104,9570) | "I'm looking for the head wizard.", "Ok, here you are.", "Yes, certainly." |
| Aubury | (3252,3402) | "I have been sent here with a package for you." then talk to him again, no choices (he gives "Notes") |
| Sedridor | (3104,9570) | none: takes the notes, the quest completes and the air talisman comes back |

Route hazard on the Aubury leg: dark wizards at the Varrock stone circle near (3223,3373) (`learnings/hazards.md`). Approach Varrock from the south via (3260,3335). [v 2026-10-11 conductor2 local]

Sedridor reads as unreachable from the ladder foot (3104,9576); stand south of the statues at (3104,9570). [v 2026-10-11 conductor2w3 local]
