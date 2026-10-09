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
