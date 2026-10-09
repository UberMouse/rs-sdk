# Roadmap: max the account

The conductor's long-range plan. The conductor keeps **Now** and **Backlog** current; the
retrospective agent proposes changes; knowledge (where things are, how they work) lives in
`learnings/` and `wiki/`, not here. Progress numbers come from `bun conductor/tools/progress.ts`.

Goal: 99 in all 19 skills (total level 1881) on the local server (members world, 25× XP).

## Now

- Woodcutting to 30 on normal trees, then willows (task `woodcutting`).

## Unlocks

Skills and areas gated behind something other than levels. Check the quest page for its own
requirements before planning it.

| Unlock | Needs | Page |
|---|---|---|
| Herblore training | Druidic Ritual | `wiki/quests/druidic-ritual.md` |
| Runecraft training | Rune Mysteries | `wiki/quests/rune-mysteries.md` |

## Backlog

Tasks the catalog needs, roughly in the order the account needs them. Each line: what, why,
status (`idea` / `authoring` / `in catalog`).

- `woodcutting` bank mode (keep logs for Firemaking/Fletching and money) — idea
- `fishing` (shrimps at Lumbridge/Draynor) and `cooking` on a range — idea
- `mining` (copper/tin near Lumbridge) and `smithing` at a furnace + anvil — idea
- `combat` against an NPC with food, eating and style rotation (Attack/Strength/Defence) — idea
- `firemaking` from banked logs — idea
- money making to fund gear and supplies — idea
- quest tasks for the Unlocks table — idea

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

Variants worth comparing with `bun conductor/tools/stats.ts` (a different spot, target or
mode for the same objective). Each line: hypothesis, variants, status.

## Review follow-ups

Review findings `task-review` deferred because their fix needs work outside the reviewed change
(most findings are fixed in the same pass).
