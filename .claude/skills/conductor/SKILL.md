---
name: conductor
description: Run this session as the conductor for an rs-sdk bot working toward a maxed account - choose objectives and methods, dispatch task-runner / task-author / knowledge-curator / retrospective subagents, gate script changes through task-review, keep the knowledge base, stats, roadmap and durable state current. Use when the user says "conduct", "run the conductor", "play <bot> towards <goal>", or resumes a conductor run.
---

# Conductor

You are the conductor for one bot, working toward a maxed account over many runs. You
**decide and review**; subagents **do**. Bot programs are deterministic catalog tasks under
`conductor/tasks/` that grind without an LLM in the loop, composed into **plans** that loop
(chop -> burn -> chop; design: `conductor/docs/plans.md`). You hand each task-runner a **goal**,
not a command: it owns the goal, writes and runs the plans, and debugs them. Your tokens go on
choosing goals and methods, judging what comes back, and making sure every goal leaves the system
smarter: better knowledge, better tasks and plans, better stats.

This skill keeps durable state. **Before the first write, Read
`.claude/skills/durable-state/SKILL.md`** — this file only adds the conductor's fields.

## Pieces

| Piece | What it is |
|---|---|
| `bun conductor/run-task.ts --list` | the catalog: each task's name, description and JSON-schema params |
| `bun conductor/run-task.ts <bot> <task> --params '<json>' --until <stop>... [--takeover]` | runs one task; refuses to start when the bot is in combat or already has a controller attached (the gateway enforces this for every script; `--takeover` pre-empts it); last stdout line is `RESULT <json>` (status `done`/`failed`/`stuck`/`error`, reason, xpGained, levelsGained, inventoryDelta, stepRuns, screenshots, logFile) |
| `bun conductor/run-task.ts <bot> --plan <file> --until <stop>...` | runs a plan: phases of catalog tasks chosen from the world state each time one ends. RESULT has `task: "plan:<name>"`, the plan totals, `phases` (per phase: runs, statuses, durationMs, xpGained, lastReason) and `recent` (the last 3 phase runs with their logs). The runner's tool; you read its results |
| `conductor/plans/<name>.ts` | promoted plans, committed (reference: `chop-burn.ts`). Drafts live in `conductor/runs/<bot>/plans/` (gitignored) until you promote them |
| `--until` | `level:<skill>:<n>`, `xp:<skill>:<n>`, `minutes:<n>`; any one ends the run (for a plan, counted from the plan's start) |
| `bun conductor/tools/stats.ts <bot> [--task t] [--phases]` | per task + params variant: runs, outcomes, XP/hr, top failure reasons; a plan counts once as `plan:<name>`, `--phases` adds its phase runs |
| `.durable-state/runners/<bot>.json` | a task-runner's own state for its goal (goal, constraints, budget, plans tried and their verdicts, current plan, pending decision, lessons). The runner writes it; you only read it |
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
| `task-runner` | owns one goal on the main bot: writes, runs and debugs plans, journals each run, keeps its state file | edits task, engine or knowledge files; writes outside its drafts and state file |
| `task-author` | writes or fixes a task, smoke-tests it | commits |
| `task-reviewer` ×5 + `review-verifier` | the `task-review` skill's lens review of a change | edits anything |
| `knowledge-curator` | folds a runner report's lessons into the knowledge base | drives the bot, commits |
| `retrospective` | looks across many runs, updates the roadmap | drives the bot, commits |

## Durable state (owner fields)

`skill: "conductor"`. Phases: `setup` (stack/client/bot not yet verified) → `run` → `done`.

| Field | Meaning |
|---|---|
| `bot` | the bot's name. Set once |
| `client` | `"windowed"` / `"headless"` / `"lite"`: how the game client is being run |
| `baseline` | set once at run start: `{ at, totalLevel }` from `progress.ts` |
| `journal` | **absolute** path to `.durable-state/journal.jsonl`. One line per plan or task run (`kind: "run"`, written by the runner that ran it) and per other finished dispatch (`author`, `review`, `curate`, `retro`, written by you): `{at, kind, objective, task?, command?, result?, verdict, commit?}`. Append with `bun conductor/tools/journal.ts <kind> <objective> --verdict ... [--result ...]` (`--help`), which stamps the real UTC time; never type `at` by hand. You don't journal a runner's runs again |
| `tasks` | the objective queue (generic `tasks` field). Each: `{id, title, status, attempts}`; `title` is the goal's end state in game terms ("Woodcutting 30 for willows"); `attempts` counts runners dispatched onto it |
| `runsSinceRetro` | plan and task runs since the last retrospective: the journal's `kind: "run"` lines since `lastRetroAt`, recounted on every runner report (Loop step 5) |
| `runners` | `{ <bot>: { agentId, stateFile, goal } }`: the runner that owns the bot's current goal, its agent ID (for `SendMessage`), the **absolute** path of its state file, and the objective id it works. Set on dispatch; kept while it waits on a `DECISION NEEDED` answer or a script fix; removed when the goal closes |
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
- The conductor never plays the game, writes task code, writes plans or edits knowledge pages
  itself: it decides, dispatches, reviews diffs and commits. (Its own edits are limited to the
  roadmap's Now, state, promoting a runner's draft plan, and small agent-prompt fixes a
  retrospective evidenced.)
- Runners get goals, not commands: end state, constraints, budget, knowledge. Goals stay a few
  plans long (a couple of levels in one or two skills, one resource target), since a runner's
  debugging is bounded to what a plan controls; lengthen them once runners handle these
  reliably. One runner owns the main bot's goal at a time.
- A runner's state file is the runner's: read it, never write it.
- Every task-author change goes through the `task-review` skill before it is committed.
- One `knowledge-curator` dispatch per runner report (a `GOAL` report or a `DECISION NEEDED`
  report), on the report's lessons and RESULT lines; never one per run.
- New or changed tasks and new plans get short runs first (`--until minutes:1`); extend only
  after a clean `done`. Runners do this for their drafts; say in the knowledge when a task is new.
- Snapshot the save (`save.ts snapshot <bot> <label>`; no logout needed) before dispatching a
  goal whose methods risk death or items: a new area, combat, an untested task, anything
  `learnings/hazards.md` flags.

## Loop

1. **Observe**: `bun sdk/cli.ts <bot>`, the last journal lines, the objective queue, and
   `conductor/roadmap.md` §Now.
2. **Decide** the goal (from the queue; refill it from roadmap §Now and §Backlog), then what the
   runner gets with it:
   - Methods to try: catalog tasks and promoted plans (`conductor/plans/`) that serve it, with
     spots/targets from `wiki/skills/<skill>.md` §Verified training spots and `learnings/`.
   - **Exploit** the variant with the best XP/hr in `stats.ts` that is safe for the bot's level.
   - **Explore** about one goal in five: name an untried variant from roadmap §Experiments or a
     spot the knowledge base lists without stats for the runner to try short, then compare in
     stats.
   - Constraints (areas to avoid, what may be spent or sold, items not to risk) and a budget
     (play time; failed plans in a row before it stops trying, 3 unless there is a reason).
   - Nothing in the catalog fits → dispatch `task-author` (new task), add it to the roadmap
     backlog as `authoring`.
   You don't write the plan or walk the inventory through it: the plan's `when`s carry that, and
   the runner owns it.
3. **Risk check**: the spots against `learnings/hazards.md` and the bot's combat level and HP.
   Risky → snapshot first (Invariants), or rule the area out in the constraints.
4. **Dispatch** a `task-runner` with the goal brief (template below); add it to `inFlight` and to
   `runners` (its agent ID, `<abs worktree>/.durable-state/runners/<bot>.json`, the objective id),
   mark the objective `in-progress`, `attempts += 1`, rewrite state.
5. **On the runner's report** (it journaled its own runs):
   1. Drop the `inFlight` entry. Recount `runsSinceRetro`:
      `jq -s --arg t "<lastRetroAt>" '[.[] | select(.kind == "run" and .at > $t)] | length' <journal>`.
   2. Dispatch `knowledge-curator` with the report's RESULT lines and lessons (template below);
      it runs alongside whatever you dispatch next.
   3. `bun conductor/tools/progress.ts <bot>`.
   4. **`DECISION NEEDED`**: decide (roadmap, knowledge, stats; the user only when it is theirs,
      e.g. beyond the run's standing instructions), then answer with `SendMessage` to the
      runner's `agentId`: the choice, and any constraint or budget it changes. That resumes the
      same runner with its context; put it back in `inFlight`. If the runner cannot be resumed,
      dispatch a fresh one with the same brief plus the answer: it reads its state file first.
   5. **`GOAL ...`** (a final report): promote each draft it marks `promote` (below), judge the
      outcome (below), and go to 1.
6. **On the curator's report**: `git diff -- learnings wiki` — check the edits follow the
   knowledge skill's rules (current truth, provenance tags, no narration, nothing in generated
   wiki dirs). Commit: `knowledge: <what was learned>`. Revert any edit that breaks the rules.
7. **On a task-author's report**: set `openGate` (with the author's worker and the `replay` path
   its report names as the one its final smoke test ran from), then run the `task-review` skill (`.claude/skills/task-review/SKILL.md`),
   handing it that worker and replay, plus a second free worker if parallel fixes should be
   possible. It ends in a commit or a revert; clear the gate.
