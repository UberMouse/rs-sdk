# Spec: plans, composing catalog tasks

Expands the approved design `conductor/docs/plans.md` into ordered tasks. Each `## Task N —`
section is one unit of subagent-driven work (`.claude/skills/sdd-loop`): implemented and committed
by one agent, then reviewed for spec compliance and code quality before the next starts. Tasks
are ordered primitives-first; a task may use anything an earlier task landed.

## Global rules (apply to every task)

- **The design doc is the source of intent**: where this spec is silent, `conductor/docs/plans.md`
  decides. Don't contradict a decision recorded there.
- **Don't touch** files a conductor run holds uncommitted in the main checkout, or the merge back
  will conflict: `conductor/roadmap.md`, `conductor/actions/walk.ts`, `conductor/lib/wilderness.ts`,
  and anything under `conductor/saves/`. `sdk/` is upstream: import from it, don't edit it.
- **Every catalog task keeps working**: `bun conductor/run-task.ts <bot> <task> ...` keeps its CLI
  and `RESULT <json>` contract; `TaskResult` gains only the optional field Task 2 adds.
- **Formatting and lint**: `conductor/` is oxfmt + oxlint (warnings denied). Finish with
  `bun run verify:conductor` (fmt check, lint, `tsc --noEmit -p conductor`); format only your own
  files (`bunx oxfmt <files>`).
- **Unit tests** in `conductor/test/**/*.test.ts` (bun:test), no server, fast; scripted worlds via
  `conductor/test/simulate.ts` and `conductor/test/world.ts`. `bun test conductor` stays green.
- **Integration tests** in `conductor/test/integration/**/*.itest.ts`, run only through
  `bun run test:integration <filter>` against the shared local stack, on fresh fixture bots
  (`harness.ts`). Never drive a conductor bot; never start or restart the stack.
- **Game time is ticks.** No `Date.now()` in plan or engine logic; wall time comes from an
  injected `now()`.
- **Plan predicates are pure** functions of the view (no I/O, no clock, no state of their own).
- Comments match the surrounding density and explain why. Game knowledge goes in `learnings/`
  per the `knowledge` skill, not in comments.

## Task 1 — `bank`: withdraw what there is, and the baseline type error

**Files:** `conductor/tasks/bank.ts`, `conductor/test/tasks/bank.test.ts`, the bank smoke test only
if its scenario needs it.

A withdraw entry gains `upTo: boolean` (default `false`). With `upTo`, the step withdraws
`min(count, bank holds)`: fewer is not a failure; none at all is not a failure either (the entry
is logged as skipped with the reason). Without `upTo`, behaviour is unchanged (fails when the bank
holds fewer than `count`). The task `description` documents `upTo`.

`bun run verify:conductor` fails on `main` with `conductor/test/tasks/bank.test.ts(202,38): error
TS18046: 'm' is of type 'unknown'`. Fix it (narrow the type; don't weaken the assertion).

### Acceptance criteria
- [ ] `upTo: true` withdraws all the bank holds when it holds fewer than `count`, and the run ends
      `done`; a unit test pins it.
- [ ] `upTo: true` with none of the item in the bank ends `done`, logging that the entry was
      skipped; a unit test pins it.
- [ ] Without `upTo` the shortfall still fails as before (existing test unchanged or extended).
- [ ] `bun run verify:conductor` passes on the whole tree (the TS18046 error is gone).
- [ ] No other bank behaviour changes.

## Task 2 — Engine hooks: external stop, `partOf`, and replay of an external stop

**Files:** `conductor/lib/engine.ts`, `conductor/lib/task.ts`, `conductor/core/drivers/recording.ts`,
`conductor/core/drivers/replay.ts`, `conductor/lib/replay.ts`, tests under `conductor/test/`.

- `ExecuteOptions.externalStop?: (s: BotWorldState) => string | null`. `checkRun` calls it after
  the task's own stops (so it acts between steps and at every check of a generator step's waits,
  cancelling the step like a stop does). A non-null return ends the run `done` with that string as
  `reason`. The first time it fires the engine emits `{ type: 'external-stop', reason, tick }`.
- `ExecuteOptions.partOf?: string`, copied into `TaskResult.partOf?: string` (the only new
  `TaskResult` field): the runId of the plan a phase run belongs to. Absent for a plain task run.
- The recorder writes an `external-stop` event as a record `{ k: 'stop', tick, reason }`.
  `replayRun` gives `executeTask` an `externalStop` that returns the recorded reason once
  `state.tick >= tick`, so a phase cut short by its `until` replays to the same end instead of
  running past its recording. Bump nothing else in the recording format beyond the new record kind
  (old recordings still replay).

