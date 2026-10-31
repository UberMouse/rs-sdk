# Sheep Herder

## Overview

| Detail       | Info    |
|--------------|---------|
| Difficulty   | Novice  |
| Length       | Short   |
| Quest Points | 4       |

## Requirements

No skill or quest requirements.

## Items Needed

- 100 gp (to purchase plague suit)

## Rewards

- 3,100 gp

## Walkthrough

### Getting Started

Speak to Councillor Halgrive, located south of the Ardougne chapel. He explains that 4 infected sheep have escaped quarantine and need to be dealt with before the plague spreads.

### Preparing Equipment

1. Receive poisoned sheep feed from Councillor Halgrive.
2. Visit Doctor Orbon near the chapel. Purchase a plague suit for 100 gp. You must wear the full plague suit to handle the infected sheep.
3. Collect the cattle prod from the nearby shed.

### Herding the Sheep

1. Equip the cattle prod.
2. Locate the 4 infected sheep wandering around the area. They are visually distinct from normal sheep (discolored).
3. Use the cattle prod to herd each sheep one at a time into the fenced pen. Prod them from behind to push them in the correct direction.
4. This step requires patience as the sheep can be uncooperative.

#### Bot route (partial, parked 2026-11-01)

Draft `conductor/runs/questw2/plans/sheep-herder.ts` (not promoted) took sheep 1 from a fresh load of `lib:sheep-herder-start` through herding (about 55 s, `herd` task), feed, bones and the furnace (about 15 s together) after a 70 s prelude; sheep 2-4 did not finish. [v 2026-11-01 questw2 local]

- `herd` params per sheep, all with `stop` {minX 2595, maxX 2609, minZ 3351, maxZ 3364} and `goneIsDone: true` (spawn areas from `server/content/maps/m40_52.jm2`; routes from a BFS over the SDK collision data):
  - Sheep 1: from (2609, 3344), route (2613, 3344), (2613, 3365), (2594, 3365), (2594, 3363). Worked once. [v 2026-11-01 questw2 local]
  - Sheep 2: from (2622, 3367), route (2594, 3367), (2594, 3363) proven; a first waypoint (2620, 3367) is untested. Once it wanders to z 3368 a building at x 2616-2619, z 3368-3371 blocks the west push ("4 prods in a row did not move the NPC at (2620,3368)"). [v 2026-11-01 questw2 local]
  - Sheep 3: from (2561, 3390), route (2594, 3390), (2594, 3363). Untested.
  - Sheep 4: from (2611, 3391), route (2594, 3391), (2594, 3363). Untested.
- A walk from inside Brumty's pen to the south or east sticks at (2609, 3357); leave by the west gate (x 2594, z 3361-3362), e.g. travel to (2590, 3362) first. [v 2026-11-01 questw2 local]
- (2611, 3351) is a wall tile: a sheep in the notch at (2610, 3351), outside the pen's SE corner, has no stand tile behind it ("can't reach the stand tile"). [v 2026-11-01 questw2 local]
- Prodding without the suit worn, or a sheep already disposed of, opens a dialog loop: gate every herd phase on suit worn and prod wielded. [v 2026-11-01 questw2 local]
- The draft counts progress by its own phase runs, so it cannot resume mid-quest: start each attempt from a fresh load. [v 2026-11-01 questw2 local]

### Disposing of the Sheep

1. Once all 4 sheep are in the pen, apply the poisoned feed to eliminate them.
2. Collect the bones from the sheep.
3. Burn the bones in the nearby furnace to prevent further contamination.

### Completing the Quest

Return to Councillor Halgrive and report that the infected sheep have been disposed of.

## Key NPCs & Locations

| NPC/Location          | Role                                      |
|-----------------------|-------------------------------------------|
| Councillor Halgrive   | Quest start, S of Ardougne chapel         |
| Doctor Orbon          | Sells plague suit (100 gp)                |
| Shed                  | Contains cattle prod                      |
| Sheep pen             | Herd infected sheep here                  |
| Furnace               | Burn sheep bones                          |
