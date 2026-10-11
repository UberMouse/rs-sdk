# Roadmap: max the account

The conductor's long-range plan. The conductor keeps **Now** and **Backlog** current; the
retrospective agent proposes changes; knowledge (where things are, how they work) lives in
`learnings/` and `wiki/`, not here. Progress numbers come from `bun conductor/tools/progress.ts`.

Goal: 99 in all 19 skills (total level 1881) on the local server (members world, 25× XP).

## Now

State at 2026-10-11 (conductor run 2, account `conductor2`, rev 289, 25x XP): total level 469 / 1881,
1.55% of max XP. WC 66, FM 55, Mining 51, Thieving 49, Cooking 44, Fishing 40, Crafting 35,
Fletching 30, Str 25, HP 22, Att 16, Prayer 15, Def 15. Ranged, Magic, Smithing, Herblore, Agility,
Runecraft are level 1. Goals done this window: Fletching 30 / Fishing 40 / Cooking 44 (plans
`chop-fletch`, `fish-cook-bank`) and Crafting 35 by pottery (plan `pottery-craft`). In flight: a
task-runner on guard thieving for money (draft `runs/conductor2/plans/guard-thieve.ts`, Guards
unlock at Thieving 40).
Holds a steel axe, bronze pickaxe, net, Knife, tinderbox; cooked food is banked at Draynor.

- Catalog: `woodcutting`, `pickup`, `firemaking` (line burn), `fletching` (named logs, Make 10),
  `mining`, `combat` (melee/Ranged/Magic), `bank`, `shop`, `smithing`, `cooking`, `fishing`,
  `thieving`, `crafting` (pottery), `fill`, `agility` (Gnome course), `walkTo` across levels.
  Plans in `conductor/plans/`: chop-burn, chop-fletch, fish-cook-bank, pottery-craft.
- Measured: WC oaks steel ~780k/h; Mining iron 541k/h; FM 690k-1.16M/h; Thieving men 91k/h with food,
  166k/h without (+41 gp/min); Crafting pottery ~65k/h (Crafting 1->35 in ~12 min); cooking at the
  Lumbridge Cooking pot 345k/h; fishing net ~95k/h; fletching shafts 70k/h (slow: Make 10 helps
  only past Fletching ~30). Melee is 5-10x slower than gathering: do not grind it yet.
- Next, in order (each is a goal for a task-runner; level-1 skills first, each lifts total level fast):
  1. Agility 1 -> 40+ on the Gnome course (~2.2k XP/lap at 25x). Needs the bot at the Stronghold
     (task has no travel; the runner plans a walk or a `walkTo` step first).
  2. Smithing 1 -> 40+: mine iron/coal (Mining 541k/h) -> smelt -> smith, with banking in a plan.
  3. Ranged and Magic 1 -> 30+ via `combat` (cows/goblins with bow+arrows from fletching, strike spells).
  4. Money for the adamant pickaxe (guard thieving, in flight), then Mining 60+ (coal/mithril).
  5. Quests that unlock Herblore (Druidic Ritual) and Runecraft (Rune Mysteries; tower ladder works,
     tower-room entry is deferred, see Review follow-ups).
  6. Raise the leaders cheaply: WC willows/yews at 60+, FM line burn on logs for FM 70+, Cooking/Fishing
     on better food (trout/salmon need lure/bait fishing).
- Standing rules: bank leftovers and superseded tools between goals (task-runner rule); bank cooked
  food each loop; user instruction: skip tool tiers when the 25x XP makes the cheaper one enough.

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
- In review: firemaking wall-edge fix (user report: thin walls), cooking reach fix (walk to a tile that
  reaches the range). Both are uncommitted in the working tree; the main bot runs the working tree.
- **Attack-in-transit hazard (fixed)**: `underAttackGuard` fights a winnable attacker to the end. A
  Bear (lvl 21) roams the Lumbridge-Draynor road and failed two fishing walks; kill it once or route around.
- Next ideas, in order: `agility` travel to the Stronghold (or a walkTo preflight inside the task) and
  a second course for Agility 40+; `woodcutting` bank mode (logs for FM/fletching, money);
  `smithing` plan from mined iron/coal (mine -> bank -> smelt -> smith); `crafting` beyond pottery
  (leather, jewellery with gems/gold); quest tasks (Druidic Ritual, Rune Mysteries);
  `combat` upgrades (eat real food from the bank, better target than chickens); `prayer` (bury bones);
  `fishing` lure/bait for trout/salmon.
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

## Experiments

Variants worth comparing with `bun conductor/tools/stats.ts`. Each line: hypothesis, variants, status.

- Skill speed ranking at the current levels (XP/hr): WC 780k, Mining iron 541k, Cooking 345k,
  Thieving 166k, Crafting pottery 65k-310k (varies with water/clay trips), Fishing 95k, Fletching 70k.
  Hypothesis: Agility (Gnome ~2.2k XP/lap) beats all of these at level 1. Status: measure on the first run.
- Fletching: arrow shafts are the slowest gain. Hypothesis: shortbow/longbow (u) on oaks is 2-4x
  XP/log. Variants: shafts vs oak longbow (u) at Fletching 30+. Status: untested.
- Crafting past 35: pottery caps near Crafting 40 for useful XP; compare leather/gem cutting. Status: untested.
- Combat target: chickens Def 108k/h, Str 83k/h, Att 55k/h vs 300k-1M/h for gathering. Hypothesis:
  cows/goblins and a better weapon give 3-5x. Status: untested; run after Ranged/Magic.
- Mining rock: iron 541k/h vs copper/tin 159k/h done. Next: coal at Mining 50+ with the adamant
  pickaxe. Status: iron done.
- Woodcutting: oaks steel ~780k/h done; next willows/yews at WC 60+ and an oak -> bank loop vs drop.
- Firemaking: line burn: 26 logs Lumbridge field 5 lines 91.6s -> 9 lines 79.6s once wall edges are
  checked (author result). Compare against sidestep at the FM 60+ rate. Status: pending review.
- Cooking at the Lumbridge Cooking pot beats the range (west-side unreachable); done (345k/h).
- Tool tier skipping: steel axe done; test steel -> mithril directly beats stepping.
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
- Lib: thieving copies combat's `foodInInventory`/`wantsToEat` (`tasks/combat.ts`); move both to
  a shared `lib/food.ts` taking `{ food, eatBelow }` and have both tasks import it (contract T5).
