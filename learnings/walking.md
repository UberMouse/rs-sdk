# Walking & Navigation

Successful patterns for movement and pathfinding.

## Basic Walking

`bot.walkTo()` performs pathfinding for both short and long routes:

```typescript
const result = await bot.walkTo(3222, 3218);  // Walk to Lumbridge
if (!result.success) console.warn(result.reason, result.message);
```

## A target in view can be unreachable from where you stand

`reachable` on a loc or NPC is judged from the player's current tile, so the same target flips as you move. A Range open on one side only reads `false` from the other: the Lumbridge Range at (3230,3196) is reachable from its east (x 3231) and from (3230,3195) but not from the west tiles (3229,3195..3197), though the west tile is adjacent. `walkTo(x, z, tolerance)` aimed at such a loc does not help: the pathfinder stops next to it on the near side. Instead stand on tiles around the loc, one at a time, and re-read `reachable` after each (the cooking task's `approach`). [v 2026-10-11 conductor2w3 local]

## Long Distance Walking

`walkTo()` supports long routes. Use waypoints when you intentionally need a
safer route, want progress checkpoints, or need to avoid a dangerous area:

```typescript
const WAYPOINTS_TO_BANK = [
    { x: 3270, z: 3380 },  // Step 1
    { x: 3250, z: 3395 },  // Step 2
    { x: 3230, z: 3410 },  // Step 3
    { x: 3210, z: 3425 },  // Step 4
    { x: 3185, z: 3436 },  // Final destination
];

async function walkWaypoints(waypoints) {
    for (const wp of waypoints) {
        // Try up to 3 times per waypoint
        for (let attempt = 0; attempt < 3; attempt++) {
            await bot.walkTo(wp.x, wp.z);
            await new Promise(r => setTimeout(r, 500));

            const player = sdk.getState()?.player;
            const dist = Math.sqrt(
                Math.pow(player.worldX - wp.x, 2) +
                Math.pow(player.worldZ - wp.z, 2)
            );

            if (dist <= 5) break;  // Close enough
        }
    }
}
```

## Verifying Arrival

Always check if you actually arrived:

```typescript
const result = await bot.walkTo(targetX, targetZ);

const player = sdk.getState()?.player;
const dist = Math.sqrt(
    Math.pow(player.worldX - targetX, 2) +
    Math.pow(player.worldZ - targetZ, 2)
);

if (dist > 5) {
    console.warn(`Walk failed: still ${dist.toFixed(0)} tiles away`);
}
```

## Known Routes

### Lumbridge to Varrock West Bank

- From (3235, 3220) to Varrock West bank (3185, 3436) the conductor `walkTo` op arrives in one walk
  of 133 ticks with 38 sends, opening no door on the way. [v 2026-10-10 integration-tests local]

### Lumbridge cooking pot to Varrock East bank

- Pot (3232, 3238) -> Varrock East bank (3254, 3420) walked cleanly on every trip of the lure-cook-bank plan (3 trips per run), no hazards met. [v 2026-10-11 conductor2 local]

### Varrock East bank to the Gnome Stronghold course

- Varrock East bank (3254, 3420) -> course start (2474, 3436): `travel` to {x:2474, z:3436}, tolerance 3, no waypoints. 250 s; the task's `gnome-gate` step opens the Stronghold gate itself (a few dialogs, suspended by the dialog guard). Arrived (2473, 3436) with HP 19/23 at combat 25; no food eaten, no combat logged, the travel log records no damage event. White-wolf trouble is not confirmed or ruled out by one trip (HP was 19/23 on arrival, cause not logged). [v 2026-10-11 conductor2 local]

### Smithing loop legs (avoid the Varrock stone circle)

- Mine -> Lumbridge furnace (3225, 3256) is not a travel leg: the smithing task's `smelt` phase walks it itself (area at the furnace).
- Furnace -> Varrock West anvil: travel to (3188, 3425), tolerance 3, via (3200, 3300), (3180, 3350).
- Varrock West bank -> SE Varrock mine: travel to (3286, 3368), tolerance 4, via (3260, 3400); ~44 s.
- Falador furnace -> Varrock West via (3035, 3385), (3100, 3420): ~86 s.
[v 2026-10-11 conductor2 local]

### Varrock Mine to Varrock West Bank (~100 tiles)

```typescript
const MINE_TO_BANK = [
    { x: 3270, z: 3380 },
    { x: 3250, z: 3395 },
    { x: 3230, z: 3410 },
    { x: 3210, z: 3425 },
    { x: 3185, z: 3436 },
];

const BANK_TO_MINE = [
    { x: 3210, z: 3425 },
    { x: 3230, z: 3410 },
    { x: 3250, z: 3395 },
    { x: 3270, z: 3380 },
    { x: 3285, z: 3365 },
];
```

## Opening Obstacles

- Lumbridge castle's front doors are a pair of `Large door` locs at (3217, 3218) and (3217, 3219),
  shut (option Open) unless someone opened them; the entrance hall behind them (x 3214..3216) is
  reached only through them. A second shut pair stands at (3213, 3220) and (3213, 3221). The
  conductor `walkTo` op opens the front pair on its way in, and `bot.walkTo` gets back out through
  them shut again. [v 2026-10-10 integration-tests local]

`bot.walkTo()` attempts to open doors and gates on its route. If a route fails,
inspect nearby objects and open the specific obstacle before retrying:

