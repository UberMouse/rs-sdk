# Lens: robustness

Does every run end, end for the right reason, and say why?

## Criteria

- **R1 Bounded failure.** Every step that can fail repeatedly counts failures in a row with
  `ctx.streak(name)` (the engine ends a streak when the step stops applying; `ctx.counter` is for
  run-scoped totals only; this is the one place that rule is reported, contract T7 points here), resets the count on success, and returns `{ fail }` past a small
  limit with the last failure's message in the reason. No step can loop forever without the
  watchdog being the only thing that ends it.
- **R2 Progress or fail.** A step that runs but changes nothing (no XP, position or inventory)
  is either waiting for something specific with a bound, or failing. Steps don't spin on
  conditions that cannot change.
- **R3 Step selection.** `when()` predicates are ordered so the first match is right: urgent
  states (full inventory, out of area) come before the grinding step; no step's `when` is
  always true unless it is last; two steps can't keep handing control back and forth. A `when`
  is pure (the engine checks every step's `when` every loop): no side effects in it, such as
  `streak`/`counter` `add` or `reset`, `ctx.memory` writes or logging. This is the one place
  `when` purity is reported (contract T7 points here).
- **R4 Preflight.** Missing requirements (tools, levels, items, being in the right region) are
  refused in `preflight` with a clear reason, not discovered as a mid-run failure.
- **R5 Recoverable interruptions.** The task survives what normally happens: a level-up dialog,
  a random event NPC, another player taking the resource, a respawn delay, the bot being
  attacked, a door closing behind it. Dialogs, low HP and leftover modals are the shared
  guards' (`allow` only for a task that drives them on purpose); being attacked while skilling is
  `guards: [underAttackGuard]`. Threat checks in a step or op duplicate them (T9).
- **R6 Honest outcomes.** `{ done }` is returned only when the objective is met; failure reasons
  name the cause and the evidence (what was tried, what came back), so the conductor can tell a
  world problem from a script problem.
- **R7 Exceptions.** No `throw` for expected game outcomes (ops return a tagged result);
  awaited promises can't reject unhandled; `ctx.state()` is not called where state may be absent without handling it.
- **R8 Cancellation.** A `catch` in an op or a task step starts with `rethrowIfCancelled(e)`
  (or rethrows `Cancelled`): swallowing it leaves a step the engine cancelled still running.
  Cleanup that must run when a step is cancelled (closing a bank) is in `finally`; a multi-tick
  sequence that must not be cut mid-way is inside `uninterruptible`.
- **R9 Game time.** Budgets and give-up limits are ticks (`state.tick`, `wait`/`ticks`), as
  named constants. `Date.now()`, `setTimeout` or a sleep in task, action or core logic is wrong:
  it neither follows game time nor replays in a unit test. (Only the contract's `stepTimeoutMs`
  and `stuckAfterMs` are milliseconds, and `stuckAfterMs` outlasts the task's own longest
  legitimate silence.)

## Bands

- **A** — a normal run ends in `stuck` or loops forever (watchdog or step timeout is the only
  exit), or ends `done` without meeting the objective; an R8 catch that swallows `Cancelled`
  on a path a stop, guard or timeout takes.
- **B** — a common interruption (R5) or requirement (R4) ends the run with a misleading reason
  or after wasting most of it; an R1 count that never resets (or a `ctx.counter` used for a
  streak), so long runs fail spuriously; an R3 `when` with side effects; an R9 wall-clock limit
  in task logic.
- **C** — an R6 reason that is vague but not wrong; a bound much larger than needed.
- **D** — an interruption you could not show happens in the task's spots.
