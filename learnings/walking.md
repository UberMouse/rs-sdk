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

Ground items can sit on blocked tiles (on a Table or counter): the state flags them `[UNREACHABLE]`, which is only the client's 0x0-footprint route test. The server accepts a take from a cardinally adjacent tile with no wall between (`Player.inOperableDistance`), and `pickup` does this: when no routable item is left it walks to a side of the item (N, E, S, W) and takes it, failing after 4 refused sides. A side behind a wall is refused ("I can't reach that!"): the Lumbridge kitchen Pot (3210,3212) is taken from (3210,3213) inside, not from (3210,3211) outside the south wall. Verified: Pot (3210,3212), Digsite Panning tray (3369,3378) from (3369,3379); the Catherby Insect repellent (2807,3450, bigtable) is the same case. [v 2026-10-24 questw7 local]

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

### Varrock: general store to the palace (fixed: doors in a straight run)

- The plain walk from the Varrock general store, or from beside Aubury (3253, 3401), to King Roald (3222, 3476) failed `Stuck at (3213, 3438)` (also (3212, 3438) on a Reldo walk) with no waypoint needed once fixed. The alley at x 3212-3213 from the market north ends in a double door at (3212, 3470) and (3213, 3470) (locs 1516 and 1519, `Large door`), which the route crosses in one straight run: a route's waypoints are only its turns, so the walk had none near the door, sent one 34-tile leg through it, and the client's route finder (`tryNearest` accepts only the destination or a tile beside it) finds nothing reachable behind a closed door and does not move the bot at all. Why the unfixed walk sometimes still reached the door is not established (the bot's login scene differed): a login beside Aubury reproduced it every time, a login at (3219, 3415) or (3254, 3420) walked it. Fixed in `withDoorStops` (`conductor/actions/paths.ts`): every door of the SDK's index, not only the masked ones, gets a waypoint on it and one before it, counting the segment from the bot's own tile, so the walk opens it on arrival. The workaround waypoint (3236, 3437) is no longer needed. A walk that makes the same hop sequence four times in a row without arriving now ends `stuck` naming the hops (`HOP_REPEAT_LIMIT`, `conductor/actions/walk.ts`; history per run, cleared on arrival). `(3212, 3428)` is inside the fenced Varrock square garden (every tile blocked), so no walk starts or ends there. [v 2026-10-23 questw5 local]

### Lumbridge cooking pot to Varrock East bank

- Pot (3232, 3238) -> Varrock East bank (3254, 3420) walked cleanly on every trip of the lure-cook-bank plan (3 trips per run), no hazards met. [v 2026-10-11 conductor2 local]

### Varrock East bank to the Gnome Stronghold course

- Varrock East bank (3254, 3420) -> course start (2474, 3436): `travel` to {x:2474, z:3436}, tolerance 3, no waypoints. 250 s; the task's `gnome-gate` step opens the Stronghold gate itself (a few dialogs, suspended by the dialog guard). Arrived (2473, 3436) with HP 19/23 at combat 25; no food eaten, no combat logged, the travel log records no damage event. White-wolf trouble is not confirmed or ruled out by one trip (HP was 19/23 on arrival, cause not logged). Repeat at combat ~50: 245 s, no attack, 16 fish carried and none eaten. [v 2026-10-16 conductor2 local]

### Ardougne, Gnome Stronghold and Catherby legs

- Ardougne market (2650, 3295) -> Gnome Stronghold course (2474, 3436) by `travel`: 107 s, no attacks. Stronghold -> Catherby by `travel` via waypoints (2650,3295), (2725,3485), (2800,3440): 220 s, no attacks (stays west of White Wolf Mountain's wolves, see `learnings/hazards.md`). [v 2026-10-23 conductor3 local]

- Camelot first floor (Lancelot's, L1) -> Catherby: the walk stops 54 tiles short at (2767, 3497). `travel` to the level-0 courtyard (2762, 3508) first, then on. See [Merlin's Crystal](../wiki/quests/merlins-crystal.md). [v 2026-10-23 questw3 local]

- Hadley's house (Waterfall Quest) -> Tree Gnome Village ladder: the walk finds no path. `travel` to (2533, 3157) first, then climb down. [v 2026-10-23 questw2 local]

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
- A diagonal door (shape 9, e.g. the Varrock house door at (3160, 3440)) opens with op1 and the
  script steps the player aside; the SDK's own pathfinder still reads its tile blocked, so
  `bot.walkTo` finds no path through it, but a raw `sdk.sendWalk` after opening walks in (the
  conductor's walker knows these doors, `conductor/actions/paths.ts` EXTRA_DOORS). [v 2026-10-19 t9check1 local]
- The Lumber Yard's broken fence at (3305, 3493), climbed from the south (members), leaves the
  player standing on the fence's own tile; from there a walk goes on into the yard. [v 2026-10-19 t9check1 local]
- Plan steps (`interact`, `talk`) take `at: {x, z, tolerance}` with a minimum tolerance of 1. A stand tile right beside a wall therefore lets the walker open the door itself and walk through. For a door step omit `at`, or put it two tiles from the door on the near side. Item pickup on level 1 works with `area.level: 1`. [v 2026-10-23 questw1 local]
- `interact`'s `at` counts as arrived by Chebyshev distance to the stand tile, not by path. When the stand tile is behind a wall or door, pick a stand farther than the tolerance so the walker really walks. [v 2026-10-24 questw1 local]

### A loc opened by an `interact` shows its new options late

After `interact` Open on a cupboard (Morgan's, (3096,3268) level 1) the client's loc list kept offering only "Open" for ~10 s, so an immediate Search failed "offers: Open" and a second Search 10 s later succeeded. Gate the follow-up on the game message ("You open the cupboard.") and give the phase a retry rather than treating the first failure as final. [v 2026-10-24 questw1 local]

### `talk` and fenced areas

- `talk` does not walk when the NPC is already in reach (nearer than its approach distance by Chebyshev), even if a wall or counter is in the way, so it can fail "unreachable". Put a `travel` phase first to stand where the NPC is really reachable (plague-city's Clerk). [v 2026-10-24 questw7 local]
- McGrubor's Wood (Seers' Village, north of the Ardougne road) is fenced at x=2662 (z 3494-3501). The south gate (2649/2650, 3469) is permanently locked (Forester: "Hey! You can't come through here!") and traps `walk`. The way in is the Loose Railing (2662, 3500), op "Squeeze-through"; `travel` with waypoints (2650,3300), (2725,3485) and target (2668,3492) crosses it. [v 2026-10-24 questw7 local]

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
| Fishing spots | (3267, 3148) | Shrimp fishing; use this north spot, not (3276, 3140) where lvl 14 scorpions attacked a combat-29 bot [v 2026-10-23 conductor3 local]

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

`walkTo` climbs stairs and ladders when the target is on another level or region. Its connectors are the world index's (`wiki/world.json`, read by `conductor/lib/connectors.ts`), and it picks them as the shortest way over the index's graph (`conductor/lib/walk-graph.ts`), so it may take a staircase this table does not list (Lumbridge castle's north tower stairs at (3204,3229) to the Duke; the Ice Mountain trapdoor at (3019,3450) into the Dwarven Mine's north end). Facts the connectors rest on (stand = tile to stand on before the op; inside a building stand on the exact tile):

| Connector | Surface/upper loc, option | Stand / landing | Lower/other loc, option | Stand / landing |
|---|---|---|---|---|
| Falador mine stairs | (3059,3376) `Climb-down Staircase` | stand (3062,3376) | (3059,9776) `Climb-up Staircase` | landing (3058,9776) |
| Wizards' Tower ladder | (3104,3162) `Climb-down Ladder` | stand (3105,3162), lands (3104,9576) | (3103,9576) `Climb-up Ladder` | lands (3105,3162) |
| Wizards' Tower stairs | (3103,3159) on levels 0 and 1 | stand/landing (3105,3160) | top floor (3104,3160) | stand/landing (3104,3161) on level 2 |
| Lumbridge castle SW tower stairs | (3204,3207) levels 0 and 1, (3205,3208) level 2 | stand/landing (3205,3209) on every level | | |
| Edgeville Dungeon trapdoor | (3097,3468) closed: `Open`, then `Climb-down` | stand (3096,3468), the west opening of the ruined house ((3096,3467) is across a wall and the open fails); lands (3096,9868) (`trapdoors.rs2:11` moves the player's own tile) | ladder (3096,9867) `Climb-up` | stand (3096,9868); lands (3096,3468), inside the ruined house (leave by its west opening) [v 2026-10-18 server data] |

- Both Falador mine directions were walked live (shop task: Nurmof's Iron pickaxe 140 gp, then back up and a sale at the Falador general store). Wizards' Tower and Lumbridge stairs/ladder were exercised only in integration tests. [v 2026-10-11 conductor2w1 local]
- Lumbridge level 1 offers `Climb-up` and `Climb-down`; a plain `Climb` asks a "Climb up or down?" dialog. [v 2026-10-11 conductor2w1 local]
- Underground areas sit on level 0 at the surface x with z + 6400 (Falador mine 3059,3376 -> 3059,9776; Wizards' Tower basement 3104,3162 -> 3104,9576). The Dwarven Mine region is x 2880..3071, z 9728..9855, not the Wilderness (the Edgeville dungeon, x 2944..3391, z >= 9920, is). [v 2026-10-11 conductor2w1 local]
- A ladder `interact` (Climb-down/Climb-up) ends on the animation, before the view shows the new level: follow it with a settle phase (`travel` with `onFail:'continue'`) before the next op. With no `tile`, `interact` picks the nearest ladder of that name, which can be the wrong one (Monk's Friend: use `tile`; see [Monk's Friend](../wiki/quests/monks-friend.md)). [v 2026-10-24 questw3 local]
- Ladders and stairs shift the player's own tile by +/-6400 in z (`ladder_from_cellar` in `server/content/scripts/ladders+stairs/scripts/ladders.rs2`), not the ladder's: you land at your stand tile +/-6400, so the stand tile decides where you arrive. Some ladders have a forceapproach side that must be used (Taverley Dungeon surface ladder: approach from the east). [v 2026-10-16 server data + review]
- Gap class: shape-9 (diagonal) ground-layer doors are missing from `sdk/collision-data.json`, so the SDK finds no route through them. The known case is the Wizards' Tower stairs/ladder room (x 3103..3107, z 3159..3163), entered through the door at (3107,3162) (loc 1536). `conductor/actions/paths.ts` (`EXTRA_DOORS`, commit c0593d7f1) unblocks that tile and reports the door, so `walkTo` opens it and reaches the basement ladder: a bot walked Lumbridge -> tower -> basement -> Sedridor in the Rune Mysteries plan. [v 2026-10-11 conductor2w3 local]
- The Asgarnian Ice Dungeon (Thurgo's ladder) has no up-connector in the index: `travel` down works, but `travel` from (3049,9567) to the surface fails "No connector from level 0 ... to (3011, 3152)". Use `interact` Climb-up on the ladder (3008,9550). [v 2026-10-23 questw4 local]
- Falador castle level 2 (Sir Vyvin's cupboard, (2987,3341)) has no walk path to the Falador bank ("No path to (3013,3355) ... no waypoints"): `travel` down to level 0 first. [v 2026-10-23 questw4 local]
- Hazards at the landings (Falador mine scorpions, Wizards' Tower lesser demon): `learnings/hazards.md`; a combat-20 worker was not attacked on its Falador mine trips (safe level still unverified).
- Draynor Manor: the whistle room (south of the door at (3106,3361) L2) and the upper floors have no walker exit. Hand steps: `interact` Door Open (tile 3106,3361) swings the player north; Staircase Climb-down (3105,3363) L2 -> L1; Staircase Walk-down (3108,3364) L1 -> ground; then `travel`/`talk` walks work. See [Holy Grail](../wiki/quests/holy-grail.md). [v 2026-10-24 questw5 local]
- Merlin's workshop (Camelot L1, door (2764,3503)): a `talk`'s own walk does not carry `met` tokens, so after Merlin the next long walk fails "No path ... ends 541 tiles away at (2768,3498)". Run a `travel` with `met:["quest:grail>=1"]` to (2760,3512) first. [v 2026-10-24 questw5 local]

### Gnome Stronghold exits and the Zeke leg
- Stronghold bank (2445, 3425) level 1 works as a bank area. The Staircase Climb-down at (2475, 3401) level 1 lands at (2474, 3400) level 0 (11.6 s in plan `melee40`). Stronghold -> Zeke's shop (Al Kharid) takes 270 s, crossing stiles by loc-op; Zeke -> Falador farm (3027, 3307) 82 s. [v 2026-10-24 conductor3 local]
