---
name: task-review
description: Agent-driven review -> verify -> fix loop for bot task code (conductor/tasks, conductor/lib), with rs-sdk lenses (game semantics, robustness, task contract, account safety). Run by the conductor after every task-author change, before the change is committed. No human gate; the conductor decides.
---

# Task review

Adapted from kawaka's `branch-review`: parallel lens finders, a recall-first verifier, then a
fix-forward loop. Here there is no human gate: the conductor acts on the verified findings.

```
change (uncommitted, from task-author)
  -> 4 task-reviewer agents in parallel, one per lens        (.claude/review-lenses/*.md)
  -> review-verifier: refute wrong findings, re-band the rest
  -> A/B: task-author fixes + re-smoke-tests  -> round 2 on the lenses that had fixes
  -> C: backlog in conductor/roadmap.md       D / refuted: dropped
  -> commit (or revert)
```

Lenses (the criteria live in the lens files, not here):

| Lens | File | Asks |
|---|---|---|
| `game-semantics` | `.claude/review-lenses/game-semantics.md` | does the code's model of the game and SDK match reality? |
| `robustness` | `.claude/review-lenses/robustness.md` | does every run end, for the right reason, and say why? |
| `contract` | `.claude/review-lenses/contract.md` | does it fit the task contract and catalog, reusing what exists? |
| `safety` | `.claude/review-lenses/safety.md` | could it cost the account deaths, items, money? |

## 0. Scope

The change is the uncommitted diff under `conductor/` that a task-author left
(`git diff --stat -- conductor/` plus untracked files from `git status --short conductor/`).
Keep the author's report: its smoke-test RESULT lines are evidence for the reviewers.

If the change touches only a task's `description` or comments, run the `contract` lens alone.
Otherwise run all four.

## 1. Find

Dispatch one `task-reviewer` per lens **in a single message** (they run in parallel):

```
Lens: <lens>
Change: uncommitted diff under conductor/ (`git diff -- conductor/`; new files: <list>)
Purpose: <one line: what the task-author was asked to do>
Evidence: <smoke-test RESULT lines; their logFile and screenshot paths>
Return the JSON from .claude/review-lenses/common.md only.
```

A reviewer that returns no parseable JSON, or a `checked` list missing criteria from its lens,
gets re-dispatched once. If it fails again, **fail closed**: do not commit; record the
incomplete review in the journal and retry on the next loop.

## 2. Verify

No findings from any lens → skip to §5.

Otherwise number all findings `0..n-1` in one list (keep each one's lens) and dispatch one
`review-verifier` with the list inline and the same Change/Evidence lines. Then sort:

- **fix**: not refuted, not a duplicate, band A or B.
- **backlog**: band C → one line each under `## Review follow-ups` in `conductor/roadmap.md`
  (`- <task>: <summary> (<lens> <criterion>)`).
- **drop**: band D, refuted, duplicates.

## 3. Fix

If there is anything to fix, dispatch `task-author` once with every fix finding inline:

```
Fix review findings in conductor/tasks/<task>.ts (and <other files>), on bot <bot>.
For each: <file>:<line> [<lens> <criterion>, band <band>] <summary>
  Evidence: <evidence>
  Fix: <suggestion>
Change only what these findings call for. Re-run the smoke test and tsc.
Leave the change uncommitted; report per finding: fixed / couldn't (why), and the RESULT lines.
```

## 4. Round 2

Re-run §1–§2 for only the lenses that had fix findings, on the whole uncommitted change. At
most two rounds in total. After round 2:

- No A or B left → §5.
- B left → §5, and add the B findings to the backlog as well.
- A left → **revert**: `git checkout -- <changed files>` and delete new files; journal the
  findings; set the objective back to `pending` with the findings as notes for the next
  task-author dispatch.

## 5. Commit

`git add` the specific files, then commit. The message stands alone (no finding ids):

```
feat(tasks): <what the task does now>      (or fix(tasks): / refactor(tasks):)

<why the change was made: the objective or the failure it addresses>
- review: <problem and fix, in prose, one bullet per fixed finding>
```

Append a journal line `{ at, kind: "review", task, rounds, found, fixed, backlog, dropped,
commit }` and clear the `script-approval` gate.
