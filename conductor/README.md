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
 conductor/tasks/*.ts   defineTask({ params, preflight, steps: [{ name, when, run }] })
 conductor/lib/engine   first valid step runs · interrupts · stop conditions · watchdog · screenshots
```

The task loop is UberUtils/ArteDungeon's Strategy pattern: each loop the first step whose
`when()` passes runs; shared interrupts (death, wilderness, low HP, dialogs) go first; a watchdog ends runs
whose XP, position and inventory stop changing.

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
bun conductor/tools/load.ts conductor1w1 wc-lumbridge-1 --client --create  # load one into a worker, log it in
bun conductor/tools/load.ts conductor1w1 bot:conductor1 --client     # or a live copy of the main bot
bun conductor/tools/save.ts snapshot conductor1w1 my-scenario --library --purpose "..."  # file a new scenario
bun conductor/tools/library.ts generate <name> --preset <NAME> --purpose "..."          # or build one from a spec
```

Saves come from the engine's management port (`:8898`, dev only): `GET /save/<name>` exports an
online player's save without logging it out; `POST /kick/<name>` logs it out server-side.

## How it learns

| Loop | Where it lives |
|---|---|
| Game knowledge: spots, requirements, hazards, gear, SDK gotchas | `learnings/`, `wiki/skills/`, `wiki/quests/` (rules: `.claude/skills/knowledge`) |
| Which method is best | `bun conductor/tools/stats.ts <bot>` over every run; explore/exploit in the conductor loop |
| How far from max, how fast | `bun conductor/tools/progress.ts <bot>` |
| What to do next | `conductor/roadmap.md` (Now, Unlocks, Backlog, Experiments, Review follow-ups) |
| Code quality | `.claude/skills/task-review` with lenses in `.claude/review-lenses/` |
| How the agents themselves work | the retrospective reads transcripts via `.claude/skills/session-forensics` |
| Undo a bad experiment | `bun conductor/tools/save.ts snapshot\|restore <bot> <label>` |

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
(all gitignored). Worktrees share that server; `save.ts` and `load.ts` find the saves through
`RS_ENGINE_DIR=<main checkout>/server/engine` (and a stack on other ports through
`RS_ENGINE_ORIGIN` / `RS_MANAGEMENT_ORIGIN`).

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

Run artifacts (NDJSON logs, screenshots, progress snapshots, save snapshots) land in
`conductor/runs/<bot>/` (gitignored). Conductor run state lives in `.durable-state/`
(gitignored, see `.claude/skills/durable-state`).
