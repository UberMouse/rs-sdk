# The Tourist Trap

## Overview

| Detail | Info |
|--------|------|
| Difficulty | Intermediate |
| Length | Long |
| Quest Points | 2 |

## Requirements

- 10 Fletching
- 20 Smithing
- Ability to defeat a level 47 enemy

## Items Needed

- A desert shirt, desert robe and desert boots: a slave trades his clothes only for all three (`mining_slave.rs2:146-160`) [server data, unverified in game 2026-10-23]
- 5 gp for a Shantay pass, which the pass takes on the way in
- Optional 100 gp cart bribe; telling the driver "Prison riot in ten minutes" works without paying (`mine_cart_driver.rs2:83-97`) [server data, unverified in game 2026-10-23]
- Feathers (for dart crafting)
- Bronze bar (for dart crafting)
- Combat gear

## Rewards

- 2 Quest Points
- 4,650 XP (choose 2 skills from Agility, Fletching, Smithing, or Thieving)
- Ability to smith dart tips, unlocked partway through the quest once Al Shabim has taught you darts, not at completion (`smithing.rs2:109,226`) [server data, unverified in game 2026-10-23]
- Slave robes
- 6 bronze darts

## Walkthrough

### Getting Started

1. Speak to **Irena** south of the Shantay Pass. Her daughter Ana has gone missing in the desert.
2. Buy a **Shantay pass** from Shantay for 5 gp (`areas/area_alkharid/scripts/shantay.rs2:128`), then Go-through the pass from the north: it takes the pass (`shantay_pass.rs2:96`), and going back north is free (`shantay_pass.rs2:70`). Without a disclaimer the poster asks "Go into Desert?": answer "Yeah, that poster doesn't scare me!" (`shantay_pass.rs2:88`); the guard then hands over a disclaimer, and the poster is not asked again while you hold it (`shantay_pass.rs2:84`, `:98`).

### Infiltrating the Camp

3. Travel south to the mining camp area. Defeat the **Captain** (level 47) and obtain the **metal key**.
4. Use the key to access the slave camp. Swap clothes with a **slave** to disguise yourself and infiltrate the camp.

### The Nomads' Camp

5. Visit **Al Shabim** at the nomads' camp nearby. He tells you about the secret weapon the mining camp is developing.
6. Return to the camp and find **Captain Siad's** office. Mention **"Jib"** in dialogue to distract him.
7. Search his desk to obtain the **technical blueprints** for dart production.

### Crafting Darts

8. Bring the blueprints to Al Shabim. Use your Fletching and Smithing skills to **craft prototype darts** from a bronze bar and feathers.
9. Show the darts to Al Shabim. He gives you a **pineapple** (or you trade for one) that you will need later.

### Rescuing Ana

10. Navigate into the **mines** using the mine cart system.
11. Find **Ana** in the mining area. Help her escape by hiding her in a **barrel**.
12. Use the **winch** mechanism to lift the barrel with Ana out of the mines.
13. Load the barrel onto a cart. Get the cart driver to leave: bribe him 100 gp, or warn him of a prison riot, or ride the cart yourself (`mine_cart_driver.rs2:78-97`). [server data, unverified in game 2026-10-23]

### Completion

14. Return to **Irena** south of the Shantay Pass. She is reunited with Ana and rewards you.

## Key NPCs & Locations

| NPC / Location | Role | Location |
|----------------|------|----------|
| Irena | Quest start and completion | South of Shantay Pass |
| Captain | Level 47, drops metal key | Mining camp |
| Al Shabim | Nomad leader, provides intel | Nomads' camp |
| Captain Siad | Has blueprints on desk | Mining camp office |
| Ana | Prisoner to rescue | Mining camp mines |
| Cart driver | Bribe 100 gp for transport | Mining camp |
| Shantay Pass | Desert entry point | South of Al Kharid |
