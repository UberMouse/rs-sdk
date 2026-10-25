---
name: task-review
description: Agent-driven review -> verify -> fix loop for bot task code (conductor/tasks, conductor/lib, conductor/tools), with rs-sdk lenses (game semantics, robustness, task contract, account safety, TypeScript code quality). Run by the conductor after every task-author change, before the change is committed, or on a commit range to review code already landed. No human gate; the conductor decides.
---

# Task review

Adapted from kawaka's `branch-review`: parallel lens finders, a recall-first verifier, then a
fix-forward loop. Here there is no human gate: the conductor acts on the verified findings.

```
change (uncommitted from task-author, or a commit range)
  -> 5 task-reviewer agents in parallel, one per lens        (.claude/review-lenses/*.md)
  -> review-verifier(s): refute wrong findings, re-band the rest
  -> A/B and meaningful C: task-author fixes + re-checks  -> round 2 on the lenses that had fixes
  -> D / cosmetic C / refuted / duplicates: dropped
  -> commit (or revert)
```

Lenses (the criteria live in the lens files, not here):

| Lens | File | Asks |
|---|---|---|
| `game-semantics` | `.claude/review-lenses/game-semantics.md` | does the code's model of the game and SDK match reality? |
| `robustness` | `.claude/review-lenses/robustness.md` | does every run end, for the right reason, and say why? |
| `contract` | `.claude/review-lenses/contract.md` | does it fit the task contract and catalog, reusing what exists? |
| `safety` | `.claude/review-lenses/safety.md` | could it cost the account deaths, items, money? |
| `code-quality` | `.claude/review-lenses/code-quality.md` | is it well-written TypeScript: types, async hygiene, simplicity, naming, comments, consistency? |

## 0. Scope

Usually the change is the uncommitted diff under `conductor/` that a task-author left
(`git diff --stat -- conductor/` plus untracked files from `git status --short conductor/`).
To review code already committed, name a range instead (`git diff <base>..HEAD -- conductor/`);
then §4's revert becomes "report the A findings to the user" — never rewrite landed history.

Keep the author's report: its unit tests (`conductor/test/`, run with `bun test conductor`) and
smoke-test RESULT lines are evidence for the reviewers. Missing tests are a contract finding (T8),
not a gap to wave through; which changes need unit tests is contract T8
(`.claude/review-lenses/contract.md`), and any changed task needs a passing integration smoke. When
the bot can't run the task (missing gear, dead), say so in the evidence so reviewers don't wait
on it.

If the change touches only a task's `description` or comments, run `contract` and
`code-quality` alone. Otherwise run all five. The lenses are written for the generator-step
pattern in `.claude/agents/task-author.md`.

## 1. Find

Dispatch one `task-reviewer` per lens **in a single message** (they run in parallel):

```
Lens: <lens>
Change: <the diff command; new files: <list>>
Purpose: <one line: what the change is for>
Evidence: <unit tests added/changed and whether `bun test conductor` passes; smoke-test RESULT lines; their logFile and screenshot paths; what couldn't be run>
Return the JSON from .claude/review-lenses/common.md only.
```

For a long brief (round 2, many prior fixes), write it to a file under `$CLAUDE_JOB_DIR/tmp/`
and point every reviewer at it.

A reviewer that returns no parseable JSON, or a `checked` list missing criteria from its lens,
gets re-dispatched once. If it fails again, **fail closed**: do not commit; record the
incomplete review in the journal and retry on the next loop.

## 2. Verify

