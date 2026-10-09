# Conductor

An Opus conductor session works a bot toward a maxed account over many runs. It picks
objectives and methods; subagents run tasks, write and review them, and keep the knowledge base
current; the tasks themselves are deterministic programs that grind without an LLM in the loop.

```
conductor (Claude Code session, .claude/skills/conductor)
 ├─ task-runner          runs one task, diagnoses failures (world vs script)
 ├─ knowledge-curator    after every run: folds what it taught into learnings/ + wiki/
 ├─ task-author          writes/fixes tasks, smoke-tests them
 │    └─ task-review     5 lens reviewers + verifier -> fix -> commit or revert
 └─ retrospective        every 10 runs: outcomes + agent transcripts -> roadmap, proposals
       │
       ▼
 bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>   →  RESULT <json>
       │
       ▼
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
(`<bot> already has N controller(s) attached`); `--takeover` pre-empts the other controller.

## How it learns

| Loop | Where it lives |
|---|---|
| Game knowledge: spots, requirements, hazards, gear, SDK gotchas | `learnings/`, `wiki/skills/`, `wiki/quests/` (rules: `.claude/skills/knowledge`) |
| Which method is best | `bun conductor/tools/stats.ts <bot>` over every run; explore/exploit in the conductor loop |
| How far from max, how fast | `bun conductor/tools/progress.ts <bot>` |
| Journal a dispatch with a real UTC stamp | `bun conductor/tools/journal.ts <kind> <objective> --verdict ... [--result ...]` (see `--help`) |
| What to do next | `conductor/roadmap.md` (Now, Unlocks, Backlog, Experiments, Review follow-ups) |
| Code quality | `.claude/skills/task-review` with lenses in `.claude/review-lenses/` |
| How the agents themselves work | the retrospective reads transcripts via `.claude/skills/session-forensics` |
| Undo a bad experiment | `bun conductor/tools/save.ts snapshot\|restore <bot> <label> --logout` |
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
(all gitignored). Worktrees share that server; `save.ts` finds the saves through
`RS_ENGINE_DIR=<main checkout>/server/engine`.

On NixOS, `conductor/local/migrate-sqlite.ts` stands in for `bun run sqlite:migrate` (Prisma has
no engines for NixOS); `up.sh` runs it.

## Tasks

```bash
bun conductor/run-task.ts --list
bun conductor/run-task.ts conductor1 woodcutting --params '{"area":{"x":3195,"z":3220}}' --until minutes:1
```

Run artifacts (NDJSON logs, screenshots, progress snapshots, save snapshots) land in
`conductor/runs/<bot>/` (gitignored). Conductor run state lives in `.durable-state/`
(gitignored, see `.claude/skills/durable-state`).
