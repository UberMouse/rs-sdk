# Conductor

An Opus conductor session works a bot toward a maxed account over many runs. It picks
objectives and methods; subagents run tasks, write and review them, and keep the knowledge base
current; the tasks themselves are deterministic programs that grind without an LLM in the loop.

```
conductor (Claude Code session, .claude/skills/conductor)
 ├─ task-runner          owns a goal: writes and runs plans, debugs them (world vs script)
 ├─ knowledge-curator    once per runner report: folds what it taught into learnings/ + wiki/
 ├─ task-author          writes/fixes tasks, smoke-tests them
 │    └─ task-review     5 lens reviewers + verifier -> fix -> commit or revert
 └─ retrospective        every 10 runs: outcomes + agent transcripts -> roadmap, proposals
       │
       ▼
 bun conductor/run-task.ts <bot> --plan <file> --until <stop>              →  RESULT <json>
 bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>   →  RESULT <json>
       │
       ▼
 conductor/plans/*.ts   definePlan({ name, requires?, phases: [phase(task, params, { when, until, onFail })] })
 conductor/tasks/*.ts   defineTask({ params, memory, guards, preflight, steps: [{ name, when, *run }] })
 conductor/lib/engine   first valid step runs · guards · stop conditions · watchdog · screenshots
 conductor/actions      ops a step composes: chop, interactLoc, ...
 conductor/core         op commands + interpreter
```

The task loop is UberUtils/ArteDungeon's Strategy pattern: each loop the first step whose
`when()` (a pure predicate) passes runs.

### How a task runs

- A step's `run` is a generator (`*run`) that `yield*`s ops from `conductor/actions`
  (`chop`, `interactLoc`) and the commands in `conductor/core/op.ts` (`send`, `wait`, `ticks`,
  `log`, ...). It never touches the SDK itself (its context has no `bot` or `sdk`): the
  interpreter (`core/interpret.ts`) executes each command against a driver, so the same step runs
  against the live game (the `LiveDriver`) or a scripted timeline in a unit test. A step that only
  decides is a plain function returning an outcome.