No findings from any lens → skip to §5. Drop band-D findings before verifying, except a D
whose suspicion is cheap to check (a requirement, level or constant against `server/content`):
check it, and keep it if it holds (the firemaking review's only round-1 B started as a D).
Otherwise every round with findings goes through a `review-verifier`, however obvious the
findings look: the orchestrator judging them itself is how a review skips the check (fletching,
53ff9e640).

Number the rest `0..n-1` in one list (keep each one's lens) in a file, grouped by file area
(engine/interrupts, the task, tools) so duplicates from different lenses sit together. One
`review-verifier` handles up to ~20 findings; past that, dispatch one per group **in
parallel**, each told which indices are its own. Then sort:

- **fix**: not refuted, not a duplicate, and band A or B, or a **meaningful** C.
- **drop**: band D, a cosmetic C, refuted, duplicates.

A C is meaningful when it is a silent failure or a guess where the code should report, a broken
guarantee (a check the code claims and doesn't make), a stale or misleading comment, or
duplication that has already drifted. A C is cosmetic when no output or reader changes: a style
preference, a harmless cast, a latent edge no script or input can reach. You (the orchestrator)
judge each C and give a dropped one a one-line reason in the report. A round-2 review that finds
only cosmetic C closes the review. There is no backlog: the codebase is young, and a backlog of
small issues outlives its context. Defer a meaningful finding only when its fix needs work outside
the change's files (a new task, an SDK change
upstream would own); then add it to `## Review follow-ups` in `conductor/roadmap.md`
(`- <task>: <summary> (<lens> <criterion>)`).

## 3. Fix

Dispatch `task-author` with every fix finding (inline, or in a brief file for many). Whoever runs this loop never edits
the task files itself: every fix goes through a `task-author` (retro #3: a review delegate committed its own fixes,
4778e2480). While a dispatched agent runs, end the turn and wait for its notification; never poll it with Monitor or
sleep loops (retro #3: one delegate spent 39.8 M cache reads on 267 such polls).

```
Fix review findings in <files>, smoke-testing on worker <worker> from save <save>
(`bun conductor/tools/load.ts <worker> <save> --client`).
For each: <file>:<line> [<lens> <criterion>, band <band>] <summary>
  Evidence: <evidence>
  Fix: <suggestion>
Change only what these findings call for. Re-run `bun test` on the changed area, the integration
tests for the files you touched (`bun run test:integration <name>`, never the full suite), and
`bun run verify:conductor`.
Format only your files (`bunx oxfmt <files>`, not `bun run fmt`: other agents' uncommitted
files are in conductor/ too); a verify error in a file you didn't touch is theirs, not yours.
Leave the change uncommitted; report per finding: fixed / couldn't (why), and the RESULT lines.
```

The worker is the author's: it stays assigned to this change until the review commits or
reverts (the conductor's `workers` state, and `openGate.worker`). The save is the `replay` path
from the `LOADED` line the author's smoke tests ran from (a copy of exactly what was loaded, so
the fix is retested from the same state even when the author started from a moving `bot:`
source); it is also in `openGate.replay`. The author's report lists every save it loaded: a
finding about a branch it tested from another save names that replay too. Many findings may go to two fix agents **in parallel only when their files
are disjoint** and the review was given a second free worker; otherwise, or when a fix spans both
sets (a shared helper used on both sides), they run one after the other. Never let two drive the
same bot.

## 4. Round 2

Only when a fix was band A or B: a round of C fixes alone is closed by your own read of the fix
diff and `bun test conductor`, with no second round. Otherwise re-run §1–§2 for only the lenses
that had A or B fix findings, on the whole change, telling the
reviewers which round-1 fixes to re-check, the round-1 findings that were dropped (so they
aren't re-raised), and the newest smoke-test logs, which every round-2 reviewer must read (the
post-fix log is where regressions show). Round 2 usually finds problems the fixes introduced:
fix those as in §3. There is no round 3: close with `bun run verify:conductor` and the
conductor's own read of the round-2 fix diff (each finding resolved, nothing out of scope, no
new defect). Then:

- No A left → §5.
- A left → **revert** (uncommitted change): `git checkout -- <changed files>` and delete new
  files; journal the findings; set the objective back to `pending` with the findings as notes
  for the next task-author dispatch. For a commit range, report the A findings to the user.

## 5. Commit

A review never runs the full `bun run test:integration`: it is too slow for the loop (a review
once took 76 minutes for a 140-line change, with every fix author re-running it, 2026-10-11, and
the user ruled it out). Before the commit, `bun test conductor`, `bun run verify:conductor`, and
the integration tests named after the touched files (`bun run test:integration <name>`) are the
gate.

Before you commit and report, make sure nothing you started is still running (a test or smoke
run in the background, a subagent): wait for it or stop it. An orchestrator that reports with
background work alive keeps re-notifying the conductor after its report.

`git add` the specific files, then commit with a pathspec, `git commit -- <files>`: other agents
share the worktree's index, and a bare `git commit` sweeps in what they staged. The pre-commit
hook re-checks format and lint. The
message stands alone (no finding ids):

```
feat(tasks): <what the task does now>      (or fix(tasks): / refactor(tasks):)

<why the change was made: the objective or the failure it addresses>
- review: <problem and fix, in prose, one bullet per fixed finding>
```

Append a journal line `{ at, kind: "review", task, rounds, found, fixed, deferred, dropped,
commit }` and clear the `script-approval` gate.
