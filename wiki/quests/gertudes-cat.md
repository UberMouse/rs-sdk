# Gertrude's Cat

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Short |
| Quest Points | 1 |

## Requirements

- None

## Items Needed

- 100 gp (to pay Shilop)
- Bucket of milk
- Raw sardine
- Doogle leaves (found near Gertrude's house)
- Seasoned sardine (use doogle leaves on raw sardine)

## Rewards

- 1,525 Cooking XP
- Chocolate cake
- Stew
- A kitten (pet)

## Walkthrough

1. **Start the quest.** Speak to Gertrude at her house, located west of Varrock. Her cat Fluffs has gone missing and she asks you to find it.

2. **Talk to her sons.** Find Wilough and Shilop in Varrock Square. Speak to Shilop and pay him 100 gp to learn where the cat went.

3. **Go to the lumber mill.** Head to the lumber mill east of the Jolly Boar Inn (NE of Varrock).

4. **Find the cat.** Climb up to the 2nd floor of the lumber mill to find Fluffs.

5. **Feed the cat.** Give Fluffs a bucket of milk and a seasoned sardine. To make the seasoned sardine, use doogle leaves on a raw sardine. Doogle leaves grow near Gertrude's house.

6. **Find the kitten.** Feeding the sardine picks one of six "Crate" NPCs (option Search) at random: (3305, 3500), (3310, 3499), (3307, 3507), (3303, 3506), (3298, 3514), (3311, 3511). A search takes 4 ticks and says "You find nothing." or "You find a kitten!". The decoy crates and barrels are locs, not NPCs. [v 2026-11-01 questw1 local]

7. **Complete the quest.** Use Fluffs' kitten on "Gertrudes cat" upstairs, then talk to Gertrude. [v 2026-11-01 questw1 local]

### Verified route

Run by `conductor/plans/gertrudes-cat.ts` (a `defineQuest` plan): a fresh load of `lib:gertrudes-cat-start` (by the doogle leaves (3153, 3403), 150 coins, bucket of milk, raw sardine) to quest done in 223 s. [v 2026-11-14 conductor3w1 local] Killed past the payment, or after the kitten was found, a fresh run picks up at the right step from the journal, the held items and the floor. [v 2026-11-14 conductor3w1 local]

- Gertrude (3151, 3410) is behind a door (3150, 3412) the walker does not open: `interact` Open it before each visit unless she reads reachable (it is sometimes already open). [v 2026-11-14 conductor3w1 local] Arriving from the lumber yard, one Open failed with the door "not in sight" at the stand tile (3151, 3414); the next try opened it. [v 2026-11-14 conductor3w1 local]
- The player's level reads stale just after a ladder: end a ladder phase with an `until` on the level. [v 2026-11-01 questw1 local]
- Shilop or Wilough (same dialog, Varrock square): "What will make you tell me?" then "Okay then, I'll pay." (100 coins). The first talk after the quest starts sometimes closes before its choices ("the dialog closed after 0 of 2 choices"); the next talk goes through. [v 2026-11-14 conductor3w1 local]
- Journal per stage, as the lite client shows it (the struck-out earlier lines stay in the text): started "I need to speak to Shilop and Wilough at the marketplace"; paid "I spoke to Shilop, Gertrude's Son. ... find the lost cat and return it to Gertrude"; milk "I found the lost cat but it won't come back"; sardine "I gave the cat milk and sardines"; kitten returned "I gave Fluffs her kitten back. She ran off home" (the milk line becomes "The cat didn't follow me back"). [v 2026-11-14 conductor3w1 local]
- Using the kitten on the cat takes it from the inventory at once; the stage moves to returned about 12 ticks later, when Fluffs and the kitten vanish and the mesbox "Fluffs has run off home with her offspring." opens. The lite client does not record that mesbox in `recentDialogs` (`learnings/dialogs.md`). The quest plan's read after the use (`journal:return-kitten`, re-reading every 4 ticks) saw the returned stage at its second read. [v 2026-11-14 conductor3w1 local]
- After Gertrude's last page closes, the quest tab shows the quest complete about 9 ticks later ("... and some food!", a chocolate cake and a stew), so wait for it before judging the quest. [v 2026-11-14 conductor3w1 local]
- Doogle leaves are ground spawns at (3151-3157, 3399-3401); "Doogle leaves" on "Raw sardine" gives "Seasoned sardine". [v 2026-11-01 questw1 local]
- The lumber yard's south entrance is the Broken fence (3305, 3493), "Climb-over" (members); `travel` crosses it (since 4d0b70fab, which also routes round the blockwalk Crate NPCs in the yard). [v 2026-11-01 questw1 local]
- The cat is upstairs: ladder (3310, 3509), stand tile (3309, 3509), cat roams (3301-3311, 3507-3517) on level 1. Milk first, then the sardine; the cat hits for about 3, so HP 10 is enough. [v 2026-11-01 questw1 local]

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Gertrude | West of Varrock |
| Wilough & Shilop | Varrock Square |
| Lumber mill | East of Jolly Boar Inn, NE of Varrock |
| Fluffs (cat) | 2nd floor of the lumber mill |
| Kitten | SE crates, lower floor of the lumber mill |
| Doogle leaves | Near Gertrude's house |
