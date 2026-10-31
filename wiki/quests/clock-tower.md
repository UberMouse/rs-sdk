# Clock Tower

| Detail | Info |
|--------|------|
| Difficulty | Intermediate |
| Length | Medium |
| Quest Points | 1 |

## Requirements

- None checked by the scripts; the ogres are not a requirement [server data, unverified in game 2026-10-23]
- Ice gloves (optional, for handling the black cog through fire)

## Items Needed

- Bucket of water (obtainable during quest)
- Ice gloves (optional but helpful for the black cog)

## Rewards

- 500 gp

## Walkthrough

1. **Start the quest.** Speak to Brother Kojo at the clock tower, located SW of the Ardougne Zoo. The clock has broken down and he needs you to retrieve 4 colored cogs from the dungeon beneath the tower.

2. **Enter the dungeon.** Climb down the ladder in the clock tower to access the dungeon. Colored floor bricks indicate the paths to each cog. You can only carry one cog at a time.

3. **Retrieve the Red Cog** at (2583, 9613). Something there attacked the bot once in five runs. Place it on the ground-floor spindle (2568, 3243). [v 2026-11-01 questw7 local]

4. **Retrieve the White Cog** (2577, 9655) from the rat cage: take the rat poison (2564, 9662), pull the Lever (2591, 9661) from (2591, 9660), use the poison on the Food trough (2586, 9654), then the Gate (2579, 9656) opens from either side. Take the tower stairs (2572, 3240) up and place it on the level-2 spindle (2567, 3241). [v 2026-11-01 questw7 local]

5. **Retrieve the Blue Cog** (2574, 9633). Its cell is not reached from the main dungeon (railings block): take the surface ladder (2621, 3261) down to (2621, 9662), follow the east corridor (x 2580), and Push the "Wall" (2575, 9631) from (2576, 9631). It opens only briefly: Push it again from inside, from (2574, 9631), to leave. Climb out by the ladder (2621, 9661) and place it on the level-1 spindle (2569, 3240). The surface ladders at (2566/2569, 3227), (2566/2569, 3231) and (2572, 3227) lead only to dead-end railing cells. [v 2026-11-01 questw7 local]

6. **Retrieve the Black Cog** (2613, 9639). Picking it up is refused ("red hot") unless ice gloves are worn or a bucket of water is used on the ground cog (`quest_cog` scripts). Place it on the basement spindle (2570, 9642). [v 2026-11-01 questw7 local]

7. **Complete the quest.** Once all 4 cogs are placed on their correct poles, return to Brother Kojo to finish the quest.

**Important:** You can only carry one cog at a time. Plan your trips accordingly.

### Verified route

Run by `conductor/plans/clock-tower.ts`: a fresh load of `lib:clock-tower-start` (beside Brother Kojo (2572, 3250), Att/Str/Def 20, HP 30, ice gloves worn, 8 swordfish; no food was eaten) to quest done in 409 s, red, black, white, then blue. Kojo's start choice is "OK old monk"; the tower ladder (2566, 3242) leads down to (2566, 9643); he pays 500 coins at the end. [v 2026-11-01 questw7 local]

- The plan reads progress from its own phase run counts, so it must start from the fresh save: a resume re-tries placed cogs ("You have already placed a cog here."). [v 2026-11-01 questw7 local]
- Ladders, stairs, spindles, the Wall and the Gate need an `at` tile on their own floor, or `interact` finds "no reachable loc in sight". After a ladder climb the state keeps the old position for about one loop; a phase right after can fail "no connector" and needs a retry. [v 2026-11-01 questw7 local]

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Brother Kojo | Clock tower, SW of Ardougne Zoo |
| Red cog | Dungeon (red brick path, past ogres) |
| White cog | Dungeon (white brick path, poison rats) |
| Blue cog | Dungeon (blue brick path, water obstacle) |
| Black cog | Dungeon (black brick path, fire obstacle) |
| 1F pole (red) | Clock tower, 1st floor |
| 2F pole (blue) | Clock tower, 2nd floor |
| 3F pole (white) | Clock tower, 3rd floor |
| Basement pole (black) | Clock tower, basement |
