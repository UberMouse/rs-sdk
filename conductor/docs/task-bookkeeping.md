# Task bookkeeping: fail streaks, respawn waits and eat steps written once

Design from the 2026-11-14 audit ([`plan-primitives.md`](plan-primitives.md), "Other follow-ups") and
a survey of the 32 catalog tasks the same day. Built per
[`task-bookkeeping-spec.md`](task-bookkeeping-spec.md).

## What is there today

The audit's picture was partly out of date: two of the helpers it asked for exist.

- `lib/watchdog.ts` has `stuckWindowMs(...silentTicks)` and `failStreakTicks(limit, worstTicks)`.
  27 of the 32 tasks set `stuckAfterMs` through them. `ctx.streak(name)` and `ctx.counter(name)`
  give a step its counts, and `walkToArea` / `walkToSpotStep` wrap the walk streak.
- **The list behind each window is summed by hand.** Each task lists "every fail streak I can hold"
  beside its own `*_FAIL_LIMIT` constants. Nothing ties that list to the streaks its steps use, and
  `test/lib/watchdog.test.ts` checks the link for 8 tasks only. Five tasks set no window
  (`fletching`, `herblore`, `herd`, `prayer`, `teleport`); four of them have fail streaks, so the
  90 s default may end their runs `stuck` before their own reason fires. Not yet checked.
- **The limit check is written about 95 times** in 29 task files (`combat` 11, `runecraft` 7,
  `items` and `smithing` 6). About 70 are one shape: count an op failing in a row, reset on
  success, fail with "N <things> in a row failed (last: <message>)". Five tasks wrap it in a local
  `failed(message)` closure. About 10 more are a missing-target streak (wait 2 ticks, fail after 3
  looks) copied in five tasks.
- **Waiting for a respawn has four near-copies** (`woodcutting`, `pick`, `mining`, `fishing`): a
  memory field for when "none" began, one log line, an idle-tracked wait, an "area depleted"
  failure. They differ in the give-up ticks, mining's 100-tick chunks and fishing's message suffix.
- **The eat step is copied**: `combat` and `thieving` hold the same step (eat the configured food
  below `eatBelow`, three failed eats fail the run); `agility` has a near-copy (any food, below 75%).

## Decisions

- **A fail streak is declared once**, as a value: `failStreak({ name, limit, worstTicks, what })` in
  `lib/streak.ts`. It carries the limit, the silent ticks it can hold (`failStreakTicks`) and the
  noun of its failure. In a step, `streak.miss(ctx, message)` counts one and returns the `fail`
  outcome at the limit, `streak.clear(ctx)` resets. A reason that does not fit the standard
  sentence passes its own text. The count is still `ctx.streak(name)`, so the engine's reset when
  a step stops applying is unchanged.
- **A task lists what can keep it silent** in `TaskDef.silent`: declared streaks and plain tick
  counts (a respawn give-up, a long wait). `defineTask` sizes `stuckAfterMs` from it with
  `stuckWindowMs`. A task no longer writes `stuckAfterMs` itself.
- **The link is enforced.** `miss` on a streak the running task did not list in `silent` throws,
  so a streak cannot be used without being counted in the window; the unit tests of every task
  exercise it. The table in `watchdog.test.ts` goes: the rule now holds by construction.
- **One `waitForRespawn`** in `lib/respawn.ts`: the memory of when "none" began, the give-up ticks,
  the wait's label and predicate, the outside sighting, optional chunking, and the failure text.
  It exposes its give-up ticks for `silent`.
- **One `eatStep`** in `lib/eat-step.ts`: a food matcher, a threshold, the fail streak. `combat`,
  `thieving` and `agility` use it.
- **Behaviour does not change.** Every limit, tick count and failure reason stays as it is, to the
  character: plans match on some reasons, and the unit tests pin them. A stuck window may grow where
  the hand-summed list missed a streak, never shrink. The existing unit tests pass unedited except
  where they import a constant that moved. Shapes that are not "N in a row then fail" (best-so-far
  resets in `herd`, the idle-look waits in `combat` and `thieving`, capped non-failures) keep
  their own code and list their silent ticks in `silent`.

## Assumptions (decided without asking, under "you can drive this")

- Failure wording is not unified here; that is the naming and outcomes workstream, which will
  have one place to change it once the streaks are declared.
- No live run: nothing changes what a task sends or when. The proof is the unit suite unedited,
  plus a replay of one existing recording per migrated task where one exists
  (`conductor/tools/replay.ts`, first differing decision).
- The five tasks without a window get one from their declared streaks. If that shows a real gap
  (a streak longer than 90 s), it is a fix, and it is listed in the report.

## Not in this build

- Outcome codes, renamed params, reason-string synonyms.
- `pickup`'s spawn wait (a param-driven limit in 5-tick slices) and the look-count waits in
  `combat` and `thieving`: different enough to stay.