```typescript
let result = await bot.walkTo(3250, 3260);
if (!result.success) {
    const gate = sdk.findNearbyLoc(/^gate$/i);
    if (gate?.optionsWithIndex.some(option => /^open$/i.test(option.text))) {
        await bot.openDoor(gate);
        result = await bot.walkTo(3250, 3260);
    }
}
```





## Cow Field to Draynor Bank

Draynor Bank (3092, 3243) is the closest bank to Lumbridge cow field.

### DANGER: Dark Wizards
**AVOID** the area around (3220, 3220) - aggressive Dark Wizards here will attack and likely kill characters under combat level 20.

### Safe Route Strategy
Stay **north of z=3240** when walking west from cow field to Draynor. Use `walkTo` with intermediate points that curve north around the danger zone rather than walking in a straight line.

```typescript
// Safe: curve north around Dark Wizards
await bot.walkTo(3230, 3270);  // Go west, stay north
await bot.walkTo(3150, 3250);  // Continue west
await bot.walkTo(3092, 3243);  // Draynor Bank

// DANGEROUS: straight line cuts through wizard area!
await bot.walkTo(3092, 3243);  // May path through (3220, 3220)
```

## Key Coordinates

| Location | Coordinates |
|----------|-------------|
| Lumbridge spawn | (3222, 3218) |
| Lumbridge cows (field center) | (3253, 3290) |
| Cow field south gate | (3253, 3266) |
| Draynor fishing | (3087, 3230) |
| Varrock West bank | (3185, 3436) |
| SE Varrock mine | (3285, 3365) |
| Lumbridge general store | (3212, 3247) |
| Lumbridge castle (thieving) | (3222, 3218) |
| Falador center | (2951, 3380) |
| Falador north gate (to Taverley and wester side of map) | ~(2935, 3460) | 
| Taverley (stone circle) | (2935, 3479) |

### Al Kharid Coordinates

| Location | Coordinates | Notes |
|----------|-------------|-------|
| Toll gate (Lumbridge side) | (3268, 3228) | Pay 10gp to enter |
| Toll gate (Al Kharid side) | (3277, 3227) | Walk here after paying |
| Al Kharid bank | (3269, 3167) | x=3269 is 1 tile west of typical "in Al Kharid" check |
| Kebab seller | (3273, 3180) | Dialog-based shop, 1gp per kebab.
| Scimitar shop (Zeke) | (3287, 3186) | Bronze to Mithril scimitars |
| Al-Kharid warriors (palace) | ~(3293, 3170) | Good thieving/combat training.
| Fishing spots | (3267, 3148) | Safe shrimp fishing (there is a lvl 14 scorpion)

### Al Kharid Detection

```typescript
// Simple check: x >= 3270 means inside Al Kharid
// BUT note the bank is at x=3269, so use x >= 3267 for safety
function isInAlKharid() {
    const player = sdk.getState()?.player;
    if (!player) return false;
    return player.worldX >= 3267 && player.worldZ < 3220;
}
```

## Stairs and ladders (`walkTo` between levels)

`walkTo` climbs stairs and ladders when the target is on another level or region (connector table in `conductor/lib/connectors.ts`). Facts the connectors rest on (stand = tile to stand on before the op; inside a building stand on the exact tile):

| Connector | Surface/upper loc, option | Stand / landing | Lower/other loc, option | Stand / landing |
|---|---|---|---|---|
| Falador mine stairs | (3059,3376) `Climb-down Staircase` | stand (3062,3376) | (3059,9776) `Climb-up Staircase` | landing (3058,9776) |
| Wizards' Tower ladder | (3104,3162) `Climb-down Ladder` | stand (3105,3162), lands (3104,9576) | (3103,9576) `Climb-up Ladder` | lands (3105,3162) |
| Wizards' Tower stairs | (3103,3159) on levels 0 and 1 | stand/landing (3105,3160) | top floor (3104,3160) | stand/landing (3104,3161) on level 2 |
| Lumbridge castle SW tower stairs | (3204,3207) levels 0 and 1, (3205,3208) level 2 | stand/landing (3205,3209) on every level | | |

- Both Falador mine directions were walked live (shop task: Nurmof's Iron pickaxe 140 gp, then back up and a sale at the Falador general store). Wizards' Tower and Lumbridge stairs/ladder were exercised only in integration tests. [v 2026-10-11 conductor2w1 local]
- Lumbridge level 1 offers `Climb-up` and `Climb-down`; a plain `Climb` asks a "Climb up or down?" dialog. [v 2026-10-11 conductor2w1 local]
- Underground areas sit on level 0 at the surface x with z + 6400 (Falador mine 3059,3376 -> 3059,9776; Wizards' Tower basement 3104,3162 -> 3104,9576). The Dwarven Mine region is x 2880..3071, z 9728..9855, not the Wilderness (the Edgeville dungeon, x 2944..3391, z >= 9920, is). [v 2026-10-11 conductor2w1 local]
- Open problem: the Wizards' Tower stairs/ladder room (x 3103..3107, z 3159..3163) is entered through a diagonal door at (3107,3162) that the SDK collision data lacks, so a walk into the tower from outside ends with no path. [v 2026-10-11 conductor2w1 local]
- Hazards at the landings (Falador mine scorpions, Wizards' Tower lesser demon): `learnings/hazards.md`; a combat-20 worker was not attacked on its Falador mine trips (safe level still unverified).
