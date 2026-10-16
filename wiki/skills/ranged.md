# Ranged

Ranged allows attacking from a distance with bows, crossbows, throwing knives, and other projectiles. Rangers are effective against mages but weak to melee.

## Training

Ranged XP is gained by dealing damage with ranged weapons. Requires line of sight to target.

## Bows

| Bow | Ranged Level | Max Arrow |
|-----|-------------|-----------|
| Shortbow | 1 | Iron |
| Longbow | 1 | Iron |
| Oak shortbow | 5 | Steel |
| Oak longbow | 5 | Steel |
| Willow shortbow | 20 | Mithril |
| Willow longbow | 20 | Mithril |
| Maple shortbow | 30 | Adamant |
| Maple longbow | 30 | Adamant |
| Yew shortbow | 40 | Rune |
| Yew longbow | 40 | Rune |
| Magic shortbow | 50 | Rune |
| Magic longbow | 50 | Rune |

## Armour

| Armour | Ranged Level | Defence Level |
|--------|-------------|--------------|
| Leather | 1 | 10 |
| Studded leather | 1 | 20 |
| Green d'hide | 40 | 40 |
| Blue d'hide | 50 | 40 |
| Red d'hide | 60 | 40 |
| Black d'hide | 70 | 40 |

## Ranging Guild

- **Location:** next to Hemenster; see [wiki/places/ranging-guild.md](../places/ranging-guild.md) [map data 2026-10-11]
- **Requirement:** 40 Ranged
- **Features:** Target practice, weapon shop

## Notes

- Arrows sometimes land near the target and can be picked up; others are lost on impact.
- Monsters attacked by ranged will try to close to melee range.

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge chickens | (3231, 3295), radius 8 | 1-40 | Shortbow + Bronze arrows wielded; arrows dropped by misses are picked up again. Ranged 1 -> 13 in 8 min, 13 -> 40 in ~10 min (also gave Hitpoints 24 -> 36). Setup: [combat](../../learnings/combat.md) | not from stats.ts (1 run: 14.4k Ranged in 10 min) | 2026-10-11 conductor2 local |

## Speeds, ammo and XP (server data)

- 100 Ranged XP per damage at 25x (plus ~33 Hitpoints XP); damage is capped at the target's remaining HP (`player_ranged.rs2:52-53`), so high-HP targets pay best. [server data, unverified in game 2026-10-16]
- Attack speed: shortbow 4 ticks (3 on rapid), longbow and crossbow 6 (5), darts and knives 3 (2), thrown axes 5 (4), javelins 6 (5) (`player_ranged.rs2:15-24`). Rapid beats accurate in every modelled case. The ranged bonus comes from the ammo (arrows bronze 7 ... mithril 22, adamant 31, rune 49), and ammo needs a bow of at least its tier: mithril needs willow, adamant maple, rune yew (`player_ranged.rs2:97`). [server data, unverified in game 2026-10-16]
- 20% of shots delete the ammo; the rest land under the target for 200 ticks (`combat.constant:4`, `player_ranged.rs2:128-134`). Dargaud (Ranging Guild, Ranged 40) sells bows up to willow, arrows and tips; prices ramp 1% per unit bought. No shop sells yew or magic bows (fletch them) or throwing knives. The `combat` task supports bow + arrows only. [server data, unverified in game 2026-10-16]

