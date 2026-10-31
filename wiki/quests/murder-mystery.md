# Murder Mystery

## Overview

| Detail       | Info    |
|--------------|---------|
| Difficulty   | Novice  |
| Length       | Short   |
| Quest Points | 3       |

## Requirements

No skill or quest requirements.

## Items Needed

- An empty pot, filled from the mansion's flour barrel (needs the guards' permission, so after starting; `quest_murder.rs2:177-190`); the flour barrel (2735,3582) "Take From" worked after starting. [v 2026-10-31 questw4 local]
- Flypaper (obtainable during quest)

## Rewards

- 1,406 base Crafting XP (`stat_advance(crafting, 14060)`, `quest_murder.rs2:428`); this server showed 35,150 Crafting XP. [v 2026-10-31 questw4 local]
- 2,000 gp

## Walkthrough

### Getting Started

Speak to the Guard outside the Sinclair Mansion, located north of Seers' Village. Lord Sinclair has been murdered and you are asked to investigate.

### Collecting Evidence

1. Enter the mansion and search the crime scene.
2. Collect the following key evidence:
   - **Pungent pot** - found near the crime scene.
   - **Dagger** - the murder weapon.
   - **Thread** - found on or near the dagger.
3. Note the color of the thread, as it corresponds to one of the suspects.

### Investigating the Poison

1. Visit the poison salesman located south of the Seers' Village bank.
2. Ask about recent poison purchases to narrow down the suspect list.

### Interviewing Suspects

Interview all 6 family members who are suspects:
- **Bob**
- **Frank**
- **David**
- **Elizabeth**
- **Carol**
- **Anna**

Each suspect has an alibi. Pay attention to inconsistencies.

### Gathering Proof

1. Check poison usage locations around the mansion (compost heap, beehive, fountain, etc.) to determine who had access to poison.
2. Match the thread color found on the dagger to the suspect who wears that color.
3. Search the barrel in each suspect's room to find personal items.
4. Collect fingerprint evidence:
   - Use a pot of flour on the crime scene items to dust for prints.
   - Use flypaper to lift the prints.
   - Compare the fingerprints to confirm the murderer's identity.

### Completing the Quest

Report your findings to the Guard outside the mansion, naming the correct suspect with your evidence.

## Key NPCs & Locations

| NPC/Location            | Role                                      |
|-------------------------|-------------------------------------------|
| Guard                   | Quest start, outside Sinclair Mansion     |
| Sinclair Mansion        | N of Seers' Village, crime scene          |
| Poison Salesman         | S of Seers' Village bank                  |
| Bob                     | Suspect                                   |
| Frank                   | Suspect                                   |
| David                   | Suspect                                   |
| Elizabeth               | Suspect                                   |
| Carol                   | Suspect                                   |
| Anna                    | Suspect                                   |

## Verified route

The plan `conductor/plans/murder-mystery.ts` is promoted: four fresh loads of `lib:murder-mystery-start` (south of the mansion at (2741,3556), Att/Str/Def 20, HP 30, one empty pot, no coins) each reached quest done in one run, 198-243 s, with murderers Bob, Elizabeth, Anna and Frank. [v 2026-10-31 questw4 local]

- The Guard at (2741,3562) starts the quest ("Sure, I'll help"). The walker reached the study and upstairs rooms without door or stairs trouble. [v 2026-10-31 questw4 local]
- Thread colour picks the suspect pair: thread loc 1808 red = Bob/Carol, 1809 green = Anna/David, 1810 blue = Elizabeth/Frank (scripts; matched in all 4 runs). [v 2026-10-31 questw4 local]
- Tiles: criminals' dagger on the ground (2746,3578); thread at the smashed window (2747,3577); pungent pot (2747,3579); flour barrel (2735,3582); sacks (2731,3582) "Investigate", choice "Yes, it might be useful" gives one flypaper. [v 2026-10-31 questw4 local]
- Suspect barrels (Search): Anna (2733,3575) and Bob (2733,3578) ground floor; David (2733,3578), Carol (2733,3581), Frank (2747,3577), Elizabeth (2747,3581) upstairs. [v 2026-10-31 questw4 local]
- Fingerprints: dust and lift prints for both suspects and the dagger. Use a suspect's print on the dagger print (id 1822): a match keeps the suspect's print and gives the Killers' print (1815); a mismatch destroys the suspect's print. With the Killers' print held, the murderer is the first suspect if that print is still held, otherwise the second. [v 2026-10-31 questw4 local]
- Poison: the salesman at (2737,3491) in Seers' Village, "Who did you sell Poison to", sets progress; then only the murderer's "Why'd you buy poison" answer sets `spoken_murderer`. Suspect talk tiles that worked: Bob (2747,3560), Anna (2734,3575), Frank (2742,3577), Elizabeth (2746,3581 level 1). [v 2026-10-31 questw4 local]
- Murderer's place to Investigate, then accuse to the Guard: Anna compost (2730,3572), Bob beehive (2730,3559), Carol drain (2736,3573), David spiders' nest (2740,3574 level 1), Elizabeth fountain (2747,3563), Frank crest (2746,3573). Run in game for Bob, Anna, Elizabeth and Frank; Carol and David from map files and scripts only. [v 2026-10-31 questw4 local]
- Phase seconds (Frank run): start 11, dagger 12, flour 29 (3 runs), paper 38 (3 runs), thread 9, barrels 16 each, dust/lift about 1 each, checks 1-3, salesman 32, ask-frank 30, accuse 17. [v 2026-10-31 questw4 local]
