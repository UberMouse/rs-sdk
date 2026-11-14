# Naming and outcomes: spec

Expands `conductor/docs/naming-outcomes.md` into ordered tasks. A later task may use anything an
earlier one landed.

## Global rules (apply to every task)

- **Do not edit** `sdk/`, `server/`, `mcp/` or `wiki/`. `conductor/plans/` is edited only where a
  task names the plan files.
- **Reason sentences do not change.** Every failure and done reason stays as it is, to the
  character; codes are added beside them. Existing test expectations on reasons are not edited.
  A test is edited only where a task renames a param or a constant it uses.
- **Contracts that stay working:** the `run-task.ts` CLI and its last line `RESULT <json>` (new
  fields are additive and optional), `--list`, plan files that do not use a renamed param, replay
  of recordings whose params still parse.
- **Formatting and lint**: finish with `bun run verify:conductor`. `bun run fmt` formats code in
  place; do not run a formatter over markdown files.
- **Unit tests** live in `conductor/test/**/*.test.ts`, need no server, never call `process.exit`.
  Run `bun test conductor` (never `bun test conductor wiki`, never two test runs at once).
- **Integration tests** only where a task names them (`bun run test:integration <filter>`, one at
  a time; the local stack is up on `:7780` / `:8888`; never start, stop or restart it; the tests
  make their own fixture bots; never drive an existing bot). No live plan runs.
- The catalog guard (`conductor/test/lib/catalog.test.ts`) keeps passing. Its shape fixture is
  regenerated (`UPDATE_CATALOG_SHAPES=1`) only by a task that renames a param or adds catalog
  output, and the report lists the fixture diff.
- Game knowledge goes in `learnings/`, not in comments. Comments explain why, not what. No
  `Date.now()` in game logic.

## Task 1 — Outcome codes in the engine, the result, the plan view and the catalog

