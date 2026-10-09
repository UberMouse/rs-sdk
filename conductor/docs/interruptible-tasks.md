# Interruptible, composable, testable tasks

Plan for moving conductor tasks from `async` steps that wait on their own to generator steps that
hand every wait and send back to the engine, so interrupts, stops and timeouts are handled in one
place, and so task and action logic runs against fake world states in `bun test`.

Decisions (2026-10-09):

- **No Effect-TS.** The game is one tick-driven state stream in and packets out; plain generators
  plus a small interpreter cover it (see "Why generators" below).
- **The new action layer lives in `conductor/`**, not `sdk/`. `sdk/` is upstream
  (MaxBittker/rs-sdk, active: 60 SDK commits since June; this fork has only touched
  `sdk/runner.ts`). `bot.*` stays as is for MCP, `bots/*` scripts and upstream merges.
- **Test worlds: scripted tick timelines + replay of recorded runs first**, a reactive rule-based
  sim later and only for mechanics where timelines get painful (walking, depletion).
- **Integration suite: the headless lite client, gated locally** (`bun run test:integration`)
  before committing changes to `conductor/core` or `conductor/actions`.

## Where things stand

*The starting point of the port, before it landed: `INTERRUPTS`, `waitUnlessThreatened` and
counters reset in `when` are what it replaced. The pattern as built is in
`.claude/agents/task-author.md`, with `conductor/tasks/woodcutting.ts` as the reference.*

### Task code (`conductor/lib`, `conductor/tasks`, ~3k lines)

- `engine.ts` already runs a priority list: each loop the first step whose `when()` passes runs,
  with `INTERRUPTS` (death, wilderness, low HP, dialog) in front. Interrupts, stops and the
  watchdog are only checked **between** steps.
- So each long wait reimplements threat awareness: `waitUnlessThreatened` (`lib/threat.ts`),
  `waitOrTimeout`/`waitForKill` (`tasks/combat.ts`), the `combatTicks` loop in
  `tasks/woodcutting.ts`, similar helpers in mining/smithing/bank.
- Step timeouts use `Promise.race`; a timed-out step keeps running in the background
  (`engine.ts` logs `abandoned-step-error`). A `minutes:` stop is late by up to a whole step.
- Tasks fork SDK actions to make them interruptible: `woodcutting.ts` has its own `chopTree`
  because `bot.chopTree` waits 30s blind and counts any `/logs/i`.
- Untestable seams: `Date.now()` in step logic (`noTreeSince`, `fightStartedAt`), reads outside
  the state snapshot (`ctx.sdk.getNearbyLocs()`, `getGroundItems()`), untyped `ctx.memory`,
  counters reset as a side effect inside `when()`, `ctx.memory.expectDialog` flags.
- No tests under `conductor/`.

### SDK (`sdk/`, upstream)

- `bot.*`: 56 async methods in `sdk/actions.ts` (4.9k lines) + `actions-helpers.ts`. All
  sequential: 45 `waitForCondition`, 38 `waitForTicks`, 0 `Promise.race`, 0 `finally`. No
  cancellation anywhere. Some waits hide side effects (`burnLogs` clicks dialogs inside a
  `waitForCondition` predicate).
- Seam for a fake world: every `send*` goes through one private `sendAction(BotAction)`; state
  arrives in `handleMessage` → `this.state` → `stateListeners`. `findPath` is local
  (`sdk/pathfinding.ts` + `collision-data.json`), so simulated walking can use real collision.

### SDK test health (measured 2026-10-09)

| Tier | What | Result |
|---|---|---|
| Unit, `sdk/test/*.test.ts` (in `bun run test`) | Fabricated state, `(sdk as any)` monkeypatching, no shared fake | **190 pass, 0 fail.** Covers trade/GE, chat, state summary, `walkTo` partial paths + tolerance, `dismissBlockingUI`, attack observation. ~11 of 56 `bot.*` methods. |
| Integration, other `sdk/test/*.ts` (52 scripts) | Puppeteer browser client + `generateSave` fixture saves against the local server | **32/33 pass** of the 33 that ran (batch stopped early), 11-44s each. The one failure (`combat-style-metadata`, Bronze mace) is a stale expectation: the game publishes 4 mace styles incl. Spike/Controlled. Not in CI, not run routinely. |

