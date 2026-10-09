# Spec: interruptible, composable, testable tasks

Expands the approved plan `conductor/docs/interruptible-tasks.md` into ordered tasks. Each
`## Task N —` section is one unit of subagent-driven work: implemented and committed by one
agent, then reviewed for spec compliance and code quality before the next starts. Tasks are
ordered primitives-first; a task may use anything an earlier task landed.

## Global rules (apply to every task)

- **`sdk/` is upstream** (MaxBittker/rs-sdk). Do not edit `sdk/` except where a task says so.
  Importing from `sdk/` (types, `BotSDK`, `BotActions`, `sdk/test/utils/save-generator`) is fine.
- **Do not touch** `conductor/tools/save.ts`, `conductor/tools/load.ts`, `conductor/lib/saves.ts`,
  `conductor/lib/client.ts`, `conductor/saves/`: another session (branch `parallel-bots`) owns
  them.
- **Every phase leaves `bun conductor/run-task.ts` working and every catalog task runnable**,
  with an unchanged CLI and `RESULT <json>` contract (`TaskResult` fields unchanged unless a task
  says so).
- **Formatting and lint**: `conductor/` is oxfmt + oxlint (warnings denied). Finish with
  `bun run verify:conductor` (fmt check, lint, `tsc --noEmit -p conductor`).
- **Unit tests** live in `conductor/test/**/*.test.ts` (bun:test), never call `process.exit`, need
  no server, and run in `bun test conductor` in well under 10s total. Add `conductor` to the root
  `test` script in Task 1.
- **Integration tests** live in `conductor/test/integration/**/*.itest.ts` and run only through
  `bun run test:integration`, against the local stack (engine `:8888`, gateway `:7780`).
- **Game time is ticks.** New core/action/task logic never calls `Date.now()`; time comes from
  `state.tick` or the injected `now()`.
- Game knowledge discovered along the way goes in `learnings/` per the `knowledge` skill, not in
  code comments.
- Comments match the surrounding density: explain why, not what.

## Task 1 — Integration harness and runner

**Files:** `conductor/test/integration/harness.ts` (an uncommitted draft exists: finish and own
it), `conductor/test/integration/run.ts`, `conductor/test/integration/smoke/woodcutting.itest.ts`,
`package.json`.

`withFixtureBot(save, fn, opts)` spawns a fresh never-used account from a generated save:
`createSaveData` (from `sdk/test/utils/save-generator`) written atomically to
`<engineDir>/data/players/main/<name>.sav`; a temporary `bots/<name>/bot.env` for the local stack
(`SERVER=localhost:8888`, `GATEWAY_URL=ws://localhost:7780`); the lite client
(`server/webclient/src/lite/runner.ts <name>`, cwd `server/webclient`) started and awaited on its
`Gateway connected` line; a control `BotSDK` via `conductor/lib/env.ts` `connectSdk`. `engineDir()`
is `RS_ENGINE_DIR`, else `<main checkout>/server/engine` from `git rev-parse --git-common-dir`.
`writeFixtureSave(username, config)` and `startLiteClient(botName, { timeoutMs })` keep these
names and shapes: they will be swapped for `conductor/lib/saves.ts` `writeSave` and
`conductor/lib/client.ts` `startLiteClient` from `parallel-bots`. `startLiteClient` resolves to
`{ pid, log, stop() }` exactly as that module does: `log` is the path of the client's combined
stdout/stderr file, `conductor/runs/<bot>/lite-client.log`; `stop()` sends SIGINT and SIGKILLs
after 5s. Unlike `parallel-bots`' version, the harness keeps the child attached (not detached or
unref'd) so a crashed test process can't orphan it. Failure messages include the log's tail.

`runTask(name, task, params, until[])` in the harness runs `bun conductor/run-task.ts` as a
subprocess against a fixture bot (`withFixtureBot(..., { connect: false })`) and returns the
parsed `RESULT` line, plus stdout/stderr for failure messages.

