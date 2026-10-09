# Firemaking

Firemaking allows lighting logs on the ground to create campfires, which can be used for cooking.

## How to Light Fires

1. Use a tinderbox on logs in your inventory, OR
2. Drop logs on the ground, right-click and select "Light logs"

Success depends on Firemaking level. Tinderboxes are sold at General Stores.

## Log Types

| Log | Level | XP (base) |
|-----|-------|----|
| Normal logs | 1 | 40 |
| Oak logs | 15 | 60 |
| Willow logs | 30 | 90 |
| Maple logs | 45 | 135 |
| Yew logs | 60 | 202.5 |
| Magic logs | 75 | 303.8 |

Source: `server/content/scripts/skill_firemaking/configs/firemaking.obj` (`levelrequire`, `productexp` in tenths of XP); base XP before the local 25x rate (normal logs gave 1000 XP on local = 40 x 25). There is no teak in this engine. [v 2026-10-09 conductor1 local]

## Notes

- Fires are useful for cooking food when no range is nearby.
- Ranges have lower burn rates than campfires for cooking.
- Fires eventually burn out and disappear.
- You cannot light a fire on a tile that already has one, or in certain locations (banks, buildings).

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Field east of Lumbridge General Store | (3230, 3240), radius 6 | 1-45 (tested) | normal logs, 1000 XP/log at local 25x; ~14-15 logs/min; no rats seen | ~847k (local, `stats.ts` over 2 short runs) | 2026-10-09 conductor1 local |
| Open ground NE of Lumbridge, west | x 3248..3252, z 3258..3262 | 1 (tested) | every tile walkable (`walkTo`); fires lit at (3248,3260) and (3252,3260), one light each | not measured | 2026-10-10 integration-tests local |
| Open ground NE of Lumbridge, east | x 3254..3258, z 3258..3262 | not tried | every tile walkable (`walkTo`); no fire lit here yet | not measured | 2026-10-10 integration-tests local |

- Buy the Tinderbox at the Lumbridge General Store first (1 gp, see `learnings/shops.md`).
- A refused light shows the game message "You can't light a fire here." (raw `sendUseItemOnItem` tinderbox-on-logs, read from `gameMessages`); `bot.burnLogs` returns only its own generic "Failed to light fire (possibly bad location)" (`sdk/actions.ts`), not that message. Seen repeatedly at the exact tile (3230, 3240) within a few minutes of earlier runs, where a sidestep could not leave the tile (neighbour "destination tile is blocked"), while a different tile in the same field lit at once, so a recently-fired tile is the likely cause. Unconfirmed: how long a tile stays refused, and any other causes. The `firemaking` task sidesteps and retries. [v 2026-10-09 integration-tests local]