Of the ~20 `bot.*` methods the tasks use, `dropItem` has no test at all and `dismissBlockingUI`
only unit tests; the rest have at least one integration script.

Harness problems: `generateSave` writes relative to `process.cwd()`, so from a worktree the save
lands in the worktree and the shared server (main checkout) never sees it (worked around by
running from a scratch dir with `server/engine/data/players` symlinked). The webclient's
`node_modules` are not installed in worktrees, so its unit tests fail there (`fflate` missing).

**Do we need an integration suite?** Yes, but since `sdk/` is not being rewritten its jobs are:

1. **Verify each ported `conductor/actions` op against the real game** (the new code is what can
   break).
2. **Parity during migration**: run the old `bot.X` and the new op on the same fixture save and
   compare outcomes.
3. **Pin the upstream behaviour we build on** (state fields, `send*` effects, `findPath`) so an
   upstream merge that changes it fails loudly. Plus: rerun upstream's own `sdk/test` scripts
   after each upstream sync as a baseline.

## Target design

### Why generators

Everything that looks concurrent in this domain is a predicate over the same per-tick state
(`s => arrived(s) || died(s)`), so the whole stack can be a pure function from (params, state
sequence) to command sequence. Generators give: deep cancellation (`gen.return()` propagates
through every `yield*` and runs `finally`), synchronous tests that feed a thousand ticks in
milliseconds, and exact replay of recorded runs. Typed results come from the same `yield*` trick
Effect uses.

### `conductor/core/`: commands, ops, interpreter

```ts
type Op<T> = Generator<Command, T, unknown>;

// Commands an op yields; only the interpreter touches the SDK.
type Command =
  | { type: 'send'; action: BotAction }                       // -> ActionResult
  | { type: 'wait'; until: (s: BotWorldState) => boolean;
      ticks: number; label: string }                          // -> WaitResult
  | { type: 'scan'; radius?: number }                         // -> NearbyLoc[] (async extended scan)
  | { type: 'call'; label: string; run: () => Promise<unknown> } // legacy bot.* escape hatch, migration only
  | { type: 'log' | 'screenshot'; ... };

type WaitResult = { kind: 'met' | 'timeout'; state: BotWorldState };

// typed helpers, used with yield*
function* wait(label: string, until: Pred, ticks: number): Op<WaitResult> { ... }
function* send(action: BotAction): Op<ActionResult> { ... }
function* ticks(n: number): Op<BotWorldState> { ... }
```

- **Time is ticks.** Waits take tick budgets; ops read `state.tick`. Wall clock is only for the
  engine's watchdog and `minutes:` stops, via an injected `now()`.
- **Reads go through the snapshot** passed in the op's context (`ctx.state()`), never
  `sdk.get*()`; the extended scan is a command.
- **Interpreter** (`interpret(op, driver, guards)`) runs one op: forwards `send`/`scan`/`call`
  to the driver; for `wait`, re-checks on every tick, in order: guards → the wait's own
  predicate → its tick budget. When a guard fires:
  - `abort`: `op.return()` (its `finally` may yield cleanup sends, run uninterruptibly with a
    small tick cap), then the guard's own op runs, then the engine re-selects a step.
  - `suspend`: the guard's op runs, then the same wait resumes (for level-up dialogs).
- `uninterruptible(op)` marks a critical section (mid-withdraw, mid-trade) that guards only
  preempt for `death`/`wilderness`.
- A `call` (opaque Promise) can only be raced: a guard firing during one waits for it to settle
  (bounded) and is logged. It exists only so tasks can move to generators before their actions
  are ported; the goal is zero `call`s.

**Drivers** (`conductor/core/drivers/`):

- `LiveDriver(sdk)`: sends via `sdk.send*` (one switch over `BotAction`), ticks from
  `sdk.onStateUpdate`, scans via `sdk.scanNearbyLocs`, `findPath` via the SDK. Optionally records
  every tick (see Replay).
- `TimelineDriver(states, opts)`: tests. Each `wait` advances through a scripted list of tick
  states; every `send` is recorded and answered (default success, or scripted per action). Later
  `opts.react` (the sim phase) lets rules turn sends into state changes.

### `conductor/actions/`: the action library

