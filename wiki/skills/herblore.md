# Herblore

Herblore is used to create potions and poisons. Druidic Ritual is **not** needed in this revision: identifying a herb checks only a members world and the Herblore level (`skill_herblore/scripts/identifying/identify.rs2:59-73`, whose comment says early OSRS had no Druidic Ritual check), and `attempt_brew_potion` (`brewing/brew_potion.rs2:98-147`) has no quest check either; a worker with the quest not started identified a grimy guam and brewed an Attack potion. The quest is still worth its XP reward. [v 2026-10-23 conductor3w5 local]

## Herb Identification

Unidentified herbs are identified through the Herblore skill. Higher levels unlock new herb types.

| Level | Herb | Identify XP |
|-------|------|-------------|
| 3 | Guam leaf | 2.5 |
| 5 | Marrentill | 3.8 |
| 11 | Tarromin | 5 |
| 20 | Harralander | 6.3 |
| 25 | Ranarr weed | 7.5 |
| 30 | Toadflax | 8 |
| 40 | Irit leaf | 8.8 |
| 48 | Avantoe | 10 |
| 54 | Kwuarm | 11.3 |
| 59 | Snapdragon | 11.8 |
| 65 | Cadantine | 12.5 |
| 67 | Lantadyme | 13.1 |
| 70 | Dwarf weed | 13.8 |
| 75 | Torstol | 15 |

Levels and XP from `identified_herb_level` / `identified_herb_exp` (tenths) in `server/content/scripts/skill_herblore/configs/herbs.obj`. [v 2026-10-09 conductor1 local]

## Potion Making

1. Fill a vial with water (buy vials from Taverley herblore shop or make via glassmaking)
2. Add an identified herb to the vial of water → Unfinished potion
3. Add a secondary ingredient → Finished potion

### Finished potions (level / XP)

From `brew_potion_level` / `brew_potion_exp` (tenths) in `configs/brewing/brew_potion.struct`; potion names are inferred from the obj names. Attack 3 / 25, antipoison 5 / 37.5, strength 12 / 50, restore 22 / 62.5, energy 26 / 67.5, defence 30 / 75, agility 34 / 80, prayer restore 38 / 87.5, super attack 45 / 100, super antipoison 48 / 106.3, fishing 50 / 112.5, super energy 52 / 117.5, super strength 55 / 125, weapon poison 60 / 127.5, super restore 63 / 142.5, super defence 66 / 150, anti-dragon (lantadyme + dragon scale dust) 69 / 157.5, ranging 72 / 162.5, magic 76 / 172.5, Zamorak brew (torstol + jangerberries) 78 / 175. Unfinished-potion levels: marrentill 5, tarromin 12, harralander 22, ranarr 30, toadflax 34, irit 45, avantoe 50, kwuarm 55, snapdragon 63, cadantine 66, lantadyme 69, dwarf weed 72, torstol 78. [v 2026-10-09 conductor1 local]

## Supply and route (server data, research 2026-10-16)

- Unfinished potions give 0 XP (the `unf_*` structs have no `brew_potion_exp`); only cleaning and the finished potion pay. Real XP is tenths x 2.5. [server data, unverified in game 2026-10-16]
- No shop sells herbs. Herbs come from the shared random-herb drop table (weights /128: guam 32, marentill 24, tarromin 18, harralander 14, ranarr 11, irit 8, avantoe 6, kwuarm 5, cadantine 4, lantadyme 3, dwarf weed 3; `drop tables/scripts/shared_droptables.rs2:2-31`). Best dropper: chaos druids, ~0.45 herbs per kill (20 HP, 50-tick respawn; 11 spawns in Edgeville Dungeon near (3110, 9936), 6 in Taverley Dungeon (2934, 9849)). Only eye of newt is shop-bought among secondaries (Port Sarim 300 stock, Taverley 800), so attack (guam) and super attack (irit) are the potions you can always finish; vials of water at East Ardougne (500). Averaged over the table that is ~459 XP per herb (clean + those two potions), ~70-100k Herblore XP/h at chaos druids. [model, research 2026-10-16]
- Quest lumps (x25, all implemented): Jungle Potion 19,375 (Druidic Ritual only), Digsite 50,000 (Herblore 10, Agility 10, Thieving 25), Eadgar's Ruse 275,000 (Herblore 31 at start, Death Plateau + Troll Stronghold done, a troll potion), Shades of Mort'ton 8,375 + 50,000 (+50,000 Crafting). ~403k together, ~40% of the 99 total on this server's XP curve. [server data, unverified in game 2026-10-16]

## Secondary Ingredients & Sources

| Ingredient | Source |
|-----------|--------|
| Eyeball | Shops (3 gp), monster drops |
| Mistletoe | Shops (3 gp), monster drops |
| Unicorn horn dust | Ground unicorn horns (pestle & mortar) |
| Chocolate dust | Ground chocolate bars from Cook's Guild |
| Blue dragon scale dust | Taverley Dungeon |
| Wine of Zamorak | Chaos Temples (Falador, Wilderness level 38) |

## Weapon Poison

Can be applied to arrows, daggers, and other pointed weapons. Causes gradual damage to targets until they use an antidote or the poison wears off.

## Notes

- Vials can be bought in Taverley or crafted via glassmaking.
- Herbs are dropped by many monsters and can be farmed.
- Cleaning herbs gives small XP and is required before use in potions.
