---
name: sdd-loop
description: Build an approved design doc (or a small, understood change) through subagent-driven development - turn it into a committed spec of ordered tasks, implement each with a fresh subagent, review each with a spec-compliance and a code-quality reviewer IN PARALLEL, fix forward until both are clean, then review the whole branch with the task-review lenses and land it. Use when the user says "build the plan", "turn the plan into a spec and build it", "sdd loop", or hands over a design doc to implement.
---

# SDD loop (rs-sdk)

Adapted from kawaka's `sdd-loop` (`~/code/kawaka/.claude/skills/sdd-loop/`). What differs here:
the input is usually an approved design doc that becomes a committed spec (as
`conductor/docs/interruptible-tasks-spec.md` was), verification is `bun`, the whole-branch review
is this repo's `task-review` lenses, and the work lands as a merge into `main`, not a PR.

**Core principle:** a change is done not when it works, but when a reviewer that did not write
it, reading the real committed tree, cannot find anything wrong with it.

**Announce at start:** "Using the sdd-loop skill: spec, then each task implemented and reviewed
by subagents, then a whole-branch review."

```
  0. Input      approved design doc ─► or a small ask: ASK, then acceptance criteria (one task)
  1. Setup      worktree from local main, bun install, baseline tests; BASE; state.json
  2. Spec       <topic>-spec.md: global rules + `## Task N —` sections with acceptance criteria
                  primitives-first; committed with the design doc; no approval gate
  3. SDD loop   per task, sequentially:
                  implement ─► ⟨spec-review ∥ quality-review⟩ ─► one combined fix
                    ─► (re-review what the fix touched)* ─► task done, committed
  4. Verify     verify:conductor, bun test conductor, the touched integration tests
  5. Branch     task-review over BASE..HEAD, delegated to ONE subagent; fixes A/B + meaningful C
  6. Land       report; merge into main when the user says so
```

## When to use / not

- Use: a design the user approved (a plannotator pass, or "start building it"), or a small change
  you understand that should still be independently reviewed.
- Not: a design still being argued (finish the doc first); a typo or a comment (just edit it);
  a single catalog task change in a conductor run (that is `task-author` + `task-review`).

## State

Durable state per `.claude/skills/durable-state/SKILL.md` (read it before the first write), in
the worktree's own `.durable-state/state.json`, so it never collides with a conductor run in the
main checkout.

- `skill: "sdd-loop"`, `phase`: `spec` → `implement` → `branch-review` → `land` → `done`.
- Owner fields: `base` (set once, §1), `branch`, `designDoc`, `specDoc`, `implModel`,
  `reviewModel`, `baselineFailures` (§1).
- `tasks[]`: `{id, title, status, commit, spec, code, fixRounds, agentInFlight}`; rewrite on every
  transition (dispatched, reviewed, fixed, done).
- `invariants`: the three under §Resuming.

Models: `implModel` `opus` for engine/core/lib work, `sonnet` for docs, agent prompts and simple
tasks; `reviewModel` `sonnet`. **Every Agent call passes `model` explicitly.** Implementers, fix
agents and the per-task reviewers are the `sdd-implementer`, `sdd-spec-reviewer` and
`sdd-code-reviewer` agent types (`.claude/agents/`), not `general-purpose`: their definitions set
effort `medium`, the implementer's turn cap and compaction window, and a tool list without the
dozens of tools a `general-purpose` agent pays to load on every call.

## Resuming

1. Re-read this file and `references/dispatch-templates.md`, then `.durable-state/state.json`
   (its `standingInstructions` still bind) and the spec.
2. `git log --oneline <base>..HEAD` and `git status --short`: a task whose agent died with edits
   left ⇒ resume it with `SendMessage`; none ⇒ re-dispatch. Continue from the first task not
   `done`, or the phase recorded.
3. Invariants:
   - **The conductor (you) never edits code for a task or a finding.** Implementers and fix agents
     do; a hand edit skips both reviews.
   - **Every Agent call passes `model`.** Omitted, it inherits the session's model.
   - **Every dispatch uses the templates**: verdicts on the FIRST LINE, implementers commit their
     own work with a pathspec.

## 0. Input

**A design doc** (the usual case): it is the approved source. Read it and the code it touches.
Anything it leaves open that would change the code materially, ask in one `AskUserQuestion`
batch; decide the rest and write it into the spec as an `**Assumption:**`.

**A small ask** with no doc: read the code first, ask what is load-bearing (two readings that
would produce materially different code), then write acceptance criteria in a short spec with one
task. Same file and flow; the spec is just short.

## 1. Setup

```bash
git -C <main checkout> rev-list --count origin/main..main     # local main is usually ahead
git -C <main checkout> worktree add -b <branch> .claude/worktrees/<branch> main
```

Then `EnterWorktree` with that `path`. (`EnterWorktree` with `name` branches from `origin/main`,
which lags local `main` here.) The main checkout often holds a conductor run's uncommitted work:
leave it alone; move only files that belong to this build (the design doc) into the worktree.

In the worktree: `bun install` (enables `.githooks`) and `bun install --cwd server/webclient` (the
integration tests' lite client needs its packages; a fresh worktree has none), then the baseline:
`bun test conductor` and `bun run verify:conductor`. Record any failure already on `main` in
`baselineFailures` and assign it to the spec task that touches that file, or list it in the final
report; reviewers must not chase it as the task's fault.

`base` = `git rev-parse HEAD` before the spec commit, set once.

## 2. Spec

Write `conductor/docs/<topic>-spec.md` (or beside the design doc), modelled on
`conductor/docs/interruptible-tasks-spec.md`:

- One line on what it expands, then **Global rules** that bind every task: formatting/lint, test
  layout (`conductor/test/**/*.test.ts`, `*.itest.ts`), files not to touch, contracts that must
  stay working (`run-task.ts` CLI, `RESULT <json>`), no `Date.now()` in game logic, knowledge in
  `learnings/` not comments, comment density.
- `## Task N — <title>` sections, **primitives-first** (a task may use anything an earlier one
  landed): `**Files:**`, what to build in enough detail that two implementers would build the same
  thing, then `### Acceptance criteria` as `- [ ]` checks a reviewer can verify from the code and
  tests, including the test criterion and an out-of-scope line where there is a temptation.