Generator ops ported from `sdk/actions.ts`, only what tasks need, in rough order of use:
`dismissUI`, `interactLoc`/`interactNpc`, `chop`, `mine`, `eat`, `drop`, `pickup`, `equip`,
`openBank`/`deposit`/`withdraw`/`closeBank`, `openShop`/`buy`/`sell`/`closeShop`, `attack`,
`useItemOnLoc`, `smithAtAnvil`, `fletch`, `burn`, then `walkTo` (biggest: doors, partial paths,
`actions-helpers.ts`).

- Results are tagged unions per op (`{ ok: true, ... } | { ok: false, reason: 'cant-reach' |
  'felled-by-other' | 'timeout' | ... }`), not `success` + free text, so tasks branch on reasons.
- Ops wait only for their own effect. No threat checks inside an op: guards handle that.
- Side effects inside waits become explicit loops (`burnLogs`' dialog click becomes
  `while (!xp) { const w = yield* wait(...); if (dialogOpen(w.state)) yield* send(click) }`).
- Each op file header records `ported from sdk/actions.ts <method> @ <upstream sha>`;
  `bun conductor/tools/upstream-drift.ts` lists upstream commits to `sdk/actions*.ts` since each
  recorded sha, so upstream fixes get considered for porting after each sync.

### Task contract (`conductor/lib/task.ts`)

```ts
defineTask({
  name, description, params,
  memory: () => ({ noTreeSince: null as number | null }),   // typed, per run
  preflight(ctx) { ... },                                    // pure over ctx.state()
  steps: [
    { name: 'chop', when: ctx => true, *run(ctx) { ... yield* chop(ctx, tree) ... } },
  ],
  allow: ['dialog'],          // replaces memory.expectDialog: guards this task handles itself
});
```

- `run` becomes `*run(ctx): Op<Outcome>`. `when` must be pure. The engine evaluates every
  step's `when` each loop (cheap) so it can reset per-step **streak counters**
  (`ctx.streak('chopFails')`) automatically when that step stops applying, which removes the
  "reset the counter inside `when`" pattern.
- `TaskContext` loses `bot` and `sdk`: tasks reach the game only through `conductor/actions` and
  core commands. That is the type-level enforcement that keeps agent-written tasks testable.
- `INTERRUPTS` become guards: `{ name, when, policy: 'abort' | 'suspend', *run }`. Death and
  wilderness: abort + fail. Low HP: abort, eat/regen, re-select. Dialog: suspend, dismiss,
  resume. Under attack while skilling (woodcutting/mining today): abort + task-specific handling,
  as built a task's own guard: `guards: [underAttackGuard]` on the task def, checked after the
  shared guards. Under an abort guard's handler only critical, higher-ranked and suspend guards
  stay on, so a task guard never cuts short the low-HP eat.
- Deleted: `waitUnlessThreatened`, `waitOrTimeout`, per-task combat-tick loops,
  `expectDialog`, `Date.now()` in tasks.

### Engine and `run-task.ts`

- `executeTask(def, { driver, sinks, now })`: pure of I/O. NDJSON log, progress printing and
  screenshots become injected sinks; tests pass in-memory ones.
- Stops, watchdog and guards are checked at every tick of every wait, not only between steps.
- Step timeout is real cancellation (`op.return()`); `abandoned-step-error` disappears.
- `run-task.ts` builds `LiveDriver` from `runScript`'s `sdk` and the file sinks; the CLI and
  `RESULT <json>` contract don't change.

### Tests

`conductor/test/` with `bun:test`; added to `bun run test` and `verify:conductor`.

- **State builders** (`conductor/test/world.ts`): `player({ at, hp })`, `inv('Logs', 3)`,
  `loc('Tree', x, z)`, `npc(...)`, `dialog(...)`, `ticks(n)`, built over a real captured base
  state (`bun conductor/tools/capture-state.ts <bot>` dumps a trimmed snapshot to
  `conductor/test/fixtures/`), not `as unknown as BotWorldState` casts.
- **Op tests**: drive an action op with `TimelineDriver`, assert commands and result.
- **Step/task tests**: `simulate(task, { params, timeline })` returns commands, step sequence,
  `TaskResult`.
- **Engine tests**: guards abort/suspend/resume, stops mid-wait, watchdog, step timeout
  cancellation, `finally` cleanup.

### Replay