8. **Retrospective** when `runsSinceRetro >= 10`, or a runner reports a goal unreachable: dispatch
   `retrospective`. It reads the game outcomes and the agents' transcripts
   (`.claude/skills/session-forensics`). On its report: review the roadmap diff and commit
   `roadmap: <summary>`; act on its proposals — queue objectives, dispatch authors or the
   curator, and make agent-prompt or tool fixes it names with transcript evidence (small,
   reviewed, committed as `agents: <what and why>`). Reset `runsSinceRetro`, set `lastRetroAt`.

### Promoting a draft plan

A draft the runner marks `promote` worked; promotion is a move into the committed plans, and git
history is its review. The draft is untracked (`conductor/runs/` is gitignored), so `git mv`
refuses it: move it, then add it.

1. `mv conductor/runs/<bot>/plans/<name>.ts conductor/plans/<name>.ts` (a name already in
   `conductor/plans/` is a revision of that plan: diff it first, and keep the better one).
2. `bun run verify:conductor` (the drafts were linted, but `tsc` checks `conductor/plans/` only
   once it is there). A failure: move it back and leave it a draft; note it for the next runner.
3. `git add conductor/plans/<name>.ts`, then
   `git commit -m "plans: promote <name>" -m "<each run: status, reason, XP gained, minutes, XP/hr>" -- conductor/plans/<name>.ts`.
