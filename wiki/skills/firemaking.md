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
| Open ground E of Lumbridge, south of the fields above | x 3250..3256, z 3254..3255 | 1 (tested) | every tile walkable (`walkTo`), no loc on it; fires lit from random tiles here (`burn.itest.ts`). Around it: dead trees at (3249,3253), (3248,3251), a fern at (3254,3253), a food trough at (3257,3256) | not measured | 2026-10-10 integration-tests local |
| Varrock oaks, line burn | (3190, 3458), radius 6 | 15-53 (tested) | oak logs, 26 burned in one line run (FM 15->53, 39000 XP in 110 s) | not measured | 2026-10-10 conductor2w4 local |
| Open ground NE of Lumbridge, line burn | (3256, 3260), radius 6 | 1-33 (tested) | 10 logs, 10000 XP in 46 s | not measured | 2026-10-10 conductor2w4 local |
| Draynor, line burn (willow logs) | (3088, 3247), radius 6; [Draynor willows](../places/draynor-willows.md) | 58-78 (tested) | 22 willow logs in ~55 s in two lines: z 3247 (x 3094->3082) and z 3248 (x 3093->3083); ~2.4 s per light for the first 12-13; level-up dialogs cost a tick each (1-4 per phase). Combined chop-burn cycle ~3 min, FM 58->75 in 601 s (~768k/h incl. chopping) | ~768k (chop+burn cycle, RESULT of a 601 s run) | 2026-10-11 conductor2 local |

- Buy the Tinderbox at the Lumbridge General Store first (1 gp, see `learnings/shops.md`).
- A refused light shows the game message "You can't light a fire here." (raw `sendUseItemOnItem` tinderbox-on-logs, read from `gameMessages`); the `firemaking` task's burn op surfaces that message as its failure, while the SDK method `bot.burnLogs` returns only its own generic "Failed to light fire (possibly bad location)" (`sdk/actions.ts`). Seen repeatedly at the exact tile (3230, 3240) within a few minutes of earlier runs, where a sidestep could not leave the tile (neighbour "destination tile is blocked"), while a different tile in the same field lit at once, so a recently-fired tile is the likely cause. Unconfirmed: how long a tile stays refused, and any other causes. The `firemaking` task picks a clear east-west line of lightable tiles and marks refused tiles bad (it does not sidestep). [v 2026-10-09 integration-tests local] [v 2026-10-10 task-review local]
- Varrock oaks area, centre (3190, 3458) radius 6: a narrow cobble path between walls (around x 3187-3190, z 3458-3462). It fits only a handful of fires: 8 oak logs burned (Firemaking 15->38, 1500 XP per oak log at local 25x), then "burn: 5 lights in a row failed (last: You can't light a fire here.)" once the westward fire line ran out of lightable tiles and the sidestep tile (3187, 3462) was blocked. A 2-log run with normal logs there finished with no refused lights (Firemaking 1->15). A full inventory of logs does not fit here. [v 2026-10-10 conductor2 local]
- Lumbridge field east of the General Store, oak logs, area (3230, 3240) r6: 9 lights then refused beside a building at (3229..3229, 3239..3241) (Firemaking 38->47). [v 2026-10-10 conductor2 local]
