# Elemental Workshop

## Overview

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Short |
| Quest Points | 1 |

## Requirements

- 20 Mining, 20 Smithing, 20 Crafting
- Ability to defeat level 35 Earth Elementals, which spawn when the ore is mined. The `combat` task refuses level-35 targets unless the bot carries food ("level 35, above limit 5"), so bring plenty.

## Items Needed

- Knife (or any slash weapon), Hammer, Pickaxe, Needle, Thread, Leather, 4 coal, and food: 14 lobsters were all used (with 10 the bot ran out and `combat` then refused)

## Rewards

- 1 Quest Point, Elemental Shield, Crafting 125,000 XP and Smithing 125,000 XP (`stat_advance` 50,000 tenths each, at the local 25x rate; the run's Smithing +125,700 includes the elemental bar; the final run took Crafting 80 -> 85 and Smithing 82 -> 87, Strength +7000 and Hitpoints +2310 from the fights). [v 2026-10-24 conductor3 local]

## Quest state

Quest id `elemental_workshop`; varp `elemental_workshop_bits` (id 299), complete = bit 20 (a bit index, not a stage). The client sees only the tab colour (none / yellow / done); the puzzle state (valves, water wheel, bellows, furnace) is a varp the plan never sees, so it reads it from game messages (last 50). [v 2026-10-23 questw6 local]

## Walkthrough (verified route)

Plan `conductor/plans/elemental-workshop.ts`: from a fresh load of `lib:elemental-workshop-start` (Seers' Village bank (2725,3492), Att 45 Str 50 Def 40 HP 50, Mining/Smithing/Crafting 20, steel scimitar worn, knife, bronze pickaxe, hammer, needle, thread, leather, 4 coal, 14 lobsters) the quest finished in 227-279 s (two fresh-load runs; the `defend` phase fights the aggressive workshop elementals). Promoted. [v 2026-10-23 questw6 local]

1. **Bookcase** (2716,3481) in a house (door (2713,3483)); stand (2714,3481), tolerance 1. Gives a "Battered book" once. Read it (option "Read") to start the quest (tab yellow).
2. Use a knife (or any slash-animation weapon, a Bronze sword works) on the book: "Battered key". Neither is consumed; keep the book for the shield.
3. **"Odd looking wall"** (2709/2710,3495), a double door in the Seers' smithy: use the key on it. `interact` reported "no effect" though the bot got through, so the phase is `onFail: continue`.
4. **"Staircase"** (2710,3497) Climb-down lands at (2716,9888), workshop level 0 (x 2688-2745, z 9856-9920). Another smithy "Staircase" offers only Climb-up, so select by tile. Stairs back up at (2714,9887).
5. **Stone bowl**: Crate (2717,9894), search gives "A stone bowl" (ids 2888 empty, 2889 full). A crate-search `expect` "you find a stone bowl" never matched though the search worked; drop the `expect`. A needle at (2700,9887); the leather is in "Boxes" at (2724,9894) (Search; not a crate or ground item), once per account. A full pack (28 slots) blocks the bowl crate search: eat or drop to free a slot first. [v 2026-10-24 conductor3 local]
6. **Water wheel**: "Water Valve" right (2726,9908), left (2713,9908). The right one toggles only while the left is off: right, left, then the "Lever" (2722,9906) starts the wheel; the valves then lock. The lever's reset message brings the valves back to zero.
7. **Bellows**: "Bellows" (Fix) at (2734,9882)/(2736,9882): Crafting 20, consumes leather and thread. Air "Lever" (2734,9887) pumps them only with water flowing and the bellows fixed; pulling again stops it.
8. **Lava**: use the bowl on a "Lava trough" ((2714,9871) or (2706,9876)), then on the "Furnace" (2724,9874), which stays lit.
9. **Ore**: "Pile of Rock" (Mine), 21 locs around x 2690-2708, z 9898-9916. Mining spawns a level-35 earth elemental that attacks; its death drops Elemental ore on the ground, which despawns within minutes (pick up at once). The server discards repeat Mine ops while a spawn is alive, and `interact` does not see the spawn as an effect (fail and continue). Many ordinary aggressive Earth (35) and Water (34) elementals near the rocks drop no ore; fighting all of them used up the food.
10. **Metal**: Elemental ore + 4 coal on the lit furnace with air flowing gives "Elemental metal" (80 Smithing XP).
11. **Shield**: bar on a "Workbench" ((2717,9887) or (2722,9887)) with hammer, Smithing 20 and the book in the inventory: "Elemental shield", quest complete.

Notes for the plan: `interact` needs a `tile` to pick between same-named locs; `combat` with target "elemental" and `maxLevelGap` 25 works (with no food it refuses level-35 targets). Elementals hazard: [hazards](../../learnings/hazards.md).
