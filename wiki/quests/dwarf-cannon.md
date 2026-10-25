# Dwarf Cannon

Quest id `mcannon`; varp 11 = done (stages 0-10). Plan: `conductor/plans/dwarf-cannon.ts` (promoted; fresh load of `lib:dwarf-cannon-start` to done in 768 s). [v 2026-10-24 questw7 local]

## Overview

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Short |
| Quest Points | 1 |

## Requirements

- No mandatory skill requirements. Crafting sets the railing success rate: the roll is `stat_random(crafting,60,150)`, about 54% at Crafting 85, about 23% at Crafting 1; a failure costs 3 HP. [v 2026-10-24 questw7 local]

## Items Needed

- None. The Commander hands out the 6 railings and the Tool kit; the remains, ammo mould and notes are collected in game. [v 2026-10-24 questw7 local]

## Rewards

- 1 Quest Point
- 750 Crafting XP
- Ability to purchase the Dwarf Multicannon (750,000 gp)
- Ability to craft cannonballs
- (no ammo mould: the commander takes it back, `lawgof2.rs2:201`; Nulodion's shop sells it afterwards, `dwarven_workshop.inv:14`) [server data, unverified in game 2026-10-23]

## Walkthrough (proven route)

Commander choices: "love to help" (start); "Ok, I'll see what I can do" (gives the Tool kit); "just for you" (sends you to Nulodion). Nulodion needs no choices. [v 2026-10-24 questw7 local]

1. Talk to the **Dwarf Commander** at the camp (2571,3463); the camp is fenced by railings. ~11 s.
2. Replace the **6 broken railings** (loc ids 15-20; 14 is a sound one): 15 (2556,3475), 16 (2558,3472), 17 (2557,3464), 18 (2559,3462), 19 (2564,3460), 20 (2572,3460). Inspect shows "One railing is broken and needs to be replaced.", then the option "Try to replace the railing."; success "You replace the railing with no problems.", failure "...but fail and cut yourself trying." Each try 9-15 s; ~135 s total with nudge walks. In a task, `interact` `expect` must be 'railing is broken' (an options page does not count as a match; a bare "You search the railing..." ends the effect too early). After a failed try, walk a few tiles (a nudge) so a plan's idle rail does not count the failure (see `conductor/docs/plans.md`).
3. Report the fences to the Commander (~12 s). This must come before the remains pickup works (stage >= 2).
4. **Watchtower** south of the camp: ladder up at (2570,3441) to level 1 (arrival (2569,3441)); a second ladder (2570,3443) to level 2. Dwarf remains on level 2 near (2570,3443) (`pickup` area (2570,3442) r7, level 2). Climb down by the same two ladders. ~15 s.
5. Hand the remains to the Commander (~19 s).
6. **Goblin cave** entrance near (2621,3394) (travel to (2621,3393) works); entering teleports to (2620,9797). Lollk (the boy; Gilob in older notes) is in crate loc id 1 at (2571,9850); travel to (2571,9849) takes ~14 s (the cave is connected). Search with `tile:{x:2571,z:9850}` and `expect:'Thank the heavens'` to open the child's dialog. Other crates give junk (a Broken staff). Cave goblins are low level and harmless. Exit: Mud pile (2621,9796) Climb-over to about (2623,3391). ~70 s for the cave leg.
7. Talk to the Commander for the Tool kit (~37 s).
8. **Cannon shed**: door (2576,3461) opens at stage >= 6; Broken MultiCannon at (2577,3461). Stand at (2576,3461) (tolerance 3; (2579,3461) is blocked). First Inspect: "I guess I'd better fix it with the toolkit I was given."; each following inspect opens the part menu: 'pipe', 'barrel', 'axle', 'shaft' in turn (30 Crafting XP each, message "You inspect the multi cannon."); a final inspect with `expect:'working order'` finishes it. ~15 s per repair, ~63 s total.
9. Talk to the Commander, who sends you to Nulodion (~23 s).
10. **Nulodion** is at (3011,3453) beside the Dwarven Mine entrance (not the Ice Mountain camp). `travel` from the camp ~190 s each way, uneventful; these two legs are 55% of the quest's time.
11. Walk back to the camp and finish with the Commander (the final talk is at the camp).

## Key NPCs & Locations

| NPC / Location | Role | Location |
|----------------|------|----------|
| Dwarf Commander | Quest start and progression | Camp (2571,3463) |
| Lollk | Captured boy to rescue | Crate at (2571,9850) in the goblin cave (entrance near (2621,3394)) |
| Nulodion | Ammo mould, notes | (3011,3453), Dwarven Mine entrance |
| Watchtower | Dwarf remains, level 2 | Ladders (2570,3441) and (2570,3443) |
| Cannon shed | Cannon repair | Door (2576,3461), cannon (2577,3461) |

All tagged [v 2026-10-24 questw7 local].
