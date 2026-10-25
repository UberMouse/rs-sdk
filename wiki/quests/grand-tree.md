# The Grand Tree

| Detail | Info |
|--------|------|
| Difficulty | Experienced |
| Length | Long |
| Quest Points | 5 |

## Requirements

- 25 Agility, checked partway through the quest, not at the start (`quest_grandtree.rs2:25`) [server data, unverified in game 2026-10-23]
- Ability to defeat a Black Demon (level 172)
- Tree Gnome Village is not needed: the start (`king_narnode.rs2` stage 0) checks nothing [server data, unverified in game 2026-10-24]. Monkey Madness needs both quests.
- Agility 25 is boostable and is checked only at the climb-tree in Glough's house [server data, unverified in game 2026-10-24]

## Items Needed

- None required (all items obtained during quest)

## Rewards

- 7,900 Agility XP (`quest_grandtree.rs2:199`) [server data, unverified in game 2026-10-23]
- 18,400 Attack XP
- 2,150 Magic XP
- Access to spirit tree teleportation network
- Access to gnome glider transport system

## Walkthrough

The varp `grandtree` runs 10, 20, ... 150 (`quest_grandtree.constant`); 160 = done. Item ids: bark 783, translation book 784, journal 785, scroll 786, lumber order 787, Glough's key 788, twigs 789 T, 790 U, 791 Z, 792 O, Daconia rock 793, invasion plans 794. [v 2026-10-24 questw6 local]

1. **Start.** Talk to King Narnode in the Grand Tree. He gives a bark sample.
2. **Hazelmere** is at (2678,3086) on level 1, reachable on foot. He takes the bark and writes a scroll. Take it to the King; the translation answers, in order: "I think so!", "None of the above" x2, "A man came to me with the King's seal.", "I gave the man Daconia rocks.", "And Daconia rocks will kill the tree!". [v 2026-10-24 questw6 local]
3. **Glough** is in his house at (2478,3463), level 1. **Charlie** is behind the cell door on level 3 and is reported unreachable; `interact` npc Talk-to with `unreachable: true` from (2467,3496) on level 3 works. [v 2026-10-24 questw6 local]
4. **Journal.** Cupboard at (2476,3465): Open, then Search at stage 60 or 70. Talking to Glough with the journal at stage 70 jails you in the cell (2464,3495) on level 3; Narnode frees you at stage 80. [v 2026-10-24 questw6 local]
5. **Glider.** The pilot at (2464,3501) on level 3 flies you to the Karamja crash at (2917,3058). [v 2026-10-24 questw6 local]
6. **Shipyard.** The gate (2945,3041-42) takes the dialog "Glough sent me" / "Ka." / "Lu." / "Min." and lands you on x=2945; a second Open from x=2945 sends you back out. The foreman (~2999,3043) takes the quiz answers "no longer with us", "worm holes", "Anita.", walks you to an office at (2955,3033) and gives the lumber order. The only land exit from the peninsula is the river log "A wooden log" (loc zq_logbalance, op Cross) at (2907-2909,3049), level-1 bridge tiles (`shortcuts.rs2:49`). [v 2026-10-24 questw6 local; log is server data]
7. **Femi** (2459,3382; cart exit (2459,3409)) costs 1000 coins if the boxes were declined at the gate, otherwise free. **Charlie** names Anita, on level 1 at (2390,3514), who gives Glough's key. [v 2026-10-24 questw6 local]
8. **Invasion plans.** Chest at (2482,3462) in Glough's house: use Glough's key on it. [v 2026-10-24 questw6 local]
9. **King, twigs, pillars.** Show the King the plans; he gives the twigs. Climb-tree at (2484,3464) goes up to level 2; the 4 Pillars are at (2485..2488,3467), used in T, U, Z, O order. The twigs arrive in random order, so use them by item id (789 T, 790 U, 791 Z, 792 O). [v 2026-10-24 questw6 local]
10. **Trapdoor** (2487,3464) opens at stage 130 and lands at (2491,9864) with a Glough cutscene dialog; then a Black Demon (level 172) spawns at (2479,9867). It hits up to 16 every 4 ticks; at Att/Str/Def 80 in full rune it lost about 80 of its 157 HP in 60 s. [v 2026-10-24 questw6 local]
11. **Daconia rock.** 15 Root locs (op "Search") at (2456,9886), (2457,9881), (2455,9874), (2443,9878), (2439,9881), (2444,9893), (2452,9893), (2465,9891), (2468,9890), (2467,9896), (2473,9897), (2481,9904), (2485,9885), (2490,9889), (2467,9872). One holds the rock, picked by a random 1-15 stored at stage 150 [server data, unverified in game 2026-10-24]. Return it to the King at (2464,9897).

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| King Narnode Shareen | Ground floor, Grand Tree, Gnome Stronghold |
| Hazelmere | (2678,3086), level 1 |
| Glough | Tree house, Gnome Stronghold |
| Charlie | Cell on level 3 of the Grand Tree |
| Anita | (2390,3514), level 1 |
| Foreman | Karamja shipyard |
| Black Demon (level 172) | Grand Tree roots |

## Gotchas

- Grand Tree entry: ladders at (2466,3495) go up through all 4 levels; Tree Door locs at (2464,3492) and (2466,3492). `talk`/`interact` walks to spots inside the tree fail: they cannot clear Femi's boxes dialog at the gate, and walk.ts `leaveGnomeStronghold` sends the bot out the gate for any destination inside the tree, which the stage-90 guard then refuses to re-enter. Workaround: travel to the square (2465,3489), then `interact` "Tree Door" Open. A start save needs a start tile inside the fence; a start at the plaza (2467,3489) made the walker leave via the gate. [v 2026-10-24 questw6 local]
- The quiz dialogs close and reopen, so the plan talks again rather than continuing. `recentDialogs` keeps only about 20 pages, so a marker whose line scrolls out needs a second marker line. [v 2026-10-24 questw6 local]
- Plan `grand-tree` is a draft, proven in segments (fresh start to the Karamja foreman and lumber order; from the stage-90 save through Femi, Charlie, Anita's key, chest plans, King and twigs, climb-tree, 4 pillars and the opened trapdoor, about 6 min). The full run failed at the demon and is blocked on two open task/client bugs under investigation. [v 2026-10-24 questw6 local]
- Library saves: `grand-tree-start` (TGV done, Att/Str/Def 80, HP 85, Prayer 43, Agility 30, rune melee + amulet of power, 20 swordfish, 3000 coins, inside the tree at (2465,3495)) and `grand-tree-stage90` (grandtree=90, femi_help=1, lumber order held, outside the gate at (2459,3374)).

## After the quest

- Gnome gliders: any gnome pilot asked "Can you take me on the glider?" opens the glider map once the quest is done, on
  a members world (areas/area_gnome/scripts/gnome_glider.rs2:116). Ta Quir Priw (top of the Grand Tree) is the hub:
  from it to Gandius (Karamja), Sindarpos (White Wolf Mountain), Lemanto Andra (east of Varrock) and Kar-Hewo (Al
  Kharid), and from Gandius, Sindarpos and Kar-Hewo back to it only (:14); the start is the box 8 tiles round the
  pilot's landing the player stands in (:26), so Lemanto Andra is one-way. Each flight lands within a tile of its
  landing (:22).
- The Gnome Stronghold spirit tree (`ent`, south of the Grand Tree) talks only to a player who finished the quest
  (areas/area_gnome/scripts/spirit_tree.rs2:2); its menu, after "Where can I go?": "Tree Gnome Village.", "Forest
  north of Varrock.", "Battlefield of Khazard.", members only (:65).
