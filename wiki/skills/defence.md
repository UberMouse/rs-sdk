# Defence

The Defence skill reduces how often enemies hit you. Higher defence also unlocks stronger armour.

## Training

Use the **Defensive** fighting style to gain Defence XP. Grants 4 XP per damage dealt.

## Armour Types

### Melee Armour

| Type | Properties |
|------|-----------|
| Full helm | Superior protection, hinders magic and ranged |
| Medium helm | Less protection, fewer penalties |
| Chainmail | Good vs slash/crush, weak vs stab. Allows ranged use |
| Platebody | Strongest melee defence, weak vs crush. Restricts ranged/magic |
| Kite shield | Excellent slash defence, weak vs stab |
| Square shield | Excellent slash defence, weak vs crush |
| Anti-dragonfire shield | Reduces dragonfire damage |

### Ranger Armour

| Type | Properties |
|------|-----------|
| Leather | Basic protection, good flexibility for ranged |
| Studded leather | Improved leather, still allows ranged |
| Dragonhide | Strongest ranged armour, good magic defence, hinders magic casting |

### Mage Armour

| Type | Properties |
|------|-----------|
| Mage robes | No melee/ranged defence, boosts magic attack and magic defence |

## Armour Level Requirements

| Level | Metal / Type |
|-------|-------------|
| 1     | Bronze, Leather |
| 5     | Iron |
| 10    | Steel, Studded leather |
| 20    | Black/White, Green d'hide (requires 40 Ranged) |
| 30    | Mithril |
| 40    | Adamant, Blue d'hide (requires 50 Ranged), Mystic robes |
| 50    | Rune |
| 60    | Dragon (some items require quests), Red d'hide (requires 60 Ranged) |
| 70    | Black d'hide (requires 70 Ranged) |

### Prayer Armour

These items boost prayer duration: Priest robes, Monk robes, Shade robes, Druid robes, Zamorak robes.

## Special Requirements

- Dragon Slayer quest required for some Dragon equipment.

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge chickens | (3231, 3295), radius 8 | 1-21 | `combat` task, `skill: "Defence"` (Defensive style); setup and gotchas in [strength](strength.md#verified-training-spots); ~11 kills/min; no food needed. Also gives Hitpoints and Prayer | ~69k Defence (stats.ts, 1 run of 3 min) | 2026-10-10 conductor2 local |
| Lumbridge cows | (3253, 3290) | 15-40 | `combat` task, `skill: "Defence"`; Steel scimitar (400 gp at Zeke's, Al Kharid) + Iron kiteshield, Trout as food; pen described in [combat](../../learnings/combat.md#cow-field-details-proven-from-200-kills), area [lumbridge](../places/lumbridge.md). Also gives Hitpoints (+4,555 in this run). `plan-melee40` phase, 246 s: Defence 15->40 (+13,900) | ~203k Defence (local, one run) | 2026-10-11 conductor2 local |
| Falador farm cows | (3027, 3307), radius 22 | 20-40 | `combat` with `skill: "Defence"`, `targetRange: "visible"`, Mithril scimitar + Wooden shield, no food; plan `melee40` (same run as [attack](attack.md#verified-training-spots)): Defence 20->40 (+12,900) in 115.2 s of fighting | ~403k Defence (local, one run) | 2026-10-24 conductor3 local |
