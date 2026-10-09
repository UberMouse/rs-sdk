# Fletching

## Getting Started (Level 1)

### Knife Location
- Ground spawn at **(3224, 3202)**, beside Bob's Brilliant Axes, Lumbridge. `pickup` task with area `{x:3224,z:3202,radius:4}` took it in 35 s including the walk. [v 2026-10-09 conductor1 local]
- No Lumbridge shop sells a knife (General Store stock and engine `.inv` files have none). Nearest knife shops are far: Shantay Pass (6 gp), Bedabin, Yanille, Karamja, Gnome, Dal's. See the starter tools table in `learnings/shops.md`. [v 2026-10-09 conductor1 local]

### Training Method
1. Pick up knife from ground spawn
2. Chop logs from nearby trees (~3200, 3230)
3. Use knife on logs -> arrow shafts (15 per normal log) [v 2026-10-09 conductor1 local]
4. Use feathers on shafts -> headless arrows (one feather per shaft)

## Notes
- `bot.fletchLogs()` returns at the first XP drop while the batch keeps running; wait for the logs to leave the inventory before the next step. [v 2026-10-09 conductor1 local]
- Observed: 13 logs -> 195 shafts, Fletching 1->17 in 1 min (~12 logs/min, ~139k XP/hr). 95 feathers on shafts -> 95 headless arrows, 17->27 in 40 s. Rates: `wiki/skills/fletching.md`. [v 2026-10-09 conductor1 local]
- Shortbows can be made at level 5.
