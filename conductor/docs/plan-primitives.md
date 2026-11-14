# Plan primitives: what plans work around, and the runner features that replace it

Design from the 2026-11-14 audit of the catalog (30 tasks), the promoted plans (95, of which 51
quest plans; 1,587 phases) and the layers under them. Built per
[`plan-primitives-spec.md`](plan-primitives-spec.md). The user's direction (2026-11-14): tidy the
common things so tasks and plans are easier to write and maintain, and give quest plans a more
specific API than plans. This doc covers the runner and view primitives every plan needs; the quest
layer builds on them and gets its own design (see "Next: the quest layer").

## What the audit found

Counts are greps over `conductor/plans/*.ts` at `65072140c`.

| Gap in the runner or view                                                                                               | What plans do instead                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No retry: a phase that fails with `continue` is skipped at the next selection (`skip`, `lib/plan.ts`)                   | `-b` duplicate phases, retry bundles per file; 409 `onFail: 'continue'`, 874 `maxFails`                                                                   |
| No deliberate wait: the idle rail cannot tell waiting from stuck                                                        | 45 `talk continue` phases, `pickup` of a never-held item as a timer (16 `maxWaitTicks`), no-op "settle" walks, phase pairs alternating on the tick parity |
| No settle between phases: the state is read the instant a phase returns, before a move or pickup it caused is published | 127 `v.last` checks, most of them "the last phase was X and done" standing in for a position or item                                                      |
| No per-plan defaults                                                                                                    | the same `onFail`/`maxFails` pair on most phases of a quest plan                                                                                          |
| The view has no position, proximity, worn-item or dialog-history members                                                | `started` redefined in 37 files, `px`/`pz` in 34/31, `lvl` in 19, `near` in 13; 412 raw `v.state.` reads                                                  |
| Nothing checks a plan file beyond its method link                                                                       | `/axe$/i` matching a pickaxe in three plans; phase names in `v.last?.phase === '...'` unchecked                                                           |

The local helpers have drifted apart, which is a correctness risk and not only noise: "underground"
has at least seven definitions across quest plans (`pz > 9000`, `>= 6000`, `> 5000`, boxes), `near`
differs on whether it checks the floor, and `said` differs on whether a pattern may match across the
lines of one page.

Run history agrees with the code reading: of 305 plan runs in `conductor/runs/`, 119 ended failed,
among them 19 `no phase applies` and 18 preflight refusals.

## Decisions

- **`onFail: 'retry'`.** The failed phase stays eligible at the next selection; `maxFails` (in a
  row) is its budget. A retried failure is left out of the idle rail: the budget bounds it.
  `'continue'` keeps today's meaning (skip once, a fallback takes the turn).
- **`defaults` on a plan**: `{ onFail?, maxFails? }` for every phase that sets none.
- **Settle before the next selection.** After a phase run the runner reads states until two in a row
  agree on XP, inventory and position (at most 5 reads), then does its idle accounting and selects.
  These reads are the plan's, between two phase runs, like the existing end-of-plan XP settle: no
  phase recording contains them, so `replay.ts` is unaffected. It costs one tick at a phase
  boundary, so a plan or a phase can turn it off (`settle: false`) where a boundary is on a
  tick-perfect path.
- **A `wait` catalog task** (`ticks`, `orFail`), ended early by its phase's `until`. A wait its
  `until` ended is progress by definition and is left out of the idle rail; one that ran its ticks
  out is an ordinary run, so three unchanged timeouts still end the plan.
- **View members** (scalars or functions, so the plan log's `reads` record them): `x`, `z`, `floor`,
  `within(spot)`, `held(item)`, `worn(item)`, `npcs(name, within?)`, `locs(name, within?)`,
  `ground(item, within?)`, `said(pattern, sinceTicks?)`, `lastDone(...names)`,
  `lastFailed(...names)`, `combatLevel`, `coins`, `questStarted(id)`. Phase names passed to
  `lastDone`/`lastFailed` are checked like `runs`.
- **A plan lint** over every promoted plan in `bun test conductor`: params parse, phase-name
  references exist, and no item pattern matches both an axe and a pickaxe.
- **Existing plans are not migrated here.** They were proven by runs; a mechanical rewrite without a
  run is not a proof. Only what the lint finds, and the `plague-city` worn-mask check, is fixed.
  Migration happens plan by plan when a plan is next touched or re-run.

## Constraints kept

- A plan reads like data, imports only `@conductor/lib/plan` (and `lib/quests`) and catalog tasks,
  and its predicates stay pure.
- `run-task.ts`, the `RESULT <json>` line, `TaskResult` and recordings keep working as they are.
- No server change; `sdk/` and `mcp/` untouched.

## Next: the quest layer

Built: see [`quest-layer.md`](quest-layer.md) (design) and `docs/plans.md` (Quests). The notes below
are the audit that led to it.

A quest is a linear story, and a plan is a priority list with no stage: the quest tab shows only
none/started/done, since the server sends no quest varp. So quest plans are written finish-first and
each reinvents stage tracking: held items, dialog-history patterns (23 plans read
`state.recentDialogs`, which the client holds in memory), `v.runs` chains (161 uses, lost on a
process restart), position, and sacrificial markers (`fremennik-trials` drops one Bones per step;
`priest-in-peril` has a `drop-marker` phase).

Direction, to be designed after a spike:

- `defineQuest({ id, steps: [step(name, task, params, { done })] })` in story order, compiling to
  phases so the runner, logs, plan viewer and replay stay as they are.
- A cursor from three sources: a step's `done` evidence, a stage probe, and a persisted per-bot
  record for steps that leave no trace.
- The stage probe: every quest has a `*_journal.rs2` script on its quest-tab button whose text is
  built from the stage varp (`quest_priest/scripts/priest_journal.rs2`). Clicking the entry opens
  `questjournal_scroll`.
- Spike result (2026-11-14, worker `conductor3w1` on `lib:dragon-slayer-ship-deck`, lite client,
  `bots/conductor3w1/journal-spike.ts`): `sdk.sendClickComponent(7383)` (`questlist:dragon` in
  `server/content/pack/interface.pack`) opened interface 8134 within 3 ticks, and
  `state.interface.debugInfo` listed every journal line as a component's text (`qj1` is component
  8145), ending "Now I should go to my ship in Port Sarim and set sail for Crandor!"; the same click
  on `questlist:priest` (7337, not started) read "I can start this quest by speaking to Father
  Aereck...". So the stage is readable with no client or server change on the lite client. The
  browser client's `StateCollector.collectInterfaceState` publishes no `debugInfo`, so a probe run
  there would need that added. The colour codes that mark finished lines (`@str@`) do not appear in
  the text read, so a stage is told by the last lines, not by which are struck through. Still to
  check: the journal modal's cost in ticks per probe, and that it never opens over a dialog a phase
  is holding.

## Other follow-ups from the audit (not in this build)

- Task catalog: done; params are described on their schema fields and `--list` is generated from them
  (design: `conductor/docs/task-catalog.md`).
- Task bookkeeping: done 2026-11-15 (design `conductor/docs/task-bookkeeping.md`); was: declared silent streaks in place of hand-summed `stuckAfterMs` (25 tasks), one
  streak-then-fail helper (93 blocks), one `waitForRespawn`, one eat step.
- Param naming and outcome codes: done 2026-11-15 (design `conductor/docs/naming-outcomes.md`).
- Places by name from the world index (216 literal coordinate pairs in training plans; Seers bank
  spelled three ways): built in part (`place()`, `tools/places.ts`; design `conductor/docs/named-places.md`).
  Plan parameters and level-band stages remain open.