### Acceptance criteria
- [ ] An `externalStop` that fires mid-wait cancels a generator step (its `finally` runs) and the
      run ends `done` with the returned reason; a unit test pins it.
- [ ] An `externalStop` that fires between steps ends the run before the next step; unit-tested.
- [ ] `partOf` appears in the result only when given; unit-tested.
- [ ] A recording of a run ended by an external stop has a `stop` record, and `replayRun` on it
      reports no divergence and the same status/reason; unit-tested through the recorder/replay
      test helpers.
- [ ] Runs without `externalStop` behave and record exactly as before (existing tests pass).

## Task 3 — The plan runner: `conductor/lib/plan.ts`

**Files:** `conductor/lib/plan.ts`, `conductor/test/lib/plan.test.ts` (and a small test helper next
to `simulate.ts` if useful, e.g. `simulatePlan`).

API (names are binding; the design doc explains each):

```ts
export interface PlanView {
    state: BotWorldState;
    inv(item: string | RegExp): number;   // string: exact name, case-insensitive
    full: boolean;
    free: number;                          // free inventory slots
    bank(item: string | RegExp): number | undefined;  // last seen open during this plan
    level(skill: string): number;          // base level; throws on an unknown skill
    hp: { current: number; max: number };
    runs(phase: string): number;           // times that phase has run in this plan
    last: { phase: string; status: TaskStatus; reason: string } | null;
}
export type Predicate = (v: PlanView) => boolean;
export type OnFail = 'fail' | 'continue' | ((r: TaskResult) => 'fail' | 'continue');
export interface Phase { name; task; params; when?; until?; onFail?; maxFails? }
export function phase<S extends z.ZodType, M extends object>(
    task: TaskDef<S, M>, params: z.input<S>,
    opts?: { name?: string; when?: Predicate; until?: Predicate; onFail?: OnFail; maxFails?: number },
): Phase;
export interface PlanDef { name: string; description?: string; phases: Phase[]; until?: Predicate }
export function definePlan(def: PlanDef): PlanDef;   // validates; brands the object for the CLI
export function isPlan(x: unknown): x is PlanDef;
export async function runPlan(def: PlanDef, opts: RunPlanOptions): Promise<PlanResult>;
```

