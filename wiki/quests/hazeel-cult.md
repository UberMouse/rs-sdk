# Hazeel Cult

## Overview

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Medium |
| Quest Points | 1 |

## Requirements

- No skill or quest requirements

## Items Needed

- None required

## Rewards

- 1 Quest Point
- Thieving 15,000 base XP (`quest_hazeelcult.rs2:172`); 37,500 shown on the 25x local server, Thieving 1 -> 51. [v 2026-10-31 questw4 local]
- 2,000 gp
- Hazeel's Mark (armour, if siding with Clivet)

## Walkthrough

1. Speak to **Ceril** at the **Carnillean Mansion** west of Ardougne to start the quest.
2. You will discover a cult operating beneath the mansion and must choose a side.

### Path A: Side with Clivet (Hazeel Cult)

3. Find **Clivet** in the cave south of the Carnillean Mansion.
4. He asks you to help resurrect Hazeel by retrieving a sacred scroll.
5. Poison the Carnillean dog by using poison on the **stove** inside the mansion.
6. Retrieve the **Hazeel amulet** from the mansion.
7. Navigate the **sewer valve puzzle** beneath the cave. Set the 5 valves as follows (valve 3 is the only one turned left, `quest_hazeelcult.rs2:55-70`; the raft advances one island per correct valve):
   - Valve 1: Right
   - Valve 2: Right
   - Valve 3: Left
   - Valve 4: Right
   - Valve 5: Right
[server data, unverified in game 2026-10-23]
8. This opens the path to the **scroll**. Retrieve it and bring it back to Clivet.
9. The cult performs the ritual and **Hazeel** is summoned. Quest complete.

### Path B: Side with Ceril (Carnillean Family)

Needs no poison, amulet, crate key, chest or second raft trip; the only fight is Alomone (level 13), dead in about 10 s. Run by `conductor/plans/hazeel-cult.ts` (fresh start to done in 338 s). [v 2026-10-31 questw4 local]

3. Talk to **Ceril** upstairs (level 1, about (2573,3268)); on level 0 he only says "come upstairs".
4. Sewer "Cave entrance" (2585,3233), Enter, lands at (2570,9682). **Clivet** stands about (2566,9683); talk from (2567,9682): "What do you mean?" then "You're crazy, I'd never help you." This makes the side good (`hazeelcult_side` 0, stage 4). He respawns after about 40 s, with no more choices.
5. Sewer "Stairs" Climb-up at (2570,9683) lead to (2587,3237). Turn the five surface valves: valve1 (2562,3247), valve2 (2572,3263), valve3 (2585,3245), valve4 (2597,3263), valve5 (2609,3243): right, right, left, right, right. The valve's two-page message box is closed by the dialog guard, so `interact` reports `no-effect` after about 25 ticks although the valve turned; ignore it and count turns yourself.
6. Back down the cave entrance, Board the raft (2567,9679) to the hideout (2606,9692). Alomone is about (2609,9670) among Hazeel Cultists (level 13) and rats; the combat task finds no reachable Alomone until the bot stands at (2608,9673). Cultists did not aggro in the ~10 s fight. Alomone drops **Carnillean armour**.
7. Raft at (2606,9693) back to (2567,9680); stairs up; give the armour to Ceril on level 1 (one 43 s dialog, leaves stage 7).
8. Mansion cupboard (2573,3267) level 1, from (2574,3267): Open, then Search completes the quest. The loc options lag the Open: a Search right after Open still sees only "Open"; a deliberately failing first Search followed by the real Search works.

Alomone's lines name Jones the butler as the cult's accomplice in the mansion (`alomone.rs2:7-8`), and the Carnillean guard afterwards speaks of the player having accused him (`carnillean_guard.rs2:29`). [server data, unverified in game 2026-10-31]

## Key NPCs & Locations

| NPC / Location | Role | Location |
|----------------|------|----------|
| Ceril | Quest start, leader of Carnillean family | Carnillean Mansion, W Ardougne |
| Clivet | Cult leader, alternative quest path | Cave S of Carnillean Mansion |
| Alamone | Level 13 cult member (Path B) | Sewer caves |
| Butler | Secret cult conspirator | Carnillean Mansion |
| Sewer valves (x5) | Puzzle to open waterway | Beneath the cave |
| Carnillean Mansion | Central quest location | West of Ardougne |
