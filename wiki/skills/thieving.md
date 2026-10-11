# Thieving

Thieving allows pickpocketing NPCs, stealing from market stalls, and looting trapped chests.

## Pickpocketing

Right-click an NPC and select "Pickpocket". Higher Thieving level reduces detection chance. Getting caught stuns you briefly.

| NPC | Level | Loot |
|-----|-------|------|
| Man/Woman | 1 | 3 gp |
| Farmer | 10 | 9 gp, seeds |
| Warrior | 25 | 18 gp |
| Rogue | 32 | |
| Guard | 40 | 30 gp |
| Knight | 55 | 50 gp |
| Paladin | 70 | 80 gp, 2 chaos runes |
| Hero | 80 | 200-300 gp, various gems |

## Market Stalls

Steal from stalls when nearby NPCs aren't looking. Located mainly in Ardougne.

| Stall | Level | Loot |
|-------|-------|------|
| Cake stall | 5 | Cake, bread, chocolate slice |
| Tea stall | 5 | Cup of tea |
| Silk stall | 20 | Silk (sell for 60 gp to silk trader) |
| Fur stall | 35 | Fur |
| Silver stall | 50 | Silver ore |
| Spice stall | 65 | Spice |
| Gem stall | 75 | Gems (sapphire to diamond) |

## Chests

| Chest | Level | Location | Loot |
|-------|-------|----------|------|
| 10 gp chest | 13 | East Ardougne, Magic Axe Hut, Pirates' Hideout | 10 gp |
| Nature rune chest | 28 | East Ardougne, Pirates' Hideout | 3 nature runes |
| 50 gp chest | 43 | Ardougne, Pirates' Hideout | 50 gp |
| Steel arrowtips chest | 47 | Hemenster | 5 steel arrowtips |
| Blood rune chest | 59 | Chaos Druid Tower | 2 blood runes |
| Ardougne castle chest | 72 | Ardougne Castle | 1,000 gp, raw shark |

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge castle Men | (3222, 3218), radius 6 | 1 | `thieving` task, npc Man, eatBelow 0.6, food Shrimps/Bread; Thieving 1-34 in 5 min with 2 food (156 gp), 34-39 in 5 min with no food (72 gp; regen step waited most of the run); ~1 in 4 attempts caught/stunned; one "Cannot reach Man" | ~91k (local, stats.ts, 2 runs, both phases pooled) | 2026-10-10 conductor2 local (rev 289) |
| Lumbridge castle Men, no food, level 39-49 | (3222, 3218), radius 6 | 39-49 | `thieving` task, npc Man, food [], eatBelow 0.6: 6 min gave 114 pickpockets, 17 stuns, 59 regen waits, +249 gp (~41 gp/min, vs ~14 gp/min at Thieving 34-39) and Thieving 39->49 (16600 XP) | not measured (single run) | 2026-10-10 conductor2 local |
| Falador park guards, with food | (3006, 3321), radius 8 | 56-82 | `thieving` task, npc Guard, eatBelow 0.6, food cooked Shrimps/Anchovies (27 each, from Draynor bank); ~520 gp/min; Thieving 56->67 in 8 min, 67->82 in 9.5 min; failed pickpockets cost HP, guards only stun-hit, no fight back; bank coins at Falador East (3013, 3355) | 482k (8 min run) and 1.27M (9.5 min run) (local, stats.ts, one run each; varies by level band) | 2026-10-11 conductor2 local |
| Falador park guards, no food | (3006, 3321), radius 8 | 49-56 | `thieving` task, npc Guard, food []: ~60 gp/min, regen waits dominate; 3 min run gave Thieving 373k/h and +180 gp | 373k (3 min run, stats.ts) | 2026-10-11 conductor2 local |

## Notes

- Lockpicks are a rare reward from pickpocketing Rogues.
- Traps on chests must be disarmed before opening.
- Ardougne is the main hub for Thieving training with stalls and NPCs close together.

Levels checked against `server/content/scripts/skill_thieving/configs/{pickpocking/pickpocket.dbrow,stalls/stealing.dbrow,chests/trapped_chest.dbrow}`; the 10 gp chest was listed as level 1, engine says 13; all other levels match. Loot columns unchecked. [v 2026-10-09 conductor1 local]
