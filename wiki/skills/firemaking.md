# Firemaking

Firemaking allows lighting logs on the ground to create campfires, which can be used for cooking.

## How to Light Fires

1. Use a tinderbox on logs in your inventory, OR
2. Drop logs on the ground, right-click and select "Light logs"

Success depends on Firemaking level. Tinderboxes are sold at General Stores.

## Log Types

| Log | Level | XP |
|-----|-------|----|
| Normal logs | 1 | 40 |
| Oak logs | 1 | 40 |
| Willow logs | 15 | 60 |
| Teak logs | 30 | 90 |
| Maple logs | 45 | 135 |
| Yew logs | 60 | 202.5 |
| Magic logs | 75 | 303.8 |

## Notes

- Fires are useful for cooking food when no range is nearby.
- Ranges have lower burn rates than campfires for cooking.
- Fires eventually burn out and disappear.
- You cannot light a fire on a tile that already has one, or in certain locations (banks, buildings).

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Field east of Lumbridge General Store | (3230, 3240), radius 6 | 1-45 (tested) | normal logs, 1000 XP/log at local 25x; ~14-15 logs/min; no rats seen | ~847k (local, `stats.ts` over 2 short runs) | 2026-10-09 conductor1 local |

- Buy the Tinderbox at the Lumbridge General Store first (1 gp, see `learnings/shops.md`).
- Some lights are refused and some sidestep tiles are blocked; the `firemaking` task sidesteps and retries. `bot.burnLogs` returns only its own generic "Failed to light fire (possibly bad location)" (`sdk/actions.ts`), not the game's message, so the cause of a refusal is not established. [v 2026-10-09 conductor1 local]