- Waits are game ticks (400 ms here), not wall clock. Every wait is a point where the engine can
  act: it runs the **guards** (`lib/interrupts.ts`: death, wilderness, low HP, dialog,
  leftover-interface, plus a task's own such as `underAttackGuard`), applies `--until` stops, the
  watchdog (XP, position, inventory and HP unchanged for `stuckAfterMs`) and the step's tick
  budget, cancelling the step (its `finally` blocks run) where needed. Tasks therefore carry no
  threat, dialog or timeout handling of their own.
- A step returns nothing to loop, `{ fail }` or `{ done }`; the run ends in one `TaskResult`
  printed as the `RESULT` line.
- Every run is recorded next to its log (`conductor/runs/<bot>/<runId>.ticks.ndjson.gz`, about
  47 KiB a minute, about 2.8 MB an hour): what the code observed and every command it sent. `bun conductor/tools/replay.ts
  <file>` re-runs the current task code on it and prints the first command that differs.

`conductor/tasks/woodcutting.ts` is the reference task; the design and its rationale are in
[`docs/interruptible-tasks.md`](docs/interruptible-tasks.md), and the authoring rules in
`.claude/agents/task-author.md`.

### Tests

| Layer | Where | Run |
|---|---|---|
| Unit: ops, interpreter, engine, tasks on scripted worlds (`simulate` in `test/simulate.ts`, `world()` builders and captured fixtures in `test/world.ts`, `test/fixtures/`) | `conductor/test/` | `bun test conductor` (no server) |
| Integration: ops, one smoke run per task and the replay of a recorded run, against the real local engine, one fresh bot each | `conductor/test/integration/` | `bun run test:integration [filter]` (needs the local stack) |

A new task (or a new or rewritten step in one; contract T8 in
`.claude/review-lenses/contract.md`) has both: unit tests for its success, failure and guard
scenarios, and a smoke test. Any changed task needs its smoke test to pass. `bun conductor/tools/capture-state.ts <bot> --name <fixture>` records a fixture from a
(throwaway) bot's live state.

`run-task` refuses to start when the bot is already in combat or another controller is attached
(`<bot> already has N controller(s) attached`); `--takeover` pre-empts the other controller. The
gateway enforces the same rule for every script: a second control connection is refused unless
it asks for takeover.

## Parallel testing: worker accounts and the save library

Only task-runner dispatches drive the main bot, and only their runs count as progress. Authors
and fix authors test in parallel on **worker accounts** (`WORKER=true` in their `bot.env`),
each loaded from a save in the scenario library. Design and rationale:
`docs/parallel-bots.md`.

```bash
bun conductor/tools/library.ts list                                  # scenario saves in conductor/saves/
bun conductor/tools/load.ts conductor1w1 lib:wc-lumbridge-1 --client --create  # load one into a worker, log it in
bun conductor/tools/load.ts conductor1w1 bot:conductor1 --client     # or a live copy of the main bot
bun conductor/tools/save.ts snapshot conductor1w1 my-scenario --library --purpose "..."  # file a new scenario
bun conductor/tools/library.ts generate <name> --spec '<json>' --purpose "..."          # or build one from a spec
```

Saves go through the engine's management port (`:8898`), served only when the engine runs with
`SAVE_ENDPOINTS=true` (`up.sh` sets it): `GET /save/<name>` exports a player's current save
without logging it out and says which file the engine reads; `POST /kick/<name>` logs a player
out server-side. MCP `execute_code` keeps a bot's control lease between calls until `disconnect_bot`.

## How it learns

| Loop | Where it lives |
|---|---|
| Game knowledge: spots, requirements, hazards, gear, SDK gotchas | `learnings/`, `wiki/skills/`, `wiki/quests/` (rules: `.claude/skills/knowledge`) |
| Which method is best | `bun conductor/tools/stats.ts <bot>` over every run; `--methods` sets each curated method's plan runs beside its floor (`wiki/world/methods.ts`); explore/exploit in the conductor loop |
| How far from max, how fast | `bun conductor/tools/progress.ts <bot>` |
| Journal a dispatch with a real UTC stamp | `bun conductor/tools/journal.ts <kind> <objective> --verdict ... [--result ...]` (see `--help`) |
| What to do next | `conductor/roadmap.md` (Now, Unlocks, Backlog, Experiments, Review follow-ups) |
| Code quality | `.claude/skills/task-review` with lenses in `.claude/review-lenses/` |
| How the agents themselves work | the retrospective reads transcripts via `.claude/skills/session-forensics` |
| Undo a bad experiment | `bun conductor/tools/save.ts snapshot <bot> <label>` before it, `restore <bot> <label>` after |
| Would changed code decide differently on a past run | `bun conductor/tools/replay.ts conductor/runs/<bot>/<runId>.ticks.ndjson.gz [--task-dir <dir>]` |

## Local stack

```bash
conductor/local/up.sh                              # gateway :7780 + engine :8888, builds on first run
bun conductor/tools/client.ts conductor1           # Chrome window running the bot: watch it play
bun conductor/tools/client.ts conductor1 --headless
#   GPU is off by default (--gpu to opt in) and frames are capped (--fps=<n>, default 15/10):
#   on a VMware guest a GPU-accelerated window filled vmwgfx memory and stalled the desktop.
bun conductor/tools/screenshot.ts conductor1       # PNG of the game canvas (path on stdout)
```

Run the stack from the main checkout: its `server/engine` holds the database and player saves
(all gitignored). Worktrees share that server; `save.ts` and `load.ts` ask the engine where its
saves are, so they work from any checkout. A stack whose management port is not the engine host's
`:8898` is reached with `RS_MANAGEMENT_ORIGIN=http://host:port`.

The Grand Exchange is off locally (`GE_ENABLED=false`): while `data/market.sqlite` exists the
engine loads players from its checkpoints instead of their `.sav` files, so `up.sh` refuses to
start the engine until that file is retired.

On NixOS, `conductor/local/migrate-sqlite.ts` stands in for `bun run sqlite:migrate` (Prisma has
no engines for NixOS); `up.sh` runs it.

## Tasks

```bash
bun conductor/run-task.ts --list
bun conductor/run-task.ts conductor1 woodcutting --params '{"area":{"x":3195,"z":3220}}' --until minutes:1
```

Two flags let `run-task` do the runner's bookkeeping. `--objective <title> --journal <abs path>`
(given together, on a task or a plan run) make it append the run's mechanical journal line itself when
the run ends, whatever the status (a signal's RESULT included): kind `run`, the objective, `task`
(`plan:<name>` for a plan), `command`, `result` (`<runId> <status>: <reason>; +xp; <duration>`) and a
verdict `<status>: <reason>`; nothing for a run that never opened a log. The line is built by
`conductor/lib/journal.ts`, shared with `tools/journal.ts`. And a plain (non-plan) task run that follows
another plain run in `conductor/runs/<bot>/` that started within 30 minutes of it (a plan, or a plan's
phase runs, in between do not count; an older log does not either) carries `"hint": "2nd plain task run in a row: work that repeats belongs in a plan (--plan)"` in its
RESULT (`conductor/lib/chain-hint.ts`).

Run artifacts (NDJSON logs, screenshots, progress snapshots, save snapshots) land in
`conductor/runs/<bot>/` (gitignored). Conductor run state lives in `.durable-state/`
(gitignored, see `.claude/skills/durable-state`).

## Plans

A plan composes catalog tasks into one run that loops: chop -> burn -> chop, mine -> bank ->
smelt. It is an ordered list of phases (`conductor/lib/plan.ts`: `definePlan`, `phase`), each a
whole task run with params and pure predicates over a view of the world (`when`, `until`); every
time a phase ends, the first phase whose `when` holds runs next, so a plan resumes on any
inventory. A plan's `requires` names what it needs throughout (chop-burn: combat level 5+); one that stops holding ends it `failed`. The reference is `conductor/plans/chop-burn.ts`.

```bash
bun conductor/run-task.ts conductor1 --plan conductor/plans/chop-burn.ts --until minutes:5
```

`--until` counts from the plan's start. The RESULT is a task result with `task: "plan:<name>"`,
per-phase totals (`phases`) and the last phase runs (`recent`); the plan logs to
`conductor/runs/<bot>/<stamp>-plan-<name>.ndjson` beside a copy of its source, and each phase run
has its own log and recording, so `replay.ts` works per phase. `stats.ts` counts a plan once as
`plan:<name>` (`--phases` adds its phase runs). A plan whose whole run is one training method's
cycle names it with `method` (a `wiki/world/methods.ts` id, whose record lists the plan back), so
`stats.ts --methods` sets its runs beside the method's floor.

`bun conductor/tools/plan-view.ts` serves a page (http://127.0.0.1:7790/) that follows the plan a
bot is running (its phases and their `when` answers, a timeline of phase runs, the open run's
steps, the live bot and the plan source), or a task run on its own, and shows past runs by
conductor session. Its World panel shows the bot in a live 3D view of the game (rs-world, over the
engine's world feed, which `local/up.sh` turns on). It is read-only and observes the bot without
taking control: [`docs/plan-view.md`](docs/plan-view.md).

A task-runner owns a goal and writes the plans for it as drafts in
`conductor/runs/<bot>/plans/<name>.ts`; the conductor promotes the ones that worked into
`conductor/plans/` and commits them with the runs' results. Plans import only
`@conductor/lib/plan` and `@conductor/tasks/<task>`, so promotion is a move. Design and
rationale: [`docs/plans.md`](docs/plans.md); the plan smoke test is
`bun run test:integration plan`.
