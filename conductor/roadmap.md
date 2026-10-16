# Roadmap: max the account

The conductor's long-range plan. The conductor keeps **Now** and **Backlog** current; the
retrospective agent proposes changes; knowledge (where things are, how they work) lives in
`learnings/` and `wiki/`, not here. Progress numbers come from `bun conductor/tools/progress.ts`.

Goal: 99 in all 19 skills (total level 1881) on the local server (members world, 25× XP).

## Now

State at 2026-10-16 (retro #8): conductor2, rev 289, 25x XP, total 1077/1881. Thieving/Mining 99, Cooking 83, WC 80,
Fishing 79, FM 78, Str 60 (hill giants in flight), Smithing 60, Runecraft 55, HP 53, Agility 52, Magic 41,
Att/Def/Ranged 40, Crafting 35, Fletching 30, Herblore 28, Prayer 25 (Restless Ghost done on w5, interact task in
review). Hours left at today's measured rates (XP to 99 / rate): Smithing ~931k / 115k = 8 h, Runecraft ~950k / 140k
= 6.8 h, Crafting ~987k / 306k = 3.2 h, Att+Def+Str ~2.8M / 600k = 4-5 h, Agility ~960k / 1.2M predicted = 1 h if the
Wilderness course holds, Magic/Ranged <2 h rune-bound (unmeasured), Fletching/Herblore/Prayer unmeasured. Smithing and
Runecraft are the longest rows: their methods, not clicks, bind.
In flight: hill-giants plan (runner, run 4 after the engine's stale-inCombat refusal fix landed uncommitted in
`engine.ts`: `isAttacked` replaces raw `inCombat`; joint review with agility `allowWilderness` pending); agility author
measuring the Wilderness course on w4; interact task review (Restless Ghost).
Next: Strength 70 then Att/Def on the giants (same spot), steel-bar Smithing experiment on a worker (Experiments), Crafting
flax-spin on the main account (committed 1ad9905b6), Prayer quests via `interact`.

Open conductor loop: a runner's Tick budget is now reported, but only the Runecraft earth number reached the
Max route (and only as a prediction). After each GOAL report write the measured XP/h and the next
optimization into the Max route row the same turn; Smithing and Runecraft rows were stale at retro #7.

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
| Agility | 52 | Gnome course (plans gnome-agility, agility-52), done 2026-10-16 | gnome ~254k lap-only (~130k/h incl. walk); worker 10-min runs 2026-10-16: Wilderness course 1.086M/h (Agility 55->77, 180,045 XP, 4 falls in ~90 obstacles, 1 Salmon), Barbarian 404k/h (41->63, 3 falls in ~140) | Wilderness clean lap 115 ticks / 15,035 XP (gate 20, door 16, pipe 16+2, rope 6, stones 16+1, log 17+2, rocks 11 + level-up 3; ~13 idle); a fall lap 145-167; ~1.17M/h with no falls. Barbarian clean lap 74-76 ticks / 3,487 XP (~12-15 idle). Skeletons (lvl 22) hit 2-8 HP/lap at the rocks/log; wolves stay off. Blockers before main: joint review (agility + combat engine change), `travel` refuses Wilderness routes so a plan cannot reach the door (2998,3915) yet (needs a travel opt-in), low-hp guard eat ignored mid-obstacle (worked round with an eat step). Next: main bot 52 -> 99 on Wilderness (~1.0h at ~1M; fails higher at 52) |
| Magic | 66 | Wind Blast + Staff of air on hill giants (plan magic-blast-giants), 41->66 in 641 s; superheat leg (Smithing row) carries it further | ~673k (41-66, one run) | predicted: rune-bound, not time-bound: 41-99 is ~800-2,000 casts (<1 h at 5 ticks/cast) on a high-HP target: Fire Bolt (staff of fire) -> Wind/Fire Blast (death runes, Aubury 1000 stock, price ramps ~1%/unit short, cap 6x); ~50-140k gp. Alchemy not worth the nature-rune detour Superheat (Smithing row) would pay ~1,325 Magic XP per cast alongside Smithing: ~994 casts for Smithing 60->99 take Magic most of the way to 99, so combat-spell training only needs to bridge to 43 (or 66 for the Magic Guild natures) Measured 2026-10-16 (main, plan magic-blast-giants): Wind Blast + Staff of air on hill giants, Magic 41->66 in 641 s, ~673k Magic/h casting (10.9 ticks/cast incl. kills, loot, bury; ~4 casts/kill); 145 death runes cost 7,417 gp at Aubury (ramp), staves 1,500 each at Zaff. Defence also gained +32k (check whether the combat task's Magic style splits XP to Defence, a loss if so). Rest of Magic comes from superheat |
| Ranged | 40 | Shortbow, Lumbridge chickens (14,400 XP in 10 min of plan) | ~86k (13-40) | predicted: willow shortbow (Dargaud, Ranging Guild, 200 gp) rapid (3 ticks) + iron/mithril arrows on hill giants ~450-750k, arrows picked up (80% drop); maple/yew need Fletching |
| Smithing | 60 | iron-bulk (7c188f8fb fixes): mine stock, Al Kharid furnace loads, Varrock West anvil kiteshields; done 52->60 in 926 s (2026-10-16) | ~112k/h (28,750 XP, incl 243 s travel; ore already banked); iron-smith loop 140k is still faster | per-load budget (retro #7 runner): mine 25 ore ~175 ticks, bank+walk ~140, smelt 25 ore -> 13 bars 288 (50% iron failures), smith 4 kiteshields ~30: walks + smelt idle dominate. Both iron methods are capped near 115-140k = 8 h to 99. Next: steel bars (coal, no failures) and Ring of Forging per-tick check on a worker; Mining 99 makes coal free; mithril/adamant bars give 2-2.5x XP/bar; Superheat needs nature runes Research 2026-10-16 (scripts, unmeasured): Superheat Item on iron ore (Magic 43; 1 nature + 4 fire) never fails (`skill_magic/scripts/spells/superheat.rs2` has no fail branch), pays the smelt XP (312.5) plus 1,325 Magic XP per cast, needs no furnace: cast at Varrock West bank, smith platebodies at (3188,3424); predicted ~1.0M smith-only, ~570k incl. mining, 60->99 in ~1.6 h, Magic to ~99 on the way. Never carry 2+ coal (iron + 2 coal superheats to steel). Gate: ~1,000 nature runes (Magic Guild needs Magic 66, Mage Arena is in the Wilderness, or craft at the nature altar) and ~20-40k gp. Next: superheat task + cast-tick measurement on a worker, nature-rune supply research Supply chain (research 2026-10-16, server data): Staff of fire (Zaff, 1,500 gp) replaces all fire runes; ~1,000 nature runes only from the Magic Guild (Magic 66, ~94.8k gp with the 1%/unit price ramp; Lundail has 250, Wilderness 55); crafting natures is out (nature talisman only from ~4/128 random-jewel drops). Coins: Knights of Ardougne pickpocket est. 90-100k gp/h at Thieving 99 (Falador guards measured 56k/h). Magic 41->66: ~106 blast casts (~110 death runes, Aubury, ~7-8k gp). Order: bank coin check -> thieve to ~105k -> staff + blast runes -> Magic 66 -> Yanille natures -> superheat (~2.5 h prep, then ~1.6 h for Smithing 99 + Magic ~99) Measured 2026-10-16 (worker w2, task `spell-items`): superheat = 3 ticks/cast, exactly 312.5 Smithing + 1,325 Magic per cast, 26 ore in 78 ticks (31 s), 0 dropped casts (the op holds the p_delay tick; without it every 2nd cast was lost). Cast-only ~940k Smithing + ~4M Magic XP/h: Magic 43->57 in 26 casts, so Magic 99 arrives in ~750 casts. Next: a restock plan (bank 26 ore + natures at Varrock West, superheat, smith platebodies at (3188,3424), bank) and its tick budget Loops measured 2026-10-16 (w2, 10 min each): superheat-banked 1.125M Smithing + 1.59M Magic/h (bank 33 ticks, cast 75, walk 22, smith 5 platebodies ~53 of which ~28 approach/menu); superheat-mine (SE Varrock mine -> anvil 3247,3404 -> Varrock E bank) 407k/h, 519 ticks per 25 ore, 37% walk/bank. Banked + separate bulk mining ~= mine loop. Next: Port Khazard iron (9 rocks at 2630,3143) is 22 tiles from an anvil (2651,3165); natures stack in one slot, so mine -> superheat -> smith -> drop platebodies needs no bank: measured 2026-10-16 (w2, plan khazard-superheat, smithing onDone drop): steady ~514k Smithing + 727k Magic + 480k Mining/h, 410-tick cycle = mine 25 ore 192 (7.7/ore, adamant pickaxe; 9 rocks never ran dry), cast 75, walk 40, smith 5 + drop ~63, walk back ~42; walking 20% (Varrock 37%). Mining is the long pole: a rune pickaxe is the next lever. Banked-ore 1.125M remains best for ore already in the bank |
| Hitpoints | 47 | from combat | - | predicted: finishes with melee (1.33 XP/dmg vs 4 per melee skill) |
| Crafting | 70 | Seers flax pick -> spin -> bank (plan flax-spin, now travels to Seers from anywhere), main account 35->70 2026-10-16 | ~322k measured on main (44->70, 111,750 XP in 1,247 s, 32 loops) | tick budget per 28-flax loop: spin ~132 ticks (47%), pick ~122 (43%), bank ~30 (10%). ~2.7 h to 99 at this rate. Next: the pick share is the lever (no flax shop known); research Crafting 70-99 alternatives (battlestaves at 66+ via orbs, gem cutting from the Ardougne gem stall) before the next Crafting leg |
| Fletching | 30 | arrow shafts | 70k | predicted: supply-bound, not clicks: cut (2 ticks/log, make-X) + string (no delay) longbows from the WC grind's logs + flax strings: oak 30-40, willow 40-55, maple 55-70, yew 70-85, magic 85-99 (~253 logs + strings total, <30 min of clicks); steel arrows (150 XP each, instant) as a gap filler, feathers ramp in price |
| Attack/Strength/Defence | 70/70/70 | hill giants ("Giant", lvl 28) + Mithril scimitar, burying bones (plans `hill-giants`, `giants-att-def`) | main account 2026-10-16: Str 54->70 541k/h (598 s), Att 40->68 582k/h (654 s), Def 40->70 635k/h (664 s); Prayer ~60k/h and HP ~180k/h alongside; food ~28-55 fish/h, falling above combat 65 | ~48 ticks/kill (Str run: fight 100, loot 25, bury 25, dialog 38, low-hp 7 step runs over ~25 kills); restock: Edgeville bank 60 s + walk back ~180 s. Plan notes: fight phases onFail continue (combat with no food caps NPC level at 5), two travel phases (direct from Edgeville; Al Kharid waypoints only from the south). Next 70->99: same giants lose value as levels rise (giants hunt only below combat 56, so no aggro now); a stronger target + adamant/rune scimitar; stop burying once Prayer quests run Next (research 2026-10-16, model fits the measured rates within ~10%): moss giants (60 HP vs 35, 4 spawns east Edgeville Dungeon (3158,9903)/(3165,9879)) ~+28% at equal overhead, worker measure in flight; then Rune scimitar (not sold: smith at Smithing 90 from 2 runite ore, Wilderness (3060,3885) or Lava Maze) + smithed adamant armour (Smithing 77-88) after the superheat leg: modelled ~2.5 h for 70->99 on all three vs ~3.7 h today. Scimitars swing every 4 ticks, longswords 5, so no bought weapon beats it; dragon scimitar does not exist; Protect from Melee drains too fast to beat food. Per-kill overhead (loot/bury/dialog ~18 ticks) is worth ~0.3-0.5 h |
| Prayer | 60 | Restless Ghost via `interact` task on w5 (+28,125 Prayer, 301 s); big bones buried at hill giants ~57k/h alongside Str | quests 28k per 5 min is the best rate so far (~340k/h equivalent); Priest in Peril 35k, Holy Grail 275k next; baby blue dragon bones untested | `interact` task in review; run Restless Ghost-style quests through it, then Holy Grail (check its requirements first) |
| Herblore | 28 | Druidic Ritual done; no training method measured (research in flight 2026-10-16) | - | predicted (engine data, not run): herb supply binds, not clicks (identify/mix have no delay, ~1,300 potions/h). No shop sells herbs; best source found chaos druids ~0.45 herb/kill (~220 herbs/h, ~0.1-0.25M XP/h); lantadyme/dwarf weed ~2% of drops, so 70-99 by drops is infeasible: find a bulk herb source (Miscellania unevaluated) |
| Runecraft | 55 | earth ruins via Aubury teleport, plan earth-runecraft-28 (265dea9bc), done 45->55 in 653 s | ~140k measured (25.5k XP in 653 s, 6 trips, XP is per essence so higher levels do not raise the rate) | trip ~270 ticks: enter-mine 64 (58 ruins <-> Aubury walk, 6 teleport), mine 115-148 = exactly 4 ticks/ess (floor), portal 6, craft ~69. ~6.8 h to 99 at 140k. Next: earth v2, i.e. drop the plan ROCK_AREA pin (nearest cluster, ~25 -> ~10 ticks) and drop the earth-rune stack each trip (27 essence), ~258 ticks/trip, ~153k/h modelled, worker draft in flight. Researched 2026-10-16 (runecraft.md): other altars do not pay. Fire needs ~29 Rings of dueling (cosmic only at Lundail, emerald stock 1) for ~186k, ~141k without them. Rune pickaxe -> ~171k if one drops. The plan ends inside the altar: the leave-altar `runecraft` errand always reports failed "no rune essence held" (stats noise) |

Route-wide: banks are one account-wide bank; the walk ops pay the Al Kharid toll gate both ways
(09c37ed56), so routes through Al Kharid need 10 gp, not a detour.

## Experiments

Variants worth comparing with `bun conductor/tools/stats.ts`. Each line: hypothesis, variants, status.

- Runner handback discipline (retro #7): the smithing runner called SubagentHandback with message "placeholder"
  right after launching a background run (turn 38): the harness reminder says handback is how a turn ends, and
  "end your turn and wait" in task-runner.md reads the same. The tool then refused the real report. Fix proposed:
  task-runner.md items 3/4 say "end your turn with one plain line of text; SubagentHandback only for the final
  report". Metric: handbacks without a RESULT in `reported`.
- Smithing bulk vs loop: measured (retro #8): iron-bulk 112k/h incl travel vs iron-smith 140k, so bulk iron is not the route. Next: steel bars on a worker (coal from the bank, Mining 99), per-phase ticks, vs Ring of Forging iron; target >300k/h. Status: not started.
- Al Kharid toll gate (retro #8): `walkTo` should pay it (09c37ed56, `actions/toll.ts`), yet hill-giants run 1 ended "Stuck at (3268, 3227)" with ~550 coins (travel waypoint (3270,3330) from Zeke's), while `learnings/hazards.md:18` still says the walk ops do not pay and "Fix being authored", and the Max route note says they do. Metric: repro on a worker at the gate with 500 coins; either fix the toll op or correct hazards.md. Until then plans route Al Kharid -> north via (3300,3315), (3260,3335) (run 2 reached the giants that way in 193 s).
- Runner wait friction (retro #8): task-author and task-runner agents hit "Blocked: sleep N followed by ..." (4 transcripts: agility runner turn 29, agility author turn 255, flax author turn 255, interact author turns 196/211) and "No such tool: Monitor"; they fall back to background sleeps and 100-590 s idle gaps. Fix: say in task-runner.md and task-author.md "wait with `run_in_background` on a `sleep N; tail` command and end the turn; never foreground sleep, no Monitor tool".

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
- combat (engine start refusal now uses `isAttacked`, uncommitted 2026-10-16; the finish-mid-fight deferral below is still open): a `--until` stop (minutes/xp) can land mid-fight. `engine.ts` `finish()` only eats, so
  the run ends with `inCombat: true` and the next run is refused ("in combat ... handle the
  attacker first", `executeTask` in engine.ts). The task can't fix this: no stop hook, and `isComplete` runs
  after `checkStops`. The engine fix is to defer a stop while `player.combat.inCombat`, with a
  bounded grace of about 30 s, or to wait out a fight before refusing at start (robustness R5,
  safety S1).
- bank: `bankInView` in `tasks/bank.ts` (/^bank booth$/, /banker/) is looser than `findUsableBooth` in `actions/bank.ts` (bank chests, Closed booths, usable options); export one shared predicate from the action so the no-walk shortcut cannot skip a walk and then fail no-bank-found (game G3, contract T5, code-quality Q3).
- Knowledge: `learnings/banking.md` lacks the stand tiles in `lib/banks.ts` (Varrock East verified by smoke 2026-10-10T01-34-59-869Z-bank; Falador West/East, Edgeville map-data only; Draynor/Al Kharid skip reasons) (contract T6).
- essence-mine: done 2026-10-16: `interactNpc(npc, option)` is in `conductor/actions/interact.ts` (with tests) and the Aubury Teleport uses it; the other raw `interactNpc` sends (bank, shop, fish, attack, pickpocket) still inline theirs.
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
