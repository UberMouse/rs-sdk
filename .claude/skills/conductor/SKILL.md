---
name: conductor
description: Run this session as the conductor for an rs-sdk bot working toward a maxed account - choose objectives and methods, dispatch task-runner / task-author / knowledge-curator / retrospective subagents, gate script changes through task-review, keep the knowledge base, stats, roadmap and durable state current. Use when the user says "conduct", "run the conductor", "play <bot> towards <goal>", or resumes a conductor run.
---

# Conductor

You are the conductor for one bot, working toward a maxed account over many runs. You
**decide and review**; subagents **do**. Bot programs are deterministic catalog tasks under
`conductor/tasks/` that grind without an LLM in the loop; your tokens go on choosing what to
run next, judging what came back, and making sure every run leaves the system smarter: better
knowledge, better tasks, better stats.

This skill keeps durable state. **Before the first write, Read
`.claude/skills/durable-state/SKILL.md`** — this file only adds the conductor's fields.

## Pieces

| Piece | What it is |
|---|---|
| `bun conductor/run-task.ts --list` | the catalog: each task's name, description and JSON-schema params |
| `bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>... [--takeover]` | runs one task; refuses to start when the bot is in combat or already has a controller attached (the gateway enforces this for every script; `--takeover` pre-empts it); last stdout line is `RESULT <json>` (status `done`/`failed`/`stuck`/`error`, reason, xpGained, levelsGained, inventoryDelta, stepRuns, screenshots, logFile) |
| `--until` | `level:<skill>:<n>`, `xp:<skill>:<n>`, `minutes:<n>`; any one ends the run |
| `bun conductor/tools/stats.ts <bot> [--task t]` | per task + params variant: runs, outcomes, XP/hr, top failure reasons |
| `bun conductor/tools/progress.ts <bot>` | levels, XP to 99, % to max, change since first/previous snapshot (records a snapshot) |
| `bun conductor/tools/save.ts snapshot <bot> <label> [--logout]` | snapshot the save as it is now, without a logout (`--logout` also logs the bot out). `restore <bot> <label>` rolls back to that snapshot (the newest one needs no flag; skipping past a newer snapshot, or restoring `lib:<name>` or a file, needs `--force`): logs the bot out itself and keeps the replaced save; restart its client after. Logging out is refused while a task or script drives the bot (`--takeover` only if that run is yours). `list <bot>` |
| `bun conductor/tools/load.ts <worker> <save> --client` | `<save>` is `lib:<name>`, `bot:<bot>` (a live copy) or a `.sav` path. Loads it into a worker account and starts its headless lite client (no screenshots); prints `LOADED <json>`, whose `replay` path reloads exactly that state |
| `bun conductor/tools/library.ts list\|show\|generate` | the scenario save library in `conductor/saves/`; `save.ts snapshot <bot> <name> --library --purpose "..."` adds a live bot's state |
| `bun sdk/cli.ts <bot>` | full world-state snapshot (position, inventory, skills, nearby) |
| `bun conductor/tools/screenshot.ts <bot>` | PNG of the game canvas, path on stdout — Read it. Needs the browser client |
| `conductor/local/up.sh` | starts the local stack (idempotent) |
| `bun conductor/tools/client.ts <bot> [--headless]` | the rendering bot client; windowed lets the user watch |
| `conductor/roadmap.md` | the long-range plan: Now, Unlocks, Backlog, Experiments, Review follow-ups |
| `learnings/`, `wiki/skills/`, `wiki/quests/` | the knowledge base; `.claude/skills/knowledge/SKILL.md` says what goes where |
| `wiki/items/`, `wiki/npcs/`, `wiki/shops/` | generated game data: read-only reference |
| `bots/<bot>/lab_log.md` | facts about this **account** (bank contents, quest progress, gear owned), not the game |

Agents (all dispatched in the background):

| Agent | Does | Never |
|---|---|---|
| `task-runner` | runs one task, diagnoses a failure (world vs script) | edits anything |
| `task-author` | writes or fixes a task, smoke-tests it | commits |
| `task-reviewer` ×5 + `review-verifier` | the `task-review` skill's lens review of a change | edits anything |
| `knowledge-curator` | folds a run's lessons into the knowledge base | drives the bot, commits |
| `retrospective` | looks across many runs, updates the roadmap | drives the bot, commits |

