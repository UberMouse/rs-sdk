# Woodcutting

Woodcutting produces logs from trees, used in Firemaking and Fletching.

## Axes

Woodcutting has no axe level requirement on this revision: `woodcutting_axe_checker` in
`server/content/scripts/skill_woodcutting/scripts/woodcut.rs2` picks the best axe worn **or in the
inventory** (rune > adamant > mithril > black > steel > iron > bronze) and checks no level (the
level checks are commented out, "no wc req in 2004"). Only wielding needs Attack
(`levelrequire/scripts/tier*.rs2`); a bot can chop with any axe carried in the inventory.
[v 2026-10-10 conductor2 local; read from content]

| Axe | Attack to wield | Chance vs bronze | Shop (price) | Smithing |
|-----|-----|-----|-----|-----|
| Bronze | 1 | 1× | Bob's Brilliant Axes, Lumbridge (16 gp); Bandit Duty Free, Jiminua's, Obli's | 1 |
| Iron | 1 | 1.5× | Bob's (56 gp); Gulluck and Sons (56 gp); Aemad's / Jiminua's / Obli's / Armoury (72-84 gp) | 16 |
| Steel | 5 | 2× | Bob's (200 gp, 3 in stock); Gulluck and Sons (200 gp); Armoury (300 gp) | 31 |
| Black | 10 | 2.25× | no shop | not smithable |
| Mithril | 20 | 2.5× | no shop | 51 |
| Adamant | 30 | 3× | no shop; smithed by the bot (route below) | 71 |
| Rune | 40 | 3.5× | no shop | 86 |

Shop stock from `wiki/shops/` (generated); no shop in the content stocks a black, mithril,
adamant or rune axe (`grep` of the `.inv` configs finds them only in the smithing and skill-guide
interfaces). Smithing levels from `skill_smithing/configs/smithing/smithing.dbrow` (1 bar each).
[v 2026-10-10 conductor2 local; read from content]

Adamant axe route (conductor3's `adamant-tools` draft): mine 1 adamantite ore + 6 coal in the Dwarven Mine (coal ~46 s), smelt an **Adamantite bar** at the Falador furnace (~35 s), smith the axe at the Dwarven Mine anvil (3012, 9813) (~24 s, needs a Hammer); Falador to Draynor ~92 s. The bar's item name is "Adamantite bar", not "Adamant bar" (a plan gated on the wrong name re-ran mining). [v 2026-10-24 conductor3 local]

## Chop speed

From `woodcut.rs2` (`@get_logs`, `~woodcutting_successchance`) and the engine's `STAT_RANDOM`
(`server/engine/src/engine/script/handlers/PlayerOps.ts`): [v 2026-10-10 conductor2 local; read from content]

- One roll every 4 ticks (1.6 s at 400 ms/tick) for every axe; the first roll lands 3 ticks after
  the first swing. The axe changes only the success chance, never the interval.
- Success chance per roll = `min(256, floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1) / 256`,
  L = current Woodcutting level (capped at 99), `low,high` per tree and axe in
  `configs/trees.dbrow` (`successchance`). Bronze `low,high`: normal 64,200; oak 32,100;
  willow 16,50; maple 8,25; yew 4,12; magic 2,6. The other axes scale both numbers by about the
  multiplier in the table above (the yew and magic rows round a point or two either way).
- XP per log (`productexp` in tenths, ×25 locally): normal 625, oak 937.5, willow 1687.5,
  maple 2500, yew 4375, magic 6250.
- Per roll, oak's chance is about 2× willow's and gives about 1.1× willow's XP; maple gives about
  0.74× willow's, yew 0.65×, magic 0.46×, at every axe tier. Per-log time (dropping, banking,
  moving to the next tree) is not included in these ratios.
- Normal trees fall on every log, so above about Woodcutting 50 with a bronze axe the roll
  stops being the limit and walking to the next tree is.

## Trees

Levels checked against `server/content/scripts/skill_woodcutting/configs/trees.dbrow`. [v 2026-10-09 conductor1 local]

