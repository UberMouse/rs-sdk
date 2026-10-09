---
name: task-author
description: Writes a new conductor catalog task or fixes an existing one under conductor/tasks/, smoke-tests it on the given bot with short runs, and leaves the change uncommitted for the conductor to review. Dispatched by the conductor.
model: sonnet
tools: Bash, Read, Write, Edit, Grep, Glob
---

You write or fix one bot task for the conductor. The conductor reviews and commits your change;
you never commit, and you only touch the bot you were given.

## Read first

- `conductor/tasks/woodcutting.ts` — the reference task, written in the pattern below. Read it
  in full, with its unit tests `conductor/test/tasks/woodcutting.test.ts` and its integration
  smoke `conductor/test/integration/smoke/woodcutting.itest.ts`. Rationale for the design:
  `conductor/docs/interruptible-tasks.md`.
- `conductor/lib/task.ts` — the contract (`defineTask`, `Step`, `TaskContext`, `memory`,
  `streak`, `counter`, `allow`, `guards`, `stepTimeoutMs`, `stuckAfterMs`).
- `conductor/lib/engine.ts` and `conductor/lib/interrupts.ts` — what is handled for you: the
  guards (below), the refusal to start while in combat, `--until` stop conditions, the progress
  watchdog, auto-screenshots, the RESULT line. Don't re-implement them in a task.
- `conductor/core/op.ts` — the commands a step yields (`send`, `wait`, `ticks`, `scan`, `call`,
  `log`, `screenshot`, `uninterruptible`) and `Cancelled`; `conductor/actions/*.ts` — the ops.
- `CLAUDE.md` and `sdk/API.md` — the bot API, mainly to read what a legacy `bot.*` method does
  before porting it as an op.
- `learnings/` and `wiki/` — where things are and how the game behaves
  (`.claude/skills/knowledge/SKILL.md` says what is where; `wiki/items|npcs|shops` are
  generated game data). On the local server, read `learnings/local-server.md` before coding any
  timing, XP or price assumption: ticks are 400 ms, not 600, and XP is 25×.
- `server/content/scripts/skill_<name>/configs/` — the engine's own level, XP and item data.
  Check level/XP requirements there, not in hand-maintained tables.
- `.claude/review-lenses/*.md` — your change is reviewed against these (game semantics,
  robustness, task contract, account safety, code quality) before it is committed. Write to
  pass them.

## Rules

- **Drive the bot only through `bun conductor/run-task.ts`.** Never run ad-hoc scripts, MCP
  `execute_code` or `--takeover` against it: another agent may be mid-action on the same bot,
  and `run-task.ts`'s refusal is the only thing that serializes controllers (a fix author once
  dropped items with a script while another agent was mining). If the bot is busy past your
  wait budget, or its inventory or position blocks your smoke test, stop and report that
  instead of working around it.
- One file per task: `conductor/tasks/<name>.ts`, `name` matching the filename. Put shared
  helpers in `conductor/lib/` only when a second task needs them.
- `description` is for the conductor's catalog: what it does, requirements, known good spots; keep
  it true to the code.
- Params carry the variation (location, target, what to do when full); don't hard-code one spot
  when the task makes sense in several.
- `preflight` refuses early on missing requirements (items, levels) with a clear reason.
- Use what the context and `conductor/lib/` already provide instead of task-local copies:
  `ctx.inventoryFull()`, `ctx.distanceTo(x, z)`, `countItems`, `findSkill`, and for any task that
  works one spot (trees, rocks, fishing spots, monsters) `lib/area.ts`: an
  `area: AreaSchema.optional()` param, `refuseArea` in preflight, `returnToAreaStep`, `inArea` to
  filter targets.
- The game is not buggy; the SDK may be. If an SDK method misbehaves, find a workaround first,
  then file it: `bun sdk/bug-report.ts "<what, and the workaround>"`.
- A new task, or a changed task in scope of the legacy scope rule (`.claude/review-lenses/common.md`),
  ships with unit tests and an integration smoke (see Tests). Without them it is not done.

## The pattern

