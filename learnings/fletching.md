# Fletching

## Getting Started (Level 1)

### Knife Location
- Ground spawn at **(3224, 3202)**, beside Bob's Brilliant Axes, Lumbridge. `pickup` task with area `{x:3224,z:3202,radius:4}` took it in 35 s including the walk. It respawns 100 ticks (~40 s) after pickup: no `respawnrate` override for knives, engine default `ObjType.respawnrate = 100` (`server/engine/src/cache/config/ObjType.ts`). [v 2026-10-09 conductor1 local]
- No Lumbridge shop sells a knife (General Store stock and engine `.inv` files have none). Nearest knife shops are far: Shantay Pass (6 gp), Bedabin, Yanille, Karamja, Gnome, Dal's. See the starter tools table in `learnings/shops.md`. [v 2026-10-09 conductor1 local]

### Training Method
1. Pick up knife from ground spawn
2. Chop logs from nearby trees (~3200, 3230)
3. Use knife on logs -> arrow shafts (15 per normal log) [v 2026-10-09 conductor1 local]
4. Use Feathers on Arrow shafts -> Headless arrows (1 feather + 1 shaft each, done in batches). [v 2026-10-09 conductor1 local]

## Notes
- `bot.fletchLogs()` returns at the first XP drop while the batch keeps running; wait for the logs to leave the inventory before the next step. [v 2026-10-09 conductor1 local]
- Observed: 13 logs -> 195 shafts, Fletching 1->17 in 1 min (~12 logs/min, ~139k XP/hr). 95 feathers on shafts -> 95 headless arrows, 17->27 in 40 s. Rates: `wiki/skills/fletching.md`. [v 2026-10-09 conductor1 local]
- Shortbows can be made at level 5.
- Knife on normal logs opens a 12-button make menu: Make X, Make 10, Make 5 and then the product's own button, for each of "15 Arrow Shafts", "Short Bow" and "Long Bow". The client publishes each product label with a literal `\n\n\n\n` in front ("\n\n\n\n15 Arrow Shafts"), so match a product by its words, never by equality or position; the `fletching` task also accepts "shortbow (u)". [v 2026-10-10 integration-tests local]
- Other logs offer only the two bows, labelled with the wood ("Oak Short Bow", "Oak Long Bow") (`server/content/scripts/skill_fletching/scripts/cut_logs.rs2`).
- Too low a level for the product is a dialog box ("You need a Fletching level of at least N to make a ..."), not a game message (`server/content/scripts/skill_fletching/scripts/cut_logs.rs2`, `~doubleobjbox`).
- A level-up that unlocks a product has a second page ("You can now make Shortbows.") after "Congratulations, you just advanced a fletching level.". [v 2026-10-10 integration-tests local]
- `bot.fletchLogs(product)` clicks the make-1 option, so it makes one item per call (~2.4 s per log) for bows; shafts come 15 per log. Longbow (u) from normal logs: Fletching 27->34 in a 1-min run, +4000 XP, 16 longbows. [v 2026-10-09 conductor1 local]
- `interrupt:dialog` steps seen during fletching runs are level-up dialogs; dismiss and carry on. [v 2026-10-09 conductor1 local]
- Selling bows to a shop is unverified; leave it to a shop run.
