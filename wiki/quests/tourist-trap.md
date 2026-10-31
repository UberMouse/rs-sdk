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
6. Return to the camp and find **Captain Siad's** office (ladder at (3290,3036) to level 1). Search the bookcase (3284,3032) to set the sailing flag, then talk to him ("chat", "lot of books", "interested in sailing", "cut of your jib") to distract him. [v 2026-10-31 questw7 local]
7. Search the chest (3292,3033) to obtain the **Technical plans** for dart production. [v 2026-10-31 questw7 local]

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

## Promoted route (`conductor/plans/tourist-trap.ts`)

Proven from a fresh load of `lib:tourist-trap-start` to quest done in 748 s, one run (Thieving 80, Smithing 87, Crafting 85, Att/Def 40, Str 54, 13 swordfish, hammer, bronze bar, feathers). XP picks Agility and Thieving. [v 2026-10-31 questw7 local]

- Shantay pass loc (3302,3116), Irena (3303,3113), shop (3304,3123): pass 5 gp, desert shirt and robe 40, boots 20, Waterskin(4) 30, bronze bar 8, feather 2, hammer 1. Stock is limited and prices climb, so a save holds the hammer, bar and feathers. Desert heat costs a waterskin charge about every 150 ticks (the mercenary camp and Bedabin camp exempt); 2 Waterskin(4) covered the run.
- Mercenary Captain (3270,3029), level 47, 80 HP: the choices "Wow! A real captain" / "tough guy" / "Can't I do something" / "Sorry Sir" / "funny captain" make him fight alone, with no guard summons. He drops a Metal key; opening the camp gate (3273,3029) with it, wearing no weapon or armour, advances the quest. The gate leaves the bot on the gate tile.
- Camp: a mercenary check fires every 25-100 ticks (caught means the desert or a cell). Rowdy Guards (level 43, 3 to 6 swordfish per fight) roam near (3280,3026), (3287,3030), (3296,3026); the route (3275,3021) -> (3284,3014) -> north slave (3301,3017) avoided most. Leaving the camp in slave clothes next to a guard jails the bot: strip them first.
- Slave trade needs desert shirt, robe and boots; the slave's clothes land in the inventory and must be equipped. The lock-pick attempt counter persists (2 bits): the third failure with a guard within 10 tiles jails the bot; the pick is 62% per try at Thieving 60, so train higher. The retry answers the last two choices "Yes, I'll trade" / "different instead".
- Mine door (3301,3036) in slave clothes lands at (3278,9426). Cave guard (3279,9415) takes the pineapple dialog ("different area", "quite right", "understand each other"). Mine cave (3281,9415) option "Walk through".
- Bedabin: Al Shabim (3171,3025) gives the Bedobin key after the pineapple talk; the tent guard (3170,3045) lets the plans in. Darts need a bronze bar and 10 feathers held: anvil (3171,3048) makes the tip (a bar can be wasted, about 15%), feathers on the tip make the dart (a fail wastes 10 feathers). The dart to Al Shabim gives the Tenti pineapple and 6 bronze darts.
- Rescue: take an empty Barrel at (3303,9418), ride the Mine Cart (3303,9417) to Ana's room (arrival near (3319,9431); room cart (3318,9430)), search a barrel in the loading room to find her, use the empty barrel on her. Winch bucket (3292,9423) with the winch guard ("Yes please", "gregarious"). Out by the cave and door: Use the Winch (3279,3017), search the Barrel (3278,3017), use it on the Mine Cart (3287,3023). The driver bribe is an 8-page talk ending "A hundred it is!" (100 gp); cart Search choice "Yes, I'll get on" drops the bot at (3258,3029) with Ana in a barrel. Go-through on the Shantay pass from the south runs Ana, Irena and the two XP picks.
- Plan gotchas: recentDialogs keeps about 20 pages, so long dialogs (slave, Siad, driver) evict earlier phrases: gate on items or `v.last`. The underground Mine door entrance needs `at` (3278,9424) tolerance 2 with onFail continue (the surface teleport lands mid-walk, the step fails "no path", and the view catches up). Anvil and dart results land a few seconds after the task ends. The combat flag stays true several seconds after a kill, so do not gate "unwield" on not-in-combat.
