# Spec: plan primitives

Expands the design `conductor/docs/plan-primitives.md` into ordered tasks. Each `## Task N —`
section is one unit of subagent-driven work: implemented and committed by one agent, then reviewed
for spec compliance and code quality before the next starts. Tasks are ordered primitives-first; a
task may use anything an earlier task landed.

## Global rules (apply to every task)

- **Do not edit** `sdk/`, `server/`, `mcp/` or `wiki/`.
- **Existing plans keep their behaviour.** Do not edit a file in `conductor/plans/` unless the task
  names it. Every new plan or phase option is optional and defaults to today's behaviour, except
  the settle of Task 3, which is on by default.
- **Contracts that stay as they are**: the `run-task.ts` CLI, the `RESULT <json>` line, the
  `TaskResult` fields (additions to log events are fine), and per-phase recordings and their replay
  (`conductor/tools/replay.ts`).
- **Predicates stay pure**: a view member reads the state and the plan's own record, never a clock
  or I/O. New view members are scalars or functions, never objects or arrays, so `recordReads`
  logs them.
- **Game time is ticks.** No `Date.now()` or `setTimeout` in `conductor/lib`, `tasks`, `actions`
  or `core`; time comes from `state.tick` or the injected `now()`.
- **Formatting and lint**: finish with `bun run verify:conductor` (oxfmt check, oxlint with
  warnings denied, `tsc --noEmit`). `bun run fmt` formats in place.
- **Unit tests** live in `conductor/test/**/*.test.ts` (bun:test), need no server and never call
  `process.exit`. Run `bun test conductor` (never `bun test conductor wiki`, never two test runs at
  once). A task adds tests beside the ones for the file it changes, in that file's existing style.
- **Integration tests** (`conductor/test/integration/**/*.itest.ts`) run only as
  `bun run test:integration <filter>` for the files a task names, never the whole suite, against
  the shared local stack (engine `:8888`, gateway `:7780`). If the stack is not listening, say so in
  the report and leave the itest written and unrun; do not start or restart the stack.
- Game knowledge goes in `learnings/` per the `knowledge` skill, not in code comments. Comments
  match the surrounding density: explain why, not what.

## Task 1 — View members

**Files:** `conductor/lib/plan.ts` (`PlanView`, the `view()` closure in `runPlan`, new exported
helpers), `conductor/test/lib/plan.test.ts` (the `the view` describe block).

Add to `PlanView`, each documented in its doc comment:

| Member | Meaning |
| --- | --- |
| `x`, `z`, `floor` | the player's `worldX`, `worldZ`, `level`; `0` in a state with no player |
| `within(spot)` | `spot` is `{ x, z, radius?, tolerance?, level? }` (an `area` or an `at` param as tasks take them). True when the Chebyshev distance to `(x, z)` is at most `radius ?? tolerance ?? 0` and, when `level` is given, the floor equals it. False with no player |
| `held(item)` | count in the pack plus worn, `item` as `inv` takes it (the count `shortNeeds` computes; share the code) |
| `worn(item)` | count worn only |
| `npcs(name, within?)` | number of `state.nearbyNpcs` whose name matches (`name` a string for an exact name, case-insensitive, or a RegExp), at most `within` tiles away by their `distance` when given |
| `locs(name, within?)`, `ground(item, within?)` | the same over `state.nearbyLocs` and the ground items |
| `said(pattern, sinceTicks?)` | whether a line of a recent dialog page, a whole page joined with single spaces, the open dialog's text, or a game message (not player chat) matches. With `sinceTicks`, only entries whose `tick` is within that many ticks of `state.tick` |
| `lastDone(...names)` | the previous phase run ended `done` and, when names are given, was one of them |
| `lastFailed(...names)` | the same for `failed` or `stuck` |
| `combatLevel`, `coins` | the player's combat level (`0` with no player); the pack's `Coins` count |
| `questStarted(id)` | the quest tab shows the quest yellow; throws on an unknown id like `quest` |

`lastDone` and `lastFailed` throw on a name the plan has no phase for, as `runs` does. Read the
state's field names from `sdk/types.ts`; do not guess them.

Export two builders for `requires`, each returning a one-entry record to spread:
`combatAtLeast(n)` (key `combat level n+`) and `levelAtLeast(skill, n)` (key `<Skill> n+`, using
`v.level`).

