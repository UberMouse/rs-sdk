# Spec: task bookkeeping

Expands the design `conductor/docs/task-bookkeeping.md` into ordered tasks. Each `## Task N —`
section is one unit of subagent-driven work: implemented and committed by one agent, then reviewed
for spec compliance and code quality before the next starts.

## Global rules (apply to every task)

- **Do not edit** `sdk/`, `server/`, `mcp/`, `wiki/` or `conductor/plans/`.
- **Behaviour does not change.** Every fail limit, tick count, wait length, log line and failure or
  done reason stays as it is, to the character. No step is added, removed or reordered, no `when`
  changes, no op is sent that was not sent before. A task's stuck window (`stuckAfterMs`) may grow
  where its hand-summed list missed a streak; it never shrinks. Each such growth is listed in the
  report with the streak that caused it.
- **The unit tests are the proof.** An existing test is edited only to follow a constant or helper
  that moved (an import, a renamed export); its expectations do not change. A test that would need
  a changed expectation means the migration changed behaviour: stop and fix the migration.
- **Replay as a second proof.** For each task a batch migrates, replay up to two recent recordings
  of that task where they exist (`bun conductor/tools/replay.ts <run>.ticks.ndjson.gz`; recordings
  are under `/home/taylorl/code/rs-sdk/conductor/runs/<bot>/`, read-only; pick runs of at least
  50 loops). The report lists each replay and its outcome. A differing decision is a finding to
  explain or fix, unless the same recording already differs at the batch's parent commit (check
  that before blaming the migration, and say so).
- **Shapes that stay hand-written**: counts that are not "N in a row, then fail" (a reset only on
  a new best, a cap on events that are not failures, a look count that drives a re-centre walk).
  They keep their code and list their silent ticks in `silent`.
- **Formatting and lint**: finish with `bun run verify:conductor`. `bun run fmt` formats code in
  place; do not run a formatter over markdown files.
- **Unit tests** live in `conductor/test/**/*.test.ts`, need no server, never call `process.exit`.
  Run `bun test conductor` (never `bun test conductor wiki`, never two test runs at once).
- No integration tests and no live runs in Tasks 1-7; Task 8 runs the touched smoke tests.
- The catalog guard (`conductor/test/lib/catalog.test.ts`) and its shape fixture keep passing: no
  params schema changes. Catalog text that interpolates a constant keeps interpolating it.
- Game knowledge goes in `learnings/`, not in comments. Comments match the surrounding density:
  explain why, not what. No `Date.now()` in game logic.

## Task 1 — Declared fail streaks and `TaskDef.silent`

**Files:** `conductor/lib/streak.ts` (new), `conductor/lib/task.ts` (`TaskDef.silent`, `defineTask`),
`conductor/lib/engine.ts` (only where the context is built), `conductor/lib/watchdog.ts`,
`conductor/tasks/fill.ts` and `conductor/tasks/mining.ts` (the two proofs),
`conductor/test/lib/streak.test.ts` (new), `conductor/test/lib/watchdog.test.ts`,
`conductor/test/fixtures/stuck-windows.json` (new).

- `failStreak({ name, limit, worstTicks, what })` returns a declared streak: `name` (the
  `ctx.streak` name), `limit`, `silentTicks` (`failStreakTicks(limit, worstTicks)`), and
  - `miss(ctx, last?)`: adds one to `ctx.streak(name)`; at `limit` returns
    `{ fail: "<limit> <what> in a row failed (last: <last>)" }` (without the parenthesis when
    `last` is omitted), otherwise `undefined`;
  - `missWith(ctx, reason)`: the same count, with the caller's full failure text (a string, or a
    function of the limit) for reasons that do not fit the sentence;
  - `clear(ctx)`: resets the count.
- `TaskDef.silent?: (FailStreak | number)[]`: everything that can keep the task from changing XP,
  position, HP or inventory, as declared streaks or tick counts. `defineTask` sets `stuckAfterMs`
  from it with `stuckWindowMs`. A def that gives both `silent` and `stuckAfterMs` throws at
  definition, naming the task. A def with neither keeps the engine default.