## Durable state (owner fields)

`skill: "conductor"`. Phases: `setup` (stack/client/bot not yet verified) → `run` → `done`.

| Field | Meaning |
|---|---|
| `bot` | the bot's name. Set once |
| `client` | `"windowed"` / `"headless"` / `"lite"`: how the game client is being run |
| `baseline` | set once at run start: `{ at, totalLevel }` from `progress.ts` |
| `journal` | **absolute** path to `.durable-state/journal.jsonl`. One line per finished dispatch: `{at, kind: "run"\|"author"\|"review"\|"curate"\|"retro", objective, command?, result?, verdict, commit?}` |
| `tasks` | the objective queue (generic `tasks` field). Each: `{id, title, status, task?, params?, until?, attempts}`; `title` is the objective in game terms ("Woodcutting 30 for willows") |
| `runsSinceRetro` | task runs since the last retrospective |
| `lastRetroAt` | ISO timestamp of the last retrospective (the run start, before the first) |
| `openGate` | `{kind: "script-approval", doc: <abs path of the changed task file>, taskId, worker, replay}` from a task-author's return until `task-review` commits or reverts; `worker` and `replay` (the replay path of the load the author's final smoke test ran from) are what its fix authors test on |
| `workers` | the worker pool: `{ <worker>: <task id or agent it is assigned to> \| null }`. Assign a free worker in each task-author brief. It stays assigned through that change's `task-review` (its fix authors reuse it) and is set back to `null` when the review commits or reverts. A second fix agent running in parallel gets another free worker, recorded here too |

Seed `invariants` with the list below on the first write.

## Invariants

- The main bot is driven only by task-runner dispatches (and `save.ts`); only those runs count
  as progress. Task-authors and review fix authors smoke-test on a **worker account** loaded
  from a library save (`load.ts`), never on the main bot. Work on a worker is thrown away, never
  copied back. See `conductor/docs/parallel-bots.md`.
- One controller per bot, enforced by the gateway: a second control connection is refused, so
  an agent that finds its bot busy waits or reports back; it never passes `--takeover` unless its
  brief says so. Concurrent bot claimants are capped at the worker pool size plus the one runner;
  queue authors when no worker is free.
- Curator, reviewers and retrospective don't drive a bot and may run alongside.
- Workers share one world with the main bot: don't send a worker to the spot the runner is
  using, and workers never trade with other accounts.
- The conductor never plays the game, writes task code or edits knowledge pages itself: it
  decides, dispatches, reviews diffs and commits. (Its own edits are limited to the roadmap's
  Now, state, and small agent-prompt fixes a retrospective evidenced.)
- Every task-author change goes through the `task-review` skill before it is committed.
- Every task run is followed by a `knowledge-curator` dispatch.
- New or changed tasks get short runs first (`--until minutes:1`); extend only after a clean
  `done`.
- Snapshot the save (`save.ts snapshot <bot> <label>`; no logout needed) before a run that
  risks death or items: a new area, combat, an untested task, anything `learnings/hazards.md`
  flags.

## Loop

1. **Observe**: `bun sdk/cli.ts <bot>`, the last journal lines, the objective queue, and
   `conductor/roadmap.md` §Now.
2. **Decide** the objective (from the queue; refill it from roadmap §Now and §Backlog), then the
   method:
   - Candidates: catalog tasks that serve it, with spots/targets from `wiki/skills/<skill>.md`
     §Verified training spots and `learnings/`.
   - **Exploit** the variant with the best XP/hr in `stats.ts` that is safe for the bot's level.
   - **Explore** about one run in five: an untried variant from roadmap §Experiments or a spot
     the knowledge base lists without stats — short runs (`minutes:2`), then compare in stats.
   - Nothing in the catalog fits → dispatch `task-author` (new task), add it to the roadmap
     backlog as `authoring`.
3. **Risk check**: the spot against `learnings/hazards.md` and the bot's combat level and HP.
   Risky → snapshot first (Invariants).
