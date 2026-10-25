# Observatory Quest

## Overview

| Detail       | Info    |
|--------------|---------|
| Difficulty   | Novice  |
| Length       | Short   |
| Quest Points | 2       |

## Requirements

No skill requirement is checked by the scripts (`observatory_professor.rs2`) [server data, unverified in game 2026-10-23].

## Items Needed

- 3 planks, 1 bronze bar, 1 molten glass (handed to the Professor)

## Rewards

- 2,250 Crafting XP
- Uncut Sapphire
- Random constellation reward (see below)

## Walkthrough

Proven by `conductor/plans/observatory.ts` (274 s from a fresh load of `lib:observatory-start`). Item names: Plank, Bronze bar, Molten glass, Lens mould, Lens, Keep key. The plan starts with 3 planks, 1 bronze bar and 1 molten glass in the inventory (no plank shop site; bronze bars only in far Karamja/Shantay shops; glass needs furnace, sand and soda ash). [v 2026-10-24 questw7 local]

Reception tiles: Professor (2438,3186), assistant (2442,3189), door (2443,3183), ladder down (2444,3191), dome ladder (2440,3164). Loose items nearby: logs (2458,3191), (2462,3187); bucket of sand (2461,3178); astrology book (2443,3187). [v 2026-10-24 questw7 local]

1. Talk to the Professor (2 dialog choices) to start; hand him the planks, bronze bar and molten glass (one talk each, ~6-9 s). [v 2026-10-24 questw7 local]
2. Ladder down (2444,3191) to the dungeon, arrival (2420,9459); the ladder back up is at (2420,9460). [v 2026-10-24 questw7 local]
3. Key chest (2428,9419): Open first, then Search; Search only shows once Open has taken effect. A search while closed fails once; retry after Open gives the Keep key. The chest hands out another key on later searches, even after the gate is unlocked. In a plan, chest-search and chest-open need `onFail: 'continue'`, `maxFails: 8`. [v 2026-10-24 questw7 local]
4. Keep gate at (2390,9457)/(2391,9457): use the Keep key on it. That unlocks it permanently, discards the key and moves you 1 tile across; plain Open from the north says "The gate is locked." The use opens the dialog "I'd better be quick, there may be more guards about", so `interact` can report no-effect on a use that worked. A Goblin guard (level 42) stands at the gate: combat is flagged but HP stayed full, no combat task needed. [v 2026-10-24 questw7 local]
5. Sack (2389,9454): Search it for the Lens mould. It is in the alcove south of the gate (x 2388-2393, z 9449-9457); (2389,9453) is blocked, so no `at` tile. [v 2026-10-24 questw7 local]
6. Back to the reception (ladder up (2420,9460)); give the Professor the mould. He keeps the mould until the lens is handed in and returns the glass at the mould hand-in. Make the Lens from the glass and mould (no Crafting level needed), give him the lens. Gate on his line "Wonderful, at last I can fix the telescope."; his final "Meet me at the Observatory later..." is not in recentDialogs when talk ends. [v 2026-10-24 questw7 local]
7. Dome: take the dome ladder (2440,3164), or the dungeon ladder up at (2423,9439), which lands in the dome at (2440,3165). Telescope (2440,3157): Use opens a dialog, pick "I can see a constellation". Professor (professor2) at (2439,3160) finishes the quest. [v 2026-10-24 questw7 local]

Other dungeon chests ((2390,9424), (2397,9469), (2399,9438), (2415,9425), (2420,9444), (2424,9430)) hold poisonous spiders; none searched.

### Constellation Rewards

The constellation is random. questw7 got Weapon poison, plus Uncut sapphire and 2250 base Crafting XP. [v 2026-10-24 questw7 local]

| Constellation          | Bonus Reward         |
|------------------------|----------------------|
| Aries                  | 875 XP (combat)      |
| Leo                    | 875 XP (combat)      |
| Virgo                  | 875 XP (combat)      |
| Capricorn              | 875 XP (combat)      |
| Other constellations   | Various items         |

## Key NPCs & Locations

| NPC/Location              | Role                                      |
|---------------------------|-------------------------------------------|
| Professor                 | Quest start, Observatory reception        |
| Professor's Assistant     | Provides crafting material list           |
| Observatory Dungeon       | Contains key, mould, and path to telescope|
| Observatory               | W across river from Tree Gnome Maze      |
| Telescope                 | Observe constellation for reward          |
