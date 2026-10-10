# Roadmap: max the account

The conductor's long-range plan. The conductor keeps **Now** and **Backlog** current; the
retrospective agent proposes changes; knowledge (where things are, how they work) lives in
`learnings/` and `wiki/`, not here. Progress numbers come from `bun conductor/tools/progress.ts`.

Goal: 99 in all 19 skills (total level 1881) on the local server (members world, 25× XP).

## Now

State at 2026-10-10T02:50Z (conductor run 2, account `conductor2`, rev 289, 25x XP): total level 290
(WC 62, Mining 51, FM 47, Thieving 39, HP 19, Att 16, Str 16, Prayer 15, Def 15, rest 1). Ranged,
Magic, Cooking, Fletching, Fishing, Crafting, Smithing, Herblore, Agility, Runecraft are all level 1.
Holds a steel axe (bought 200 gp from Bob; ~780k/h on Varrock oaks vs bronze 358k/h), bronze
pickaxe, tinderbox, net, Knife, 19 Logs, little cash (~230 gp from thieving). Inventory is full of
logs; bank at Varrock West holds the junk. Committed: the nine run-1 tasks plus `cooking`,
`fishing`, `thieving`, the `bank` no-area fix, the winnable-attacker guard, and combat Ranged/Magic.
In review or authoring: `crafting` (pottery, in review), `firemaking` clear-line burn (in review),
`agility` and stairs/ladders in `walkTo` (authoring).

- Measured on 289: WC oaks 590k/h bronze -> ~780k/h steel; Mining iron 541k/h, copper/tin 159k/h;
  FM 689k-1.16M/h; Thieving men 91k/h (31 gp/min with food, 14 without); combat on chickens
  Att 55k/h, Str 83k/h, Def 108k/h. Melee is 5-10x slower than gathering: do not grind it yet.
- Immediate: clear the inventory (drop or bank the 19 Logs and any stray Oak logs), then the
  Fletching/Fishing/Cooking chain: fletching arrow shafts on Logs, net shrimps at Draynor, cook them.
  The last chain failed at fletching preflight on 2 stray Oak logs (see Experiments, Review follow-ups).
- Then: crafting pottery and agility when committed (cheap level-1 skills: each lifts total level
  fast), Ranged/Magic via `combat` skill param, firemaking line burn to FM 60+.
- Tool tiers (decided): thieve for money -> adamant pickaxe; Mining past 60 needs coal/mithril.
  Skip tiers when cheaper (user standing instruction: 25x XP makes the cheaper tier enough).
- Chains: put one inventory-clean step (bank/drop) before any task that is picky about inventory
  contents; do not leave leftovers from a skipped step.

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

- In catalog: `woodcutting`, `pickup`, `firemaking`, `fletching`, `mining`, `combat` (melee,
  Ranged, Magic), `bank` (no-area walk), `shop`, `smithing`, `cooking`, `fishing`, `thieving`.
- **Attack-in-transit hazard (fixed)**: `underAttackGuard` fights a winnable attacker to the end,
  bounded by progress; it fails at once for a stronger one. Tasks opt in with `guards: [underAttackGuard]`.
- In review: `crafting` (pottery at Barbarian Village), `firemaking` east-west line burn.
- Authoring: `agility` (Gnome course save exists), stairs/ladders in `walkTo` (`actions/climb.ts`,
  `lib/connectors.ts`; unblocks multi-floor routes, Draynor rooftop, upstairs banks).
- Next ideas, in order: `fletching` Make 10/Make X batching (see follow-ups); fletching tolerance
  for mixed logs; `woodcutting` bank mode (logs for FM/fletching and money); `smithing` from mined
  iron/coal; Herblore/Runecraft after their quests (Unlocks);
  quest tasks (Rune Mysteries, Druidic Ritual); money making for the adamant pickaxe;
  `combat` upgrades (eat real food, better target than chickens).

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
  - walkTo has no stairs, ladders or ferries: a route across levels fails `no-path`.
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

- Combat target: chickens Def 108k/h, Str 83k/h, Att 55k/h vs 300k-1M/h for gathering. Hypothesis:
  cows/goblins and a better weapon give 3-5x. Variants: chicken vs cow vs goblin, bronze vs iron
  sword, style. Status: untested; low priority until cheap skills are lifted.
- Mining rock: iron 541k/h vs copper/tin 159k/h done. Next: coal at Mining 50+ with the adamant
  pickaxe plan. Status: iron done, rest untested.
- Woodcutting: steel axe on oaks ~780k/h (done); next compare willows/yews at WC 60+ and an
  oak -> bank loop vs drop. Status: axe done, trees untested.
- Firemaking: oak logs 1.16M/h at Varrock (short run), normal logs 689k/h; the clear-line burn
  (in review) should stop the "can't light a fire here" failures. Compare line vs sidestep. Status: pending review.
- Tool tier skipping: the 25x XP shortens every tier; test whether steel axe -> mithril directly
  beats stepping through each (cost vs time). Status: steel done.
- Chain robustness: does a clean-inventory pre-step (bank/drop) vs tolerant tasks (select the
  wanted log by name) cut chain failures? Status: one failure observed (fletching, 2 stray Oak logs).

## Review follow-ups

Review findings `task-review` deferred because their fix needs work outside the reviewed change
(most findings are fixed in the same pass).


- firemaking: wiki/skills/firemaking.md:42-43 still says the task sidesteps on a refused light; it now picks a clear east-west line and marks refused tiles bad. Record the smoke-verified spots: Varrock oaks {3190,3458,r6} (26 oaks, FM 15->53) and Lumbridge NE {3256,3260,r6} (10 Logs, FM 1->33) (contract T6)
- crafting: station helpers (find/walk-to wheel and oven) are local copies of the ones in smithing.ts; refactor both into lib/ (touches smithing.ts, out of the crafting review's scope) (code-quality Q4)
- crafting: pottery facts missing from the knowledge base: Barbarian Village wheel (3087,3409) and oven (3084,3407) are ground floor with no gate, clay mines (Varrock SE (3180,3372), Rimmington (2986,3239)), softening 1-tick post-delay, make-menu behaviour, observed XP rate (Crafting 1->16 in 64 s, 7 pots) -> wiki/skills/crafting.md (contract T6)
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
