# Woodcutting

Woodcutting produces logs from trees, used in Firemaking and Fletching.

## Axes

| Axe | Level | How to Obtain |
|-----|-------|--------------|
| Bronze | 1 | Bob's Axes (16 gp), Bandit Duty Free, Jiminua's Jungle Store, Obli's General Store; ground spawns at Camelot (floor 1), west Karamja and m41_58 |
| Iron | 1 | Bob's Axes, Smithing |
| Steel | 6 | Bob's Axes, Tree Spirit drops, Smithing |
| Black | 6 | Black Demon / KBD drops, player trade |
| Mithril | 21 | Tree Spirit drops, Smithing |
| Adamant | 31 | Tree Spirit drops, Smithing |
| Rune | 41 | Tree Spirit drops, Smithing |

## Trees

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
| Lumbridge trees | (3195, 3220) | 1 | normal trees, cluster west/south of the centre; `woodcutting` task with `area` radius 12; bronze axe, levels 1-48. XP is at the local 25× rate ([local-server](../../learnings/local-server.md)) | ~300k (local, stats.ts; 248k with onFull drop at lower levels) | 2026-10-09 conductor1 local |

## Notes

- Higher-level axes chop faster.
- Trees respawn after being cut down; higher-tier trees take longer to respawn.
- Logs near a bank (Seers, Draynor) are ideal for training since you can bank or burn them quickly.
