# Roadmap: max the account

The conductor's long-range plan. The conductor keeps **Now** and **Backlog** current; the
retrospective agent proposes changes; knowledge (where things are, how they work) lives in
`learnings/` and `wiki/`, not here. Progress numbers come from `bun conductor/tools/progress.ts`.

Goal: 99 in all 19 skills (total level 1881) on the local server (members world, 25× XP).

## Now

State at 2026-10-16: total level 932 / 1881, 17.2% of max XP (conductor2, rev 289, 25x XP). Thieving 99,
Mining 99, Cooking 83, WC 80, Fishing 79, FM 78, HP 47, Str 44, Magic/Agility 41, Att/Def/Ranged 40,
Smithing 39, Crafting 35, Fletching 30, Prayer 15; Herblore and Runecraft 1.
In flight: Rune Mysteries plan done on conductor2 (2026-10-14); Druidic Ritual blocked at `sanfew-start`
(no Taverley level-0 -> level-1 connector in `conductor/lib/connectors.ts`; author fixing); `runecraft` and
`essence-mine` tasks being authored. Next after the quests: Runecraft, Herblore, then Smithing by the
banked-iron route (Max route row).

Tick-perfect pass status (conductor skill, Optimizing a method): only Mining has a measured tick budget
and gap analysis (6.75 ticks/ore, floor). Thieving, melee, Ranged/Magic, WC/FM and Fishing/Cooking
finished their goals with no budget, spot search or A/B. Do these before more training, ranked by
XP still to earn / rate (hours at today's rate to finish): melee Att/Str/Def + HP ~3.9M XP at ~190k/h
(20 h+), Ranged ~980k at 86k/h (11 h), Magic ~980k at ~150k/h (6.5 h) — combat research 2026-10-16 predicts
all combat in ~6-8 h with hill giants, a mithril scimitar, a willow shortbow and bought runes (Max route rows), Smithing ~980k at 140k/h (7 h),
Cooking+Fishing ~1.4M at ~1.1M/h combined (1.3 h), WC+FM ~1.5M at 1.4M/h (1.1 h). Combat is where
the hours are; the gathering skills are already near their cap. Estimate (not measured): a 4-tick steel
scimitar at 1.8 dmg/swing gives ~270k/h at best, so the melee gap is the weapon/target tier, not clicks.

- Catalog: `woodcutting`, `pickup`, `firemaking` (line burn), `fletching`, `mining`, `combat`
  (melee/Ranged/Magic), `bank`, `shop`, `smithing` (smelt + anvil), `cooking`, `fishing`, `thieving`,
  `crafting` (pottery), `fill`, `agility` (Gnome course), `travel` (waypoints, gates, `flee`), `walkTo`
  across levels. Promoted plans in `conductor/plans/`: chop-burn, chop-fletch, fish-cook-bank,
  lure-cook-bank, pottery-craft, iron-smith, gnome-agility, guard-thieve, ranged-magic-chickens
  (mine-ore and fish-cook are drafts in `runs/conductor2/plans/`).
- The bank is ONE account-wide bank: any booth reaches the same items. Bank at the nearest booth; never
  walk to another town to fetch coins or items.
- Measured (XP/hr): Thieving Falador guards with food 1.27M (~520 gp/min; without food 373k-482k),
  Mining iron SE Varrock adamant ~875k, WC oaks steel ~780k, FM 690k-1.16M, cooking pot 345k, Fishing
  lure at the Lumbridge river ~1.1M (19k XP/min; net 95-200k), Agility Gnome ~2.2k XP/lap, Smithing
  131-140k, Crafting pottery ~65k, Fletching shafts 70k. Melee is 5-10x slower than gathering.
- Failure lessons this run (plan/brief faults, not task code): size fishing areas to cover hopped
  spots; do not order training before the purchases it needs (buy runes/arrows first); briefs state only
  confirmed facts (banks are account-wide); runners start every run in the background.
- Standing rules: bank leftovers and superseded tools between goals (task-runner rule); bank cooked
  food each loop; always use food when thieving (user); skip tool tiers when 25x XP makes the cheaper
  one enough; never walk through the Varrock stone circle (3223,3373) (dark wizards killed the bot):
  use `travel` waypoints (Varrock W -> SE mine via (3260,3400); Falador -> Varrock W via (3035,3385),
  (3100,3420)).

## Unlocks

Skills and areas gated behind something other than levels. Check the quest page for its own
requirements before planning it.

| Unlock | Needs | Page |
|---|---|---|
| Herblore training | Druidic Ritual | `wiki/quests/druidic-ritual.md` |
| Runecraft training | Rune Mysteries | `wiki/quests/rune-mysteries.md` |

## Backlog

Tasks the catalog needs, roughly in the order the account needs them. Each line: what, why,
status (`idea` / `authoring` / `in review` / `in catalog`).

- In catalog: `woodcutting`, `pickup`, `firemaking` (line burn with wall-edge check), `fletching`,
  `mining`, `combat` (melee, Ranged, Magic), `bank`, `shop`, `smithing`, `cooking`, `fishing`,
  `thieving`, `crafting` (pottery), `fill`, `agility` (Gnome course), `walkTo` stairs/ladders.
- In review / landed: firemaking wall-edge fix (bb9c4f533), cooking reach fix (25143a7db), travel +
  `passGate` (0d241f745), death ends a plan / idle rail / travel flee (ba9df8a92): all committed.
- **Flee with no food (in progress: task-author in a worktree)**: `travel` with `flee: true` in combat at low HP and no food fails at once
  in `lowHpGuard` (`interrupts.ts`: `if (p?.combat.inCombat || hpFell) return { fail: ... no food }`),
  which leaves the bot standing in the fight. Fix: in flee mode skip the no-food fail (walking on is
  the only way out; keep failing only when HP is 0 / dead), or let a task opt out via `allow: ['low-hp']`
  while fleeing. Add a unit test on a scripted world (in combat, hp 4, no food, flee: keeps walking).
- **Run-task auto-journal + plan nudge (idea)**: runners still journal in batches and chain plain runs
  after four prompt fixes; make it structural (see the retrospective #4 proposals): `run-task.ts
  --objective <title> --journal <path>` appends the mechanical journal line itself, and the RESULT
  carries a `hint` after the 2nd plain run in a row on a bot since its last plan run.
- Next ideas, in order: `thieving` higher tier (Paladin/Hero at 70-80+) if guards stop paying;
  `mining` coal/mithril mode; `woodcutting` bank mode; `smithing` steel/coal plan; `crafting` beyond
  pottery (leather, gems); `agility` second course for 40+; quest tasks (Druidic Ritual, Rune Mysteries);
  `combat` upgrades (real food from the bank, better target than chickens); `prayer`; `fishing`
  lure/bait for trout/salmon.
- Done: `fletching` Make 10 batching and mixed-log tolerance; gates for stairs/ladders.

## Framework

Changes to the conductor system itself, decided with the user; not for the conductor to start
on its own.

- **Interruptible tasks: what is left.** Built on 2026-10-10 (`conductor/docs/interruptible-tasks.md`,
  which marks what was not built): generator steps, ops in `conductor/actions/`, guards at every
  wait, scripted-world unit tests, the integration suite, recording and replay. Left:
  - `conductor/tools/upstream-drift.ts`: list upstream `sdk/actions.ts` changes since the commit
    each op's "Ported from ... @ <sha>" header names, so fixes get re-ported. Drift is manual now.
  - Run `bun test conductor` inside `verify:conductor`, and require a green
    `bun run test:integration` before committing changes to `conductor/core` or `conductor/actions`.
  - A reactive simulator (the plan's "sim later") beyond `test/react.ts`'s scripted reactions.
  - walkTo crosses levels only through the curated table in `lib/connectors.ts` (Lumbridge castle, Falador -> Dwarven Mine, Wizards' Tower); no ferries, and a connector outside the table fails `no-connector`.
  - Recordings (about 2.8 MB per bot-hour) and integration leftovers (`conductor/runs/it*`, and
    one `it*` account and save per integration test in the shared engine) are never cleaned up.
- **Task → agent decisions.** Tasks can only end with a RESULT. Add a way for a task to raise a
  predefined decision to the supervising agent mid-run (pause with a question and options)
  instead of failing and making the conductor re-plan from scratch.
- **Account snapshot fixtures.** Built: the save library (`conductor/saves/`, `library.ts`),
  worker accounts (`load.ts`), live snapshots and server-side logout (`save.ts`), and the gateway
  controller lease; design in `conductor/docs/parallel-bots.md`. Left:
  - Record library saves automatically at important moments (before a quest, on reaching a
    combat zone).
  - Generated saves cover levels, inventory, worn, bank, position and varps through
    `sdk/test/utils/save-generator`; add quest-progress specs as quests come up.
  - A library save per committed task, including its failure branches (full inventory, no
    tool), so smoke tests can exercise them.
  - The library records no content version: a content repack that renumbers item or varp ids
    would change what a saved scenario means. Add one if repacks start happening.
- **Cleanup: the step tick budget outlived its job.** `stepTimeoutMs` was the only way to regain
  control from an `async` step stuck on an `await`; generator steps yield at every wait, where
  stops, the watchdog and guards already act, every wait has its own budget and every op its own
  cap (`WALK_MAX_TICKS`). What the budget still catches is a step that keeps yielding and never
  returns (a loop of ops that moves the bot or the inventory, so the watchdog never fires, and
  starves `isComplete` and step choice). Yet legitimate steps keep hitting it (mining's respawn
  wait, shop trades, smithing, long walks, each once ending `stuck`), and the fix spread budget
  bookkeeping into ops: `ctx.stepTicksLeft()`, walkTo's `reserveTicks`, callers' `AFTER_WALK_TICKS`
  sums. Proposed: raise the default to a generous backstop (about 10 min, far above any op's cap)
  and delete `stepTicksLeft`/`reserveTicks`, so walks fall back to their own cap. Alternative: drop
  the budget and make "a loop inside a step is bounded" a review-lens criterion. Touches
  `lib/engine.ts`, `lib/task.ts`, `actions/walk.ts` and `context.ts`, the walking tasks (combat,
  smithing, shop, firemaking, `lib/area.ts`) and their tests; re-review the tasks.

## Max route

The plan to max as fast as possible, filled in while exploring (conductor skill: Explore, then
Execute). One row per skill: the fastest **measured** method so far (local, 25x XP), its rate and
band, and what is left between it and tick-perfect. Explore goals target the empty or wide rows.
First drafts are assumed suboptimal; a rate here is a floor, not the route's final number.

| Skill | Lvl | Best measured method | XP/h | Gap to close / next |
|---|---|---|---|---|
| Thieving | 99 | Falador guards, Trout/Salmon, one East booth (plan guard-thieve) | 2.2M (82-99, 683k in 19 min) | at 99, done; no tick budget taken (pickpocket delay vs stun/eat ticks); only matters if XP is wanted from it |
| Mining | 99 | iron power-mine, drop each ore (02b861cd5), a 4-rock layout (SE Varrock or Rimmington, area mode) | 1.167M (6.75 ticks/ore) | at the engine floor for iron: 5-tick swing + a step; 3-rock spots are respawn-bound (7.6); standing still and roll-tick clicks gain nothing |
| Fishing | 79 | Lumbridge lure, cook + bank (plan lure-cook-bank) | ~1.1M | drop vs cook; better spot at 80+ |
| Cooking | 83 | Lumbridge pot, inside lure-cook-bank | 345k (alone) | a range next to a bank; cook while fishing |
| Woodcutting | 80 | Draynor willows chop + burn (plan willow-burn), steel axe | 667k (WC) / ~1.43M with FM | no tick budget yet: 5 trees (respawn waits), 12-tile walk to the burn line, axe tier; yews/maples at 80+. Spot search + A/B pending |
| Firemaking | 78 | willow logs line burn inside willow-burn | 768k | 2nd burn line costs a walk-back; maple/yew logs |
| Agility | 41 | Gnome course (plan gnome-agility) | ~224k (1-38) | per-obstacle idle ticks; higher courses |
| Magic | 41 | Wind Strike, Lumbridge chickens | ~150k (1-41) | predicted: rune-bound, not time-bound: 41-99 is ~800-2,000 casts (<1 h at 5 ticks/cast) on a high-HP target: Fire Bolt (staff of fire) -> Wind/Fire Blast (death runes, Aubury 1000 stock, price ramps ~1%/unit short, cap 6x); ~50-140k gp. Alchemy not worth the nature-rune detour |
| Ranged | 40 | Shortbow, Lumbridge chickens (14,400 XP in 10 min of plan) | ~86k (13-40) | predicted: willow shortbow (Dargaud, Ranging Guild, 200 gp) rapid (3 ticks) + iron/mithril arrows on hill giants ~450-750k, arrows picked up (80% drop); maple/yew need Fletching |
| Smithing | 39 | iron kiteshields (plan iron-smith) | 140k | predicted (route search, not run): banked iron in bulk phases (mine SE Varrock -> Varrock East bank; smelt Al Kharid furnace + bank; platebodies at Varrock anvil + bank) ~250k; Superheat (Magic 43; nature runes only at the Mage Arena) ~520-600k; Ring of Forging ~740k; steel worse per tick |
| Hitpoints | 47 | from combat | - | predicted: finishes with melee (1.33 XP/dmg vs 4 per melee skill) |
| Crafting | 35 | pottery | 65k | leather, gems, glass |
| Fletching | 30 | arrow shafts | 70k | oak/willow longbows (u) |
| Attack/Strength/Defence | 40/44/40 | Lumbridge cows, steel scimitar, cooked fish (plan melee40, 13 min for 15-25 -> 40) | 173-203k | predicted (engine data, 2026-10-16 research): Edgeville Dungeon hill giants (35 HP, def 26, 12 spawns ~(3106,9834)) + Mithril scimitar (1,040 gp, Zeke) ~440k/skill at 40, ~570k at 55, ~750-900k with a rune sword (20.8k, Champions' Guild, 32 QP); Strength first; HP rides along; big bones -> Prayer. A/B on w3 in flight |
| Prayer | 15 | bones from combat | - | predicted: big bones from hill giants while training melee, 375 XP each buried, ~60-95k/h |
| Herblore | 1 | locked: Druidic Ritual (runner in flight 2026-10-14) | - | predicted (engine data, not run): herb supply binds, not clicks (identify/mix have no delay, ~1,300 potions/h). No shop sells herbs; best source found chaos druids ~0.45 herb/kill (~220 herbs/h, ~0.1-0.25M XP/h); lantadyme/dwarf weed ~2% of drops, so 70-99 by drops is infeasible: find a bulk herb source (Miscellania unevaluated) |
| Runecraft | 1 | locked: Rune Mysteries (runner in flight 2026-10-14) | - | predicted (engine data, not run): one air trip to 9, then Aubury teleport -> essence -> earth ruins (3305,3472), ~180 ticks/28 ess, 130-150k (rune pickaxe saves 28 ticks/trip). XP is per essence; no tiaras or pure essence in this rev; needs an earth talisman (men 2/128). `runecraft` task being authored |

Route-wide: banks are one account-wide bank; the walk ops pay the Al Kharid toll gate both ways
(09c37ed56), so routes through Al Kharid need 10 gp, not a detour.

## Experiments

Variants worth comparing with `bun conductor/tools/stats.ts`. Each line: hypothesis, variants, status.

- Skill speed ranking at the current levels (XP/hr): Thieving guards 1.27M (with food), Mining iron adamant
  875k, WC oaks 780k, Cooking pot 345k, Smithing 140k, Fishing 95-200k, Crafting 65k, Fletching 70k.
  Hypothesis: Agility (Gnome ~2.2k XP/lap) beats the slow ones at level 1. Status: measure on the first run.
- Fletching: arrow shafts are the slowest gain. Hypothesis: shortbow/longbow (u) on oaks is 2-4x
  XP/log. Variants: shafts vs oak longbow (u) at Fletching 30+. Status: untested.
- Crafting past 35: pottery caps near Crafting 40 for useful XP; compare leather/gem cutting. Status: untested.
- Combat target: chickens Def 108k/h, Str 83k/h, Att 55k/h vs 300k-1M/h for gathering. Hypothesis:
  cows/goblins and a better weapon give 3-5x. Status: untested; run after Ranged/Magic.
- Mining rock: iron with the adamant pickaxe ~875k/h vs bronze 541k (different start level). Next: coal
  and mithril at 55-70+. Status: iron done.
- Woodcutting: oaks steel ~780k/h done; next willows/yews at WC 60+ and an oak -> bank loop vs drop.
- Firemaking: line burn: 26 logs Lumbridge field 5 lines 91.6s -> 9 lines 79.6s once wall edges are
  checked (author result). Compare against sidestep at the FM 60+ rate. Status: pending review.
- Cooking at the Lumbridge Cooking pot beats the range (west-side unreachable); done (345k/h).
- Tool tier skipping: steel axe done; test steel -> mithril directly beats stepping.
- Smithing method: iron kiteshield loop 140k/h (bars 50% smelt fail) vs smelt-only 131k/h. Variants: ring of
  forging, steel bars (coal), smithing bigger items per bar (platebody 5 bars). Status: untested.
- Tick-perfect pass on combat (priority): from a `melee40` and `ranged-magic` replay compute idle ticks per kill
  (walk, loot, eat, bury, re-target). Spot search for cows/goblins vs stronger targets (hill giants, guards)
  and weapon tier; A/B on a worker at one spot. Metric: XP/h per skill. Status: not started.
- Tick-perfect pass on willow-burn and Fishing/Cooking (cheap, ~1 h each left): burn line next to the trees,
  cook while fishing. Status: not started.
- Hand-curated connectors (`lib/connectors.ts`, 176 lines; Wizards' Tower door c0593d7f1, Taverley 2026-10-16)
  have cost two blocked goals. Hypothesis: the world-index phase 2 spec (connectors from the scripts) removes
  the class; schedule it before the next quest goal. Status: spec drafted, not authored.
- Runner process: plan-first from loop 1 and run to goal in the background. Metric: plain runs per goal
  and idle minutes between a RESULT and the next run (journal `at` gaps). Status: after the checklist
  restructure (retro #4) and `--objective` auto-journal; measure on the next three runners.
- Chain robustness: plans (`when` predicates on inventory) replaced numbered chains; one failure
  mode left: plan `when` bugs (pottery-craft craft-bowl matched an unfired pot). Status: watch.

## Review follow-ups

Review findings `task-review` deferred because their fix needs work outside the reviewed change
(most findings are fixed in the same pass).

- walkTo: the Wizards' Tower stairs/ladder room (x 3103..3107, z 3159..3163) is entered by a diagonal elf door (3107,3162) that `sdk/collision-data.json` lacks, so `collisionPaths` finds no route in from outside and `walkTo` into the tower ends `no-path` (connectors work from inside the room); needs diagonal-door support in the SDK collision data or in `walkOnPlane` (game G3)
- walkTo: connector `hazard` is only logged (`walk: WARNING at ...`); add an opt-in `WalkOptions` gate (e.g. a combat floor on the Falador mine stairs: scorpions hunt combat 28 and under) that returns a distinct reason, and make the shop task use it before walking into the Dwarven Mine; touches tasks outside the walk change (safety S1)
- crafting: station helpers (find/walk-to wheel and oven) are local copies of the ones in smithing.ts; refactor both into lib/ (touches smithing.ts, out of the crafting review's scope) (code-quality Q4)
- fishing: learnings/fishing.md:76 labels the Al Kharid spot (3267,3148) Lure/Bait but map data says Net/Bait (npc 330); River Lum Lure/Bait spot (3238,3252) and the Draynor four hop tiles + dark-wizard hazard are missing (contract T6)
- combat: a `--until` stop (minutes/xp) can land mid-fight. `engine.ts` `finish()` only eats, so
  the run ends with `inCombat: true` and the next run is refused ("in combat ... handle the
  attacker first", `executeTask` in engine.ts). The task can't fix this: no stop hook, and `isComplete` runs
  after `checkStops`. The engine fix is to defer a stop while `player.combat.inCombat`, with a
  bounded grace of about 30 s, or to wait out a fight before refusing at start (robustness R5,
  safety S1).
- bank: `bankInView` in `tasks/bank.ts` (/^bank booth$/, /banker/) is looser than `findUsableBooth` in `actions/bank.ts` (bank chests, Closed booths, usable options); export one shared predicate from the action so the no-walk shortcut cannot skip a walk and then fail no-bank-found (game G3, contract T5, code-quality Q3).
- Knowledge: `learnings/banking.md` lacks the stand tiles in `lib/banks.ts` (Varrock East verified by smoke 2026-10-10T01-34-59-869Z-bank; Falador West/East, Edgeville map-data only; Draynor/Al Kharid skip reasons) (contract T6).
- essence-mine: the Aubury Teleport is a raw `interactNpc` send; add a generic `interactNpc(npc, option)` op in `conductor/actions/interact.ts` mirroring `interactLoc`, with actions test and itest (contract T4).
- Knowledge: no `wiki/skills/runecraft.md` or learnings entry for the essence-mine landing spots, the portal exit coord (defaults to Sedridor when unset), or talisman-on-ruins entry (contract T6).
- Engine/lib: `Counter` has no read method (tasks read with `add(0)`); add `value()` (shop review).
- Lib: pickup and fletching copy the same `attacked` step (fail on any `inCombat`); make it a
  shared guard in `lib/interrupts.ts` beside `underAttackGuard` (code-quality Q4, contract T1).
- Actions: the fletch op (`conductor/actions/fletch.ts`, ported from `bot.fletchLogs`) clicks the
  product's make-1 button, so the fletching task cuts one log per call (~4 s/log against 0.8 s);
  add Make 10 / Make X to the op and let the task batch (game-semantics G5). No SDK change needed.
- Lib: `lib/saves.ts` builds its own copy of the engine XP table (`LEVEL_XP`, tenths) and a
  private `levelForXp`; have it use `xpForLevel`/`levelForXp` from `lib/xp.ts` (scaling tenths)
  and drop the copy, which also gives the `lib/xp` exports a caller outside their test
  (code-quality Q3).
- Knowledge: `learnings/hazards.md` has no White Wolf Mountain entry (white wolves lvl 25/38 attack combat-22 bots on the Lumbridge -> Gnome Stronghold route; the `travel` task takes the HP hit and relies on carried food; ~8 HP lost over a 270 s run with 10 shrimps eaten) (safety S1).
- Actions: `clean` (dialog text strip) in `actions/gate.ts` duplicates `actions/climb.ts`; export one shared helper (touches climb.ts, out of the travel review's scope) (code-quality Q3).
- Lib: thieving copies combat's `foodInInventory`/`wantsToEat` (`tasks/combat.ts`); move both to
  a shared `lib/food.ts` taking `{ food, eatBelow }` and have both tasks import it (contract T5).
- Brief accuracy: the conductor's dispatch told a runner "Falador has a furnace, an anvil" (false: no
  Falador anvil, `learnings/smithing.md:48`) and cost it ~25 turns; briefs state only facts a page confirms.