`run.ts` (`bun run test:integration [filter] [-j N]`) finds `*.itest.ts` under
`conductor/test/integration/`, runs each file as its own `bun test <file>` process, N in
parallel (default 3), and prints a table: file, pass/fail, seconds; exit 0 only if all pass.

### Acceptance criteria
- [ ] `bun run test:integration woodcutting` passes on the local stack. The woodcutting smoke
      spawns a bot at Lumbridge trees with a bronze axe and Woodcutting 1, runs the
      `woodcutting` task via `run-task.ts` with `--until xp:Woodcutting:25 --until minutes:2`,
      and asserts `status: "done"` with Woodcutting XP gained.
- [ ] A save written where the running engine doesn't read it fails the test with a message
      naming `engineDir()` and `RS_ENGINE_DIR` (the bot's login position doesn't match the
      fixture's), not a timeout.
- [ ] Cleanup always runs (pass, fail, throw): the lite client process exits, the SDK
      disconnects, `bots/<name>/` is removed. No leftover processes after a run.
- [ ] `run.ts` runs files in parallel, prints the table, and exits non-zero when any file fails;
      a filter argument limits which files run.
- [ ] `package.json`: `test:integration` script added; `bun test conductor` added to the `test`
      script (passes with zero test files present is not required; Task 3 adds unit tests).
- [ ] Out of scope: no changes to `sdk/test/*`, `run-task.ts` or the engine.

## Task 2 — Smoke tests for every catalog task, and missing action coverage

**Files:** `conductor/test/integration/smoke/*.itest.ts`,
`conductor/test/integration/actions/*.itest.ts`, `conductor/docs/integration-baseline.md`.

One smoke per catalog task (bank, combat, firemaking, fletching, mining, pickup, shop, smithing;
woodcutting exists), each a fixture bot at the task's verified spot with the minimal inventory,
running the task through `runTask` with a short `--until` and asserting the observed effect
(XP gained, item gained/lost, coins changed), not just `status`. Spots (from the task
descriptions and `learnings/`): SE Varrock mine (3285,3365) copper/tin; firemaking field
{x:3230,z:3240,radius:6}; fletching anywhere (knife + logs, product "arrow shaft"); Lumbridge
chickens (3231,3295, radius 8, inside the coop); knife spawn {x:3224,z:3202,radius:4}; Varrock
West bank (3185,3436) with items in the save's bank; Lumbridge general store "Shop keeper"
(3212,3247), buy one Hammer with coins; smithing: smelt at Lumbridge furnace (3225,3256) with
copper + tin ore, and smith a bronze dagger at the Varrock West anvil (3188,3421) with a bronze
bar + hammer.

Plus atomic integration tests for the two `bot.*` methods tasks use that have no integration
coverage: `bot.dropItem` (item leaves inventory, appears on the ground) and
`bot.dismissBlockingUI` (a level-up dialog, produced by giving the save XP one action short of a
level, is dismissed and the next action runs).

### Acceptance criteria
- [ ] One `*.itest.ts` per catalog task, each asserting an observed game effect.
- [ ] `dropItem` and `dismissBlockingUI` integration tests exist and assert observed effects.
- [ ] `conductor/docs/integration-baseline.md` records the first full `bun run test:integration`
      table (pass/fail/time per file, date, engine commit if known). A test that fails because
      the task itself is broken (not the test) is kept, marked `test.todo`/skipped with the
      RESULT reason, and listed in the baseline as a known failure; the task is not fixed here.
- [ ] Out of scope: changing any catalog task or `sdk/`.

## Task 3 — Core: commands, ops, interpreter, timeline driver

**Files:** `conductor/core/op.ts`, `conductor/core/interpret.ts`,
`conductor/core/drivers/timeline.ts`, `conductor/test/core/*.test.ts`.

```ts
type Op<T> = Generator<Command, T, unknown>;
type Command =
  | { type: 'send'; action: BotAction }            // resumes with ActionResult
  | { type: 'wait'; label: string; until: (s: BotWorldState) => boolean; ticks: number } // WaitResult
  | { type: 'scan'; radius?: number }              // NearbyLoc[]
  | { type: 'call'; label: string; run: () => Promise<unknown> } // legacy escape hatch
  | { type: 'log'; msg: string; data?: Record<string, unknown> }
  | { type: 'screenshot'; label: string };         // string | null
type WaitResult = { kind: 'met' | 'timeout'; state: BotWorldState };
```

Typed helpers used with `yield*`: `send`, `wait`, `ticks(n)` (wait n ticks, returns the state),
`scan`, `call`, `log`, `screenshot`. `BotAction` is the SDK's action union (`sdk/types.ts`).

`Driver` interface: `state(): BotWorldState`, `nextTick(): Promise<BotWorldState>` (resolves
with the next published state), `send(action)`, `scan(radius)`, `call(run)`, `log`, `screenshot`,
`now(): number`.

`interpret(op, { driver, guards, onTick })` runs an op to completion and returns
`{ kind: 'returned', value } | { kind: 'aborted', by: guardName } | { kind: 'cancelled', reason }`:
- `send`/`scan`/`call`/`log`/`screenshot` forward to the driver; the result is passed back into
  the generator.
- `wait`: checks immediately, then on every `nextTick()`, in order: (1) `onTick(state)` (the
  engine's stops/watchdog; returns a cancel reason or null), (2) each guard's `when(state)`,
  (3) the wait's `until`, (4) the tick budget (`ticks` counted from the wait's first state).
- A guard has `{ name, when, policy: 'abort' | 'suspend', run(): Op<GuardOutcome> }`.
  `abort`: `op.return()` (its `finally` blocks run; commands they yield are executed with guards
  off, capped at a fixed number of ticks), then the guard's op runs, result `aborted`.
  `suspend`: the guard's op runs (guards off while it runs), then the same wait resumes and
  re-checks. A guard op returning `{ fail }`/`{ done }` ends the interpretation with that
  outcome as `aborted`, carrying the outcome.
- `onTick` returning a reason: `op.return()` with the same finally handling, result `cancelled`.
- `uninterruptible(op)`: a wrapper op; inside it only guards flagged `critical` (death,
  wilderness) fire.
- A guard firing during a `call` waits for the call to settle, then acts; it is logged.
- Exceptions thrown by the op propagate out of `interpret`.

`TimelineDriver(states, opts)`: `nextTick` advances through a scripted list of tick states (the
last one repeats, with `tick` incremented, or the run ends with an error when `opts.strict`);
every command is appended to a `commands` log; `send` answers from `opts.respond(action)` or
success; `now()` derives from the tick (`tick * TICK_MS`).

### Acceptance criteria
- [ ] Unit tests (TimelineDriver, no server) cover: send result threaded back; wait met /
      timeout by tick budget; guard abort runs the op's `finally` (including a cleanup `send`)
      then the guard op; guard suspend resumes the same wait; `onTick` cancel; nested `yield*`
      ops are cancelled through the whole stack; `uninterruptible` blocks non-critical guards
      and not critical ones; guard during `call` acts after it settles; op exceptions propagate.
- [ ] `yield*` helpers are fully typed: `const r = yield* wait(...)` is `WaitResult` with no
      casts at the call site.
- [ ] No `Date.now()` in `conductor/core/`; no SDK import in `op.ts`/`interpret.ts` beyond types.
- [ ] Out of scope: engine changes, live driver, task changes.

## Task 4 — Live driver and engine on the interpreter

**Files:** `conductor/core/drivers/live.ts`, `conductor/lib/engine.ts`, `conductor/lib/task.ts`,
`conductor/run-task.ts`, `conductor/test/engine/*.test.ts`.

`LiveDriver(sdk, sinks)`: `state()` from `sdk.getState()`, `nextTick()` via
`sdk.onStateUpdate` (resolves on the next state whose `tick` advanced), `send` maps every
`BotAction` to the SDK's public `send*` methods (one exhaustive switch; type error when a new
action type appears), `scan` via `sdk.scanNearbyLocs`, `now()` = `Date.now()` (the only wall
clock).