**Files:** `conductor/core/op.ts` (`Outcome`), `conductor/lib/task.ts` (`TaskResult.code`,
`TaskDef.outcomes`, `defineTask`), `conductor/lib/engine.ts` (`End`, `ended`, the result builder,
the guard endings), `conductor/lib/interrupts.ts` (the engine's guards declare their codes),
`conductor/lib/plan.ts` (`PlanView.last`), `conductor/lib/catalog.ts` and `conductor/run-task.ts`
where `--list <task>` is built, tests beside each.

- `Outcome = void | { done: string; code?: string } | { fail: string; code?: string }`. A guard's
  outcome is the same type.
- `TaskResult.code?: string`: set when the outcome that ended the run carried one. Absent
  otherwise (stops, the watchdog, preflight, errors keep `status` alone).
- `PlanView.last` becomes `{ phase, status, reason, code?, endedBy? }`, copied from the result.
- A code is lower-case kebab-case (`/^[a-z][a-z0-9-]*$/`).
- `TaskDef.outcomes?: Record<string, string>`: each code the task's steps can end with, mapped to
  one sentence on when it happens. `defineTask` throws on a malformed code or an empty sentence.
  A guard declares its codes the same way on the guard object (`outcomes`).
- A step that ends with a code its task does not declare, or a guard with a code it does not
  declare, ends the run `error` with a reason naming the step and the code (as an undeclared
  streak does). A def built without `defineTask` is checked the same way at run time.
- `--list <task>` prints the task's outcomes (code and sentence) after its rules, including the
  codes of the guards the task installs; `--list --all` carries them in its JSON. A task with none
  prints nothing new.
- No task or guard gains a code in this task except what the tests need (use test defs).

### Acceptance criteria

- [ ] Unit tests: a step's `{ fail, code }` and `{ done, code }` reach `TaskResult.code`; a guard's
      code does; an undeclared code ends the run `error`; a malformed declaration throws at
      definition; `v.last.code` and `v.last.endedBy` are visible to a plan's `when`.
- [ ] `RESULT <json>` of a run with no code is byte-identical to before (no `code` key).
- [ ] The catalog guard passes; `--list` output for existing tasks is unchanged (no task declares
      outcomes yet); a test def with outcomes shows them.
- [ ] Out of scope: codes on real tasks, plans, lint.

## Task 2 — Codes where a plan branches today, the three plans, epilogue, a lint rule

**Files:** `conductor/tasks/pickup.ts`, `talk.ts`, `combat.ts`, `conductor/lib/interrupts.ts` (the
under-attack and death guards), `conductor/lib/plan.ts` (the `DEATH_GUARD` check may stay on
`endedBy`), `conductor/lib/epilogue.ts`, `conductor/lib/plan-lint.ts`,
`conductor/plans/clock-tower.ts`, `conductor/plans/monks-friend.ts`,
`conductor/plans/troll-stronghold.ts`, tests beside each.

- `attacked`: pickup's "attacked while picking up" failure, and every ending of the engine's
  under-attack guard (all its wordings, including the two `clock-tower`'s `/attacked/` misses
  today: "under attack by … for N ticks" and "fight with … not finished"). **Assumption:** the
  plan wants every one of them; state in the report what each ending means and flag any that
  should not share the code.
- `died`: the death guard's ending.
- `unreachable`: talk's "no reachable … (N in view but unreachable from here)" failure, only when
  the unreachable note applies (the case `monks-friend` matches today). interact's failure with
  the same note ("no reachable … in sight (N in view but unreachable from here)",
  `conductor/tasks/interact.ts`) carries it too, so `monks-friend`'s `omad-door` phase still
  re-runs after its own such failure. **Assumption:** the walk op's path error ("No path to …:
  Destination … is unreachable"), which the plan's `/unreachable/` also matched, gets no code:
  the door phase firing after any failed walk east of x 2603 was accidental.
- `dialog`: combat's `stopOnDialog` ending ("dialog opened: …").
- The three plans: `clock-tower.ts:82` tests `v.last.code === 'attacked'`; `monks-friend.ts:54`
  tests `code === 'unreachable'`; `troll-stronghold.ts:31` tests `code === 'dialog'` and keeps its
  match on the dialog text (game text, not our wording). Each plan's other logic is untouched.
- `lib/epilogue.ts`'s client-drop matching (`:73`, `:122`) stays on text where the text comes
  from outside the engine; where the engine itself writes the reason (`engine.ts` "client stopped
  publishing ticks"), give that ending a code only if it is an Outcome today. Report what was
  possible; do not restructure the engine's stop paths.
- Plan lint: a new rule flags a plan source that tests `.reason` with a regex or `.includes`
  (`.test(v.last.reason)`, `v.last.reason.match`, `reason.includes`), naming `last.code`. A match
  that follows a `code ===` test in the same expression is allowed (troll-stronghold). The rule
  runs over every promoted plan in the existing lint test and finds none after this task.

### Acceptance criteria

- [ ] Unit tests pin each new code on its producer, with the reason sentence unchanged.
- [ ] Each of the three plans has a unit test (plan simulation or predicate test, as the plan
      tests do today) showing the branch is taken on the code, including for clock-tower one of
      the two attack wordings it missed before.
- [ ] The lint rule has a flagged and an allowed fixture; all promoted plans pass.
- [ ] `--list pickup`, `talk`, `combat` show their outcomes; the shape fixture diff is listed.
- [ ] Out of scope: any other code, any reason rewording, running the quests live.

## Task 3 — Unknown params are refused

**Files:** `conductor/lib/engine.ts` (where params are parsed), `conductor/lib/plan.ts` (where a
plan's phase params are parsed at load), `conductor/lib/plan-lint.ts` if it parses separately,
`conductor/plans/*.ts` only for keys the scan finds, tests.

- First a scan, committed as a test: every promoted plan's phases, with each phase's top-level
  param keys checked against its task's schema keys. The report lists every key dropped today,
  per plan, as a typo (name the intended key and fix the plan) or dead (delete it from the plan).
  A phase whose params are built by a function or spread is checked on the value the plan
  produces where the existing plan tests can evaluate it; list those that cannot be checked.
- Then the refusal: a run whose raw params hold a top-level key the task's schema does not have
  ends at preflight, `failed`, reason `preflight: unknown param "<key>" (<task> takes: <keys>)`;
  several unknown keys are all named. A plan with such a phase fails at load with the phase name,
  as an invalid param does today. Top-level keys only: nested objects keep their schemas.
- Quest plans built with `defineQuest` go through the same check.

### Acceptance criteria

- [ ] Unit tests: the refusal text for one and for two unknown keys; a valid run is unchanged; a
      plan with an unknown key fails at load naming phase and key.
- [ ] The scan test passes over all promoted plans after the fixes; the report lists what it found.
- [ ] `bun run test:integration smoke/plan` passes.
- [ ] Out of scope: drafts under `conductor/runs/`, nested keys, renames.

## Task 4 — Renames

**Files:** `conductor/tasks/thieving.ts`, `combat.ts`, `pickup.ts`, `spell-items.ts`, `shop.ts`,
the plans that pass `maxWaitSeconds`, their tests, the catalog shape fixture, `conductor/tools/`
or docs that name the old params.

- thieving: `stopWhenFull: boolean` becomes `onFull: 'continue' | 'stop'`, default `continue`
  (`stop` is the old `true`).
- combat: `endWhenPackFull: boolean` becomes `onFull: 'continue' | 'stop'`, default `continue`.
- pickup: `maxWaitSeconds` becomes `maxWaitTicks`, integer, default the tick count of the old
  default (90 s is 225 ticks at 400 ms a tick; an earlier draft of this line said 150, which was wrong); behaviour for the default is unchanged to the tick; every promoted
  plan that passes `maxWaitSeconds` passes the equal tick count (seconds × 1000 / 400, rounded
  up; list each plan and both values).
- spell-items `item` uses `patternParam` (same matching as today; if today's hand-made regex
  differs in any way from `patternParam`'s, keep today's matching and report the difference
  instead of changing behaviour). shop `at` uses `AtSchema` (the fields it lacked take the
  schema's defaults only if that changes no walk; otherwise keep its shape and report).
- The gathering tasks' `onFull: 'drop' | 'stop'` is unchanged.
- Task 3's refusal makes a stale name fail loudly; no alias for an old name.

### Acceptance criteria

- [ ] Unit tests of the four tasks pass with expectations unedited except the param name and value
      in the test's params.
- [ ] `git grep` finds no `stopWhenFull`, `endWhenPackFull` or `maxWaitSeconds` in `conductor/` or
      `.claude/` outside finished specs and the design doc.
- [ ] The plan scan test of Task 3 passes; the shape fixture diff is listed.
- [ ] `bun run test:integration smoke/pickup` (or the nearest existing file) and `smoke/thieving`
      pass.
- [ ] Out of scope: `npc`, `target`, `name`, `item`, `food`, `product` renames.

## Task 5 — Typed op failure reasons

**Files:** `conductor/actions/*.ts` (types only), `conductor/lib/spot.ts`,
`conductor/tasks/crafting.ts`, `spinning.ts`, any other site the compiler then flags.

- One exported `Failure<R extends string>` (where `bank.ts` has it today, moved to the module the
  ops share) used by every op's failure type; `OpenFailure = Failure<string>` in `modal.ts` gets
  the union of the reasons its ops return.
- The task and lib sites that compare an op's reason against a `string[]` list
  (`FINAL_WALK_FAILURES` in `lib/spot.ts`, the `fatal:` lists in `crafting.ts`, the
  `.includes(r.reason)` in `spinning.ts`) are typed by the op's reason union (`satisfies` or a
  typed array), so a value the op cannot return fails to compile.
- No reason value is renamed, added or removed. No runtime behaviour changes.

### Acceptance criteria

- [ ] `tsc` passes; a deliberately misspelt value in each of the four lists fails to compile
      (checked and reverted; stated in the report).
- [ ] No test file changes.
- [ ] Out of scope: merging synonyms.

## Task 6 — Docs and agent prompts

**Files:** `.claude/agents/task-author.md` (declare `outcomes`, return a code where a plan would
branch, never make a plan read a sentence), `.claude/agents/task-runner.md` (its prose on reasons
starting `died` or `under-attack` uses `code` / `endedBy`; `v.last.code`; unknown params are
refused), `conductor/docs/plans.md`, `conductor/README.md` where results or `--list` are
described, `.claude/review-lenses/` (contract lens: a plan matching reason text, an undeclared
code), `conductor/roadmap.md` (this follow-up done; follow-ups: selector names kept, the 90 op
reason synonyms kept, more codes as plans need them), `conductor/docs/plan-primitives.md` (the
follow-up line points here).

### Acceptance criteria

- [ ] Every statement checked against the code at HEAD.
- [ ] `bun run verify:conductor` and `bun test conductor` pass.

## Out of scope for this spec

- Renaming selectors, rewording reasons, merging op reason synonyms.
- Places by name, plan parameters, moving plans onto newer primitives.
