# Biohazard

| Detail     | Info     |
|------------|----------|
| Difficulty | Novice   |
| Length     | Long     |
| Quest Points | 3 QP  |

## Requirements

- Plague City complete (varp `elenaquest` 165 = 29): Elena's house door (2592,3339) opens only at its completion (`doors.rs2:1-5`, area_ardougne_east) [v 2026-10-31 questw1 local]
- Do not start Biohazard before Plague City's digging: the mud patch stays packed once Biohazard has started ([Plague City](plague-city.md)) [server data, unverified in game 2026-10-23]

## Items Needed

- Items obtained during the quest (pigeon cage, rotten apple, doctor's gown)

## Rewards

- 3 Quest Points
- 1,250 Thieving XP (31,250 on the local server, Thieving 1 to 49) [v 2026-10-31 questw1 local]
- Access to King Lathas' training field (Combat Training Camp)

## Walkthrough

1. Speak to **Elena** in **East Ardougne**. She needs you to help retrieve her distillator from the Mourners and smuggle plague samples to Varrock for analysis.
2. Get a **pigeon cage** from **Jerico's** house, located north of the East Ardougne chapel.
3. Use the pigeons at the **watchtower** near the Mourner headquarters to create a distraction.
4. Obtain a **rotten apple** and use it to contaminate the **cauldron** inside the Mourner headquarters, poisoning the Mourners' food.
5. Get a **doctor's gown** from **Nurse Sarah** at the church.
6. Wearing the doctor's gown, enter the **Mourner headquarters**. Kill the one **sick mourner** (level 13, `mourner.npc:145`); he drops the gate key (`mourner.rs2:75-78`). Retrieve Elena's **distillator**. [server data, unverified in game 2026-10-23]
7. Return the distillator to **Elena**. She prepares sample **vials** for you to deliver.
8. Travel to the **Chemist** west of **Rimmington** and obtain **touch paper** for the analysis.
9. Give one vial each to the three errand boys **Chancy**, **Hops** and **DeVinci** in Rimmington (not Ardougne; `chancy.rs2`, `hops.rs2`, `devinci.rs2`). They carry them past the Varrock guards.
10. Travel to Varrock and collect the vials from the three at the **Dancing Donkey Inn** (`chancy.rs2:29`). [server data, unverified in game 2026-10-23]
11. Wearing priestly attire, visit **Guidor** in Varrock to have the samples analysed.
12. Guidor reveals that the **plague is fabricated** -- the samples show no trace of disease.
13. Report this discovery to **Elena** in Ardougne.
14. Meet **King Lathas** in Ardougne Castle. He reveals a different threat and grants you access to his training field.

## Key NPCs & Locations

| NPC / Location           | Where to Find                                 |
|--------------------------|-----------------------------------------------|
| Elena                    | Her house in East Ardougne                    |
| Jerico                   | House north of East Ardougne chapel           |
| Mourner headquarters     | Northeast West Ardougne                       |
| Nurse Sarah              | East Ardougne church                          |
| Chemist                  | West of Rimmington                            |
| Dancing Donkey Inn       | Varrock                                       |
| Guidor                   | Varrock                                       |
| King Lathas              | Ardougne Castle                               |

## Proven run (plan `conductor/plans/biohazard.ts`) [v 2026-10-31 questw1 local]

One run from `lib:biohazard-start` (East Ardougne market (2655,3300), Att 40, Str 54, Def 40, HP 47, Prayer 49, 10 swordfish, 1000 coins, Plague City done, Biohazard varp 0) to quest done in 1241 s. Quest varps: Biohazard 68 (16 = done), errand-boys 69. Do not start a save at (2600,3320): that tile is enclosed and blocked for walks.

- Priest gown (id 426) and Priest robe (id 428) are carried in the start save: Varrock's Fancy clothes store sells both under the name "Priest gown" and the shop task buys only the first matching line. Guidor needs both worn.
- Pigeon cage: Jerico's cupboard (2611,3326), Open then Search, only after talking to Jerico (the Search option shows ~15 s after Open). Full cages spawn at (2618,3323-3325); the cage item is "pigeons" (Open). Use the Bird feed on the Watchtower locs (2559,3301), (2560-2562,3301), (2563,3302-3306), then open the cage inside x 2559-2565, z 3299-3307 ((2565,3304) worked).
- Crossing to West Ardougne: Omart (2559,3266) east of the wall, Kilron (2556,3266) west. Omart's chat closes mid-dialog before the crossing choice: one talk with no choices, then talk `continue:true` with choice "lets do it". Kilron's "Yes I do" returns you east.
- Rotten apple: ground spawn (2535,3333) in West Ardougne. HQ cauldron (2543,3332) is in a fenced dining room with a door locked at this stage: climb the Fence (2541,3331) from (2541,3333), landing (2542,3331), then stand on (2543,3331) before using the apple on the cauldron ("I can't reach that" from (2542,3331)). Message: "and it quickly dissolves into the stew".
- Nurse Sarah's hut: open Door (2519,3275) from (2520,3275); Cupboard (2517,3276), stand (2518,3276). The Doctors' gown comes only after the stew is poisoned.
- HQ: the south-wall door (2551,3320) admits you only with the gown worn. Stairs top (2543,3325) behind door (2547,3325) on level 1. The Sick Mourner (13) upstairs: talk with choice "hold your breath" starts the fight, talk again settles it, he drops a Key. Gate (2551,3325-3326, level 1): interact Gate Open with tile (2551,3326). The Distillator crate is (2554,3327) level 1; the other crates say "nothing of value".
- Leaving the HQ: the walker cannot climb down from level 1, so open the door (2547,3325) L1 and interact Staircase "Climb-down" (2544,3325) L1. The ground-floor door between the stairs room and the kitchen needs a second identical walk call (the first fails "Stuck at (2547,3325)"); about 170 s of the run.
- Item names: "Ethanea" (sic), "Liquid honey", "Sulphuric broline", "Plague sample", "Touch paper", "Distillator", "Key", "Doctors' gown".
- Chemist (Rimmington, about (2934,3210)): choices "Elena's friend" then "Guidor"; the plague-sample option takes the sample away. Errand boys at (2931-2935,3219): Chancy takes Liquid honey, Hops Sulphuric broline, DeVinci Ethanea; other pairings lose the vial. In Varrock they wait near the Dancing Donkey Inn (3268-3274,3389-3391) and return the vials by plain talk.
- Guidor (3285,3381): choices "assistance", "pupil Elena", "Elena wanted". Elena then says "King of East Ardougne"; King Lathas (2578,3293) level 1, choice "understand" ends the quest.
- Route Ardougne to Rimmington to Varrock to Ardougne is plain travel/talk `at` params, about 3, 2 and 4 min, no hazards; the return passes Seers' Village (2752,3425).
- Phase seconds: elena-start 40, jerico 31, cupboard 38, cage 4, feed 23, omart 23, apple 21, fence+poison 17, nurse 94, hq-door 13, sick mourner 29, HQ exit ~170, kilron 21, elena-distillator 34, chemist 185, errand boys 25, to Varrock 119, collect 22, Guidor 29, report to Elena 233, Lathas 44.
