# Death Plateau

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Medium |
| Quest Points | 1 |

Most of this is read from scripts (`death_guard_equiproom.rs2` and the death quest scripts) and `.jm2` map data; the whole quest was walked in game by the promoted plan `conductor/plans/death-plateau.ts` (questw2): from a fresh load of `lib:death-plateau-start` to quest done in 603 s, one run, no combat, no deaths. [v 2026-10-24 questw2 local]

## Requirements

- No skill level or combat is checked; the cooked trout and bread are items handed to Tenzing. [server data, unverified in game 2026-10-24]
- No forced fights. Trolls roam the plateau (sign `death_dangersign_trolls`) and the secret path avoids them. The climbing rocks (`death_climbingrocks_top`/`_bottom`) need the climbing boots worn. The Tenzing and Harold doors check the quest state. [server data, unverified in game 2026-10-24]

## Items Needed

- About 5000 coins for the dice game (the plan's gamble bands assume 5000, 4998 after the 2 gp ale; two losses then a win in the proof run), 10 bread, 10 cooked trout, 1 iron bar. The certificate, boots, map and balls arrive one at a time, so start with 27 slots or fewer used: with 28 held, Denulth "has given you a certificate" but none arrived (a full pack silently loses a quest handout). Put the best food in the first slots: the low-HP guard eats slot order (it ate bread first). Start save `death-plateau-start`: Burthorpe (2897,3531), Att 40 Str 54 Def 40 HP 47 Prayer 49, mithril scimitar, 3 swordfish, 10 bread, 10 trout, 1 iron bar, 5000 coins. [v 2026-10-24 questw2 local]

## Rewards

- 3,000 Attack XP before x25 (75,000 here), steel claws, climbing boots wearable. [server data, unverified in game 2026-10-24]

## Walkthrough

Steps were walked end to end [v 2026-10-24 questw2 local] (phase seconds in the proof run: start 24, Eohric 21, door duty 29, Harold duty 9, ale+gambles about 100, balls about 70, cave-in 16, Saba 16, hut door 60, Tenzing 15, Dunstan deal 52, Denulth certificate 28, spikes 23, give 11, secret path about 40, back to Burthorpe 39, finish 16). The number in brackets is the `%death_equiproom`/quest stage the step sets, where known.

1. **Denulth** (Imperial Guard camp, Burthorpe): "Do you have any quests for me?" then "No but perhaps I could try and find one?" (10).
2. **Eohric** the head servant (castle): "I'm looking for the guard that was on last night." (20).
3. **Harold** (Toad and Chicken inn; Eohric says "Harold is staying at the local inn, the Toad and Chicken." [v 2026-10-24 questw2 local]): "You're the guard that was on duty last night?" (30). Back to Eohric: "I found Harold but he won't talk to me!" (40).
4. Give Harold an **Asgarnian Ale** (bought in the inn; use it on him, or "Can I buy you a drink?") (50).
5. **Gamble for the IOU** (55), then Read the IOU for the safe combination (60: "You have found the combination!"). See Dice game below.
6. **Cannonballs**: five `death_cannonball_*` ground spawns at (2893, 3561-3565) (obj ids 3109 red, 3110 blue, 3111 yellow, 3112 purple, 3113 green, all named "Stone ball"). Use each on a stone mechanism: blue (2894,3562), yellow (2895,3562), red (2894,3563), purple (2895,3563), green (2895,3564). All five at stage 60 set 70 and unlock the room. Seen in game: the Combination text matched the placement, and placing all five gave "equipment room door has unlocked". Spawn tiles in column x=2893: yellow z3561, green z3562, purple z3563, blue z3564, red z3565. Picked balls respawn quickly; a `pickup` of count 5 took duplicates (a second purple, no red); one `pickup` per colour with area centre (2891, spawnZ) radius 2 takes the right one. A placed ball stays on the ground about 1000 ticks. [v 2026-10-24 questw2 local]
7. **Saba** in his cave (`death_hermitcave_entrance`): "Do you know of another way up Death Plateau?" (map state 1).
8. **Tenzing** the Sherpa (knock; he says "I'm not the milkman" once map state >= 1): helping the Imperial Guard, then "OK, I'll get those for you." (2, gives climbing boots).
9. **Dunstan** the blacksmith: no-payment speech (3), then he asks for a son-in-the-guard certificate.
10. **Denulth** gives the certificate (4). Dunstan with the certificate (5): the spikes cost 1 iron bar plus the boots ("Yes, but I still want them").
11. **Tenzing**: 10 bread, 10 cooked trout and the spiked boots (6), then he gives the map (7).
12. **Secret path**: out the back door of Tenzing's hut, over the stile (2817,3562) ("Climb-over" from (2817,3561) lands on (2817,3563); return from (2817,3564)), north along x=2817 to z3584, then NE via (2821,3589), (2827,3591), (2831,3597), (2836,3601), (2842,3605), (2847,3608), (2853,3609), (2859,3609) to about (2865,3609). The scout trigger zone is x2864-2871, z3608-3615 (`quest_death.rs2`); success text "You can see that there are no trolls on the secret path." The path stays 7+ tiles from every troll spawn behind cliffs, about 20 s each way. [v 2026-10-24 questw2 local] Stage 8 set.
13. **Denulth** with the secret map and the combination completes the quest.

## Dice game (Harold)

[server data, unverified in game 2026-10-24] except where tagged.

- The IOU comes only from Harold's dice game (`death_guard_equiproom.rs2`: harold_roll, dice_winnings, haroldgamble_end). `%death_equiproom` reaches 55 (given_iou) only when the player wins a bet larger than Harold's remaining gold. He starts with 100 (set by denulth_quests).
- Max bet 1000. Harold wins ties (player wins 15/36 per game). The bet is entered in a `p_countdialog` "Enter amount" prompt; the roll button is `death_dice:com_28`.
- Seen in game: the first `talk` with `amount` 101 at stage 40 gave the ale and won the IOU in one conversation (about 27 s); each further game takes about 18 s. Harold's gold is 100 plus what you have lost to him, so a bet above that wins the IOU on a single win (bets of 101, 202, 404, 808, then 1000). [v 2026-10-24 questw2 local]
- A very drunk Harold (Blurberry Special) always loses.
- Re-reading the IOU gives the combination; `harold_reclaim_iou` works only after it was first given.

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Denulth | Imperial Guard camp, Burthorpe |
| Eohric | Castle, Burthorpe |
| Harold | Toad and Chicken Inn, Burthorpe |
| Saba | Hermit cave on the mountainside |
| Tenzing | Sherpa's hut, mountain path |
| Dunstan | Blacksmith, Burthorpe |
| Cannonballs | Ground spawns (2893, 3561-3565) |
| Secret path end | about (2864,3608) |

Burthorpe tiles: Denulth (2896,3528); Eohric (2902,3565) level 1; barman Tostig (2906,3537); Harold (2905,3539) level 1 [server data, unverified in game 2026-10-24]. Seen in game: the inn stairs (2914,3539 to 2914,3542) land in the east bedroom; the hall is the z=3544 row; opening Harold's door (2906,3543) on level 1 from (2906,3544) knocks ("Harold: Come in!") and walks you to (2906,3542). A walk with `at` on the wall tile (2906,3545) loops on the knock dialog forever, and a talk to Harold from outside the room is unreachable. Shop with Tostig only from the ground floor: travel to (2906,3539) on level 0, then `shop` with no `at`. [v 2026-10-24 questw2 local]

Saba's cave: entrance loc (2857,3578), safe `at` (2857,3576) (6 s from Burthorpe); exit loc "Cave Exit" (2268,4752), Saba (2270,4759); enter and exit with `interact` options Enter and Exit. [v 2026-10-24 questw2 local]

Tenzing's hut: front door (2822,3555), back door (2820,3557). Entering knocks every time and the door closes behind you: open it with `interact` (Open at (2824,3555), tolerance 1), then talk to Tenzing with no `at` from the door tile; clear a leftover knock dialog with `talk` `continue`. [v 2026-10-24 questw2 local]

Safe route from the cave to the hut: (2848,3576), (2833,3583), (2826,3578), (2833,3569), (2827,3561), door (2822,3555); it passes about 5 tiles from the lowest troll spawns and was survived twice. Returning east from the hut, a talk with `at` (2896,3526) sticks at (2864,3567) with "I can't reach that!": travel to (2880,3556) via (2833,3567), (2833,3583), (2857,3576) first. Denulth's `at` (2896,3526) is not reachable from the pocket tile (2893,3524). [v 2026-10-24 questw2 local]

A library save placed at (2893,3524) sat in an enclosed pocket with no path; (2897,3531) works. [v 2026-10-24 questw2 local]

## Gotchas

- The plan `conductor/plans/death-plateau.ts` is promoted. Its first draft died at (2864,3604) (see below). [v 2026-10-24 questw2 local]
- `v.quest('death')` only gives none/started/done; the plan tracks stages by dialog markers (chained so one scrolled out of the ~20-page history is still known). Saba's "nettlesome Sherpa" page can be missing when clicked fast; the plan uses "Where does this Sherpa live". [v 2026-10-24 questw2 local]
- Do not `interact` the Saba cave entrance (2857,3578) with `at` (2857,3580): that tile is not reachable from the Burthorpe side, and the pathfinder detoured west and north through (2840,3590), (2838,3596), (2850,3604), (2864,3604), which is Mountain Troll ground; a 47 HP bot (Def 40) died there at (2864,3604) in about 20 ticks (run `2026-10-24T04-17-40-428Z-plan-death-plateau`). A plain `travel` to (2857,3575) from Burthorpe took 6 s. See [hazards](../../learnings/hazards.md). [v 2026-10-24 questw2 local]
- `recentDialogs` text wraps across lines: match markers on `d.text.join(' ')` (see [dialogs](../../learnings/dialogs.md)). [v 2026-10-24 questw2 local]
