# Roadmap: max the account

The conductor's long-range plan. The conductor keeps **Now** and **Backlog** current; the
retrospective agent proposes changes; knowledge (where things are, how they work) lives in
`learnings/` and `wiki/`, not here. Progress numbers come from `bun conductor/tools/progress.ts`.

Goal: 99 in all 19 skills (total level 1881) on the local server (members world, 25× XP).

## Now

State at 2026-10-09T07:58Z: total level 189 (WC 63, FM 53, Att 17, HP 17, Str 13, Prayer 10, Def 4, rest 1).
Catalog: `woodcutting`, `shop`, `combat`, `firemaking` (all reviewed, committed).

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

- `woodcutting`, `shop`, `combat`, `firemaking` — in catalog.
- `fletching` (knife + logs -> arrow shafts/shortbows; consumes woodcutting output, fast XP) — idea.
  Needs a knife from the General Store: one `shop` call.
- `fishing` (shrimps/sardines, Lumbridge/Draynor; needs a net, 1 shop call) then `cooking` on a
  range (consumes the catch, gives food for `combat`'s `food` param) — idea
- `mining` (copper/tin near Lumbridge; pickaxe = 1 shop call) then `smithing` at furnace + anvil
  (bronze bars -> kit and sellable items) — idea
- `crafting` (leather/needle, cheap) and `thieving` (men/farmers; HP 17 now survives stuns) — idea
- `agility` course (Draynor rooftop, Gnome course) — idea, check Unlocks/wiki first
- `woodcutting` bank mode (keep logs for Firemaking/Fletching and money) — idea
- `combat` upgrades: eat real food, rotate styles, a better target than chickens (see Experiments) — idea
- money making to fund gear and supplies — idea
- quest tasks for the Unlocks table (Rune Mysteries, Druidic Ritual) — idea

## Framework

Changes to the conductor system itself, decided with the user; not for the conductor to start
on its own.

- **Interrupts and long actions.** Interrupts only run between steps, so a task that waits on
  a long action has to reimplement the SDK action to make it interruptible. `woodcutting`
  copies `bot.chopTree`, including its `dismissBlockingUI` call, and holds its own "in combat:
  wait, don't click" block. Design an architecture where the engine owns waiting on an
  action's effect and interrupting it, so tasks state intent ("chop this tree") instead of
  polling. Move the combat wait into it as a shared interrupt.
- **Task → agent decisions.** Tasks can only end with a RESULT. Add a way for a task to raise a
  predefined decision to the supervising agent mid-run (pause with a question and options)
  instead of failing and making the conductor re-plan from scratch.
- **Account snapshot fixtures.** Today smoke tests run on the live account wherever it stands.
  A woodcutting smoke test on `conductor1` ended with the bot killed and its axe lost. Plan:
  - A library of named save states (`<name>.sav` plus a note of what state it is: task, area,
    levels, gear).
  - Recorded automatically at important moments (before a quest, on reaching a combat zone).
  - Generated from a spec by a script that builds a player and serializes it with the engine's
    own `Player.save()`: stats, inventory, equipment, position, and the varps that store quest
    progress.
  - Loaded into throwaway test accounts so tests don't touch the main account and can run
    concurrently. A `.sav` holds no name or account id (checksum over contents only), so
    copying it to `<test-bot>.sav` works. Exception: Grand Exchange participants load from the
    exchange checkpoint store, so keep GE accounts out of fixtures.
  - task-author smoke-tests against fixtures; task-review's evidence names the fixture.
- **New-bot setup.** Create a bot, skip the tutorial, record a fresh-account fixture: one
  scripted path instead of hand-run one-offs.

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
  attacker first", engine.ts ~l.208). The task can't fix this: no stop hook, and `isComplete` runs
  after `checkStops`. The engine fix is to defer a stop while `player.combat.inCombat`, with a
  bounded grace of about 30 s, or to wait out a fight before refusing at start (robustness R5,
  safety S1).
- Engine/lib: `Counter` has no read method (tasks read with `add(0)`); add `value()` (shop review).
- Engine/lib: export a `TICK_MS` constant (400 ms, `learnings/local-server.md`). combat.ts was
  authored with `MS_PER_TICK = 600` after the page was corrected; one reviewer caught it.
  pickup.ts repeated it (`TICK_MS = 600`, four lenses caught it); it now uses wall-clock time.
- Lib: pickup and fletching copy the same `attacked` step (fail on any `inCombat`); extract a
  shared step into `conductor/lib` (next to `returnToAreaStep`) (code-quality Q4, contract T1).
- SDK: `bot.fletchLogs` clicks the product's make-1 button, so the fletching task cuts one log per
  call (~4 s/log against 0.8 s); add a quantity option (Make 10 / Make X with the count dialog)
  and let the task batch (game-semantics G5).
- Knowledge: the headless-arrow recipe (Feathers on Arrow shafts) the fletching task uses is not
  in `learnings/fletching.md`; give it to the knowledge-curator (contract T6).
- Engine: a smoke test never exercises failure branches (woodcutting "area depleted", shop
  `shop_not_open` reopen); give tasks a test hook or use the snapshot fixtures item.
- Tooling: `conductor/tools/journal.ts` that appends a journal line stamped with the real UTC
  time (the conductor guessed times; F16), and a bot lease (owner + expiry) honoured by `run-task.ts`.
