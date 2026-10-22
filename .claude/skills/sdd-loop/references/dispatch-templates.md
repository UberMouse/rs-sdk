# sdd-loop dispatch templates

Read before the first dispatch of a run and again after any resume. Give every agent its task
text **inline** (the spec section and the global rules, verbatim); never make it read the spec
file for its instructions. Every dispatch passes `model` explicitly. `<WORKTREE>` is the
worktree's absolute path: agents inherit your cwd, but say it anyway.

A worktree-isolated session refuses git commands it can't verify stay in the worktree, so every
agent that runs git gets this line: the `sdd-*` agent types carry it in their definitions, and
the branch review agent's template below spells it out:
`Run each git command as its own plain Bash call from the worktree (no && chains, cd, -C or $(...) around git; a heredoc message is fine).`

## Fix modes (the Implementer template doubles as the fix agent)

| Mode | Used by | `<FIX_FEEDBACK>` |
|---|---|---|
| **A. Per-task combined fix** | §3 step 3, §4 | `This may combine findings from the parallel spec-compliance AND code-quality reviews — fix ALL of them together:` then both finding sets, inline |
| **B. Branch-review finding** | §5 (dispatched by the review agent) | each finding: file:line, lens + criterion + band, evidence, suggested fix |

## Implementer (also the fix agent)

The `sdd-implementer` agent type carries the standing instructions (job steps, git rule, context
hygiene, report format), its model default, effort, turn cap and compaction window. The
dispatch carries only what is specific to the task.

```
Agent(sdd-implementer, model=<implModel>):
  description: "Implement task <N>: <title>"     (fix: "Fix task <N> review findings")
  prompt:
    Worktree: <WORKTREE> (your cwd).

    ## Task
    <the spec's `## Task N —` section, verbatim, including its acceptance criteria>

    ## Global rules (bind every task)
    <the spec's Global rules, verbatim>

    ## Context
    <one paragraph: the feature, what earlier tasks landed (files, symbols), conventions to copy,
     baseline failures that are not this task's; for a large file the task edits, the functions
     or line ranges it touches>

    ## If this is a FIX dispatch
    REVIEW FEEDBACK to address (exactly this, nothing more):
    <FIX_FEEDBACK>
```

**Turn cap.** An implementer that reaches its `maxTurns` returns output marked partial. Resume it
once with `SendMessage` ("continue: <what is left>"); its context is intact. If it comes back
partial again, the task is too big: stop, split it in the spec (commit the amendment with the
reason), and dispatch the parts.

## Spec-compliance reviewer

```
Agent(sdd-spec-reviewer, model=<reviewModel>):
  description: "Spec review task <N>"
  prompt:
    Worktree: <WORKTREE>. Change: `git diff <task parent>..HEAD`.

    ## What was requested
    <the spec's Task N section verbatim (acceptance criteria included) + the global rules>

    ## What the implementer claims
    <implementer's report>
```

## Code-quality reviewer (parallel with the spec reviewer)

```
Agent(sdd-code-reviewer, model=<reviewModel>):
  description: "Code review task <N>"
  prompt:
    Worktree: <WORKTREE>. Change: `git diff <task parent>..HEAD`.

    ## Also check, for this task
    <task-specific traps you can name from the design and the touched files; omit if none>
```

## Branch review agent (§5)

```
Agent(general-purpose, model=opus):
  description: "Branch task-review <branch>"
  prompt:
    Run `.claude/skills/task-review/SKILL.md` end to end on a committed range, in the worktree
    <WORKTREE>. Change: `git diff <base>..HEAD -- conductor/ .claude/` (new files: <list>).
    Run each git command as its own plain Bash call from the worktree (no && chains, cd, -C or $(...) around git; a heredoc message is fine).
    Pass the same rule on to every agent you dispatch.
    Purpose: <one line>. Evidence: <tests/verify results, integration RESULT lines, what couldn't
    be run>. The design doc is <path>, the spec <path>: findings that contradict a decision
    recorded there are dropped, not fixed.

    Adaptations to the skill for this run:
    - §1: dispatch the five `task-reviewer` lenses yourself, in parallel; §2 the verifier.
    - §3: fix A, B and meaningful C (task-review §2 defines it; drop cosmetic C with a reason). Your fix agents are `sdd-implementer` (model sonnet, opus for engine
      changes) given the findings inline as a FIX dispatch; they commit on top as `fix(review): <what>`, with a
      pathspec, after `bun run verify:conductor` and `bun test conductor` pass. No worker bot
      unless a finding needs a smoke run (then ask me for one; never drive a conductor bot).
    - §4: round 2 on the lenses that had fixes; then stop. No revert: an A you could not fix is
      reported.
    - §5: no separate commit and no journal line; the fix commits are the record.

    Report (compact; keep lens JSON out of it): per lens found / fixed / deferred / dropped, one
    line per fixed finding (problem → fix), unfixed A/B with why, the fix commit SHAs, and the
    final verify and test results.
```