- **The link:** `miss`, `missWith` and `clear` throw when the running task's `silent` does not
  hold that streak (the message names the task and the streak). The context carries what the
  helper needs to check this; choose the smallest addition to `TaskContext` and say what it is.
  Shared steps that own a streak (`walkToArea`, `walkToSpotStep`) are out of this check in this
  task: they keep `ctx.counter` / `ctx.streak` as they are, and export their silent ticks as a
  constant for `silent`.
- `stuckWindowMs` accepts declared streaks as well as numbers.
- Before any migration, generate `stuck-windows.json`: each catalog task's `stuckAfterMs` (or
  `null` for the default) at this task's parent commit. A test over every catalog task asserts the
  current window is at least the fixture's (the default counts as `DEFAULT_STUCK_AFTER_MS`), and
  that every declared streak in `silent` fits inside the window.
- Migrate `fill` and `mining` to the helper and `silent` as the proof: their `*_FAIL_LIMIT`
  constants stay exported where the catalog text or a test reads them.

### Acceptance criteria

- [ ] Unit tests for `failStreak`: counts to the limit, the two failure texts, `clear`, the engine
      reset when the step stops applying still works through it, the throw for an undeclared
      streak, the throw for `silent` plus `stuckAfterMs`.
- [ ] `fill` and `mining`: their existing unit tests pass with expectations unedited; their windows
      equal the fixture's.
- [ ] The window test covers all 32 tasks and fails when a task's window is made smaller than the
      fixture (checked by mutation, stated in the report).
- [ ] The 8-task table in `watchdog.test.ts` stays for tasks not yet migrated and loses `fill` and
      `mining` only if the new test covers what the table checked for them (say which).
- [ ] Out of scope: any other task file.

## Task 2 — The five tasks with no window

**Files:** `conductor/tasks/fletching.ts`, `herblore.ts`, `herd.ts`, `prayer.ts`, `teleport.ts`, their
tests, `conductor/test/fixtures/stuck-windows.json` is NOT edited.

For each: list every stretch the task can spend with no XP, position, HP or inventory change
before its own reason fires (each streak with its limit and worst ticks per attempt, each long
wait). Declare the streaks with `failStreak` where they are the standard shape and set `silent`.
Where the longest stretch exceeds what the 90 s default allowed, that was a bug (the run could end
`stuck` before the task's own reason): add a unit test that holds the task in that stretch and
expects the task's own reason. `teleport` gets `silent` only if it has such a stretch; if it has
none, leave it and say why.

### Acceptance criteria

- [ ] The report has, per task, the table of stretches (name, limit, worst ticks, total ticks) and
      whether the old default covered it.
- [ ] A test per real gap, failing at the parent commit for the right reason (stated in the
      report) and passing now.
- [ ] Existing tests pass with expectations unedited.
- [ ] Out of scope: the other 27 tasks.

## Tasks 3-5 — Move the other tasks onto declared streaks

One task per batch, the same work on different files:

- **Task 3 — gathering and processing:** `woodcutting`, `fishing`, `pick`, `pickup`, `cooking`,
  `firemaking`, `crafting`, `smithing`, `spinning`, `spell-items`.
- **Task 4 — interaction and movement:** `interact`, `talk`, `items`, `locate`, `combolock`,
  `travel`, `runecraft`, `essence-mine`, `bank`, `shop`, `agility`.
- **Task 5 — combat and the rest:** `combat`, `thieving`, `herd`, `prayer`, `fletching`,
  `herblore`, `teleport`, `wait`, `journal` (the last five only where Task 2 left hand-written
  limit checks or a hand-set `stuckAfterMs`).

**Files:** the batch's files in `conductor/tasks/`, `conductor/test/lib/watchdog.test.ts` (rows of
migrated tasks), and a shared module only when the batch needs one of these:

- the missing-target streak (`MISSING_LIMIT` looks, `MISSING_WAIT_TICKS` apart) copied in
  `interact`, `combolock`, `talk`, `runecraft` and `essence-mine`: one declared streak factory in
  `conductor/lib/streak.ts` or beside the spot helpers, used by all five (Task 4);
- `WALK_FAIL_LIMIT` redefined in `travel.ts`: import the shared one (Task 4).

