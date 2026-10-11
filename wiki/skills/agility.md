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
- Getting here: Varrock East bank (3254, 3420) -> (2474, 3436) is one `travel` with no waypoints (tolerance 3), ~250 s, and it passes the Stronghold gate itself (see learnings/walking.md). The `agility` task needs the bot within 40 tiles of (2474, 3436). [v 2026-10-11 conductor2 local]
- A `--until` stop can end the `agility` task mid-lap on a raised plane (final level 2 at (2483, 3420) on 2026-10-11); the next run's travel/lap start should expect that. [v 2026-10-11 conductor2 local]

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Gnome Stronghold course | (2480, 3428) | 1 | `agility` task `{course:"gnome"}`, no failure; 13,975 XP in 225 s of laps (Agility 1 to 38, 49 obstacle steps). Laps alone ~224k/h at levels 1-38; ~106k/h for the whole plan incl. the 250 s trip from Varrock East (stats.ts) | 224k (laps only, local) | 2026-10-11 conductor2 local |

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

**Location:** Barbarian Outpost, north past Baxtorian Falls
**Prerequisite:** Alfred Grimhand's Barcrawl mini-quest

| Obstacle | XP | Failable |
|----------|-----|---------|
| Pipe | 10 | No |
| Rope swing | 20 | Yes |
| Log balance | 12.5 | Yes |
| Net climb | 7.5 | No |
| Ledge | 20 | Yes |
| Crumbling walls | 12.5 | No |
| **Lap bonus** | **139.5** | Yes |
| **Total per lap** | **222** | |

### Wilderness Course (Level 52+)

**Location:** Deep wilderness (level 52+), PvP risk
**Best XP/hr but dangerous**

| Obstacle | XP | Failable |
|----------|-----|---------|
| Ridge | 15 | Yes |
| Pipe | 12.5 | No |
| Rope swing | 20 | Yes |
| Stepping stones | 20 | Yes |
| Log balance | 20 | Yes |
| Rocks | 0 | No |
| **Lap bonus** | **571.5** | Yes |
| **Total per lap** | **659** | |

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
