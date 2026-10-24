# Death Plateau

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Medium |
| Quest Points | 1 |

Most of this is read from scripts (`death_guard_equiproom.rs2` and the death quest scripts) and `.jm2` map data; the dice game, the stone-ball puzzle and the Saba cave walk were tried in game (questw2, plan draft not yet proven) and are tagged. [server data, unverified in game 2026-10-24]

## Requirements

- No skill level or combat is checked; the cooked trout and bread are items handed to Tenzing. [server data, unverified in game 2026-10-24]
- No forced fights. Trolls roam the plateau (sign `death_dangersign_trolls`) and the secret path avoids them. The climbing rocks (`death_climbingrocks_top`/`_bottom`) need the climbing boots worn. The Tenzing and Harold doors check the quest state. [server data, unverified in game 2026-10-24]

## Items Needed

- About 3000+ coins for the dice game, 10 bread, 10 cooked trout, 1 iron bar, and free slots for the ale, boots, cannonballs and map. [server data, unverified in game 2026-10-24]

## Rewards

- 3,000 Attack XP before x25 (75,000 here), steel claws, climbing boots wearable. [server data, unverified in game 2026-10-24]

## Walkthrough

All steps [server data, unverified in game 2026-10-24]. The number in brackets is the `%death_equiproom`/quest stage the step sets, where known.

1. **Denulth** (Imperial Guard camp, Burthorpe): "Do you have any quests for me?" then "No but perhaps I could try and find one?" (10).
2. **Eohric** the head servant (castle): "I'm looking for the guard that was on last night." (20).
3. **Harold** (Toad and Chicken inn; Eohric says "Harold is staying at the local inn, the Toad and Chicken." [v 2026-10-24 questw2 local]): "You're the guard that was on duty last night?" (30). Back to Eohric: "I found Harold but he won't talk to me!" (40).
4. Give Harold an **Asgarnian Ale** (bought in the inn; use it on him, or "Can I buy you a drink?") (50).
5. **Gamble for the IOU** (55), then Read the IOU for the safe combination (60). See Dice game below.
6. **Cannonballs**: five `death_cannonball_*` ground spawns at (2893, 3561-3565) (obj ids 3109 red, 3110 blue, 3111 yellow, 3112 purple, 3113 green, all named "Stone ball"). Use each on a stone mechanism: blue (2894,3562), yellow (2895,3562), red (2894,3563), purple (2895,3563), green (2895,3564). All five at stage 60 set 70 and unlock the room. Seen in game: the Combination text matched the placement, and placing all five gave "equipment room door has unlocked". Spawn tiles in column x=2893: yellow z3561, green z3562, purple z3563, blue z3564, red z3565. Picked balls respawn quickly; a `pickup` of count 5 took duplicates (a second purple, no red); one `pickup` per colour with area centre (2891, spawnZ) radius 2 takes the right one. A placed ball stays on the ground about 1000 ticks. [v 2026-10-24 questw2 local]
7. **Saba** in his cave (`death_hermitcave_entrance`): "Do you know of another way up Death Plateau?" (map state 1).
8. **Tenzing** the Sherpa (knock; he says "I'm not the milkman" once map state >= 1): helping the Imperial Guard, then "OK, I'll get those for you." (2, gives climbing boots).
9. **Dunstan** the blacksmith: no-payment speech (3), then he asks for a son-in-the-guard certificate.
10. **Denulth** gives the certificate (4). Dunstan with the certificate (5): the spikes cost 1 iron bar plus the boots ("Yes, but I still want them").
11. **Tenzing**: 10 bread, 10 cooked trout and the spiked boots (6), then he gives the map (7).
12. **Secret path**: out the back door of Tenzing's hut, over the stile, to about (2864,3608); the scout is automatic (8).
13. **Denulth** with the secret map and the combination completes the quest.

## Dice game (Harold)

[server data, unverified in game 2026-10-24]

- The IOU comes only from Harold's dice game (`death_guard_equiproom.rs2`: harold_roll, dice_winnings, haroldgamble_end). `%death_equiproom` reaches 55 (given_iou) only when the player wins a bet larger than Harold's remaining gold. He starts with 100 (set by denulth_quests).
- Max bet 1000. Harold wins ties (player wins 15/36 per game). The bet is entered in a `p_countdialog` "Enter amount" prompt; the roll button is `death_dice:com_28`.
- Seen in game: the first `talk` with `amount` 101 at stage 40 gave the ale and won the IOU in one conversation (about 27 s); each further game takes about 18 s. Harold's gold is 100 plus the coins he has won, so bets of 101, 202, 404, 808 (then 1000) win the IOU on a win. [v 2026-10-24 questw2 local]
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

Burthorpe tiles, from `.jm2` map data (not walked, except where tagged): Denulth (2896,3528); Eohric (2902,3565) level 1; inn bar, barman Tostig (2906,3537); Harold (2905,3539) level 1. Harold's room is entered by the bedroom door (2906,3543) on level 1; the stairs up (2914,3539 to 2914,3542) land in the east room, not Harold's. The hall north of the doors is a single row at z=3544; opening the door from (2906,3544) walks the bot to (2906,3542); (2906,3545) is wall. [server data, unverified in game 2026-10-24]

Saba's cave: entrance loc (2857,3578), exit loc (2268,4752), Saba (2270,4759). Tenzing's hut: front door (2822,3555), back door (2820,3557). [server data / map data, unverified in game 2026-10-24]

A library save placed at (2893,3524) sat in an enclosed pocket with no path; (2897,3531) works. [v 2026-10-24 questw2 local]

## Gotchas

- No plan is promoted yet; the draft (questw2) reached the Saba cave walk and no further.
- Do not `interact` the Saba cave entrance (2857,3578) with `at` (2857,3580): that tile is not reachable from the Burthorpe side, and the pathfinder detoured west and north through (2840,3590), (2838,3596), (2850,3604), (2864,3604), which is Mountain Troll ground; a 47 HP bot (Def 40) died there at (2864,3604) in about 20 ticks (run `2026-10-24T04-17-40-428Z-plan-death-plateau`). A plain `travel` to (2857,3575) from Burthorpe took 6 s. See [hazards](../../learnings/hazards.md). [v 2026-10-24 questw2 local]
- `recentDialogs` text wraps across lines: match markers on `d.text.join(' ')` (see [dialogs](../../learnings/dialogs.md)). [v 2026-10-24 questw2 local]
