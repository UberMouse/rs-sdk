# Strength

The Strength skill determines your maximum hit in melee combat. Higher strength means more damage per hit.

## Training

Use the **Aggressive** fighting style to gain Strength XP. Grants 4 XP per damage dealt.

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge chickens | (3231, 3295), radius 8 | 1-21 | `combat` task, Aggressive style; Bronze sword + Wooden shield; ~6 kills/min; no food needed, HP stayed full at combat 3-10. Also trains Hitpoints (~1/3 of the melee XP) and Prayer (~1/3, from burying bones); feathers drop. 25× local rate ([local-server](../../learnings/local-server.md)) | ~45k Strength (levels 1-13, one 2 min run, not stats.ts) | 2026-10-10 conductor2 local (rev 289; Strength 1->15 in 87 s, Lunge/Aggressive, no food, 7 bones buried: Prayer 5->11, HP 14->17) |
| Lumbridge cows | (3253, 3290) | 25-40 | `combat` task, Aggressive style; Steel scimitar (400 gp at Zeke's, Al Kharid) + Iron kiteshield, Trout as food; pen described in [combat](../../learnings/combat.md#cow-field-details-proven-from-200-kills), area [lumbridge](../places/lumbridge.md). Also gives Hitpoints (+3,708 in this run). `plan-melee40` phase, 202 s: Strength 25->40 (+11,300) | ~201k Strength (local, one run); with the post-kill idle fixed 329k (Steel, 22 ticks/kill, 10 min run) | 2026-10-16 conductor2w3 local |
| Edgeville Dungeon hill giants | (3100-3114, 9827-9840), 12 spawns; access [walking](../../learnings/walking.md#stairs-and-ladders-walkto-between-levels), danger [hazards](../../learnings/hazards.md) | 44-77 | `combat` task, Aggressive; ~51 ticks/kill with Mithril scimitar (1,040 gp, [shops](../../learnings/shops.md)), 83% of ticks swinging, 8 cooked fish per 10 min. Also HP (+34,027 per 10 min) and Prayer if bones are buried. Steel scimitar: 429k/h, ~73 ticks/kill, 15 fish | ~619k Strength (Mithril, one 10 min run; Steel 429k) | 2026-10-16 conductor2w3 local |

Same spot trains Attack (1 min run: 300 XP, ~18k/hr, levels 1-4), see [attack](attack.md#verified-training-spots).

## Temporary Boosts

| Source | Effect |
|--------|--------|
| Strength potion | Temporary strength level increase |
| Burst of Strength (Prayer 4) | +5% strength |
| Superhuman Strength (Prayer 13) | +10% strength |
| Ultimate Strength (Prayer 31) | +15% strength |
| Dragon battleaxe special | Large temporary boost, reduces other combat stats |

## Notes

- Strength affects max hit, not accuracy (that's Attack).
- See the Items Database for weapon strength bonuses.
