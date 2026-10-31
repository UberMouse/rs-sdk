# Black Knights' Fortress

| Detail     | Info          |
|------------|---------------|
| Difficulty | Intermediate  |
| Length     | Medium        |
| Quest Points | 3          |

## Requirements

- 12 Quest Points

## Items Needed

- Bronze medium helmet
- Iron chainmail
- Cabbage (must NOT be from Draynor Manor; the Monastery cabbage patch works)

## Rewards

- 2,500 gp

## Walkthrough

1. Speak to **Sir Amik Varze** on the 3rd floor of the **White Knights' Castle** in Falador. He asks you to infiltrate the Black Knights' Fortress and sabotage their secret weapon.
2. Equip the **bronze medium helmet** and **iron chainmail** as a disguise.
3. Travel north to the **Black Knights' Fortress** on Ice Mountain.
4. Enter the fortress wearing the disguise. Push through the wall on the south side to gain entry to the inner area.
5. Climb the ladder and listen at the **grill** on the eastern wall to learn about the Black Knights' invincibility potion.
6. Pick up a **cabbage** from the Monastery garden if you have not already (do not use a Draynor Manor cabbage as it will not work).
7. Go to the room above the cauldron and use the **cabbage** on the **hole** in the floor. The cabbage falls into the potion, ruining it.
8. Return to Sir Amik Varze to complete the quest.

### Bot notes (parked 2026-11-01)

Draft `conductor/runs/questw5/plans/black-knights-fortress.ts` (save `lib:black-knights-fortress-start`: Falador east bank (3013, 3357), Att/Str/Def 40, HP 50, disguise worn, iron scimitar, 20 swordfish, a normal Cabbage in the last pack slot, 12 QP from real quest varps) reached the quest start and the fortress interior but not the grill. [v 2026-11-01 questw5 local]

- Sir Amik Varze (2962, 3338) level 2: choices "seek a quest", "laugh in the face" (40 s). The disguise opens the fortress door (3016, 3513). [v 2026-11-01 questw5 local]
- The cabbage must be the normal one (obj 1965); the Draynor `magic_cabbage` is refused (`quest_blackknight.rs2`). Combat's low-HP eat takes the first edible slot, so keep the Cabbage last, and expect it eaten once the food runs out. [v 2026-11-01 questw5 local]
- Fortress locs (`server/content/maps/m47_54.jm2`): door (3016, 3513), secret wall level 0 (3016, 3517), banquet-hall door (3020, 3515), ladder (3021, 3510) level 0 to 1, Grill (3025, 3507), level-1 door (3025, 3511), level-1 secret Wall (3030, 3510), Hole (3031, 3507) level 1. [server data, unverified in game 2026-11-01]
- The walker opened the banquet-hall door (3020, 3515): a dialog and Black Knight (level 33) aggro followed. They respawn, so the combat task fought for about 6 minutes and about 7 swordfish per aggro at Defence 40. Avoid the hall. [v 2026-11-01 questw5 local]
- The Grill reported "Cannot reach Grill" from (3025, 3506) and (3025, 3508), even with `unreachable: true`; the walker has no connector from level 0 (3024, 3505) to the hole room (3031, 3508) on level 1. The real stand tiles are unknown: find them with `rsmod.reached` and use `at` with `tolerance: 0`. [v 2026-11-01 questw5 local]
- The Wilderness starts at z 3520, just north of the fortress: a combat area centred at (3022, 3512) radius 20 fails preflight; (3024, 3508) radius 8 passes. [v 2026-11-01 questw5 local]

## Key NPCs & Locations

| NPC / Location            | Where                                      |
|---------------------------|---------------------------------------------|
| Sir Amik Varze            | White Knights' Castle, 3rd floor, Falador    |
| Black Knights' Fortress   | Ice Mountain, north of Falador               |
| Monastery cabbage patch   | South of the fortress, on the mountain path  |
| Grill                     | Inside the fortress, eastern wall             |
| Cauldron / hole           | Inside the fortress                           |
