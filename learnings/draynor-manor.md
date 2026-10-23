# Draynor Manor

## DANGER: One-Way Front Door

The front door of Draynor Manor **cannot be opened from inside**. The quest script (`quest_haunted.rs2`) checks `if(coordz(coord) > coordz(loc_coord))` — only players on the north (outside) side can open it.

**If the pathfinder routes you through the front door, you will be trapped inside.**

### How to Escape (If Trapped)

The manor has internal doors that connect rooms. Two key doors form an escape path through the east wing:

1. **Door at (3119, 3356) id:1530** — connects the SE room to the warehouse area
2. **Door at (3123, 3360) id:136** — connects warehouse to the courtyard

The SDK pathfinder can't open these doors automatically because `sendInteractLoc` relies on server-side pathfinding, which blocks on closed doors. Use raw `sendWalk` to get adjacent, then interact:

```typescript
// Step 1: Raw-walk to a tile adjacent to the door
sdk.sendWalk(doorX, doorZ - 1); // south side
await sdk.waitForTicks(2);

// Step 2: Interact to open
sdk.sendInteractLoc(doorX, doorZ, doorId, 1);
await sdk.waitForTicks(3);

// Step 3: Walk through
sdk.sendWalk(doorX, doorZ + 1); // north side
await sdk.waitForTicks(2);
```

### Avoidance

Avoid routing through Draynor Manor entirely. If you need to pass through the area, use coordinates that stay well clear of the manor grounds (x < 3090 or x > 3130).

## Draynor Manor Underground

- **Stairs down** at (3115, 3357) → crypt at (3077, 9771)
- Crypt is a separate area from the puzzle basement — no walking connection between them
- **Magic door** exit at (2874, 9750) leads to the Wilderness — avoid unless you know what you're doing

## Key Coordinates

| Location | Coordinates | Notes |
|----------|-------------|-------|
| Front door (one-way) | (3108, 3353) | DO NOT ENTER |
| East wing doors | (3119, 3356), (3123, 3360) | Escape route |
| Crypt stairs | (3115, 3357) | Goes to (3077, 9771) |
| Courtyard | (3125, 3370) | North of east wing |

## Lever basement (Ernest the Chicken, oil can)

Entered by the ladder at (3092, 3362) in the west garden -> (3116, 9754); the ladder up is (3117, 9754). It resets every lever. Levers are wall decorations pulled from their own tile (a pull leaves the bot there): A (3108, 9745), B (3118, 9752), C (3112, 9760), D (3108, 9767), E (3097, 9767), F (3096, 9765). Lever bits are server-only: the client cannot see them. [v 2026-10-23 questw1 local]

Doors are named by the two rooms they join; crossing lands on the exact far tile. Door tiles: 4-7 (3108, 9758), 4-5 (3105, 9760), 5-8 (3102, 9758), 5-6 (3100, 9760), 3-6 (3097, 9763), 2-3 (3100, 9765), 1-2 (3105, 9765), 2-5 (3102, 9763), 8-9 (3100, 9755; the oil can room). The walker cannot open 8-9 from inside. [v 2026-10-23 questw1 local]

Solution (from the `quest_haunted.rs2` conditions, run end to end): pull A, B, D; door 4-5; 5-8; pull A, B; doors 5-8, 5-6, 3-6; pull E, F; doors 2-3, 1-2; pull C; doors 1-2, 2-3; pull E; doors 2-3, 2-5, 5-8, 8-9. Oil can at (3092, 9755). [v 2026-10-23 questw1 local]

Quest walkthrough and item tiles: `wiki/quests/ernest-the-chicken.md`.
