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

### Bot notes (parked 2026-11-01)

Draft `conductor/runs/questw1/plans/gertrudes-cat.ts` (start save `lib:gertrudes-cat-start`: by the doogle leaves (3153, 3403), 150 coins, bucket of milk, raw sardine) proved every step but never the whole quest in one run: after the kitten, walks to the ladder fail intermittently with "Stuck at (3307, 3506)" beside the Crate NPCs, from `interact` and `travel` alike. [v 2026-11-01 questw1 local]

- Gertrude (3151, 3410) is behind a closed door (3150, 3412) the walker does not open: `interact` Open it first, on each visit. [v 2026-11-01 questw1 local]
- Shilop or Wilough (same dialog, Varrock square): "What will make you tell me?" then "Okay then, I'll pay." (100 coins). The first talk after the quest starts sometimes closes before its choices; give it a retry phase. [v 2026-11-01 questw1 local]
- Doogle leaves are ground spawns at (3151-3157, 3399-3401); "Doogle leaves" on "Raw sardine" gives "Seasoned sardine". [v 2026-11-01 questw1 local]
- The lumber yard's south entrance is the Broken fence (3305, 3493), "Climb-over" (members). The walker crosses it but then reports "Repeating the same hops 4 times without arriving"; cross with an explicit `interact` instead. [v 2026-11-01 questw1 local]
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
