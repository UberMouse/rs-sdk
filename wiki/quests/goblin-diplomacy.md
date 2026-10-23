# Goblin Diplomacy

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Medium     |
| Quest Points | 5       |

## Requirements

None.

## Items Needed

- 3 Goblin armours (dropped by goblins)
- 3 Redberries
- 2 Onions
- 2 Woad leaves (buy from Wyson the Gardener in Falador Park)

## Rewards

- 200 Crafting XP (`quest_gobdip.rs2:62`) [server data, unverified in game 2026-10-23]
- Gold bar

## Walkthrough

1. Speak to the **Bartender** at the **Rusty Anchor** pub in **Port Sarim**. He mentions the goblin generals are arguing about the colour of their armour.
2. Kill **goblins** to collect **3 goblin armours** (or buy from other players).
3. Visit **Aggie** in **Draynor Village** to make dyes:
   - **Red dye**: Bring 3 redberries and 5 gp.
   - **Yellow dye**: Bring 2 onions and 5 gp.
   - **Blue dye**: Bring 2 woad leaves (from Wyson the Gardener in Falador Park) and 5 gp.
4. Create **orange dye** by using red dye on yellow dye.
5. Use dyes on the goblin armours:
   - Use **orange dye** on one armour to make **orange goblin armour**.
   - Use **blue dye** on one armour to make **blue goblin armour**.
   - Leave one armour undyed (this serves as the **brown goblin armour**).
6. Travel to **Goblin Village** north of Falador. Speak to **General Wartface** and **General Bentnoze**.
7. Present the orange armour first. They reject it.
8. Present the blue armour. They reject it.
9. Present the brown armour. They agree on it, ending the dispute.

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Bartender              | Rusty Anchor pub, Port Sarim                 |
| Aggie                  | House in Draynor Village                     |
| Wyson the Gardener     | Falador Park                                 |
| General Wartface       | Goblin Village, north of Falador             |
| General Bentnoze       | Goblin Village, north of Falador             |
| Goblins                | Various locations; common near Lumbridge     |

## Verified run (plan `goblin-diplomacy`)

`conductor/plans/goblin-diplomacy.ts` ran the whole quest on worker questw1 in 898 s: goblin-mail grind 461 s, Aggie 67, Wyson 59, Falador leg 61, onions 22, redberries 26, Port Sarim bartender 31. Start with 35+ gp (3 x 5 gp dyes + 20 gp for woad), a weapon and food. [v 2026-10-23 questw1 local]

| Need | Where | Notes |
|---|---|---|
| Goblin mail x3 | Lumbridge goblins around (3254, 3236), radius 20 | the grind is half the run [v 2026-10-23 questw1 local] |
| Redberries x3 | ground spawns SE Varrock (3267, 3371), (3271, 3366), (3278, 3374) | keep clear of the stone-circle dark wizards (`learnings/hazards.md`); the plan goes via (3260, 3335) [v 2026-10-23 questw1 local] |
| Onions x2 | Lumbridge field plants (3188-3191, 3266-3268), loc "Onion", option Pick | [v 2026-10-23 questw1 local] |
| Woad leaves x2 | Wyson the Gardener (3027, 3379): "I'm looking for woad leaves", then "How about 20 coins?" gives 2 leaves | [v 2026-10-23 questw1 local] |
| Dyes | Aggie (3086, 3259): "Can you make dyes for me please?", then "What do you need to make <colour> dye?", then "Okay, make me some <colour> dye please." 5 gp per dye | red, yellow, blue; [v 2026-10-23 questw1 local] |
| Orange dye, dyed mail | red on yellow dye; dye on mail; all item-on-item (`items` task, combine) | [v 2026-10-23 questw1 local] |
| Generals | Wartface/Bentnoze at (2957, 3511) | see below |

- Generals: option 3 "Do you want me to pick an armour colour for you?" exists only at stage 1. Stage 2 takes the orange mail, stage 3 the blue, stage 4 the plain (brown) one. The plan hands in orange, blue, then plain. [v 2026-10-23 questw1 local]
- The Port Sarim bartender starts the quest; the plan is restart-safe (phases come from held items, quest tab and position). [v 2026-10-23 questw1 local]
