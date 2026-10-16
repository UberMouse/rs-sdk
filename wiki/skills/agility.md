# Agility

Agility allows traversing obstacles and shortcuts throughout the world. Higher levels also restore run energy faster.

## Agility Courses

### Gnome Stronghold Course (Level 1+)

**Location:** Gnome Stronghold, northwest of Ardougne

Obstacle order and coordinates (from `gnome_course.rs2` / `m38_53.jm2`; the course is no-fail, no aggressive NPCs): [v 2026-10-11 conductor2w3 local]

1. Log balance: loc 2295 at (2474, 3435).
2. Obstacle net up: (2471 / 2473 / 2475, 3425).
3. Tree branch up: (2473, 3422).
4. Balancing rope: (2478, 3420), east to (2483, 3420).
5. Tree branch down: (2486, 3419).
6. Obstacle net down: (2483..2487, 3426).
7. Obstacle pipe: (2484 or 2487, 3431); can answer that it is in use.

Gotchas: [v 2026-10-11 conductor2w3 local]
- The log balance sits on a bridge-flagged tile that neither `nearbyLocs` nor a loc scan lists; interact with it by id and tile.
- Nets and pipe answer "You can not do that from here" when approached from the wrong side.
- A lap is about 34 s and 86.5 XP base (about 2162 XP per lap at the local 25x rate); two laps took Agility 1 to 23.
- Getting here: Varrock East bank (3254, 3420) -> (2474, 3436) is one `travel` with no waypoints (tolerance 3), ~245-250 s, and it passes the Stronghold gate itself (see learnings/walking.md). The `agility` task needs the bot within 40 tiles of (2474, 3436). [v 2026-10-11 conductor2 local]
- A `--until` stop can end the `agility` task mid-lap on a raised plane (final level 2 at (2483, 3420) on 2026-10-11); the next run's travel/lap start should expect that. [v 2026-10-11 conductor2 local]

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Gnome Stronghold course | (2480, 3428) | 1 | `agility` task `{course:"gnome"}`, no failure; 13,975 XP in 225 s of laps (Agility 1 to 38, 49 obstacle steps). Laps alone ~224k/h at levels 1-38; ~106k/h for the whole plan incl. the 250 s trip from Varrock East (stats.ts) | 224k (laps only, local) | 2026-10-11 conductor2 local |
| Barbarian Outpost course | (2548, 3555) yard | 35 | `agility` task `{course:"barbarian"}`, 3487 XP a lap, 74-76 ticks a clean lap; 67,200 XP in 10 min (Agility 41 to 63, 19 laps, 3 falls, no food eaten) | 404k (local) | 2026-10-16 conductor2w4 local |
| Wilderness agility course | (2998, 3915) door | 52 | `agility` task `{course:"wilderness", minFood:3}`, 15,035 XP a lap, 115 ticks a clean lap; 180,045 XP in 10 min (Agility 55 to 77, 11 laps, 4 falls, 1 Salmon eaten). In the Wilderness: PvP, wolves, skeletons | 1.09M (local) | 2026-10-16 conductor2w4 local |
| Gnome Stronghold course, Agility 41-52 | (2480, 3428) | 41 | plan `conductor/plans/agility-52.ts`: 41 to 52 (+20,462 XP) in 564 s total; 10 laps in 290 s, ~29 s and ~2.0k XP per lap | ~254k (laps only, local) | 2026-10-16 conductor2 local |

| Obstacle | XP | Failable |
|----------|-----|---------|
| Log balance | 7.5 | No |
| Net climb | 7.5 | No |
| Tree branch | 5 | No |
| Tight rope | 7.5 | No |
| Tree branch (down) | 5 | No |
| Net climb (down) | 7.5 | No |
| Pipes | 7.5 | No |
| **Lap bonus** | **39** | No |
| **Total per lap** | **86.5** | |

### Barbarian Outpost Course (Level 35+)

**Location:** Barbarian Outpost, north past Baxtorian Falls. The server scripts check no quest (`barbarian_course.rs2`). Barbarians (level 7-8) do not attack a combat-53 bot. [v 2026-10-16 conductor2w4 local]

Lap (from `barbarian_course.rs2` and `m39_55.jm2`, locs at x+2496, z+3520; ticks measured on a clean lap of the `agility` task, `{course:"barbarian"}`): [v 2026-10-16 conductor2w4 local]