`LiveDriver` records each tick to `conductor/runs/<bot>/<runId>.ticks.ndjson.gz`.
`bun conductor/tools/replay.ts <file>` re-runs the current task code against the recorded states
and reports the first command that differs from the recorded run. Replay is valid up to that
divergence (the world doesn't react to new decisions), so it answers "would the new code have
decided differently here", which is the question a failed run raises.

Risk: full `BotWorldState` per tick may be large. Measure first; record a trimmed projection
(player, inventory, equipment, skills, dialog/interfaces, combat, nearby within ~15 tiles, new
messages) delta-encoded against the previous tick if needed.

### Integration suite (`conductor/test/integration/`)

- `withFixtureBot(save, fn)`: unique name → `createSaveData` (from `sdk/test/utils/save-generator`)
  written under `RS_ENGINE_DIR/data/players/main` → temp `bots/<name>/bot.env` → spawn
  `server/webclient/src/lite/runner.ts <name>` (cwd `server/webclient`) and wait for `Gateway
  connected` → `runScript` SDK → `fn` → kill runner, remove the bot dir.
- One atomic test per `conductor/actions` op (sdk/test/PRINCIPLES.md style: minimal inventory,
  exit on the observed effect), parity tests against `bot.X` while both exist, one short smoke
  per task at its verified spot, and an upstream-contract set.
- `bun run test:integration [filter] [-j N]`: parallel (lite clients are cheap), table of
  pass/fail + time. Gate: the task-review skill and the conductor's commit rule require a green
  run for changes to `conductor/core` or `conductor/actions` (a git hook can't, it needs the
  local stack).

## Phases

Each phase leaves `run-task.ts` working and every task runnable.

0. **Safety net.**
   - Lite-client `withFixtureBot` harness and `test:integration` runner.
   - Smoke tests for every current task on fixture saves.
   - Integration tests for the `bot.*` methods tasks use that lack them (`dropItem`,
     `dismissBlockingUI`).
   - Record the baseline.
   - Note upstream's stale `combat-style-metadata` mace expectation (upstream issue or PR) and
     the `generateSave` cwd path (small upstream PR: honour `RS_ENGINE_DIR`).
1. **Core + engine.**
   - Commands, `Op`, interpreter, both drivers, sinks, `now()`.
   - Engine drives generator steps.
   - `async run` steps keep working through a `call` adapter, so no task changes yet.
   - Engine unit tests.
2. **Reference task.**
   - Port woodcutting end to end: `chop` op, guards replace its threat handling, typed memory,
     streak counters.
   - Unit tests + integration smoke.
   - Rewrite the task-author agent, the robustness/contract/code-quality lenses and
     `conductor/README.md` around the new pattern, so new tasks are written the new way from
     here on.
3. **Action library + remaining tasks.**
   - Port ops in the order above, each with op unit tests, an integration test and a parity
     test.
   - Port each task once its ops exist (combat, mining, fletching, firemaking, pickup, bank,
     shop, smithing).
   - `walkTo` last.
   - Then remove `call`, `lib/threat.ts` waits and `bot`/`sdk` from `TaskContext`.
   - As built (Task 14): done. No task, op or engine path reaches `bot` or `sdk`; `call`, `async
     run`, the wall-clock step grace and `abandoned-step-error` are gone.
4. **Recording + replay.** Measure state size, add the recorder and `replay.ts`, and have
   task-runner's failure diagnosis use replay.
5. **Reactive sim (later).**
   - Rules for the mechanics where timelines get painful: walking along `findPath` with real
     collision, resource depletion/respawn, skilling yields.
   - Add each rule only once a test needs it, and check it against integration results.

## Risks

- **Drift from upstream `bot.*`**: ported ops miss upstream fixes. Mitigation: recorded shas +
  `upstream-drift.ts` after each sync, parity tests.
- **`walkTo` port size**: door handling, partial paths, stairs. As built (Task 13) the op opens
  doors and gates and handles partial paths and long walks, but climbs no stairs or ladders and
  takes no ferry; with `call` gone, a task that needs a level change or the Karamja ferry needs
  those ported as ops first.
- **Guard policy mistakes** (abort vs suspend) change game behaviour, e.g. whether a level-up
  dialog stops skilling. Decide per guard from observed behaviour, record it in `learnings/`.
- **Agent adoption**: task-author agents must learn the generator style; the type-level removal
  of `bot`/`sdk` and the woodcutting reference task carry most of that.
- Uncommitted work in this worktree (`engine.ts`, `util.ts`, `woodcutting.ts`, new
  bank/mining/smithing tasks) should land before phase 1 touches the engine.
