# Smithing

Smithing converts ores into bars (smelting) and bars into weapons and armour (forging).

## Smelting

Use ores on a furnace to create bars.

| Bar | Ores Required | Level | Notes |
|-----|--------------|-------|-------|
| Bronze | 1 Tin + 1 Copper | 1 | |
| Iron | 1 Iron ore | 15 | 50% success rate (Ring of Forging = 100%) |
| Silver | 1 Silver ore | 20 | Used for Crafting, not Smithing items |
| Steel | 1 Iron ore + 2 Coal | 30 | |
| Gold | 1 Gold ore | 40 | Used for Crafting, not Smithing items |
| Mithril | 1 Mithril ore + 4 Coal | 50 | |
| Adamant | 1 Adamantite ore + 6 Coal | 70 | |
| Runite | 1 Runite ore + 8 Coal | 85 | |

## Forging

Use bars on an anvil with a hammer in your inventory.

| Item | Bronze | Iron | Steel | Mithril | Adamant | Rune |
|------|--------|------|-------|---------|---------|------|
| Dagger | 1 | 15 | 30 | 50 | 70 | 85 |
| Axe | 1 | 16 | 31 | 51 | 71 | 86 |
| Mace | 2 | 17 | 32 | 52 | 72 | 87 |
| Med helm | 3 | 18 | 33 | 53 | 73 | 88 |
| Sword | 4 | 19 | 34 | 54 | 74 | 89 |
| Scimitar | 5 | 20 | 35 | 55 | 75 | 90 |
| Longsword | 6 | 21 | 36 | 56 | 76 | 91 |
| Full helm | 7 | 22 | 37 | 57 | 77 | 92 |
| Square shield | 8 | 23 | 38 | 58 | 78 | 93 |
| Warhammer | 9 | 24 | 39 | 59 | 79 | 94 |
| Battleaxe | 10 | 25 | 40 | 60 | 80 | 95 |
| Chainbody | 11 | 26 | 41 | 61 | 81 | 96 |
| Kite shield | 12 | 27 | 42 | 62 | 82 | 97 |
| 2h sword | 14 | 29 | 44 | 64 | 84 | 99 |
| Plateskirt | 16 | 31 | 46 | 66 | 86 | 99 |
| Platelegs | 16 | 31 | 46 | 66 | 86 | 99 |
| Platebody | 18 | 33 | 48 | 68 | 88 | 99 |

### Bars Per Item

- 1 bar: dagger, axe, mace, med helm, sword (also knife, dart tips, arrowheads, nails)
- 2 bars: scimitar, longsword, full helm, square shield
- 3 bars: warhammer, battleaxe, chainbody, kite shield, 2h sword, plateskirt, platelegs
- 5 bars: platebody

Smelt XP per bar (`productexp` in tenths): bronze 6.2, iron 12.5, silver 13.7, steel 17.5, gold 22.5, mithril 30, adamant 37.5, runite 50.

Smelting levels checked against `server/content/scripts/skill_smithing/configs/smelting/smelting.struct`; forging levels and bar counts against `configs/smithing/smithing.dbrow` (all 6 metals x all 17 items match the table; fixed the bar counts). Iron 50% success confirmed in `scripts/smelting/smelting.rs2`. [v 2026-10-09 conductor1 local]

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| SE Varrock iron -> Lumbridge furnace (3225, 3256) -> Varrock West anvil (3188, 3421) -> Varrock West bank | (3225, 3256) | 15 | 23 iron ore (~63 s with adamant pickaxe) smelt to ~14 bars (50% failures), +4,375 xp (Smithing 22 -> 31); 12 iron bars -> 4 kiteshields (3 bars each), +7,500 xp | not measured | 2026-10-11 conductor2 local |

XP per action on this server (25x): iron smelt 312 xp per bar made (~190 per ore after failures); bronze scimitar 312 xp per bar (625 per scimitar, 2 bars); iron kiteshield 625 xp per bar (1,875 each, 3 bars). Bronze run: 4 scimitars = 2,500 xp. [v 2026-10-11 conductor2 local]

## Special Items

Some items require quest completion:
- Dart tips: requires The Tourist Trap
- Claws: requires Death Plateau

## Notes

- A hammer is required for forging (buy from general stores).
- Gold and silver bars are for Crafting (jewelry, holy symbols), not Smithing.