| Obstacle | Loc (x, z) | Base XP | Fails (at Agility 41, falls are 9-17%) | Ticks |
|----------|------------|---------|----------|-------|
| Rope swing (Swing-on), from z >= 3554, swings south | (2551, 3550) | 20 | pit under the yard (z 9949), 15% HP; ladder (2547, 9951) Climb-up lands at the same x, z-6400 by the log | 6 |
| Log balance (bridge-flagged, not in `nearbyLocs`: id 2294) | (2550, 3546) | 12.5 | lake: 9% HP, lands on the south shore (2545, 3542) | 13 |
| Obstacle net, from the east (x > 2538) | (2538, 3545) | 7.5 | no | 3 |
| Balancing ledge, level 1 | (2535, 3547) | 20 | spikes below (2533-2535, 3546): 15% HP, on foot to the net again | 8 |
| Ladder down (Climb-down, no XP) | (2532, 3545) level 1 | 0 | no | 2 |
| Crumbling wall 1, 2, 3 (loc id 1948; the walls' neighbours id 1947 are the Taverley shortcut and skip the lap progress) | (2536 / 2539 / 2542, 3553) | 12.5 each | no | ~5 each, 3 idle between |
| Lap bonus on the third wall | | 42 | | |
| Pipe (Outpost to yard, from z >= 3560) | (2552, 3559) | 10 | no | 8 |

139.5 base XP a lap (3487 at the local 25x) without the pipe. The yard (x 2528-2553, z 3541-3559) is closed in: the pipe is the only way in, and the lap needs no pipe (the rope swing is reached on foot from the walls), so the `agility` task crosses the pipe once when it starts outside and then loops yard-only. A clean lap is 74-76 ticks; a fall adds 20-25. The bonus needs rope, log, net, ledge and the third wall in order (a progress varp); after a pit fall the rope is swung again, not the log. [v 2026-10-16 conductor2w4 local]

### Wilderness Course (Level 52+)

**Location:** Wilderness level ~53-55 at (2998, 3917) (door) to (3005, 3960); PvP risk and items lost on death; the `agility` task runs it with the Wilderness guard off (`allowWilderness`). Dangers: white wolves (level 38) in the field south of the door, armed skeletons (level 22) west of the log and rocks, skeletons in the pit cave. [v 2026-10-16 conductor2w4 local]

Lap (from `wilderness_course.rs2`, `m46_61.jm2` at x+2944, z+3904, `m46_161.jm2` for the cave at z+6400; ticks measured on a clean lap): [v 2026-10-16 conductor2w4 local]

| Obstacle | Loc (x, z) | Base XP | Fails | Ticks |
|----------|------------|---------|-------|-------|
| Ridge north: Door (Open), north along x 2998 for 13 tiles into the compound | (2998, 3917) | 15 | into the wolf field east of the corridor, no damage | 16 |
| Pipe (from z <= 3938 only) | (3004, 3938) | 12.5 | no | 16 |
| Rope swing (from z <= 3953) | (3005, 3952) | 20 | skeleton cave at (3004, 10357): 15% HP, ladder (3005, 10363) lands near the stones | 6 |
| Stepping stones | (3001, 3960) | 20 | lava: 22% HP, lands (3002, 3963) | 16 |
| Log balance (bridge-flagged: id 2297) | (3001, 3945) | 20 | cave at (2998, 10345): 15% HP | 17 |
| Rocks (Climb, south) | (2993-2995, 3936) | 0, but the lap bonus 498.9 | no | 11 |
| Ridge south: Gate (Open) | (2998, 3931) and (2997, 3931) | 15 | wolf field, no damage | 20 |

601.4 base XP a lap (15,035 at the local 25x) including both ridges. The compound (z >= 3931) is closed in: the ridge is the way in and out, so a lap is door, pipe, rope, stones, log, rocks, gate. A clean lap is 115 ticks (46 s), which is 1.08M XP/h measured over 10 minutes at Agility 55-77; the bonus needs pipe, rope, stones, log and rocks in order, so a bot that fell at the rope and skipped back to the stones would lose it (the `agility` task retries the fallen obstacle). [v 2026-10-16 conductor2w4 local]

## Individual Shortcuts

| Level | Shortcut | XP | Location |
|-------|----------|----|----------|
| 5 | Crumbling wall | 15 | Taverley-Falador |
| 15 | Monkey bars | 20 | Edgeville Dungeon |
| 20 | Log balance | 8.5 | Coal Trucks to Seers' Village |

## Notes

- Failing an obstacle can cause damage and drop you below the course.
- Higher Agility level reduces failure rate on obstacles.
- Run energy regenerates faster at higher Agility levels.