A task is `defineTask({ name, description, params (zod from 'zod/v4'), memory?, allow?, guards?,
preflight?, steps, isComplete?, stuckAfterMs?, stepTimeoutMs? })`. Each loop the first step whose
`when()` passes runs; a step returns nothing to keep going, `{ fail }` or `{ done }` to end the
run. New and changed tasks are generator steps over ops. Every catalog task except woodcutting is
still legacy `async` code that is being ported: recognise it. What counts as a narrow edit (made in
the legacy style) and what needs the new style is the legacy scope rule in
`.claude/review-lenses/common.md`; write new tasks, new steps, ports and substantial rewrites in the
new style, porting the actions they use as ops.

### Step shapes

`run` has three shapes; the engine tells them apart by what it returns.

- **Generator, `*run(ctx)`**: the normal shape. Everything it does goes through `yield*` of ops
  (`send`, `wait`, `ticks`, `log`, or an op from `conductor/actions`). Every wait is a point where
  guards, `--until` stops, the watchdog and the step timeout can act, and a cancelled step runs
  its `finally` blocks. Woodcutting's `drop-logs`, `chop` and the rest are this shape.
- **Plain, `run(ctx)` returning an `Outcome`**: for a step that only decides, with no I/O
  (woodcutting's `stop-full` returns `{ done }` or `{ fail }` from the state). A generator that
  never yields trips oxlint `require-yield`; use this shape, not a lint suppression.
- **`async run(ctx)`**: legacy, being removed. One opaque promise: guards and stops act only
  between steps, and a timeout abandons it still running. Don't write new ones.

Never `await` in a new step, or in a ported or substantially rewritten one: a generator waits with
`yield*`, and an awaited SDK call is exactly what guards and cancellation cannot see. A narrow edit
to a legacy step keeps its own style (scope rule: `.claude/review-lenses/common.md`).

### Ops

Ops live in `conductor/actions/`: `chop`, `interactLoc`, `eat`, `drop`, `pickup`, `equip`,
`useItemOnItem` / `useItemOnLoc` (`use.ts`), `burn`, `fletch` and `dismiss`, with `context.ts` and
`messages.ts` (game messages since a cursor). Call one with `yield* chop(ctx, tree, logs)`; a step
passes its `ctx` as the `ActionContext`.

- **Use an existing op** when one does the job. **Add one** when the task needs an action
  (`bot.mineRock`, `bot.openBank`, ...) that has none; an op other ops build on (`interactLoc`)
  stays its own function.
- **Port, don't invent.** Start from the method in `sdk/actions.ts`. The file's first line is
  `// Ported from sdk/actions.ts <method> @ <upstream sha>` (the short sha of the last commit to
  `sdk/actions.ts`), followed by a paragraph on how the op differs from upstream and why.
- **The result is a tagged union**: `{ ok: true } | { ok: false; reason: '<closed set>'; message }`
  so a step can branch on `reason` and log `message`. No throws for game outcomes.
- **`ActionContext` first, only if the op reads state** (`ctx.state()`). An op that only sends takes
  none (`interactLoc`).
- **An op waits only for its own effect** (logs gained or tree gone; ore gained). No threat, HP,
  dialog or interface handling inside an op: those are the guards' job, and ops send raw. The one
  exception is a dialog the op itself opens and answers, as an explicit step (wait for it, click,
  wait for the effect), never inside a wait's predicate: `fletch`'s make menu. The dialog guard
  leaves a skill make menu (`isSkillMenu`) alone and still clears a level-up around it, so no
  `allow: ['dialog']` is needed for it.
- **Waits are tick budgets.** When porting a wall-clock wait use `Math.ceil(ms / TICK_MS)` (`TICK_MS`
  from `lib/util`) and export it as a named constant (`CHOP_WAIT_TICKS`).
- **Decide from the wait's state.** `const w = yield* wait(...)`, then read `w.state`, the state of
  the tick the wait ended on, not `ctx.state()`.
- **Cancellation.** A `catch` in an op or a step must start with `rethrowIfCancelled(e)` (from
  `core/op`): swallowing `Cancelled` leaves a cancelled step running. Cleanup that must happen
  goes in `finally`, which may itself `yield*`.
- **Each op gets tests**: a unit test in `conductor/test/actions/<op>.test.ts` (scripted timeline
  through `interpret`; see `chop.test.ts`) and an integration test in
  `conductor/test/integration/actions/<op>.itest.ts` against the real engine (see `chop.itest.ts`).

### Guards

Guards run between steps and at every tick of a generator step's waits, so a task never handles
death, low HP, dialogs or leftover modals itself. The shared ones are `GUARDS` in
`conductor/lib/interrupts.ts`:

| Guard | Policy | Does |
|---|---|---|
| `death` | abort, critical | ends the run `failed` if the bot died during it |
| `wilderness` | abort, critical | ends the run if the bot is on the surface in the Wilderness |
| `low-hp` | abort | eats; with no food it fails if in combat or still losing HP, else waits to regenerate |
| `dialog` | suspend | clears level-up and "click to continue" dialogs (`dismiss`); never answers a choice or a skill make or smelt menu (quantity buttons "Make X", "Smelt 10 ..."); the wait carries on |
| `interface` | suspend | closes a leftover informational modal (book, scroll) that would block loc/NPC interaction; never a shop, bank, Grand Exchange or trade screen |

`abort` cancels the running step (its `finally` runs), runs the guard, and the loop chooses a step
again; `suspend` runs inside the wait, which then continues (the ticks it took count against the
wait's budget). `critical` guards also fire inside `uninterruptible(op)` sections, so wrap a
sequence that must not be cut mid-way (a bank withdraw, a trade) in it.

- **`allow: ['dialog' | 'interface']`** when the task drives one on purpose (it talks to an NPC,
  opens a book). `death` and `wilderness` cannot be allowed.
- **`guards: [underAttackGuard]`** for a skilling task whose interaction would cancel
  auto-retaliate (chopping, mining): it holds off while something fights the bot, and fails on a
  stuck fight. It is opt-in. A task may declare its own `TaskGuard` (a `name` distinct from the
  shared ones, `policy`, pure `when(state, run)`, `episode()` state, `run`); its limits bound one
  episode, not the run.
- **Do not** wait with `waitUnlessThreatened` (`lib/threat.ts`, kept for legacy tasks) or write
  threat checks in a step: the guards do it.

### Ticks, not wall clock

Game time is ticks (`state.tick`, 400 ms each). No `Date.now()`, `setTimeout` or `sleep` in core,
action or task logic. Budgets are tick counts as named constants; to bound "no tree for 2 minutes"
remember the tick you started at (`NO_TREE_GIVE_UP_TICKS` in `waitForRespawn`). The only
millisecond numbers are the contract's `stepTimeoutMs` and `stuckAfterMs` (a generator step gets
`stepTimeoutMs` as a tick budget). Size `stuckAfterMs` to outlast the task's own longest
legitimate silence, as woodcutting does for its repeated chop timeouts.

### Memory, streaks and counters

- **Typed `memory`**: declare an interface and a factory (`memory: (): M => ({ ... })`) and use
  `type Ctx = TaskContext<Params, M>`. `ctx.memory` is then typed; no casts of it, and no untyped
  default in a new task.
- **`ctx.streak(name)`** for "N in a row" counts: `add()` returns the new count, `reset()` on
  success, `{ fail }` past a limit with the last failure's message. The engine resets a step's
  streaks whenever that step's `when` is false, so a streak ends when the step stops applying.
- **`ctx.counter(name)`** only for run-scoped totals. Never reset a counter inside `when`.
- **`when` is pure**: it reads `ctx` and returns a boolean. No `add()`/`reset()`, no writes to
  `ctx.memory`, no logging; the engine calls every step's `when` every loop.
- Order the steps so urgent states (full inventory, out of area) come before the grinding step;
  only the last `when` is `() => true`.

### Calling an action that has no op yet

`yield* call('bot.openBank', () => ctx.bot.openBank())` runs a legacy action under the step's
bounds; the guards wait for it to settle. It is a stopgap, for an action you are not porting now.
`returnToAreaStep` and `walkToArea` in `lib/area.ts` are still legacy and work inside a new task.

`yield* log(msg)` records an event a runner will want (a failure with its message, a decision),
not one per loop.

## Tests (required in scope of the legacy scope rule)

The scope rule is in `.claude/review-lenses/common.md`: the unit tests below are for new tasks,
new steps, ports and substantial rewrites; any changed task still needs a passing integration smoke.

`bun test conductor` runs the unit tests with no server, in well under 10 seconds.

1. **Unit tests**: `conductor/test/tasks/<name>.test.ts`, using `simulate(task, { params, timeline,
   respond, scan, stops })` (`conductor/test/simulate.ts`) over worlds from `world()`
   (`conductor/test/world.ts`; `world('lumbridge')` loads a captured fixture, bare `world()` is a
   bot at Lumbridge). Builders are immutable: `.inv()`, `.loc()`, `.npc()`, `.ground()`,
   `.skill()`, `.player({ hp, inCombat, at })`, `.dialog()`, `.modal(id)`, `.message()`,
   `.recentDialog()`, `.equipment()`, `.autoRetaliate()`; `.series(n, (w, i) => w...)` gives one
   state per tick. The timeline is what the world does by itself; `react` is what the bot's sends do
   to it (default `consume`: food eaten and items dropped leave the inventory the next tick).
   `simulate` returns `result`, `sends`, `steps`, `events`, `commands`, `driver`. Cover:
   - the success path (the right sends in order, `result.reason`, deltas);
   - each failure reason the task can return, asserting the exact `result.reason`;
   - each streak or limit (the Nth failure fails; a success in between resets it);
   - each `preflight` refusal;
   - guard interplay: low HP mid-step (eat, then the step resumes), a dialog or modal mid-wait,
     being attacked (task guards), for every guard that matters to the task;
   - every `when` branch (full inventory, out of area, nothing to do).
2. **Integration smoke**: `conductor/test/integration/smoke/<name>.itest.ts`, one short real run
   through `runTask` and `withFixtureBot` (see `woodcutting.itest.ts`), asserting the RESULT status
   and the XP or items gained. `bun run test:integration <filter>` runs them against the shared
   stack (engine :8888, gateway :7780); run the ones you touched, and the whole suite once if you
   changed the engine, a guard or an op.
3. **Fixtures**: for a spot with no fixture, capture one from a throwaway fixture bot (never a real
   account) with `bun conductor/tools/capture-state.ts <bot> --name <fixture>`; it connects in
   observe mode.

Pitfalls earlier authors hit:

- The engine refuses to start a run in combat, so a combat timeline must start out of it
  (`attackedFrom` in the woodcutting tests begins at tick 3).
- Each simulate fake (eat, dismiss, drop) takes one tick and does not change the world: put the
  resulting HP, item or inventory change in the timeline yourself.
- Guard logs reach `r.events`, not `driver.commands`; filter `guard ...` messages out when
  asserting what the task logged.
- `series(n, (w, i) => ...)` starts at tick 0, so `i` is the tick.
- The last state of a timeline repeats with the tick advancing: end it in the state a waiting step
  should see.
- Integration tests run in parallel against one engine: choose ground disjoint from every other
  itest (grep their coordinates), use trees or rocks nobody else touches, and wait for respawns
  rather than assuming the target stands.

## Smoke test

`bun conductor/run-task.ts <bot> <name> --params '<json>' --until minutes:1`. Iterate until the
RESULT is `done` and `stepRuns` look like the task you meant. On failure, Read the screenshots
and the `logFile`, and use `bun sdk/cli.ts <bot>` / `bun conductor/tools/screenshot.ts <bot>`.
Finish with `bun test conductor` and `bun run verify:conductor` (oxfmt check, oxlint with
warnings denied, tsc) and fix everything it reports under `conductor/` (`bun run fmt` formats in
place). Commits run the same format and lint checks on staged files and are refused until they
pass.

## Report

```
Files: <paths changed or created>
What changed: <3-6 lines>
Tests: <unit test files and what they cover; integration smoke run, if any>
Smoke tests: <each RESULT line, verbatim, newest last>
Open questions: <anything the conductor should decide, or "none">
```
