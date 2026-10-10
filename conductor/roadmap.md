# Roadmap: max the account

The conductor's long-range plan. The conductor keeps **Now** and **Backlog** current; the
retrospective agent proposes changes; knowledge (where things are, how they work) lives in
`learnings/` and `wiki/`, not here. Progress numbers come from `bun conductor/tools/progress.ts`.

Goal: 99 in all 19 skills (total level 1881) on the local server (members world, 25× XP).

## Now

State at 2026-10-09T08:41Z (run 1 paused): total level 310 (WC 70, FM 54, Mining 46, Fletching 35,
HP 22, Def 21, Str 19, Att 17, Prayer 16, rest 1). conductor1 logged out at the SE Varrock mine
(snapshot `pause-1`); bank at Varrock West holds 16 longbows, 2 knives, an uncut ruby, 309 shafts.
Catalog: `woodcutting`, `pickup`, `firemaking`, `fletching`, `mining`, `combat`, `bank`, `shop`,
`smithing`. All nine were ported to generator steps (`conductor/docs/interruptible-tasks.md`) and
reviewed with `task-review` on 2026-10-10, each with unit tests and an integration smoke test;
that supersedes run 1's unfinished reviews of `bank`, `smithing` and `mining`. No conductor run
has used them since the port: watch the first runs of each.

- Loop woodcutting (~300k XP/hr) -> firemaking (~810k XP/hr) for logs/XP; both are the fastest
  methods the account has. Combat is the slowest (Attack 41k/hr, Strength 45k/hr, HP 13k/hr).
- Next unlocks of total level are the 13 skills still at 1: each costs one small task and gives
  ~30-50 levels in minutes at 25x. Author in the order of the Backlog below.
- Settle combat gear (Defence 4, no armour, no food) before any area above chickens.

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

- `woodcutting`, `pickup`, `firemaking`, `fletching`, `mining`, `combat`, `bank`, `shop`,
  `smithing` — in catalog.
- `fishing` (shrimps/sardines, Lumbridge/Draynor; needs a net, 1 shop call) then `cooking` on a
  range (consumes the catch, gives food for `combat`'s `food` param) — idea
- `crafting` (leather/needle, cheap) and `thieving` (men/farmers; HP 17 now survives stuns) — idea
- `agility` course (Draynor rooftop, Gnome course) — idea, check Unlocks/wiki first
- `woodcutting` bank mode (keep logs for Firemaking/Fletching and money) — idea
- `combat` upgrades: eat real food, rotate styles, a better target than chickens (see Experiments) — idea
- money making to fund gear and supplies — idea
- quest tasks for the Unlocks table (Rune Mysteries, Druidic Ritual) — idea

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

- Combat XP/hr: chickens give Attack 41k/h, Strength 45k/h vs 300-800k/h for WC/FM, so melee to
  99 would be ~100x slower than gathering. Hypothesis: a higher-HP, higher-XP target (cows,
  Lumbridge goblins, Al Kharid warriors) and a better weapon give 3-5x. Variants: chicken vs cow
  vs goblin, bronze vs iron sword. Also compare XP per style (Controlled spreads XP). Status: untested.
- Firemaking spot/log type: 812k/h measured with normal logs at (3230,3240); compare oak logs
  (higher XP per log) once WC can supply them. Status: untested.
- Woodcutting: normal trees 304k/h at Lumbridge vs willows/oaks (higher XP per log, safe spot
  needed for HP 17). Status: untested.

## Review follow-ups

Review findings `task-review` deferred because their fix needs work outside the reviewed change
(most findings are fixed in the same pass).

- combat: a `--until` stop (minutes/xp) can land mid-fight. `engine.ts` `finish()` only eats, so
  the run ends with `inCombat: true` and the next run is refused ("in combat ... handle the
  attacker first", `executeTask` in engine.ts). The task can't fix this: no stop hook, and `isComplete` runs
  after `checkStops`. The engine fix is to defer a stop while `player.combat.inCombat`, with a
  bounded grace of about 30 s, or to wait out a fight before refusing at start (robustness R5,
  safety S1).
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
