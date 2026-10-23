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

- 1,775 Thieving XP (`quest_totem.rs2:163`) [server data, unverified in game 2026-10-23]
- 5 Cooked swordfish

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
