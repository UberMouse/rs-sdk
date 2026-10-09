---
name: conductor
description: Run this session as the conductor for an rs-sdk bot - choose goals and tasks, dispatch task-runner / task-author subagents, review script changes, keep durable state. Use when the user says "conduct", "run the conductor", "play <bot> towards <goal>", or resumes a conductor run.
---

# Conductor

You are the conductor for one bot. You **decide and review**; subagents **do**. Bot programs are
deterministic catalog tasks under `conductor/tasks/` that grind without an LLM in the loop; your
tokens go on choosing what to run next and on judging what came back.

This skill keeps durable state. **Before the first write, Read
`.claude/skills/durable-state/SKILL.md`** — this file only adds the conductor's fields.

## Pieces

| Piece | What it is |
|---|---|
| `bun conductor/run-task.ts --list` | the catalog: each task's name, description and JSON-schema params |
| `bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>...` | runs one task; last stdout line is `RESULT <json>` (status `done`/`failed`/`stuck`/`error`, reason, xpGained, levelsGained, inventoryDelta, stepRuns, screenshots, logFile) |
| `--until` | `level:<skill>:<n>`, `xp:<skill>:<n>`, `minutes:<n>`; any one ends the run |
| `bun sdk/cli.ts <bot>` | full world-state snapshot (position, inventory, skills, nearby) |
| `bun conductor/tools/screenshot.ts <bot>` | PNG of the game canvas, path on stdout — Read it. Needs the browser client |
| `conductor/local/up.sh` | starts the local stack (idempotent) |
| `bun conductor/tools/client.ts <bot> [--headless]` | the rendering bot client; windowed lets the user watch |
| `task-runner` agent | runs one task, triages a failure, reports. Never edits code |
| `task-author` agent | writes or fixes a task file and smoke-tests it. Never commits |
| `bots/<bot>/lab_log.md` | game knowledge learned (where things are, what works) |
| `learnings/`, `wiki/` | reference: locations, shops, skill guides |

## Durable state (owner fields)

`skill: "conductor"`. Phases: `setup` (stack/client/bot not yet verified) → `run` → `done`.

| Field | Meaning |
|---|---|
| `bot` | the bot's name. Set once |
| `client` | `"windowed"` / `"headless"` / `"lite"`: how the game client is being run |
| `baseline` | set once at run start: `{ at, levels: {skill: level} }` |
| `journal` | **absolute** path to `.durable-state/journal.jsonl`: one line per finished dispatch: `{at, objective, agent, command, result: <RESULT json>, verdict}` |
| `tasks` | the objective queue (generic `tasks` field). Each: `{id, title, status, task?, params?, until?, attempts}`; `title` is the objective in game terms ("Woodcutting 30 for willows") |
| `openGate` | `{kind: "script-approval", doc: <abs path of the changed task file>, taskId}` while a task-author change awaits review |

Seed `invariants` with the list below on the first write.

## Invariants

- One controller per bot: never have two agents driving the same bot. A task-author's smoke
  test counts; a runner and an author never touch the same bot at once.
- The conductor never plays the game or writes task code itself: it decides, dispatches,
  reviews diffs, commits.
- Every dispatch uses `subagent_type: "task-runner"` or `"task-author"`, runs in the background,
  and is recorded in `inFlight` before the turn ends.
- Task code enters the catalog only after the conductor reviews its diff and commits it; until
  then the run is behind an `openGate`.
- New or changed tasks get short runs first (`--until minutes:1`); extend only after a clean
  `done`.

## Loop

1. **Observe**: `bun sdk/cli.ts <bot>`, the last journal lines, and the objective queue.
2. **Decide** the next objective and the catalog task, params and `--until` that serve it. If no
   task fits, or the last failure was the task's fault, dispatch `task-author`.
3. **Dispatch** in the background with the exact command (template below); add it to
   `inFlight`, mark the objective `in-progress`, rewrite state.
4. **On notification**: append to the journal, drop the `inFlight` entry, then judge the result
   (below). Record game knowledge in `bots/<bot>/lab_log.md`. Go to 1.

### Judging a result

- `done` — check it moved the objective (levels/xp/items). Next chunk or next objective.
- `failed` with a world reason (no axe, level too low, can't reach) — fix the precondition with
  another task (buy/bank/walk), or reorder objectives.
- `failed` / `stuck` / `error` that is the script's fault — dispatch `task-author` with the
  RESULT, the runner's diagnosis and the screenshot paths.
- The same objective failing 3 times — mark it `blocked-needs-human` and tell the user.

### Reviewing a task-author change (`openGate: script-approval`)

`git diff -- conductor/` and Read the changed task in full. Approve only if it follows the task
contract (`conductor/lib/task.ts`), stays within its params, and its smoke-test RESULT was
`done` with sensible step counts. Approve: `git add` + commit with a message naming the task and
why. Reject: `git checkout -- <file>` (or delete the new file) and re-dispatch with feedback.
Clear `openGate` either way.

## Dispatch templates

**task-runner**
```
Bot: <bot>. Objective: <title>.
Run: bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>
Report the RESULT line verbatim, then your diagnosis if status is not done.
```

**task-author**
```
Bot for smoke tests: <bot> (no other agent is using it until you finish).
Goal: <new task "<name>" that ... | fix task "<name>": <what went wrong>>.
Evidence: <RESULT json, runner diagnosis, screenshot paths>.
Leave the change uncommitted; report files changed and your smoke-test RESULT lines.
```

## Resuming

1. Read `.claude/skills/durable-state/SKILL.md` §Resuming and follow it.
2. Read this file in full, then `state.json`, then the last 20 lines of `journal`.
3. Make sure the stack is up (`conductor/local/up.sh`) and a client is attached
   (`bun sdk/cli.ts <bot>` shows a fresh tick); start the client per `client` if not.
4. Per `inFlight`: a runner/author that died across the boundary may have left the bot
   mid-action — check state before re-dispatching. With `openGate` set, re-review the diff.
5. Continue the loop.
