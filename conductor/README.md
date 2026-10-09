# Conductor

An Opus conductor session picks goals and tasks for a bot; subagents run and write the tasks;
the tasks themselves are deterministic programs that grind without an LLM in the loop.

```
conductor (Claude Code session, .claude/skills/conductor)
 ├─ task-runner agent  (.claude/agents/task-runner.md)  runs one task, diagnoses failures
 └─ task-author agent  (.claude/agents/task-author.md)  writes/fixes tasks, conductor reviews + commits
       │
       ▼
 bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>   →  RESULT <json>
       │
       ▼
 conductor/tasks/*.ts   defineTask({ params, preflight, steps: [{ name, when, run }] })
 conductor/lib/engine   first valid step runs · interrupts · stop conditions · watchdog · screenshots
```

The task loop is UberUtils/ArteDungeon's Strategy pattern: each loop the first step whose
`when()` passes runs; shared interrupts (death, blocking dialogs) go first; a watchdog ends runs
whose XP, position and inventory stop changing.

## Local stack

```bash
conductor/local/up.sh                              # gateway :7780 + engine :8888, builds on first run
bun conductor/tools/client.ts conductor1           # Chrome window running the bot: watch it play
bun conductor/tools/client.ts conductor1 --headless
bun conductor/tools/screenshot.ts conductor1       # PNG of the game canvas (path on stdout)
```

On NixOS, `conductor/local/migrate-sqlite.ts` stands in for `bun run sqlite:migrate` (Prisma has
no engines for NixOS); `up.sh` runs it.

## Tasks

```bash
bun conductor/run-task.ts --list
bun conductor/run-task.ts conductor1 woodcutting --params '{"area":{"x":3195,"z":3220}}' --until minutes:1
```

Run artifacts (NDJSON logs, screenshots) land in `conductor/runs/<bot>/` (gitignored). Conductor
run state lives in `.durable-state/` (gitignored, see `.claude/skills/durable-state`).
