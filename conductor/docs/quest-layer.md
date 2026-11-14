# The quest layer: quests written in story order

Design from the 2026-11-14 audit ([`plan-primitives.md`](plan-primitives.md), "Next: the quest
layer") and the journal spike. The user's direction (2026-11-14): quest plans should have a more
specific API than plans. Built per [`quest-layer-spec.md`](quest-layer-spec.md).

## The problem

A quest is a linear story. A plan is a priority list with no stage: the first phase whose `when`
holds runs. The quest tab gives three states (none, started, done), since the server transmits no
quest varp. So each of the 51 quest plans is written finish-first and rebuilds the stage from what
it can see: held items, dialog-history patterns (23 plans), `v.runs` chains (161 uses, lost when the
process restarts), position, `v.last`, and items dropped as markers. `gertrudes-cat.ts` shows all of
it in 177 lines: the phases read last to first, the crates are tracked by `v.runs`, one talk is
written three times as a retry, and the finish is gated on which phase ran before.

## What the spike showed

Runs on worker `conductor3w1` (lite client, mid Dragon Slayer, scripts
`bots/conductor3w1/jspike-*.ts`):

- Clicking a quest's tab entry (`questlist:<id>`, ids in `server/content/pack/interface.pack`) opens
  interface 8134 two ticks later, and `state.interface.debugInfo` lists its components: the title
  (`#8144`, the name the quest's journal script gives, which is not the tab name for 16 of the 68
  quests) and the journal lines (`#8145`, `#8147`-`#8195`). Closing takes
  two ticks. 5 of 5 runs each way.
- A walk in progress carries on through the click and the close.
- **The click destroys an open chat dialog or shop**, with no rejection and no way back. So a read
  may only happen with no dialog and no modal open.
- The lite client strips the `@str@` tags that strike finished lines, so the text does not say
  which lines are finished. A journal is cumulative for some quests (Dragon Slayer keeps every
  earlier line) and rewritten per stage for others. A completed quest ends "QUEST COMPLETE!".
- The browser client's `debugInfo` lists only buttons (depth 3), so it would not carry the journal
  lines (read from `Client.ts`, not run). The quest layer's journal read is lite-client only; the
  conductor's bots run the lite client.

## Decisions

- **Journal memory, like bank memory.** The plan runner already remembers the bank from any state in
  which it was open. It does the same for the journal: any state with interface 8134 open is parsed
  (title to quest id through the quest's journal title in `lib/quests.ts`) and kept. Predicates stay pure: `v.journalSays(id,
pattern)` reads the memory and is `undefined` before the first read; `v.journalAge(id)` counts
  the acting phase runs since.
- **The read is a catalog task, `journal`**, run as an ordinary phase: click the entry, see the
  journal, close it. It refuses to click while a dialog or modal is open. It is marked `observes`:
  such a run does not become `v.last`, is not counted by the idle rail, and does not age the journal.
- **`defineQuest` compiles to a plan.** Steps are listed in story order; the result is a `PlanDef`,
  so `run-task.ts --plan`, the plan log, the viewer, recordings and replay are unchanged.
- **Two kinds of evidence on a step.**
    - `reached`: the story is past this step. A predicate, or `journal(/pattern/)`. The last step
      whose `reached` holds sets the base; everything up to it is behind.
    - `done`: this step needs no run now (the item is held, the bot is upstairs). Checked for the
      steps after the base.
    - A step with neither is passed once it has run: when the previous acting run was a later step,
      or this step ending done (or ended at all, with `onFail: 'continue'`). A step with
      `onFail: 'continue'` is also passed by its ended run when it has a `done` that does not hold,
      and `defineQuest` refuses one with a `reached`. After a restart such a step runs again, so it must be harmless to
      repeat. That is the trade made instead of a persisted record.
- **No persisted per-bot record.** `load.ts` puts a different save under the same account name, so a
  record on disk keyed by bot would be wrong exactly when a quest is being tested. The journal gives
  the stage for every quest; within a stage, items and position do.
- **When the journal is read.** Only for a quest with a `journal(...)` milestone, only while the tab
  shows it started, and only with no dialog or modal open: at the first selection, after a step that
  carries a journal milestone ran, and after a failed run. A read costs about four ticks.
- **A journal milestone the read cannot confirm.** If the step ended done and the fresh journal does
  not match, the step runs again (the idle rail bounds this). If the journal cannot be read because
  a dialog or modal is open, the step is passed provisionally by run order.
- **Failure policy.** A quest's default is `onFail: 'retry'` with `maxFails: 3`, replacing duplicated
  retry phases; a step can override it.
- **One plan is converted as the proof**: `gertrudes-cat`, run live from its library save to quest
  done, and once more with a kill mid-quest and a fresh process. Other quest plans move over when
  each is next run.

## Assumptions (decided without asking, under "you can drive this")

- The parked `ql-queststage` branch (stage from transmitted varps, two quests only, a client change)
  is superseded and left parked.
- The browser client gets no journal support here: it would be a `server/webclient` change.
- `v.journalSays` matches the journal's non-empty lines joined by single spaces, so a pattern may
  span a line wrap.
- A journal read that shows text different from the previous read of that quest counts as progress
  for the idle rail (the stage moved though XP, inventory and position did not).

## Not in this build

- Converting the other 50 quest plans.
- Quest requirements (skills, other quests, items) declared once and checked from `lib/quests`.
- Generating a quest's step skeleton from its `*_journal.rs2` script.
