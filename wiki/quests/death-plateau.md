# Death Plateau

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Medium |
| Quest Points | 1 |

Everything below is read from scripts (`death_guard_equiproom.rs2` and the death quest scripts) and `.jm2` map data; nothing has been tried in game. [server data, unverified in game 2026-10-24]

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
3. **Harold** (Toad and Chicken inn): "You're the guard that was on duty last night?" (30). Back to Eohric: "I found Harold but he won't talk to me!" (40).
4. Give Harold an **Asgarnian Ale** (bought in the inn; use it on him, or "Can I buy you a drink?") (50).
5. **Gamble for the IOU** (55), then Read the IOU for the safe combination (60). See Dice game below.
6. **Cannonballs**: five `death_cannonball_*` ground spawns at (2893, 3561-3565) (obj ids 3109 red, 3110 blue, 3111 yellow, 3112 green, 3113 purple). Use each on a stone mechanism: blue (2894,3562), yellow (2895,3562), red (2894,3563), purple (2895,3563), green (2895,3564). All five at stage 60 set 70 and unlock the room.
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

## Gotchas

- No plan yet. The dice game needs a count-prompt answer and an interface button click, which the catalog does not have; they are being authored, and the plan is blocked on them.