4. **Dispatch** a `task-runner` with the exact command; add it to `inFlight`, mark the
   objective `in-progress`, rewrite state.
5. **On the runner's report**:
   1. Journal it; drop the `inFlight` entry; `runsSinceRetro += 1`.
   2. Dispatch `knowledge-curator` with the RESULT and the runner's report (template below).
      It runs alongside whatever you dispatch next.
   3. `bun conductor/tools/progress.ts <bot>`.
   4. Judge the result (below) and go to 1.
6. **On the curator's report**: `git diff -- learnings wiki` — check the edits follow the
   knowledge skill's rules (current truth, provenance tags, no narration, nothing in generated
   wiki dirs). Commit: `knowledge: <what was learned>`. Revert any edit that breaks the rules.
7. **On a task-author's report**: set `openGate` (with the author's worker and the `replay` path
   its report names as the one its final smoke test ran from), then run the `task-review` skill (`.claude/skills/task-review/SKILL.md`),
   handing it that worker and replay, plus a second free worker if parallel fixes should be
   possible. It ends in a commit or a revert; clear the gate.
8. **Retrospective** when `runsSinceRetro >= 10`, or an objective has failed 3 times: dispatch
   `retrospective`. It reads the game outcomes and the agents' transcripts
   (`.claude/skills/session-forensics`). On its report: review the roadmap diff and commit
   `roadmap: <summary>`; act on its proposals — queue objectives, dispatch authors or the
   curator, and make agent-prompt or tool fixes it names with transcript evidence (small,
   reviewed, committed as `agents: <what and why>`). Reset `runsSinceRetro`, set `lastRetroAt`.

### Judging a result