- `definePlan` throws on: no phases, a plan name not matching `/^[a-z0-9-]+$/`, duplicate phase
  names (the default name is the task's name). `phase` defaults `name` to `task.name`,
  `maxFails` to 3.
- `RunPlanOptions`: `botName`, `runId`, `logFile`, `sinks` (the plan's own log/print/screenshot),
  `stops: StopCondition[]`, `now?`, `pathfinder?`, `state(): BotWorldState` (reads the world between
  phases), and `newPhaseRun(phase, index) => { driver, sinks, runId, logFile, close?() }` (each phase
  run gets its own driver, log and recording; the CLI builds live ones, tests timeline ones).
  `maxIdlePhases` (default 3). `nextTick?()` reads the next state: a plan that ends done after at least one
  phase reads `PLAN_SETTLE_TICKS` more states with it, so reward XP published after the `until` holds
  (a quest's lump) appears in the plan total but in no phase's `xpGained`.
- **Loop**: build the view from `state()`; pick the first phase whose `when` holds (default true)
  and whose `until` does not already hold, skipping a phase that just failed with `continue`. None:
  the plan ends `failed` with reason `no phase applies` (the plan log's selection event carries
  inventory counts, free slots and known bank counts). Run it with `executeTask(phase.task, {...,
  rawParams: phase.params, stops: [], partOf: opts.runId, externalStop })`.
- **`externalStop`** for a phase: the plan stops (`checkStops` with the plan's starting XP and
  elapsed time since the plan started; a plan stop ends the phase AND the plan `done`), then the
  plan's `until` (ends the plan `done`), then the phase's `until` (ends the phase `done`). A plan
  stop, plan `until` or phase `until` ends the phase at once; the engine then settles a fight the
  phase ended in (at most `SETTLE_TICKS`, `lib/engine.ts`). After a plan stop or plan `until`, a
  phase that does not end `done` fails the plan whatever `onFail` says.
- **Outcomes**: `done` → select again. `failed`/`stuck` → `onFail` (`fail` default ends the plan
  with that status and `<phase>: <reason>`; `continue` selects again with the phase skipped once;
  more than `maxFails` consecutive failures of one phase end the plan `failed`). `error` → plan
  `error`. A phase ending `done` resets its failure count.
- **Rails**: before acting, every phase's params are parsed against its task's schema (a failure
  ends the plan `error`, naming the phase and issues); `validateStops` on the plan stops. A phase
  that ends with total XP, inventory and position unchanged is idle; `maxIdlePhases` idle phases in
  a row end the plan `failed` (`phases make no progress: <names>`). A `when`/`until`/`onFail` that
  throws ends the plan `error` naming the phase and the predicate.
- **Bank memory**: the runner wraps each phase's driver so every state it returns with
  `bank.isOpen` updates the known bank counts (by item name), which `v.bank` reads.
- **`PlanResult`** = `TaskResult` + `phases`: `task: "plan:<name>"`, `params: { plan, phases:
  [{ phase, task, params }] }`, `status`/`reason` of the plan, `durationMs`, `loops` = phase runs,
  `stepRuns` keyed by phase name, `lastStep` = last phase name, `xpGained`/`levelsGained`/
  `inventoryDelta` from the plan's first state to its last, `finalPos`/`hp`/`inCombat` from the
  last state, all phases' `screenshots`, `logFile` = the plan log. `phases`: one entry per phase
  name `{ phase, task, runs, statuses: Record<status, n>, durationMs, xpGained, lastReason }`
  plus `recent`: the last 3 phase runs `{ phase, runId, logFile, status, reason }`. Kept compact:
  its size does not grow with the number of runs beyond the per-phase entries.
- Plan log events: `start` (plan name, phases, stops), `select` (phase + the summary above),
  `phase-end` (phase, runId, status, reason, durationMs, xpGained), `result` (the PlanResult).

### Acceptance criteria
- [ ] Unit tests on scripted worlds cover: selection order and `when` defaults; a producer →
      consumer cycle running two rounds; phase `until` ending a phase and the plan going on; an
      `until` ending a phase in a fight (settled by the engine); plan `until` and plan `--until` (`minutes`, `xp`) across phases
      measured from the plan's start; `onFail` `fail`, `continue`, the function form and
      `maxFails`; `no phase applies`; the idle-phase rail; params checked up front; a throwing
      predicate; `v.bank` remembered from an earlier phase; `phase-end`/`result` events; the
      PlanResult totals and `phases` summary.
- [ ] `phase()` type-checks params against the task's schema (a test file with a deliberately
      wrong param under `// @ts-expect-error` proves it).
- [ ] Each phase run's result carries `partOf` = the plan runId.
- [ ] `plan.ts` has no SDK import and no `Date.now()`.
- [ ] Out of scope: the CLI, stats, example plans.

## Task 4 — CLI, path alias and stats

**Files:** `conductor/run-task.ts`, `tsconfig.json` (root), `conductor/tsconfig.json` if needed,
`conductor/tools/stats.ts`, tests for any pure helpers you extract.

- `bun conductor/run-task.ts <bot> --plan <file> [--until <stop>]... [--takeover]`. `--plan` and a
  `<task>` positional are mutually exclusive (usage error, exit 2, with the RESULT line). The file
  is imported; its default export must pass `isPlan` (else usage error naming the file).
- The plan runs in one `runScript` session (one controller connection for the whole plan). Plan
  runId `<fileStamp>-plan-<name>`, plan log `conductor/runs/<bot>/<runId>.ndjson`, and a copy of
  the plan source beside it as `<runId>.plan.ts` (drafts change; the run keeps what ran). Each phase
  run gets its own `<fileStamp>-<task>` log and `.ticks.ndjson.gz` recording, built the way a task
  run's are today (share the code; don't duplicate it).
- The last stdout line is `RESULT <PlanResult json>`; exit 0 for `done`, 1 otherwise. A signal
  writes a killed result to the running phase's log (as today) and prints a plan RESULT with status
  `error`, reason `killed by <signal>`.
- tsconfig `paths`: `@conductor/*` → `conductor/*`, so a plan imports `@conductor/lib/plan` and
  `@conductor/tasks/<task>` both from `conductor/plans/` and from a draft in
  `conductor/runs/<bot>/plans/`. Verify Bun resolves it at runtime from both places.
- `stats.ts` skips results that carry `partOf` by default, so a plan is counted once, as
  `plan:<name>`; `--phases` includes them. Check every other reader of run results
  (`grep -rn "type === 'result'\|loadResults" conductor/tools conductor/lib`) for the same double
  count and fix it the same way.

### Acceptance criteria
- [ ] `--plan` runs a plan end to end on the live client (proved by Task 5's smoke test; here, a
      unit test of any extracted argument parsing/loading helpers covers the usage errors).
- [ ] A plan in `conductor/runs/<bot>/plans/` importing through `@conductor/...` loads and runs
      (Bun), and `tsc --noEmit -p conductor` accepts the alias.
- [ ] `stats.ts` counts a plan once by default and its phases with `--phases`; tested on a fixture
      results set if `stats.ts` has testable helpers, else by a unit test of the extracted filter.
- [ ] Plain task runs are unchanged (CLI, logs, RESULT).

## Task 5 — A promoted example plan and the smoke test

**Files:** `conductor/plans/chop-burn.ts`, `conductor/test/integration/smoke/plan.itest.ts`,
`conductor/test/integration/harness.ts` (a `runPlan` helper beside `runTask`).

- `conductor/plans/chop-burn.ts`: the design doc's chop → burn plan at the verified spots
  (woodcutting `tree`, area `{x:3195,z:3220,radius:12}`, `onFull: 'stop'`; firemaking `Logs`,
  area `{x:3230,z:3240,radius:6}`; firemaking `when: v => v.full && v.inv('Logs') > 0`).
- Smoke: a fixture bot at Lumbridge with an axe, a tinderbox and enough unrelated items that only
  a few log slots are free, so a cycle is short. Run the plan with a plan-level stop that ends it
  after two firemaking phases (wrap the promoted plan in the test, or pass `--until` if that is
  enough). Assert: status `done`, firemaking ran twice and woodcutting at least twice, Woodcutting
  and Firemaking XP gained, the phase runs' logs exist and carry `partOf`.
- If a real-world finding (a spot, a timing) surfaces, put it in `learnings/` per the `knowledge`
  skill.

### Acceptance criteria
- [ ] `bun run test:integration plan` passes against the local stack.
- [ ] `conductor/plans/chop-burn.ts` imports through `@conductor/...` and type-checks.
- [ ] The harness's new helper mirrors `runTask` (same RESULT parsing and failure messages).

## Task 6 — Agents, skills and docs for plans and goal-owning runners

**Files:** `.claude/agents/task-runner.md`, `.claude/skills/conductor/SKILL.md`,
`conductor/README.md`, `conductor/docs/plans.md` (status line only), `CLAUDE.md` (the conductor
section's task bullet only).

Write the design doc's "Goals" section into the agents' instructions:

- `task-runner.md`: it owns a goal (end state, constraints, budget, knowledge) and works it through
  plans; the plan API in brief with one example; drafts in `conductor/runs/<bot>/plans/`, reuse of
  `conductor/plans/`; running with `--plan`; its durable state file
  `.durable-state/runners/<bot>.json` (fields from the design doc; read first on every turn, written
  after every plan run and decision); the bounded debug loop (method, spot, params, phase order,
  conditions; never task or engine code); journaling every plan run; the return conditions; the
  `DECISION NEEDED` report (question, options, evidence, bot left safe) and that the conductor
  answers by resuming it; the final report (goal outcome, RESULT lines, plans that worked for
  promotion, lessons for the curator). Tools: add `Write` and `Edit` (instructions limit them to
  its drafts and its state file).
- `conductor/SKILL.md`: the task-runner dispatch template becomes Goal / constraints / budget /
  knowledge (plans to reuse); goals stay a few plans long; state gains
  `runners: { <bot>: { agentId, stateFile, goal } }`; answering a `DECISION NEEDED` with
  `SendMessage` to the agentId; promoting a draft (`git mv` into `conductor/plans/`, commit with
  the runs' results); the curator once per goal; the retrospective's run count from the journal
  and "runner reports the goal unreachable" replacing "failed 3 times"; the numbered-chain
  guidance and the conductor's inventory walk-through removed.
- `conductor/README.md`: a short "Plans" section (what, where, how to run, link to the design).
- `conductor/docs/plans.md`: replace "Not built yet." with a pointer to this spec as built.

### Acceptance criteria
- [ ] Every rule in the design doc's "Goals" and "Where plans live" sections is reflected in
      `task-runner.md` or `conductor/SKILL.md`, with nothing contradicting them.
- [ ] No reference to numbered chains remains in the conductor skill or the runner agent.
- [ ] The example in `task-runner.md` uses the real API names from `conductor/lib/plan.ts`.
- [ ] Out of scope: `conductor/roadmap.md` (held by the conductor run), other agents' prompts
      beyond a one-line pointer where they mention chains.

## Out of scope for this spec

- Plan-level replay (re-deriving phase choices from recordings).
- Bank knowledge across plans, and a `once` flag (design doc "Later").
- New catalog tasks, or changes to tasks other than `bank`.
- Running the conductor or a real goal on a conductor bot.
