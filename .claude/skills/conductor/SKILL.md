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
| `bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>... [--takeover]` | runs one task; refuses to start when the bot is in combat or already has N controller(s) attached (`--takeover` pre-empts them); last stdout line is `RESULT <json>` (status `done`/`failed`/`stuck`/`error`, reason, xpGained, levelsGained, inventoryDelta, stepRuns, screenshots, logFile) |
| `--until` | `level:<skill>:<n>`, `xp:<skill>:<n>`, `minutes:<n>`; any one ends the run |
| `bun conductor/tools/stats.ts <bot> [--task t]` | per task + params variant: runs, outcomes, XP/hr, top failure reasons |
| `bun conductor/tools/progress.ts <bot>` | levels, XP to 99, % to max, change since first/previous snapshot (records a snapshot) |
| `bun conductor/tools/save.ts snapshot\|restore\|list <bot> <label> --logout` | roll the account back after a bad experiment. Logs the bot out; restart its client after |
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
| `openGate` | `{kind: "script-approval", doc: <abs path of the changed task file>, taskId}` from a task-author's return until `task-review` commits or reverts |

Seed `invariants` with the list below on the first write.

## Invariants

- One controller per bot: a task-runner, a task-author's smoke test and `save.ts --logout` each
  drive the bot, so at most one of them runs at a time. Curator, reviewers and retrospective
  don't drive it and may run alongside.
- The conductor never plays the game, writes task code or edits knowledge pages itself: it
  decides, dispatches, reviews diffs and commits. (Its own edits are limited to the roadmap's
  Now, state, and small agent-prompt fixes a retrospective evidenced.)
- Every task-author change goes through the `task-review` skill before it is committed.
- Every task run is followed by a `knowledge-curator` dispatch.
- New or changed tasks get short runs first (`--until minutes:1`); extend only after a clean
  `done`.
- Snapshot the save (`save.ts snapshot ... --logout`) before a run that risks death or items:
  a new area, combat, an untested task, anything `learnings/hazards.md` flags.

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
7. **On a task-author's report**: set `openGate`, then run the `task-review` skill
   (`.claude/skills/task-review/SKILL.md`). It ends in a commit or a revert; clear the gate.
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
  running, log it out with `save.ts snapshot <bot> unsafe-exit --logout` (a snapshot is the only command that logs out) so it cannot die unattended. Low HP
  with no food, out of combat, already waits for regeneration (bounded) rather than failing, so
  a `failed` low-HP reason means the wait ran out or the bot is under attack.
- Death or item loss in an experiment — `save.ts restore <bot> <label> --logout`, restart the
  client, add the hazard to the curator's next dispatch.
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
Bot for smoke tests: <bot> (no other agent is driving it until you finish).
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

## Resuming

1. Read `.claude/skills/durable-state/SKILL.md` §Resuming and follow it.
2. Read this file in full, then `state.json`, the last 20 lines of `journal`, and
   `conductor/roadmap.md`.
3. Make sure the stack is up (`conductor/local/up.sh`) and a client is attached
   (`bun sdk/cli.ts <bot>` shows a fresh tick); start the client per `client` if not.
4. Per `inFlight`: a runner or author that died across the boundary may have left the bot
   mid-action — check state before re-dispatching. With `openGate` set, run `task-review` on the
   uncommitted change. Uncommitted `learnings/`/`wiki/` or roadmap edits from a dead curator or
   retrospective: review and commit or revert them.
5. Continue the loop.