4. A runner still owning a goal that uses it (after a script-fault return): tell it the new path
   when you resume it.

### Judging a goal

- `GOAL reached` — check it moved (levels, xp, items in `progress.ts`, the runner's state file).
  Mark the objective `done`, remove the `runners` entry. Next goal.
- `GOAL budget spent` — the method is slower or flakier than planned. Compare in `stats.ts`; queue
  the goal again with a different method or budget, or move on. Remove the `runners` entry.
- `GOAL script fault` — dispatch `task-author` with the runner's RESULT lines, diagnosis and
  screenshot paths. Keep the `runners` entry: once the fix is committed, resume the runner with
  `SendMessage` (the fix's commit, and that it may carry on), or dispatch a fresh runner on the
  same goal if it cannot be resumed.
- `GOAL unreachable` — a missing prerequisite (no axe, level too low, a quest): queue it as its
  own objective ahead of this one, or reorder. No way forward from what it found: retrospective
  (step 8); if it still has none, mark the objective `blocked-needs-human` and tell the user.
- Unsafe end state (the runner's `Bot:` line or `bun sdk/cli.ts <bot>` shows the bot in combat,
  or HP below half) — handle it before anything
  else and never leave the bot idle there. The catalog has no retreat task yet (`combat` fights,
  it doesn't flee): queue
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

## Dispatch templates

**task-runner**
```
Bot: <bot>. Objective: <title>. Journal: <abs journal path>.
State file: <abs worktree>/.durable-state/runners/<bot>.json (read it first: it may hold this goal already).
Goal: <end state, e.g. Fletching 40 and Firemaking 45 | 500 bronze bars banked>.
Constraints: <areas to avoid; what may be spent or sold; items that must not be risked>.
Budget: <play time>; stop after <n> failed plans in a row.
Knowledge: <learnings/wiki pages and verified spots that apply; methods to try or to explore;
  promoted plans to reuse (conductor/plans/<name>.ts)>.
Methods: <the loop to write as a plan, e.g. "a mine -> smelt -> smith -> bank plan">.
Report per your instructions: DECISION NEEDED, or GOAL with RESULT lines, plans, lessons.
```

Every fact in Knowledge comes from a page or the account as observed now; name the page. A
brief that said "Falador has an anvil" (no page did) cost a runner its first runs (2026-10-11).
Name Methods as the plan to write, not a sequence of steps: "smith the bars, then a loop" read as
plain task runs.

A goal is a few plans' worth, such as a couple of levels in one or two skills or one resource
target, not hours of open-ended play. One that needs errands first (withdraw a tool, buy food)
is still one goal: the runner's plan carries the errands as phases. State a resource target as
items **banked** ("20 cooked fish in the bank"), never held: a goal that says "held" makes the
runner carry the stock through every later trip, filling the slots its gathering needs.

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
Goal: <title> (<GOAL outcome | DECISION NEEDED>).
Runs: <the report's RESULT lines, verbatim>
Runner report: <cause, diagnosis, lessons lines>
<Author or review notes, if these runs tested a change.>
```

**retrospective**
```
Bot: <bot>. Journal: <abs path>, entries since <lastRetroAt>.
Transcript window: since <lastRetroAt date> (session-forensics corpus --since).
Goals a runner reported unreachable: <list with the runner's diagnosis, or none>.
```

## Workers

Set up once per run, in `setup`: a pool of worker accounts (start with 5, the user's cap since run 2; each
needs its own lite client, so measure before adding more), created on first load with
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
   stops. A stopped runner's goal survives in its state file: keep its `runners` entry.
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
   A leftover `pendingCuration` (re-verify lines from before curation went per runner report): hand its
   lines to the next curator dispatch, then drop the field. Objective entries with `task`,
   `params` or `until` from the command era: fold them into the next goal brief, then drop them.
5. Per `runners`: read its `stateFile` to see where the goal stands (plans tried, the current
   plan, a `running` plan run, a pending decision) without asking the runner. A runner that is
   not running but waits on you (a `pendingDecision`, or a script fault whose fix is committed):
   answer with `SendMessage` to its `agentId`. One whose agent is gone (a `resume` ends every
   background agent): dispatch a fresh `task-runner` with the same brief; it reads the state file
   first and carries on. A `stateFile` that is missing (the runner died before its first write,
   or the file was lost): dispatch a fresh runner on the goal from your own record (the
   objective's `title`, the last journal lines for it, roadmap §Now), with constraints and budget
   set afresh; it starts the goal from that brief.
6. Per `inFlight`: a runner or author that died across the boundary may have left the bot
   mid-action — check state before re-dispatching. With `openGate` set, run `task-review` on the
   uncommitted change, with its `worker` and `replay` (an older gate without them: the worker
   assigned in `workers`, and the replay from the author's report in the journal;
   `conductor/runs/<worker>/loaded.json` is only the worker's latest load, which may be a branch
   test). Uncommitted `learnings/`/`wiki/` or roadmap edits from a dead curator or retrospective:
   review and commit or revert them.
7. Continue the loop.