### Acceptance criteria

- [ ] Every member above exists on `PlanView` with the stated semantics and a doc comment.
- [ ] Unit tests cover each member, including: `within` with `radius`, with `tolerance`, with
      neither (exact tile), with a wrong `level`, and with no player; `said` matching a single line, a
      pattern spanning two lines of one page, a game message, and `sinceTicks` excluding an old
      entry; `lastDone`/`lastFailed` with and without names and throwing on an unknown name.
- [ ] A test shows the plan log's `select` event `reads` records a call of each new function member
      and a read of each new scalar.
- [ ] `combatAtLeast` and `levelAtLeast` are exported and tested.
- [ ] No file under `conductor/plans/` changes (out of scope: migrating plans to the members).
- [ ] `bun run verify:conductor` and `bun test conductor` pass.

## Task 2 — Plan defaults and `onFail: 'retry'`

**Files:** `conductor/lib/plan.ts` (`OnFail`, `PlanDef`, the failure branch and idle accounting
after a phase run in `runPlan`), `conductor/test/lib/plan.test.ts` (the `onFail` and rails blocks).

- `PlanDef.defaults?: { onFail?: OnFail; maxFails?: number }`: a phase that sets no `onFail` (or no
  `maxFails`) uses the plan's; without either, today's defaults (`'fail'`, `DEFAULT_MAX_FAILS`).
- `OnFail` gains `'retry'`, as a literal and as a value the function form may return. A `failed` or
  `stuck` run decided `'retry'`:
  - counts toward the phase's consecutive failures exactly as `'continue'` does; at `maxFails` the
    plan ends `failed` with today's `<phase> failed N times in a row: <reason>`;
  - below that, the phase is **not** skipped: the next selection may choose it again when its `when`
    still holds (another phase earlier in the list whose `when` holds still wins);
  - is left out of the idle rail: it is not appended to the idle run, its end state is not added to
    the states seen since XP last rose, and it clears the "previous phase ended done" marker.
- A death, an `error`, and a phase that fails while the plan is ending behave as today, whatever
  `onFail` says.
- The `phase-end` log event of a `failed` or `stuck` run gains `onFail`: the decision taken
  (`'fail'`, `'continue'` or `'retry'`).

### Acceptance criteria

- [ ] A phase with `onFail: 'retry'` that fails twice then succeeds runs three times in a row with
      no other phase needed, and the plan goes on.
- [ ] It fails the plan at `maxFails` with the reason above; a `done` run resets the count.
- [ ] Three retried failures that leave the state unchanged do not end the plan through the idle
      rail (with `maxFails` above 3).
- [ ] `'continue'` behaves exactly as before (existing tests unchanged and passing).
- [ ] `defaults` applies to phases without their own setting, a phase's own setting wins, and a
      plan without `defaults` behaves as before.
- [ ] The function form returning `'retry'` works; a death still ends the plan.
- [ ] `phase-end` carries `onFail` for a failed run and not for a `done` one.
- [ ] `bun run verify:conductor` and `bun test conductor` pass.

## Task 3 — Settle before the next selection

**Files:** `conductor/lib/plan.ts` (`PlanDef`, `PhaseOptions`, the code between a phase run's result
and the idle accounting in `runPlan`), `conductor/test/lib/plan.test.ts`.

After a phase run that does not end the plan, and before the idle accounting, the runner settles:
it takes the state as read after the run, then reads `opts.nextTick()` until two consecutive states
have the same `idleSignature`, at most `PHASE_SETTLE_READS = 5` reads. The settled state is what the
idle accounting uses, and the next loop's selection reads the world after it. Every state read is
passed through `observe` (the bank memory).