- `done` — check it moved the objective (levels, xp, items). Next chunk or next objective.
- `failed` with a world reason (no axe, level too low, can't reach) — queue the prerequisite as
  its own objective ahead of this one (buy, bank, walk, quest), or reorder.
- `failed` / `stuck` / `error` that is the script's fault — dispatch `task-author` with the
  RESULT, the runner's diagnosis and the screenshot paths.
- Unsafe end state (RESULT `inCombat` true, or `hp` below half) — handle it before anything
  else and never leave the bot idle there. The catalog has no combat or retreat task yet: queue
  a retreat/eat objective (a task-author dispatch for one if none exists), or when nothing is
  running, log it out with `save.ts snapshot <bot> unsafe-exit --logout` so it cannot die unattended
  (the snapshot is written either way). Combat delays a logout: on exit 1 "still in the world",
  rerun it up to twice more; a bot still in the world after that is under sustained attack, so
  stop and tell the user. A logged-out bot has no client any more, and restarting the client logs
  it in at the same spot: the first dispatch after that is the retreat/eat objective, not the
  run that got it there. Low HP
  with no food, out of combat, already waits for regeneration (bounded) rather than failing, so
  a `failed` low-HP reason means the wait ran out or the bot is under attack.
- Death or item loss in an experiment — `save.ts restore <bot> <label>` with the snapshot taken
  before it (it logs the bot out itself; `--force` only if newer snapshots exist and you mean to
  skip them), restart the client, add the hazard to the curator's next dispatch.
- The same objective failing 3 times — retrospective (step 8); if it still has no way forward,
  mark it `blocked-needs-human` and tell the user.

## Dispatch templates

**task-runner**
```
Bot: <bot>. Objective: <title>.
Run: bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>
Report per your instructions: RESULT verbatim, cause, diagnosis, suggested next step, game knowledge.
```

**task-author**
```
Bot for smoke tests: worker <worker>, yours alone until you finish. Load your starting state with
`bun conductor/tools/load.ts <worker> <save> --client` (reload it to retest from the same
state). Starting save: <lib:<name> | bot:<main bot> for the account as it is now | none: first
create lib:<name> = <the state: levels, items, position>>.
Never drive <main bot>.
Goal: <new task "<name>" that ... | fix task "<name>": <what went wrong>>.
Evidence: <RESULT json, runner diagnosis, screenshot paths>.
Knowledge to use: <the learnings/wiki pages and spots that apply>.
Leave the change uncommitted; report files changed and your smoke-test RESULT lines.
```

**knowledge-curator**
```
Bot: <bot>. Server: local.
Run: <RESULT json>
Runner report: <cause, diagnosis, game knowledge lines>
<Author or review notes, if this run tested a change.>
```

**retrospective**
```
Bot: <bot>. Journal: <abs path>, entries since <lastRetroAt>.
Transcript window: since <lastRetroAt date> (session-forensics corpus --since).
Objectives that failed 3 times: <list or none>.
```

## Workers

Set up once per run, in `setup`: a pool of worker accounts (start with 3; each needs its own
lite client, so measure before adding more), created on first load with
`bun conductor/tools/load.ts <bot>w<n> lib:fresh-lumbridge --create` (the name must be 12
characters or fewer; `--create` marks the account `WORKER=true`, the only kind `load.ts` will
overwrite, and refuses a name the server already has an account for). Record them in `workers`.
`bots/<name>/bot.env` exists only in the checkout that created it, so a later run in another
checkout finds the accounts on the server but no `bot.env`: write one by hand rather than
`--create` (the local login accepts any password), e.g. `bots/<bot>w1/bot.env` with
`BOT_USERNAME=<bot>w1`, `PASSWORD=<any>`, `SERVER=localhost:8888`, `GATEWAY_URL=ws://localhost:7780`,
`WORKER=true`.
A brief needs a starting state the library lacks → name it in the brief (`none: first create
...`); the author builds it per `task-author.md` and lists the new `conductor/saves/` files in its
report, and they are reviewed and committed with the task.

## Pausing and stopping

1. `ListAgents`, and stop **every** subagent, not only the ones in `inFlight`: a review
   orchestrator's fix author is not in `inFlight` and keeps driving its bot when its parent
   stops.
2. Find this run's leftover tasks, and only those:
   `pgrep -af "^[^ ]*bun (run )?[^ ]*run-task\.ts (<bot>|<worker1>|<worker2>|<worker3>) "` with the main bot
   and the `workers` names. The `^...bun` anchor matches the bun process itself, not the shell that
   launched it (whose command line also contains the command). A match is an orphan still driving
   one of your bots: `kill <pid>` (it prints its RESULT on SIGTERM) and journal it. Other sessions share this
   machine and server: never kill a `run-task.ts` on a bot that isn't yours.
3. `save.ts snapshot <bot> <label> --logout` for the main bot.
4. Worker lite clients keep running detached and their accounts stay logged in; workers hold
   nothing worth saving. To stop one: `pkill -f "lite/runner.ts <worker>$"` (the `$` keeps
   `<bot>w1` from also matching `<bot>w10`).

## Resuming

1. Read `.claude/skills/durable-state/SKILL.md` §Resuming and follow it.
2. Read this file in full, then `state.json`, the last 20 lines of `journal`, and
   `conductor/roadmap.md`.
3. Make sure the stack is up (`conductor/local/up.sh`) and a client is attached
   (`bun sdk/cli.ts <bot>` shows a fresh tick); start the client per `client` if not. `up.sh`
   leaves an engine or gateway that is already up alone, so check both run this code: the
   gateway's `curl -s localhost:7780/status` must show `"controllerLease": true` (an older gateway
   lets any connect pre-empt a running task), and `bun conductor/tools/save.ts snapshot <bot>
   resume` must read the save through the engine (and is a useful snapshot). If either fails,
   stop and tell the user: the stack is shared with other sessions, so its restart is
   coordinated, never done by one run.
4. A run whose state predates this file's current rules: when `invariants` differ from the list
   above, rewrite them from it (the hook prints the stored ones on every resume); when `workers`
   is missing or null, set up the pool per §Workers and record it before the next author brief.
5. Per `inFlight`: a runner or author that died across the boundary may have left the bot
   mid-action — check state before re-dispatching. With `openGate` set, run `task-review` on the
   uncommitted change, with its `worker` and `replay` (an older gate without them: the worker
   assigned in `workers`, and the replay from the author's report in the journal;
   `conductor/runs/<worker>/loaded.json` is only the worker's latest load, which may be a branch
   test). Uncommitted `learnings/`/`wiki/` or roadmap edits from a dead curator or retrospective:
   review and commit or revert them.
6. Continue the loop.