For each task in the batch: every hand-written "count, compare to a limit, fail" block of the
standard shape becomes a declared streak used through `miss` / `missWith` / `clear`; local
`failed(message)` closures go; `stuckAfterMs` and any `SILENT_STREAK_TICKS` list are replaced by
`silent`, which must hold every declared streak the task uses, the shared walk constants, and the
tick counts of the stretches that stay hand-written. The report carries, per task: blocks before,
blocks moved, blocks left hand-written with the reason each stays, the window before and after.

### Acceptance criteria (each batch)

- [ ] No task of the batch sets `stuckAfterMs` directly or compares `.add()` to a limit for a
      standard-shape streak (the report's "left hand-written" list is the complete exception list).
- [ ] The window test and every existing unit test pass, expectations unedited.
- [ ] The replay rule: outcomes listed.
- [ ] `bun run verify:conductor` and `bun test conductor` pass.
- [ ] Out of scope: respawn waits and eat steps (Tasks 6 and 7), failure wording, tasks of other
      batches.

## Task 6 — One `waitForRespawn`

**Files:** `conductor/lib/respawn.ts` (new), `conductor/tasks/woodcutting.ts`, `pick.ts`,
`mining.ts`, `fishing.ts`, `conductor/test/lib/respawn.test.ts` (new).

One generator replaces the four copies. Its options cover what differs today: the memory slot for
the tick "none" began (read and written through accessors, so each task keeps its own memory
field name), the give-up ticks, the wait's label and predicate, the first-time log line, the
outside-sighting function for `trackIdle`, an optional chunk length (mining's 100 ticks), and the
failure text builder (fishing's suffix). Each task's give-up ticks stay in its `silent`.

### Acceptance criteria

- [ ] Unit tests on a scripted world: met before the give-up, give-up with the area text and the
      no-area text, the log line once only, chunked waits adding up to the same give-up, the
      "none since" tick cleared by the caller as today.
- [ ] The four tasks' existing tests pass, expectations unedited; the replay rule for the four.
- [ ] Out of scope: `pickup`'s spawn wait, the look-count waits in `combat` and `thieving`.

## Task 7 — One eat step

**Files:** `conductor/lib/eat-step.ts` (new), `conductor/tasks/combat.ts`, `thieving.ts`,
`agility.ts`, `conductor/test/lib/eat-step.test.ts` (new).

`eatStep({ wants, food, streak, failText, logFailure? })` returns the step the three tasks hold
today: `when` from `wants`, the food picked by `food`, an eat through `actions/eat.ts`, the
declared streak cleared on success, the task's own failure text at the limit. `combat` and
`thieving` share `wantsToEat` / `foodInInventory` from the same module where the two are the same
function. The three failure texts and agility's log line stay exactly as they are (they differ
today; that is kept).

### Acceptance criteria

- [ ] Unit tests: eats when wanted and held, does nothing with no food, clears on success, fails
      with the given text at the limit.
- [ ] The three tasks' existing tests pass, expectations unedited; the replay rule for the three.
- [ ] Out of scope: the engine's low-HP guard, `thieving`'s regen step, `agility`'s out-of-food step.

## Task 8 — Docs, authoring rule, smoke tests

**Files:** `.claude/agents/task-author.md` (declare streaks with `failStreak`, list them in
`silent`, never set `stuckAfterMs`; use `waitForRespawn` and `eatStep`), `conductor/README.md` and
`conductor/docs/interruptible-tasks.md` where they describe the watchdog or streaks,
`.claude/review-lenses/` where a lens checks the stuck window by hand, `conductor/roadmap.md` (this
follow-up done; any window that grew and any gap Task 2 found, as fixed), `conductor/docs/plan-primitives.md`
(the follow-up line points here).

Run `bun run test:integration` for the smoke tests of four migrated tasks, one per family:
`smoke/mining`, `smoke/woodcutting`, `smoke/thieving`, `smoke/interact` (or the nearest existing
file for each; the local stack is up on `:7780` / `:8888`; say which ran).

### Acceptance criteria

- [ ] No doc or prompt tells an author to size `stuckAfterMs` by hand.
- [ ] The four smoke tests pass (results in the report).
- [ ] `bun run verify:conductor` and `bun test conductor` pass.

## Out of scope for this spec

- Outcome codes, renamed params, unified failure wording.
- The engine's low-HP guard and stuck detection themselves.
- Plans.