`executeTask(def, { driver, sinks, now, ... })`: no direct fs/console/SDK use inside; the NDJSON
log, progress printing and screenshots are `sinks` (file + console sinks in `run-task.ts`,
in-memory sinks in tests). Steps may be either `async run(ctx)` (legacy, run through a single
`call` command) or `*run(ctx)` returning `Op<Outcome>`. The engine interprets each step with
the `INTERRUPTS` as guards (death, wilderness: `critical`, abort+fail; low HP: abort; dialog:
suspend), and `onTick` = stops + watchdog + tick-stall, so a `minutes:` stop or watchdog fires
mid-wait in generator steps. Step timeout becomes a tick budget: the engine cancels the step
(`op.return()`), so `abandoned-step-error` no longer exists for generator steps (it remains for
legacy `call` steps, which can't be cancelled). `TaskResult` and the NDJSON event types stay as
they are.

### Acceptance criteria
- [ ] Engine unit tests with TimelineDriver + in-memory sinks cover: a generator step's wait is
      aborted by low HP mid-wait and the low-HP guard runs; a level-up dialog during a wait is
      dismissed (suspend) and the wait completes; death mid-wait fails the run; a `minutes`/`xp`
      stop ends the run mid-wait as `done`; the watchdog ends a stalled run `stuck`; step
      timeout cancels a generator step and runs its `finally`; a legacy `async run` step still
      works; `TaskResult` fields are populated as before.
- [ ] All existing tasks are unchanged and still pass their Task 2 smoke tests
      (`bun run test:integration smoke`).
- [ ] `run-task.ts` CLI, flags, exit codes and `RESULT` line unchanged.
- [ ] Out of scope: converting any task to generators.

## Task 5 — Task contract: typed memory, streak counters, `allow`

**Files:** `conductor/lib/task.ts`, `conductor/lib/engine.ts`, `conductor/lib/interrupts.ts`,
`conductor/lib/area.ts`, `conductor/test/engine/*.test.ts`.

- `defineTask({ memory: () => M, ... })`: `ctx.memory` is typed `M` (default: an empty record
  type for tasks that don't declare one, so existing tasks compile unchanged).
- `ctx.streak(name)`: a counter owned by the current step; the engine evaluates every step's
  `when` each loop (all must be pure) and resets a step's streak counters when its `when` is
  false. `ctx.counter` stays for run-scoped counts.
- `allow: GuardName[]` on a task disables those guards for it (replaces
  `ctx.memory.expectDialog`); guards are exported with stable names.
- Interrupts in `interrupts.ts` are rewritten as guards with pure `when`s (their counters become
  guard-episode state held by the engine, reset when the guard's `when` is false).

### Acceptance criteria
- [ ] Unit tests: streak counters reset when their step stops applying and not otherwise;
      typed memory compiles without casts in a sample task; `allow: ['dialog']` lets a task
      drive a dialog without the guard dismissing it; guard episode counters (low-HP eats,
      dialog-stuck) bound one episode and reset after it.
- [ ] No `when` in `conductor/lib/` has side effects.
- [ ] Existing tasks still compile and pass their smoke tests (they may keep `ctx.counter` and
      untyped memory until ported).

## Task 6 — Test world: state builders, capture tool, `simulate`

**Files:** `conductor/test/world.ts`, `conductor/test/fixtures/*.json`,
`conductor/tools/capture-state.ts`, `conductor/test/simulate.ts`, tests.

- `capture-state.ts <bot> [--name <fixture>]` connects in observe mode and writes a trimmed
  `BotWorldState` (no chat history beyond 10 messages, nearby within 15 tiles) to
  `conductor/test/fixtures/<name>.json`. Commit at least one captured base fixture (via a
  Task 1 fixture bot, not a real account).
- Builders over a base fixture: `world(base).player({ at, hp, maxHp, inCombat })`,
  `.inv(name, count)`, `.loc(name, x, z, opts)`, `.npc(...)`, `.ground(...)`, `.dialog(...)`,
  `.skill(name, level, xp)`, `.tick(n)`, producing complete `BotWorldState` objects with no
  `as unknown as` casts in tests.
- `simulate(task, { params, timeline, respond })` runs `executeTask` on a TimelineDriver and
  returns `{ result, commands, steps }`.

### Acceptance criteria
- [ ] Builders produce states the engine accepts; a test using them type-checks with no casts.
- [ ] `simulate` drives a minimal generator task end to end in a unit test.
- [ ] The capture tool works against a fixture bot (manual check recorded in the report).

## Task 7 — Reference port: `chop` op and the woodcutting task

**Files:** `conductor/actions/interact.ts`, `conductor/actions/chop.ts`,
`conductor/tasks/woodcutting.ts`, unit tests, `conductor/test/integration/actions/chop.itest.ts`.

Port `bot.chopTree`'s mechanics as `chop(ctx, tree, logs: RegExp): Op<ChopResult>` with a
tagged result (`{ ok: true } | { ok: false, reason: 'felled-by-other' | 'timeout' |
'send-failed', message }`), and an `interactLoc` op. Woodcutting's steps become generators using
them; its own threat handling (`waitUnlessThreatened`, `combatTicks`) is replaced by guards plus
a task-level "under attack while skilling" policy; typed memory; streak counters; ticks instead
of `Date.now()`. Behaviour (params, description, outcomes, fail reasons) stays the same.

### Acceptance criteria
- [ ] Unit tests (simulate + builders): chop success; tree felled by another player; low HP
      mid-chop aborts the chop and eats; full inventory with `onFull` drop and stop; area
      depleted after the give-up budget; under attack with auto-retaliate off fails.
- [ ] `chop.itest.ts` and the woodcutting smoke pass.
- [ ] Reviewed through the `task-review` skill (it is task code).
- [ ] Each ported op file starts with `// Ported from sdk/actions.ts <method> @ <upstream sha>`.

## Task 8 — Agents, lenses and docs for the new pattern

**Files:** `.claude/agents/task-author.md`, `.claude/review-lenses/{robustness,contract,code-quality}.md`,
`conductor/README.md`, `.claude/skills/task-review/SKILL.md` if it references the old pattern.

Describe the generator step pattern with woodcutting as the reference: ops from
`conductor/actions`, guards instead of threat-aware waits, ticks not wall clock, typed memory,
streak counters, unit tests with `simulate` + builders required for new/changed tasks,
integration smoke required. Lens criteria flag: `await` in task steps, `Date.now()` in task
logic, side effects in `when`, `ctx.memory` casts, missing unit tests.

### Acceptance criteria
- [ ] A task-author following only these docs would write a woodcutting-style task with tests.
- [ ] No doc still recommends `waitUnlessThreatened`, `expectDialog` or counters reset in
      `when`.

## Task 9 — Ops: inventory and simple interactions; port pickup, firemaking, fletching

**Files:** `conductor/actions/{dismiss,eat,drop,pickup,equip,use,fletch,burn}.ts`, the three
tasks, tests.

Port `dismissBlockingUI`, `eatFood`, `dropItem`, `pickupItem`, `equipItem`, `useItemOnItem` /
`useItemOnLoc`, `fletchLogs`, `burnLogs` as ops with tagged results (dialog clicks become
explicit loop steps, not side effects in wait predicates). Port the `pickup`, `firemaking` and
`fletching` tasks to generator steps on these ops.

### Acceptance criteria
- [ ] Each op has unit tests and an integration test (parity with the `bot.*` method on the same
      fixture where both exist).
- [ ] The three tasks have unit tests and pass their smokes; behaviour unchanged.
- [ ] Reviewed through `task-review` for the task changes.

## Task 10 — Ops: mining and combat

**Files:** `conductor/actions/{mine,attack}.ts`, `conductor/tasks/{mining,combat}.ts`, tests.

Port mining's rock interaction (by loc id) and `bot.attack` as ops; port both tasks
(combat's fight waiting becomes a wait with guards; its own eat step stays a task step).

### Acceptance criteria
- [ ] Op unit + integration tests; task unit tests; smokes pass; behaviour unchanged;
      `task-review` done.

## Task 11 — Ops: bank and shop

**Files:** `conductor/actions/{bank,shop}.ts`, `conductor/tasks/{bank,shop}.ts`, tests.

`openBank`/`deposit`/`withdraw`/`closeBank`, `openShop`/`buy`/`sell`/`closeShop` as ops; the
open/close pairs use `try/finally` so an abort closes the interface. Port both tasks.

### Acceptance criteria
- [ ] An abort mid-bank closes the bank (unit test via `finally`).
- [ ] Op unit + integration tests; task unit tests; smokes pass; `task-review` done.

## Task 12 — Smithing on ops

**Files:** `conductor/actions/smith.ts`, `conductor/tasks/smithing.ts`, tests.

Port `smithAtAnvil` and furnace smelting as ops; port the smithing task.

### Acceptance criteria
- [ ] Op unit + integration tests; task unit tests; both smithing smokes pass; `task-review` done.

## Task 13 — `walkTo` op

**Files:** `conductor/actions/walk.ts` (+ helpers), `conductor/lib/area.ts`, tests.

Port `bot.walkTo` with its door handling and partial-path logic from `sdk/actions.ts` and
`sdk/actions-helpers.ts`, using `sdk/pathfinding.ts` for paths. Replace every `call`-wrapped
`walkTo` in tasks and `area.ts`.

### Acceptance criteria
- [ ] Unit tests port the cases in `sdk/test/walkto-partial-path.test.ts` and
      `walkto-tolerance.test.ts` to TimelineDriver.
- [ ] Integration tests: a door on the route (Lumbridge castle / a gate), stairs or a level
      change if the original supports it, a long walk (Lumbridge → Varrock West bank); all task
      smokes pass.
- [ ] A guard firing mid-walk aborts the walk (unit test).

## Task 14 — Remove the legacy paths

**Files:** `conductor/lib/{task,engine,threat}.ts`, `conductor/core/*`, tasks.

Remove `bot` and `sdk` from `TaskContext`, the `call` command, legacy `async run` support and
`waitUnlessThreatened`/`isThreatened`-based waiting, once no task uses them.

### Acceptance criteria
- [ ] `TaskContext` has no `bot`/`sdk`; no `call` anywhere; all tasks are generator steps.
- [ ] Full unit suite and full `bun run test:integration` pass; baseline doc updated.

## Task 15 — Recording and replay

**Files:** `conductor/core/drivers/live.ts` (recorder), `conductor/tools/replay.ts`,
`conductor/core/drivers/replay.ts`, tests.

Measure the per-tick state size on a real run first and record the numbers in the plan doc.
`LiveDriver` records each tick (trimmed projection, delta-encoded if needed, gzip) to
`conductor/runs/<bot>/<runId>.ticks.ndjson.gz` along with each issued command. `replay.ts
<file>` re-runs the current task code against the recorded states and reports the first command
that differs from the recording (or "no divergence").

### Acceptance criteria
- [ ] A recorded smoke run replays with no divergence against unchanged code.
- [ ] A deliberate change to a task's decision (unit fixture) is reported as a divergence at the
      right tick.
- [ ] Recording size per minute of play is reported in the plan doc.

## Out of scope for this spec

The reactive rule-based simulator (plan phase 5), Effect-TS, changes to upstream `sdk/`
behaviour, and new catalog tasks.
