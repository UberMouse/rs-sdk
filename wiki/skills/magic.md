# Magic

Magic allows casting combat spells, teleports, enchantments, and utility spells using runes. Effective against rangers, weak to melee fighters.

## Rune Types

### Elemental Runes
| Rune | Replaced By |
|------|------------|
| Air | Staff of air |
| Water | Staff of water |
| Earth | Staff of earth |
| Fire | Staff of fire |

### Catalytic Runes
| Rune | Used For |
|------|---------|
| Mind | Strike spells |
| Body | Curse spells |
| Cosmic | Bolt spells |
| Chaos | Enchantment spells |
| Nature | Conversion spells |
| Death | Blast spells |
| Law | Teleport spells |
| Blood | Required for high level wave spells |
| Soul | Required for high level curse spells |

## Auto-Casting

Equip a staff and select an elemental spell from the combat style menu to auto-cast during combat.

## Jewelry Enchantment

| Item | Level | Effect | Uses |
|------|-------|--------|------|
| Amulet of Damned | 7 | Reflects 10% damage | 40 damage reflected |
| Amulet of Magic | 7 | +10 magic attack | Permanent |
| Ring of Dueling | 27 | Teleport to Duel Arena | 8 |
| Ring of Defence | 27 | +7 defence | Permanent |
| Ring of Forging | 49 | 100% iron smelting success | 140 ores |
| Ring of Strength | 49 | +10 strength | Permanent |
| Ring of Life | 57 | Emergency teleport at <10% HP | 1 |
| Amulet of Glory | 68 | +6 all combat stats | Permanent |

## Magic Guild

- **Location:** Yanille; store at (2595, 3087) level 1 ([shop page](../shops/magic-guild-store.md)).
- **Requirement:** Magic 66 to pass the door (`areas/area_yanille/scripts/magic_guild.rs2:11-13`), no quest.
- **Store stock:** nature 1000, fire 3000, death/law/chaos/blood 1000 each, staves 2 (`areas/area_yanille/configs/magic_guild/magic_guild.inv:15-31`). The only shops with nature runes are this one and Lundail (250, Mage Arena cellar, Wilderness ~55). Prices ramp 1% per unit bought (delta 10, `shop/scripts/shop.rs2:139-146`), so 1,000 nature runes (base 20) cost ~94,750 gp in one visit. [server data, unverified in game 2026-10-16]

## Superheat Item

- Magic 43, 1 nature + 4 fire runes, 1,325 Magic XP per cast at 25x (`skill_magic/configs/magic_spells.dbrow:183-187`). Pays the bar's smelting Smithing XP with no failure roll (iron always succeeds, no Ring of Forging needed) and needs no furnace (`skill_magic/scripts/spells/superheat.rs2`). With 2+ coal held and Smithing 30+, iron ore superheats into steel. A worn Staff of fire replaces the 4 fire runes (`skill_magic/scripts/magic.rs2:53-67`); Zaff (Varrock, 3203,3433) sells it for 1,500 gp. [server data, unverified in game 2026-10-16]

## Notes

- Staffs provide unlimited runes of their element, saving money on common spells.
- Darkened spells in the spellbook mean you lack the level or runes to cast them.

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge chickens, Wind Strike | (3231, 3295), radius 8 | 1-41 | Manual Wind Strike casts (Air + Mind runes, 1 each per cast); 97 casts took Magic 1 -> 41 at 25x XP. Runes from Aubury's (Varrock, see [shops](../../learnings/shops.md)): 110 of each cost 1079 gp. Cast mechanics: [combat](../../learnings/combat.md) | not from stats.ts (1 run: 17.6k Magic in a 10 min mixed Ranged/Magic plan) | 2026-10-11 conductor2 local |
| Edgeville Dungeon hill giants ("Giant"), Wind Blast + Staff of air | see [hazards](../../learnings/hazards.md) | 41-66 | `combat` task, manual Wind Blast, ~4 casts per kill; Magic 41 -> 66 in 641 s; Defence also gained +32k XP. Plan `magic-blast-giants` (main account) | ~673k Magic XP/h while casting (one run) | 2026-10-16 conductor2 local |