| Tree | Level | Log Type | Locations |
|------|-------|----------|-----------|
| Normal | 1 | Logs | Lumbridge, Draynor, south of Seers, Feldip Hills |
| Oak | 15 | Oak logs | North of Draynor bank, south of Seers bank |
| Willow | 30 | Willow logs | SW of Draynor bank, NW of Seers bank |
| Maple | 45 | Maple logs | North and south of Seers bank |
| Yew | 60 | Yew logs | Cemetery south of Seers, south of Edgeville bank |
| Magic | 75 | Magic logs | South of Sorcerer's Tower, Gnome Stronghold |

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge trees | (3195, 3220) | 1 | normal trees, cluster west/south of the centre; `woodcutting` task with `area` radius 12; bronze axe, levels 1-67 (task waits for respawns once the cluster is cut down). XP is at the local 25× rate ([local-server](../../learnings/local-server.md)) | ~310k (local, stats.ts, 12 runs; 248k with onFull drop at lower levels) | 2026-10-10 conductor2 local (rev 289) |
| Lumbridge trees, steel axe | (3195, 3220), radius 12 | 60-62 | normal trees, `stop-full` run: 19 logs in 110 s (~10 logs/min), 11875 XP | not measured (single run) | 2026-10-10 conductor2 local |
| Varrock oaks | (3190, 3458), radius 10 | 15 | oak trees; `woodcutting` task `onFull: stop`; bronze axe, WC 30-46 in one 189 s run; steel axe (bronze also held, game uses the best): WC 46-60, +40,312 XP in ~186 s of chopping filled 20 oak logs (+18,750 XP, 937.5 XP/log); no hostile NPCs reported at combat 20 | ~358k bronze, `onFull: stop`, WC 30-46 (stats.ts, 1 run); ~590k steel axe, `onFull: drop`, WC 46-60 (stats.ts, 1 run, includes ~60 s walk; chopping alone ~780k, ~2.2x bronze, matching the 2x steel chance above) | 2026-10-10 conductor2 local (rev 289) |
| Draynor north oaks (`tree:draynor-village:1`) | (3095, 3283), radius 16 (bbox 3084-3106 x 3275-3290) | 1 / 15 | the cluster's 13 normal trees to 15, then its 5 oaks, every log dropped (plan `oak-draynor-drop`); steel axe from Bob's (200 gp). No jail-guard attacks here over ~4 min of chopping. Not the south cluster `tree:draynor-village:2` (3112, 3240): the jail guards attack through the fence there at any combat level ([hazards](../../learnings/hazards.md)) | north site, adamant axe, WC 68-74: +67,500 XP in 247 s with ~30 s walk in, ~1.1M/h chopping (1 run). South site, steel axe, WC 15-50: ~775k/h (1 run) | 2026-10-24 conductor3, conductor3w1 local |
| Draynor willows, steel axe | (3086, 3233), 5 trees ([place](../places/draynor-willows.md), [resource](../resources/tree/willow.md)) | 68-80 | willow logs; 22 logs filled in ~120 s (~11 logs/min, ~37k WC XP per fill at WC 77), then burned at Draynor ([firemaking](firemaking.md)); [Draynor bank](../services/bank.md) booth (3092, 3243) is 10 tiles away. Dark wizards there ignored a combat-49 bot over three runs ([hazards](../../learnings/hazards.md)) | ~667k chop-burn cycle, WC 68-77 (601 s run, stats of RESULT); full cycle ~3 min: chop 120 s, burn 55 s, ~12-tile walk each way | 2026-10-11 conductor2 local |

## Notes

- Trees respawn after being cut down; higher-tier trees take longer to respawn.
- Normal trees (no `respawnrate` in `trees.dbrow`) fall on every successful chop and respawn after 120 + random(80) game ticks (48-80 s at 400 ms/tick), scaled down slightly by player count (`server/content/scripts/skill_woodcutting/scripts/woodcut.rs2`, `general/scripts/player_count.rs2`). Other trees deplete with 1/8 chance per log.
- Lumbridge trees capacity: at ~50+ WC (bronze axe, 25x XP) a bot cuts every normal tree within radius 12 of (3195, 3220) to a stump (stumps are not choppable). Respawns (48-80 s) keep a bot that waits for them at about the same XP/hr (~289k, WC 51-58 over 5 min); a bot that does not wait fails with "chop: no reachable tree nearby". [v 2026-10-09 conductor1 local]
- Lumbridge trees at WC 62-63 (bronze axe): ~10 logs/min over a 1 min run (6250 XP), so a 28-slot inventory fills in ~3 min. [v 2026-10-09 conductor1 local]
- Lumbridge trees at WC 65-67 (bronze axe): ~12 chops/min over 3 min (5000 XP/min), with several respawn waits; the 28-slot inventory fills in ~2.3 min. [v 2026-10-09 conductor1 local]
- Normal trees north of Lumbridge castle at (3212, 3232), (3217, 3231), (3225, 3232) and (3235, 3230), outside the Lumbridge trees grove; the `chop` op's integration test fells one per run there (WC 60, bronze axe, spawned at (3220, 3228)). [v 2026-10-10 integration-tests local]
- Logs near a bank (Seers, Draynor) are ideal for training since you can bank or burn them quickly.