- `## Out of scope for this spec`.

Size tasks so one reviewer can hold one diff: usually 3-8 tasks. Size them for the implementer
too: one behaviour in one module or a few closely related files, which an implementer finishes
in roughly a hundred tool calls. Every call re-reads the agent's whole context, so a task that
runs for hundreds of calls costs far more than two that each run for half as many. Split:

- **Exploration from building.** A task that must first find out what exists (scan game data,
  enumerate the cases, measure counts) becomes a research task whose deliverable is a committed
  findings file, fixture or data table; the build task after it reads that, not the raw sources.
- **A large file's separate concerns.** Name the functions or sections a task touches in a file
  over a few hundred lines, so the implementer reads those, not the file again and again.

Commit the design doc and spec
together: `docs(conductor): plan and spec for <topic>`. Echo the task list to the user and carry
on: the doc was the approval, the spec is its expansion.

## 3. The SDD loop

Tasks run **strictly sequentially**; each commits. Per task:

1. **Implementer** (`Agent`, `sdd-implementer`, `model: implModel`) with the *Implementer*
   template, the task's section of the spec **inline** plus the global rules. It implements,
   tests, verifies, commits, self-reviews. A blocking question: answer it from the design doc
   when it answers it; otherwise `AskUserQuestion`, then re-dispatch. A partial return (it hit
   its turn cap): the template's *Turn cap* rule.
2. **Review in parallel**: `sdd-spec-reviewer` and `sdd-code-reviewer` with their templates in
   **one message**, same commit, `model: reviewModel`. Neither edits the tree.
3. **Converge**: either flagged (FAIL, or PASS with meaningful findings) ⇒ **one combined fix
   agent** (Implementer template, fix mode A) with the meaningful findings of both inline; it
   commits on top. Meaningful is task-review §2's test (a silent failure or guess, a broken
   guarantee, a misleading comment, drifted duplication); drop cosmetic ones (style, a harmless
   cast, an edge no input reaches) with a one-line reason in state.json. Re-run only the reviews
   whose findings it touched. Repeat until the latest run of each has no meaningful findings.
   Findings the reviewer marks pre-existing or out of scope: decide; out-of-scope ones go to
   `## Review follow-ups` in `conductor/roadmap.md` (in §6's report if the roadmap is not on this
   branch), never into the task.
4. **Close**: state.json `done` with commit, verdicts, `fixRounds`; dispatch the next implementer
   in the same turn. A turn that ends with tasks left and nothing in flight is a stall.

Rules:

- **One agent edits the tree at a time.** Reviewers run concurrently only because they never
  modify it.
- **Never skip a review, never move on with open findings.** Fix-forward; never rewind a task.
- **Integration tests need the shared local stack** (engine `:8888`, gateway `:7780`, run from the
  main checkout). Check `ss -ltn` before a task that needs it; start it only detached
  (`setsid -f bash <main>/conductor/local/up.sh ...`) and never restart one another session uses.
  Integration tests make their own fixture bots: no agent drives a conductor bot or a worker
  another session holds.

## 4. Verify

`bun run verify:conductor`, `bun test conductor`, and `bun run test:integration <filter>` for each
integration file the branch added or whose subject it changed. Red ⇒ a fix agent (mode A), then
re-verify; don't start §5 on a red tree. Baseline failures still red are reported, not chased.

## 5. Branch review

The per-task reviews each saw one task; this sees the whole change. Dispatch **one**
`general-purpose` agent (`model: opus`) to run `.claude/skills/task-review/SKILL.md` end to end on
the range `git diff <base>..HEAD -- conductor/ .claude/`: five lenses in parallel, the verifier,
fixes for A, B and meaningful C (D, cosmetic C, refuted and duplicates dropped), round 2 on the lenses that had fixes. Adapt
its §3–§5 for engine code: its fix agents are `sdd-implementer` (fix mode B) and commit on
top as `fix(review): <what>`; there is no worker bot unless a finding needs a smoke run. It returns
a compact report (found / fixed / deferred / dropped per lens, the fix commits). Keep the lens
JSON out of your own context. Then re-run §4.

## 6. Land

Report to the user: per task, the commit and what the reviews caught; the branch review's
outcome; verify/test status; assumptions; baseline failures; follow-ups. Then ask how to land:
merge `<branch>` into `main` (from the main checkout, which may hold a conductor run's uncommitted
files: a merge that would touch them stops and asks), or leave the branch. Never push or
force-push unasked. After landing, `phase: "done"`.

## Escape hatch

If writing the spec shows the design is wrong or missing a decision that changes several tasks,
stop and ask; don't paper over it in task text.

## Dispatch templates

`references/dispatch-templates.md`. Read it before the first dispatch and after any resume.
