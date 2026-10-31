# Fishing Contest

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Medium |
| Quest Points | 1 |

## Requirements

- 10 Fishing

## Items Needed

- Spade
- Garlic (obtainable from various locations)
- 5 gp (competition entry fee)

## Rewards

- 2,437 Fishing XP
- Access to the underground passage through White Wolf Mountain

## Walkthrough

1. **Start the quest.** Speak to the dwarf (Austri or Vestri) found at either the east or west entrance of White Wolf Mountain. The dwarves need you to win a fishing competition so they can gain access to the tunnels beneath the mountain.

2. **Get the competition pass.** The dwarf gives you a fishing competition pass to enter the contest at Hemenster.

3. **Obtain red vine worms.** Travel to McGrubor's Woods (west of Seers' Village). Push through the loose fence to enter the woods. Use your spade to dig near the red vines to collect red vine worms, which are the best bait for the competition.

4. **Enter the fishing competition.** Go to Hemenster (south of Seers' Village) and pay the 5 gp entry fee to enter the fishing contest.

5. **Use garlic on the pipes.** Before fishing, place garlic in the pipes near the best fishing spot. This drives away the vampire competitor (Sinister Stranger) who would otherwise win the contest.

6. **Fish at the pipes spot.** Fish at the spot near the pipes where the vampire was standing. Using the red vine worms as bait, you will catch a winning fish.

7. **Win the competition.** After catching your fish, the judges will declare you the winner.

8. **Complete the quest.** Return to the dwarf at White Wolf Mountain with proof of your victory. You will gain permanent access to the underground passage through the mountain.

## Verified route (plan `conductor/plans/fishing-contest.ts`)

Fresh load of `lib:fishing-contest-start` to quest done in 278 s. [v 2026-10-31 questw7 local]

- Start: Mountain Dwarf at (2821,3487), reached from outside the hut (the tile (2823,3485) inside the west hut is a closed pocket for the walker). Dialog choices: "wondering what was down", "Why not", "If you were my friend", "let's be friends", "how am I meant", "Fortunately" give the pass.
- McGrubor's Wood: enter and leave by the Loose Railing (2662,3500), never the locked gate; waypoints and settle detail in `learnings/walking.md`.
- Vines about (2627-2633,3492-3499): `Vine` / `Check` with the spade gives one red vine worm per dig (about 0.8 s); pass `expect:'You find a red vine worm'`, or the idle rail ends the plan after 3 digs.
- Hemenster: Morris's gate opens to (2642,3441); Bonzo takes 5 gp; Garlic used on the Wall Pipe (2636-2638,3446) moves the Sinister Stranger to (2631,3435); fish at the pipes spot (2637,3444) with `expect:'You catch'`. One giant carp (three catches with worms) and Bonzo hands over the trophy; further casts do nothing.
- Reward: trophy to the dwarf gave 60,925 Fishing XP on the 25x server (Fishing 15 -> 59).
- Danger: Foresters and a Guard dog (Lvl 44) in the wood killed an HP-10 level-1 account near (2669,3487); Att/Str/Def/HP 40 with 10 swordfish was never attacked. The minimum is unmeasured.

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Austri / Vestri (dwarves) | East and west entrances of White Wolf Mountain |
| McGrubor's Woods | West of Seers' Village (push loose fence to enter) |
| Red vine worms | Dig near red vines in McGrubor's Woods |
| Fishing competition | Hemenster, south of Seers' Village |
| Sinister Stranger (vampire) | Fishing competition, near pipes |
