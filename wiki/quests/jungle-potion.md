# Jungle Potion

| Detail | Info |
|--------|------|
| Difficulty | Intermediate |
| Length | Short |
| Quest Points | 1 |

Plan: `conductor/plans/jungle-potion.ts` (promoted). A fresh load of `lib:jungle-potion-start` reaches quest done in 401 s in one run, net cost 30 coins. [v 2026-10-24 questw3 local]

## Requirements

- Druidic Ritual quest complete (`trufitus.rs2:280`) [server data, unverified in game 2026-10-23]
- Herblore 3 to identify the herbs (`identify.rs2:66`); the run had Herblore 28. [v 2026-10-24 questw3 local]

## Items Needed

- Food: carry about 24 (salmon in separate slots). Karamja poisons the bot ("You have been poisoned!" near the SW marsh vines) and snakes bite; poison and snakes cost about 170 HP over the quest. A run with 12 salmon failed at the 4th hand-in: low HP, no food. [v 2026-10-24 questw3 local]
- About 30 coins for the ship (Captain Tobias, Port Sarim). Antipoison(3) at Jiminua's store costs 432 gp and is not needed. [v 2026-10-24 questw3 local]
- Start save `jungle-potion-start`: Port Sarim (3028,3218), Att 40 Str 47 Def 40 HP 48 Prayer 15 Herblore 28, steel scimitar worn, 24 salmon, 200 coins, varp 80 (druidquest) = 4. [v 2026-10-24 questw3 local]

## Rewards

- 775 Herblore XP (x25 = 19,375 here; the plan's RESULT does not count the quest lump) [server data, unverified in game 2026-10-23]

## Walkthrough (as the plan runs it)

[v 2026-10-24 questw3 local]

1. Ship: Captain Tobias, choice "Yes please", lands on the deck at (2956,3143). Gangplank (2956,3144) option Cross, to the quay (2956,3146).
2. Walk to Trufitus (~2809,3086) and start the talk.
3. Per herb, in order: search the loc, Identify the "Unidentified herb", hand it to Trufitus (dialog "Of course"). Each hand-in names the next herb; "Not yet, sorry" repeats the clue. Order: vine (Snake weed), palm (Ardrigal), scorched earth (Sito foil), rock (Volencia moss), cave (Rogues purse). The Rogues purse hand-in completes the quest in the same talk.
4. Restart-safe stage: read from the newest Trufitus dialog page matching one clue phrase per herb (kisses, profusion, blackened, "clings to rocks", darkness).

## Herb rules

- Only the current stage's loc gives a counted herb; earlier stages' locs still hand out a wasted herb. [v 2026-10-24 questw3 local, from `trufitus.rs2`, `quest_junglepotion.rs2`]
- Herbs arrive as "Unidentified herb" (op Identify, Herblore 3). Trufitus refuses an unidentified one ("so dirty"). Identified names: Snake weed, Ardrigal, Sito foil, Volencia moss, Rogues purse. [v 2026-10-24 questw3 local]
- One rock search gave 2 Volencia moss (probably a re-sent op); harmless. [v 2026-10-24 questw3 local]

## Quest locs

Loc ids 2575-2585, from map data (m43_47, m44_47, m44_48, m44_148). [server data, unverified in game 2026-10-24]; the plan used them and finished. [v 2026-10-24 questw3 local]

| Herb | Loc | Tiles |
|------|-----|-------|
| Snake weed | Marshy jungle vines | (2760,3014), (2761,3017) |
| Ardrigal | Palm trees | (2870,3115), (2874,3124), (2877,3120) |
| Sito foil | Scorched earth | (2784,3067), (2789..2791, 3047..3049) |
| Volencia moss | Moss rocks | (2850,3035), (2851,3033), (2851,3036) |
| Rogues purse | Fungus-covered cavern wall (underground) | (2850,9476), (2869,9492), (2869,9517) |

- Cave entrance: "Rocks", op Search at (2824,3118); asks "Would you like to enter the caves?" (choice "enter the cave"); lands at (2830,9520).
- Cave exit: "Hand holds", Climb at (2830,9522); lands at (2823,3120).
- The Jogres in the Rogues-purse cave caused no trouble. [v 2026-10-24 questw3 local]

## Key NPCs

| NPC / Location | Where |
|----------------|-------|
| Trufitus | Tai Bwo Wannai village, Karamja (~2809,3086) |
| Captain Tobias | Port Sarim ship to Karamja |
| Jiminua's store | Tai Bwo Wannai village (antipoison, not needed) |