- No `nextTick` in the options: no settle (as today).
- `PlanDef.settle?: boolean` (default `true`) and the phase option `settle?: boolean` (default: the
  plan's): `false` skips it for that plan or after that phase's runs.
- A `nextTick` that throws (the client stopped publishing) ends the settle with the last state read;
  it never fails the plan.
- When the settle read more than one state or the signature changed during it, the plan log gets
  `{ type: 'settle', phase, reads, changed }`.
- The settle is not part of the phase run: the run's `durationMs`, its log and its recording are
  unchanged. The plan's own duration includes it.

**Assumption:** phase recordings hold only what the phase's driver read, so reads between two phase
runs do not affect `replay.ts`; confirm this in `conductor/lib/replay.ts` and say so in the report.
If it is wrong, stop and report instead of changing the replay.

### Acceptance criteria

- [ ] With a `nextTick` whose first state differs from the post-run state (the bot moved a tile) and
      whose second equals the first, the next selection sees the moved position, and a phase gated on
      it is chosen without any `v.last` condition.
- [ ] A state that keeps changing stops the settle at `PHASE_SETTLE_READS` reads.
- [ ] A run that ended where it started but whose settled state differs is not idle; one whose
      settled state equals its start is.
- [ ] `settle: false` on the plan, and on a phase, skips it; without `nextTick` nothing is read.
- [ ] A throwing `nextTick` does not fail the plan.
- [ ] The `settle` event is emitted under the stated condition only.
- [ ] Existing plan tests pass unchanged (they pass no `nextTick`, or the end-of-plan XP settle
      tests still read the states they expect: adjust a test only where it scripted `nextTick`
      states for the XP settle and now must also supply the phase settle's).
- [ ] The report states what was checked in `lib/replay.ts`.
- [ ] `bun run verify:conductor` and `bun test conductor` pass.

## Task 4 — The `wait` task

**Files:** `conductor/tasks/wait.ts` (new), `conductor/lib/task.ts` (`TaskDef.waits`),
`conductor/lib/plan.ts` (idle accounting), `conductor/test/tasks/wait.test.ts` (new),
`conductor/test/lib/plan.test.ts`, `conductor/test/integration/smoke/wait.itest.ts` (new), and
whatever registers a task in the catalog (see how `conductor/lib/catalog.ts` finds tasks).

- `wait` params, each with a zod `.describe()` (the first task to do so; `run-task.ts --list` prints
  the JSON schema, which then carries the text): `ticks` (integer, 1 to `MAX_WAIT_TICKS = 1500`,
  required) and `orFail` (boolean, default `false`).
- One generator step that waits `ticks` game ticks through the core `ticks`/`wait` ops, so the
  guards and stops act at every tick. It ends `done` (`waited N ticks`), or `failed` with the same
  reason when `orFail`. It sends nothing, has no preflight and no area.
- Its `stuckAfterMs` and `stepTimeoutMs` cover `MAX_WAIT_TICKS` with the usual margin
  (`lib/watchdog.ts`), so neither the watchdog nor the step budget ends a wait.
- Its `description` is two sentences: what it is for (a deliberate wait in a plan, ended early by
  the phase's `until`) and that the shared guards still act.
- `TaskDef.waits?: true`: "a run of this task that changes nothing is a wait, not a stall". In
  `runPlan`, a run of a `waits` task that its phase's `until` ended is left out of the idle rail in
  the same way as a retried failure (Task 2). A wait that ran its ticks out is an ordinary run.

### Acceptance criteria

- [ ] Unit tests on scripted worlds: done after exactly `ticks` ticks; `orFail` fails with the
      reason; a low-HP or death guard still ends a wait; a stop ends it; the watchdog does not end a
      `MAX_WAIT_TICKS` wait in which nothing changes.
- [ ] Plan tests: a `wait` phase whose `until` reads something outside the idle signature (an NPC's
      position) can run more than three times in a row without the idle rail ending the plan; three
      waits that run their ticks out with nothing changed end the plan as the rail does today.
- [ ] `bun conductor/run-task.ts --list` shows `wait` with both param descriptions.
- [ ] A smoke itest runs `wait` with a small `ticks` on a fixture bot and asserts `done`; run it
      with `bun run test:integration wait` if the stack is listening.
- [ ] No other task changes (out of scope: `.describe()` on other tasks, replacing waits in plans).
- [ ] `bun run verify:conductor` and `bun test conductor` pass.

## Task 5 — Plan lint, and the plans it flags

**Files:** `conductor/lib/plan-lint.ts` (new), `conductor/test/lib/plan-lint.test.ts` (new),
`conductor/test/plans.test.ts`, and the plans named below.

`lintPlan(def, source)` returns a list of problems (strings naming the phase or the text) for one
plan module's default export and its source text:

1. **Params**: every phase's params parse against its task's schema (reuse what `runPlan` does).
2. **Phase-name references**: every string literal in the source that is the argument of `runs(`, of
   a call to an identifier named `ran`, `lastDone`, `lastFailed`, `lastWas` or `lastIs`, or the
   other side of `.phase ===` / `.phase !==`, names a phase of the plan (the plan's real phase
   names, so names built from templates count). Template-literal arguments are not checked.
3. **Item patterns**: no RegExp literal in the source matches both `Bronze axe` and
   `Bronze pickaxe` (the `/axe$/i` trap).

`conductor/test/plans.test.ts` runs it over every file in `conductor/plans/` and fails listing
every problem. Then fix what it reports:

- `fm-99.ts`, `willow-burn.ts`, `oak-draynor-drop.ts`: the woodcutting-axe pattern becomes one that
  matches `Bronze axe` and `Rune axe` and not a pickaxe or a battleaxe.
- `plague-city.ts`: `wearing` reads the worn items (as `hasMask` already does on the next lines),
  not "no mask in the pack", which is also true when the mask was never held.
- Anything else the lint reports: fix it when the fix is mechanical and cannot change a proven
  plan's behaviour on the states it was proven on (a misspelt phase name that could never match);
  otherwise leave the plan, list it in the report, and exempt that one finding in the test with a
  comment saying why.

If rule 2 gives false positives (a `.phase` that is not a plan phase), narrow the rule and say how
in the report; do not add ignore comments to plans.

### Acceptance criteria

- [ ] `lintPlan` has unit tests for each rule: a clean plan, a bad param, a dangling name in each
      reference form, a template-built name that resolves, and both an offending and an anchored item
      pattern.
- [ ] `plans.test.ts` lints all promoted plans and passes.
- [ ] The four plans above are fixed as described, with no other change to them.
- [ ] The report lists every finding the lint made on the promoted plans and what was done with it.
- [ ] `bun run verify:conductor` and `bun test conductor` pass.

## Task 6 — Docs and agent prompts

**Files:** `conductor/docs/plans.md`, `conductor/README.md` (Plans), `.claude/agents/task-runner.md`,
`conductor/roadmap.md`.

- `plans.md`: document `defaults`, `onFail: 'retry'`, the settle and `settle: false`, the `wait`
  task and the new view members in "The API", "The view" and "`onFail`"; add the plan lint to
  "Tests". In "The runner's safety rails", each dated gotcha bullet whose workaround a primitive now
  replaces (the `-b` duplicate phase, the nudge `travel`, the paired `talk continue` gaps, the
  never-held-item `pickup` wait, the "`v.last` was X and done" alternative for lagging position)
  gets one sentence naming the primitive to use in new plans; keep the bullet, since promoted plans
  still use the old idiom. Remove the "`once` flag" line from "Later" only if it is now covered; it
  is not, so leave it.
- `README.md`: the Plans section's one-line API summary names the new options.
- `task-runner.md`: wherever it teaches a workaround listed above, teach the primitive instead; add
  the view members to its plan API summary. Keep it the same length or shorter.
- `roadmap.md`: under the section that holds framework follow-ups, add the items of the design
  doc's "Next: the quest layer" and "Other follow-ups from the audit" as follow-ups, each one line,
  pointing at `conductor/docs/plan-primitives.md`; and one for "migrate promoted plans to the view
  members and primitives when next touched or re-run".

### Acceptance criteria

- [ ] Every primitive of Tasks 1-5 is documented once in `plans.md`, with the names and defaults
      the code has (check against `lib/plan.ts` and `tasks/wait.ts`, not against this spec).
- [ ] The five workaround bullets point at their primitive; no dated fact is deleted.
- [ ] `task-runner.md` teaches no superseded workaround as the way to do it, and is not longer.
- [ ] `roadmap.md` has the follow-ups; no code changes in this task.
- [ ] `bun run verify:conductor` passes.

## Out of scope for this spec

- The quest layer (`defineQuest`, a stage probe, a persisted cursor): its own design after a spike.
- Migrating promoted plans to the new members and primitives.
- Persisting `v.runs` or any plan state across process restarts.
- Task catalog generation, task bookkeeping helpers, outcome codes, named places, plan parameters.
