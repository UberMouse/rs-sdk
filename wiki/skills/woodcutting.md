# Woodcutting

Woodcutting produces logs from trees, used in Firemaking and Fletching.

## Axes

| Axe | Level | How to Obtain |
|-----|-------|--------------|
| Bronze | 1 | Bob's Axes (16 gp), Bandit Duty Free, Jiminua's Jungle Store, Obli's General Store; ground spawns at Camelot (floor 1), west Karamja and m41_58 |
| Iron | 1 | Bob's Axes, Smithing |
| Steel | 6 | Bob's Axes, Tree Spirit drops, Smithing |
| Black | 11 | Black Demon / KBD drops, player trade |
| Mithril | 21 | Tree Spirit drops, Smithing |
| Adamant | 31 | Tree Spirit drops, Smithing |
| Rune | 41 | Tree Spirit drops, Smithing |

## Trees

Levels checked against `server/content/scripts/skill_woodcutting/configs/trees.dbrow` and `axes/axes.obj` (axe levels: bronze/iron 1, steel 6, black 11, mithril 21, adamant 31, rune 41). [v 2026-10-09 conductor1 local]

| Tree | Level | Log Type | Locations |
|------|-------|----------|-----------|
| Normal | 1 | Logs | Lumbridge, Draynor, south of Seers, Feldip Hills |
| Oak | 15 | Oak logs | East of Draynor bank, south of Seers bank |
| Willow | 30 | Willow logs | SW of Draynor bank, NW of Seers bank |
| Maple | 45 | Maple logs | North and south of Seers bank |
| Yew | 60 | Yew logs | Cemetery south of Seers, south of Edgeville bank |
| Magic | 75 | Magic logs | South of Sorcerer's Tower, Gnome Stronghold |

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge trees | (3195, 3220) | 1 | normal trees, cluster west/south of the centre; `woodcutting` task with `area` radius 12; bronze axe, levels 1-67 (task waits for respawns once the cluster is cut down). XP is at the local 25× rate ([local-server](../../learnings/local-server.md)) | ~310k (local, stats.ts, 12 runs; 248k with onFull drop at lower levels) | 2026-10-10 conductor2 local (rev 289) |

## Notes

- Higher-level axes chop faster.
- Trees respawn after being cut down; higher-tier trees take longer to respawn.
- Normal trees (no `respawnrate` in `trees.dbrow`) fall on every successful chop and respawn after 120 + random(80) game ticks (48-80 s at 400 ms/tick), scaled down slightly by player count (`server/content/scripts/skill_woodcutting/scripts/woodcut.rs2`, `general/scripts/player_count.rs2`). Other trees deplete with 1/8 chance per log.
- Lumbridge trees capacity: at ~50+ WC (bronze axe, 25x XP) a bot cuts every normal tree within radius 12 of (3195, 3220) to a stump (stumps are not choppable). Respawns (48-80 s) keep a bot that waits for them at about the same XP/hr (~289k, WC 51-58 over 5 min); a bot that does not wait fails with "chop: no reachable tree nearby". [v 2026-10-09 conductor1 local]
- Lumbridge trees at WC 62-63 (bronze axe): ~10 logs/min over a 1 min run (6250 XP), so a 28-slot inventory fills in ~3 min. [v 2026-10-09 conductor1 local]
- Lumbridge trees at WC 65-67 (bronze axe): ~12 chops/min over 3 min (5000 XP/min), with several respawn waits; the 28-slot inventory fills in ~2.3 min. [v 2026-10-09 conductor1 local]
- Normal trees north of Lumbridge castle at (3212, 3232), (3217, 3231), (3225, 3232) and (3235, 3230), outside the Lumbridge trees grove; the `chop` op's integration test fells one per run there (WC 60, bronze axe, spawned at (3220, 3228)). [v 2026-10-10 integration-tests local]
- Logs near a bank (Seers, Draynor) are ideal for training since you can bank or burn them quickly.
