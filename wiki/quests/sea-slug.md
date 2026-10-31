# Sea Slug

## Overview

| Detail       | Info           |
|--------------|----------------|
| Difficulty   | Intermediate   |
| Length       | Short          |
| Quest Points | 1              |

## Requirements

### Skill Requirements

- 30 Firemaking

## Items Needed

- Swamp paste

## Rewards

- 7,175 Fishing XP
- Oyster Pearls
- Access to Fishing Platform

## Walkthrough

### Getting Started

Speak to Caroline, located south of the Legends' Guild. She is worried about her husband Kent and son Kennith, who have not returned from the Fishing Platform.

### Reaching the Fishing Platform

1. Give swamp paste to Holgart, the fisherman near Caroline. He needs it to repair his boat.
2. Travel with Holgart to the Fishing Platform.

### Investigating the Platform

1. Speak to Bailey on the platform. He tells you something strange is happening with the sea slugs.
2. Find Kennith hiding on the platform. He is scared and wants to go home.
3. Visit Kent elsewhere on the platform. He appears to be under some kind of influence from the sea slugs.

### Escaping the Platform

1. Collect broken glass from the platform floor.
2. Gather damp sticks from around the platform.
3. Combine the broken glass and damp sticks to create a makeshift torch. Light it with your Firemaking skill.
4. Kick the loose panels on the platform walls to create an opening.
5. Rotate the crane mechanism to position it for escape.
6. Use the crane to get Kennith to safety.
7. Return to the mainland via Holgart's boat.

### Completing the Quest

Return to Caroline to report that Kennith is safe.

## Verified route (plan `conductor/plans/sea-slug.ts`)

Fresh load of `lib:sea-slug-start` to quest done in 216 s. Start save: (2722,3305) beside Holgart and Caroline, Firemaking 30, Att/Str/Def 20, HP 30, one Swamp paste (skips the swamp tar and flour), 0 coins. [v 2026-10-31 questw7 local]

- Start tile: the shore tile (2722,3305) is the reachable one (Holgart (2720,3306), Caroline (2716,3302)). (2718,3299) is a sealed pocket for the walker (both "No path"). Holgart's row boat (2724,3303) is boarded only through Holgart.
- Caroline "I suppose so" starts it. Holgart's first talk asks for swamp paste; the second (with paste) offers "Okay, lets do it" and lands you at the platform (2782,3273).
- Platform has two decks. Ladder (2784,3286) Climb-up leads to level 1 (2783,3286), where Kennith, the Crates, the Loose panel and the Crane are; level-1 locs are listed at jm2 level 2. The first Ladder interact reports "an animation started" before the move, so the climb phase runs twice. Ground-deck crates (2762-2765,3287-3289) are plain Search crates.
- Kennith: "Shout-across" on the level-1 Crates (2763,3287)/(2764,3287), which read UNREACHABLE until the bed-room Door (closed (2764,3285), open (2765,3285)) is passed; stand at (2764,3286) level 1. The walker sometimes opens the door itself, so don't pin the door tile.
- After Kennith: Holgart on the platform (2782,3276) sails to Kent's island (arrival (2800,3320)); Kent about (2794,3321); Holgart (about (2799,3320)) sails back. Bailey about (2763,3276) gives the unlit Torch (lit id 594, unlit 596, both named "Torch"). Boarding a boat puts a lit torch out, so light it after the last boat ride.
- Torch: Broken glass spawns (2765,3278) and (2765,3289) level 0; Damp sticks (2784,3289). Broken glass on Damp sticks gives Dry sticks (glass stays). "Rub-together" on the dry sticks lights the torch on a Firemaking 30 roll (about half of tries): "Your torch lights." or "The sticks smoke momentarily then die out".
- Then ladder up with the lit torch, Shout-across (Kennith "scared of slugs"), Kick the Loose panel (2765,3288), Shout-across again, Rotate the Crane (2768,3286) from (2769,3290), Holgart on the platform ("kid shore") boats you home (arrive (2722,3305)), Caroline pays the reward.
- Reward: Fishing 179,375 XP on the 25x server (7,175 base) and the Big oyster pearls.
- Danger: none met. Sea slugs (npc 1006) have only a Take option and never aggro (picking one up costs 3 hp, from game data, not seen). No combat or food needed. The ladder refuses a climber without a lit torch from stage 6 until the quest is done (from scripts, not tested).

## Key NPCs & Locations

| NPC/Location          | Role                                      |
|-----------------------|-------------------------------------------|
| Caroline              | Quest start, S of Legends' Guild          |
| Holgart               | Fisherman, provides boat transport        |
| Bailey                | Found on Fishing Platform                 |
| Kennith               | Caroline's son, trapped on platform       |
| Kent                  | Caroline's husband, on platform           |
| Fishing Platform      | Main quest area, offshore                 |
