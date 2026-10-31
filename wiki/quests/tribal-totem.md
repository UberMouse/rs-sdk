# Tribal Totem

## Overview

| Detail       | Info           |
|--------------|----------------|
| Difficulty   | Intermediate   |
| Length       | Medium         |
| Quest Points | 1              |

## Requirements

### Skill Requirements

- 21 Thieving

## Items Needed

- None (all items obtained during quest)

## Rewards

- Thieving 17,750 base XP (`quest_totem.rs2:163`); 44,375 shown on the 25x local server, Thieving 21 -> 55. [v 2026-10-31 questw4 local]
- 5 Cooked swordfish, 1 quest point [v 2026-10-31 questw4 local]

## Walkthrough

### Getting Started

Speak to Kangai Mau at the Shrimp and Parrot pub in Brimhaven. He explains that Lord Handelmort stole his tribe's sacred totem and has it locked away in his mansion west of Ardougne market.

### Scouting the Mansion

1. Travel to Ardougne and find the mansion located west of the market.
2. Speak to the gardener outside the mansion. He provides useful information about the layout and security.

### The RPDT Teleport

1. Visit Wizard Cromperty in his house in northeast Ardougne.
2. He can teleport you using his RPDT (RuneScape Parcel Delivery Teleport) device, but the coordinates are currently set to the wrong location.
3. Travel to the RPDT depot.
4. Swap the box labels at the depot so the teleport destination points inside the mansion.

### Obtaining the Guide Book

1. Search houses in the northwest area of Ardougne to find a guide book.
2. The guide book contains the password needed to open the locked door inside the mansion.

### Infiltrating the Mansion

1. Return to Wizard Cromperty and use his teleport to arrive inside the mansion.
2. Navigate through the mansion. Pick the lock on the door using the password **"KURT"**.
3. Search the chest in the locked room to find the tribal totem.

### Door combination lock (server data, unverified in game 2026-10-24)

- The mansion door (`combodoor`) opens interface `tribal_door2` with four letter wheels: up arrows com_48/50/52/54, down com_47/49/51/53; the letters show in com_43-46. Each press changes a wheel by 1 in 0-25 (A-Z), wrapping both ways; all wheels reset to A when the interface opens (`quest_totem.rs2:55-100`).
- The same wheel logic (`calc_tribaldoor_value`) drives Peer's riddle door in the Fremennik Trials, see [fremennik-trials.md](fremennik-trials.md).

### Verified route

Run by `conductor/plans/tribal-totem.ts` (fresh load of `lib:tribal-totem-start` to quest done in 197 s, no deaths). No guide book or gardener is needed. [v 2026-10-31 questw4 local]

1. Kangai Mau (2791,3182), Brimhaven: "I'm in search of adventure", then "Ok, I will get it back".
2. Customs officer ship, 30 coins, lands (2683,3268); Gangplank Cross (2683,3269) level 1.
3. RPDT depot, east Ardougne: Investigate the horn Crate (2650,3273) for the label (id 1858); use the label on Crate (2650,3271); the RPDT employee choice "when are you going to deliver" sets the delivery.
4. Wizard Cromperty (~2683,3326): "So what have you invented", "Can I be teleported", "Yes, that sounds good" lands at (2638,3321) inside the mansion. The arrival room's doors (2636,3323), (2639,3323) are plain; guard dogs and Horacio showed UNREACHABLE outside and did not attack.
5. Travel to (2634,3322) tolerance 1 first (the walker opens the room doors, ~20 s); `combolock` fails "no reachable Door" from the arrival room. The code is fixed, KURT, first try on door (2634,3323) (`quest_totem.rs2` letters 10,20,17,19).
6. Stairs (2631,3322): Investigate, then Climb-up from (2631,3325); with Thieving 21 it lands at (2631,3321) level 1 with no trap. An un-investigated climb drops you at about (2631,3319) level 0 for roughly 20% of HP + 1 (script reading, not seen).
7. Chest (2638,3324) level 1: the walker refuses (2638,3325) as blocked; stand at (2638,3323) for Open and Search (works despite forceapproach=north). Search lags the Open, see [learnings/walking.md](../../learnings/walking.md) (step two tiles away and back). It gives the totem (id 1857).
8. Down: Climb-down on the level 1 loc at (2631,3322), match `^Stair` (name varies Stairs/Staircase); `travel` fails "No connector from level 1". Leave, sail home with Captain Barnaby, give the totem to Kangai Mau.

### Completing the Quest

Return the totem to Kangai Mau at the Shrimp and Parrot pub in Brimhaven.

## Key NPCs & Locations

| NPC/Location            | Role                                        |
|-------------------------|---------------------------------------------|
| Kangai Mau              | Quest start, Shrimp and Parrot pub, Brimhaven |
| Gardener                | Info about mansion, W of Ardougne market    |
| Wizard Cromperty        | RPDT teleport, NE Ardougne                  |
| RPDT Depot              | Swap box labels for teleport redirect       |
| Handelmort Mansion      | W of Ardougne market, contains totem        |
| NW Ardougne houses      | Guide book location                         |
