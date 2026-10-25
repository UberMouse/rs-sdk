# Tree Gnome Village

| Detail | Info |
|--------|------|
| Difficulty | Intermediate |
| Length | Long |
| Quest Points | 2 |

## Requirements

- Ability to defeat the Khazard Warlord (level 112, hp 170, Attack 75 / Defence 80 / Strength 78, crush). The proven start save `lib:tree-gnome-village-start` has Att/Str/Def 80, HP 85, full rune (helm, platebody, platelegs, kiteshield, scimitar), amulet of power, 20 swordfish: the warlord died in ~90 s with no food eaten. Lower stats untested. [v 2026-10-23 questw6 local]

## Items Needed

- 6 normal Logs (Commander Montai takes them on the next talk after you agree). [v 2026-10-23 questw6 local]

## Rewards

- 11,450 Attack XP base (`quest_tree.rs2:98`, stat_advance 114500) and the Gnome amulet of protection; Attack +21,500 observed over the whole run on the 25x local server (includes the warlord fight). [v 2026-10-23 questw6 local]
- Access to spirit trees for teleportation

## Walkthrough

Plan: promoted, `conductor/plans/tree-gnome-village.ts`, fresh load of `lib:tree-gnome-village-start` to quest done in 458 s. Quest id `tree`; varp `treequest` stages: 1 started, 2 Montai asked for logs, 3 logs given, 4 finding trackers, 5 ballista fired, 6 orb taken, 7 first orb given, 8 warlord dead with orbs held, 9 done. The plan reads stages from items, position, locs and dialog history. [v 2026-10-23 questw6 local]

1. **Start (Bolren, ~74 s incl. the maze).** The save starts at (2504,3189) by Elkoy outside the maze (Elkoy (2504,3191), maze entrance (2504,3192)); the maze path walks in ~30-40 s. King Bolren (2542,3169): travel to (2542,3171) tolerance 1 (a talk `at` (2542,3167) tolerance 2 ends in a closed hedge pocket where Bolren reads unreachable). Dialog: "Can I help at all?" then "I would be glad to help."
2. **Montai (2523,3211), 6-17 s per talk.** Stage 1: "Ok, I'll gather some wood." (then talk again to hand over the 6 logs). Stage 3: "I'll try my best." Markers: "as quick as you can" (stage 2), "braver than most" (stage 4).
3. **Trackers need not be talked to.** (They sit at (2502,3261), (2524,3257), (2496,3235).) The ballista values are fixed: menus in order height 4, x 3, y 5 (options "0004", "0003", "0005"); other combinations miss.
4. **Ballista (12 s).** Loc "Ballista" (2508,3210), option Fire, stand (2509,3208). Marker: "The wall has been reduced to rubble. It should be possible to climb over the remains."
5. **Wall (21 s).** Stronghold front Door (2502,3250) is locked from the south. "Crumbled wall" (2509,3253), "Climb-over" from (2509,3252) teleports to ~(2509,3254); not climbable from the north. The interact ends on "an animation started" before the teleport (use onFail continue). `at` tolerance minimum is 1.
6. **Inside.** A Khazard commander (48) spawns at (2509,3254)/(2503,3255) and attacks; troopers (19) roam. "Ladder" (2503,3252) Climb-up to level 1: stand (2503,3253) tolerance 1 (an `at` of (2503,3251) let the walker stop on the door tile outside), reached from the north through the open Door (2504,3256). 14 s.
7. **Chest (10 s).** Level 1 "Closed chest" (2506,3259): Open, then Search ("Open chest"; stays open 300 ticks). It gives the Orb of protection (id 587) only at stage >= 5, else "You search the chest, but find nothing." The dialog guard eats the orb mesbox, so the search has no `expect`. Climb down from (2503,3253); walks cannot plan from level 1.
8. **Give the orb to Bolren (96 s).** Dialog "I will find the warlord and bring back the orbs." Marker "safeguard this orb" (Bolren takes the first orb).
9. **Warlord (90 s).** Khazard warlord at (2457,3302), area radius 14. Only at stage 7 does he drop the Orbs of protection (id 588), via a mesbox; otherwise bones. The chest "chestopen_khazard" at (2468,3314) is unused.
10. **Finish (96 s).** Talk to Bolren; the finish talk has no choices (cutscene).

All of the above [v 2026-10-23 questw6 local]. Plan restart caveat: two gates read dialog-history markers (the history keeps about 20 pages, `learnings/dialogs.md`); after a restart that lost them, the wall phase retries once from the south and fails harmlessly.

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Elkoy | (2504,3191) outside the maze; (2514,3159) in the village |
| King Bolren | (2542,3169) |
| Commander Montai | (2523,3211) |
| Ballista | (2508,3210) |
| Khazard commander (48), troopers (19) | inside the stronghold wall, (2509,3254) / (2503,3255) |
| Khazard Warlord (112) | (2457,3302) |

## After the quest

- The village's spirit tree (`stronghold_ent`) and the young trees (north of Varrock, Battlefield of Khazard) talk only
  to a player who finished the quest (areas/area_gnome/scripts/spirit_tree.rs2:26, :50), on a members world (:65).
  The village tree's menu, after "Where can I go?": "Battlefield of Khazard.", "Forest north of Varrock.", "Gnome
  stronghold." (:42); a young tree's "Yes please." goes to the village only (:56).
- The village tree's "Forest north of Varrock." takes the player to the young tree north of Varrock.
  [v 2026-10-19 itest-fixture local]
