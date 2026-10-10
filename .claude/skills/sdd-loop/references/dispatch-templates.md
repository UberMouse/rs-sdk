# sdd-loop dispatch templates

Read before the first dispatch of a run and again after any resume. Give every agent its task
text **inline** (the spec section and the global rules, verbatim); never make it read the spec
file for its instructions. Every dispatch passes `model` explicitly. `<WORKTREE>` is the
worktree's absolute path: agents inherit your cwd, but say it anyway.

## Fix modes (the Implementer template doubles as the fix agent)

| Mode | Used by | `<FIX_FEEDBACK>` |
|---|---|---|
| **A. Per-task combined fix** | §3 step 3, §4 | `This may combine findings from the parallel spec-compliance AND code-quality reviews — fix ALL of them together:` then both finding sets, inline |
| **B. Branch-review finding** | §5 (dispatched by the review agent) | each finding: file:line, lens + criterion + band, evidence, suggested fix |

## Implementer (also the fix agent)

```
Agent(general-purpose, model=<implModel>):
  description: "Implement task <N>: <title>"
  prompt:
    You are implementing ONE task of a larger spec, in the git worktree <WORKTREE> (your cwd).
    Earlier tasks are ALREADY COMMITTED on this branch: build on them.

    ## Task
    <the spec's `## Task N —` section, verbatim, including its acceptance criteria>

    ## Global rules (bind every task)
    <the spec's Global rules, verbatim>

    ## Context
    <one paragraph: the feature, what earlier tasks landed (files, symbols), conventions to copy,
     baseline failures that are not this task's>

    ## If this is a FIX dispatch
    REVIEW FEEDBACK to address (exactly this, nothing more):
    <FIX_FEEDBACK>

    ## Before you begin
    If something is genuinely ambiguous and the repo can't answer it, STOP and return the
    question. Don't guess.

    ## Your job
    1. Read the neighbouring code first and copy its idiom: `conductor/README.md`,
       `conductor/lib/task.ts`, `conductor/lib/engine.ts`, and `.claude/agents/task-author.md`
       for task code. Implement exactly the task.
    2. Tests: unit tests in `conductor/test/` (bun:test, scripted worlds via
       `conductor/test/simulate.ts` and `conductor/test/world.ts`); run `bun test conductor`.
       Integration (`bun run test:integration <filter>`) only when the task asks for it: it needs
       the shared local stack (check `ss -ltn | grep -E ':8888|:7780'`; if it is down, report it,
       don't start or restart it). Never drive a conductor bot.
    3. `bun run verify:conductor` must pass for your files (format your files with
       `bunx oxfmt <files>`). A baseline failure named in Context is not yours unless the task
       says to fix it.
    4. Commit: `git add <your paths>` then `git commit -m "<type>(<scope>): <what>" -- <your paths>`
       (pathspec, never `git add -A`). Do not push.
    5. Self-review with fresh eyes: every criterion met? no overbuild? tests pin behaviour, not
       implementation? Verify every behavioural claim in a comment you wrote against the code;
       delete one you can't verify. Fix what you find (amend nothing: commit on top).
    6. Stop any background shell you started before your final message.

    ## Report
    Lead with the commit SHA(s) and `git status --short`. Then briefly: what you built, tests
    and results (counts), verify result, self-review findings, concerns. Blocking questions in
    full. No restated diff.
```

## Spec-compliance reviewer

```
Agent(general-purpose, model=<reviewModel>):
  description: "Spec review task <N>"
  prompt:
    Verify an implementation matches what was asked: exactly that, no more, no less. Worktree:
    <WORKTREE>.

    ## What was requested
    <the spec's Task N section verbatim (acceptance criteria included) + the global rules>

    ## What the implementer claims
    <implementer's report>

    ## Don't trust the report. Verify against the code.
    `git diff <task parent>..HEAD` and the touched files in full. Check every acceptance
    criterion one by one, and:
    - Missing: requested but absent, or claimed but not there.
    - Extra: built but not requested, including anything the spec puts out of scope.
    - Misunderstood: right problem, wrong reading.
    - Tests: does a test actually pin each behaviour a criterion names? Run `bun test conductor`
      (and only that, plus `bun run verify:conductor` if needed).
    Earlier tasks are committed: a dependency on them is legitimate.

    ## You never modify the tree
    A code-quality reviewer reads this tree right now. No edits, no temp files in the repo, no
    commits. Want a test proven to fail? Name the exact mutation and the expected failure; it is
    run after both reviews return.

    ## Report
    FIRST LINE exactly `SPEC: PASS` or `SPEC: FAIL`. Then findings in this message, each
    file:line + criterion + what is missing/extra/wrong. Mark any finding that is pre-existing on
    main or outside this task as such.
    LAST LINE exactly `TREE: unchanged` (compare `git status --short` before/after), or
    `TREE: CHANGED — <what>`.
```

## Code-quality reviewer (parallel with the spec reviewer)

```
Agent(general-purpose, model=<reviewModel>):
  description: "Code review task <N>"
  prompt:
    Review this task's committed change for QUALITY only; a spec reviewer checks conformance in
    parallel. Worktree: <WORKTREE>. Change: `git diff <task parent>..HEAD`.

    Read `.claude/review-lenses/common.md`, then apply `.claude/review-lenses/code-quality.md`
    item by item, plus from `.claude/review-lenses/robustness.md` and `contract.md` whatever this
    change touches (engine, guards, stops, results, the task contract). Read every changed file in
    full and the code it calls; never judge from the diff alone. Report only real issues: skip
    nitpicks and anything oxlint/oxfmt/tsc catches.

    ## Also check, for this task
    <task-specific traps you can name from the design and the touched files; omit if none>

    ## You never modify the tree
    A spec reviewer reads this tree right now. No edits, no temp files in the repo, no commits.
    Want a test proven to fail? Name the mutation and the expected failure instead.

    ## Report
    FIRST LINE exactly `CODE: PASS` or `CODE: FAIL`. Any Critical or Important issue means FAIL.
    Then issues only (Critical / Important / Minor, each file:line + lens criterion if any +
    suggested fix). Mark pre-existing ones as such.
    LAST LINE exactly `TREE: unchanged` or `TREE: CHANGED — <what>`.
```

## Branch review agent (§5)

```
Agent(general-purpose, model=opus):
  description: "Branch task-review <branch>"
  prompt:
    Run `.claude/skills/task-review/SKILL.md` end to end on a committed range, in the worktree
    <WORKTREE>. Change: `git diff <base>..HEAD -- conductor/ .claude/` (new files: <list>).
    Purpose: <one line>. Evidence: <tests/verify results, integration RESULT lines, what couldn't
    be run>. The design doc is <path>, the spec <path>: findings that contradict a decision
    recorded there are dropped, not fixed.

    Adaptations to the skill for this run:
    - §1: dispatch the five `task-reviewer` lenses yourself, in parallel; §2 the verifier.
    - §3: fix A, B and C. Your fix agents are general-purpose (model sonnet, opus for engine
      changes) given the findings inline; they commit on top as `fix(review): <what>`, with a
      pathspec, after `bun run verify:conductor` and `bun test conductor` pass. No worker bot
      unless a finding needs a smoke run (then ask me for one; never drive a conductor bot).
    - §4: round 2 on the lenses that had fixes; then stop. No revert: an A you could not fix is
      reported.
    - §5: no separate commit and no journal line; the fix commits are the record.

    Report (compact; keep lens JSON out of it): per lens found / fixed / deferred / dropped, one
    line per fixed finding (problem → fix), unfixed A/B with why, the fix commit SHAs, and the
    final verify and test results.
```
