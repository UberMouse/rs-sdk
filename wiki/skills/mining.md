# Mining

Mining is used to extract ores and metals from rocks. Requires a pickaxe (available from Bob's Axes or the Dwarven Mine shop).

## Pickaxes

| Pickaxe | Level | Shop Price |
|---------|-------|-----------|
| Bronze | 1 | 1 gp (free spawns at Barbarian Village, Lumbridge 3F) |
| Iron | 1 | 137 gp |
| Steel | 6 | 500 gp |
| Mithril | 21 | 1,300 gp |
| Adamant | 31 | 3,200 gp |
| Rune | 41 | 32,000 gp |

## Ores

| Level | Ore | XP | Notable Locations |
|-------|-----|----|-------------------|
| 1 | Rune essence | 5 | Varrock, Yanille rune essence mines |
| 1 | Clay | 5 | |
| 1 | Tin | 17.5 | SW Varrock, SE Varrock, Rimmington |
| 1 | Copper | 17.5 | SW Varrock, SE Varrock, Rimmington |
| 10 | Blurite | 17.5 | |
| 10 | Limestone | 26.5 | |
| 15 | Iron | 35 | Asgarnian Ice Dungeon, Al Kharid |
| 20 | Silver | 40 | SE Varrock, Fight Arena, Al Kharid |
| 30 | Coal | 50 | Al Kharid, SW Varrock, Crafting Guild |
| 40 | Gold | 65 | Dwarven Mine, Coal Trucks, Barbarian Village, Mining Guild |
| 40 | Gems | 65 | Shilo Village (requires Shilo Village quest) |
| 55 | Mithril | 80 | North Brimhaven, Crafting Guild |
| 70 | Adamantite | 95 | Al Kharid, Fight Arena, West Lumbridge Swamp, Mining Guild |
| 85 | Runite | 125 | Al Kharid, West Lumbridge Swamp, Grand Tree, Desert Mining Camp |

Levels and XP (`rock_level`, `rock_exp` in tenths) from `server/content/scripts/skill_mining/configs/mine.dbrow`; pickaxe levels from `pickaxes.obj` (`levelrequire`, iron is 0 = no requirement). Locations column is unverified. [v 2026-10-09 conductor1 local]

## Mining Guild

- **Location:** Falador (inside Dwarven Mines)
- **Requirement:** 60 Mining
- **Features:** Coal and mithril rocks, access to main Dwarven Mines

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| SE Varrock mine, copper | (3285, 3365) | 1-31 | bronze pickaxe (Bob's, 1 gp), drop ores; radius 10 | ~164k (local) | 2026-10-09 conductor1 local |
| SE Varrock mine, copper+tin | (3285, 3365) | 31-44 | bronze pickaxe, drop ores, ~10 ores/min | ~267k (local) | 2026-10-09 conductor1 local |

Copper, tin and iron rocks all lie within 1-4 tiles of the centre; no attackers. See `learnings/mining.md` for identifying rocks.

## Tips

- You can prospect rocks (right-click) to see what ore they contain.
- Higher-level pickaxes mine faster, even if you could use a lower-level one.
