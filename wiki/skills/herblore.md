# Herblore

Herblore is used to create potions and poisons. Requires completion of **Druidic Ritual** quest to begin training.

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

From `brew_potion_level` / `brew_potion_exp` (tenths) in `configs/brewing/brew_potion.struct`; potion names are inferred from the obj names. Attack 3 / 25, antipoison 5 / 37.5, strength 12 / 50, restore 22 / 62.5, energy 26 / 67.5, defence 30 / 75, agility 34 / 80, prayer restore 38 / 87.5, super attack 45 / 100, super antipoison 48 / 106.3, fishing 50 / 112.5, super energy 52 / 117.5, super strength 55 / 125, weapon poison 60 / 127.5, super restore 63 / 142.5, super defence 66 / 150, antifire 69 / 157.5, ranging 72 / 162.5, magic 76 / 172.5, Zamorak brew 78 / 175. Unfinished-potion levels: marrentill 5, tarromin 12, harralander 22, ranarr 30, toadflax 34, irit 45, avantoe 50, kwuarm 55, snapdragon 63, cadantine 66, lantadyme 69, dwarf weed 72, torstol 78. [v 2026-10-09 conductor1 local]

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
