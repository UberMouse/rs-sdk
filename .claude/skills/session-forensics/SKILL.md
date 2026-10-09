---
name: session-forensics
description: Analyse Claude Code transcripts - the conductor's session plus every subagent it dispatched - to answer how the runs actually went - where tokens and wall time went, what agents had to rediscover, which tool or harness failures recur, and which load-bearing conclusions (knowledge-base facts, diagnoses) were wrong. Used by the retrospective agent over the runs since the last retro; also for a one-off post-mortem ("why did that conductor session stall", "token spend this week").
---

# Session forensics

Ported from kawaka's `session-forensics` (scripts unchanged; procedure trimmed to rs-sdk).
Every claim in the output carries **transcript coordinates**: file, turn number, verbatim
quote.

The question is a parameter ("where did the last 10 runs' tokens go", "why does the curator
keep re-adding that fact"); the procedure is the same; only the lenses change.

## Why tooling rather than reading

A conductor transcript is megabytes, and its subagents add more; ~95% is tool payloads (file
contents, command output, diffs). Reading it raw exhausts the context window before analysis
starts, and an agent that skims hallucinates the parts it skipped. `scripts/transcript.py` gets
you to the ~5% that carries signal. Name it by its literal path from the repo root: a
worktree-isolated session refuses `python3 "$T" …`.

```
T=.claude/skills/session-forensics/scripts/transcript.py   # for reading only; type the path in commands
```

## 0. Find the sessions

Over a window, across every project, one JSONL row per transcript that billed tokens:

```bash
python3 -I .claude/skills/session-forensics/scripts/transcript.py corpus --since 2026-10-09 --out "$CLAUDE_JOB_DIR/tmp/corpus.jsonl"
```

Rows carry `kind` (`main` / `subagent` / `workflow`), absolute `file`, `session` (the join key:
a worktree session's main and subagent transcripts sit under different project dirs but share
it), `agentType` / `description`, the first `prompt`, `models`, and `usage` (deduped by message
id). Keep only this repo's: project dirs are the absolute path with every non-alphanumeric
character replaced by `-`, and worktree sessions extend the main checkout's prefix:

```bash
jq -c 'select(.file | contains("/-home-taylorl-code-rs-sdk"))' "$CLAUDE_JOB_DIR/tmp/corpus.jsonl"
```

`--summary` prints a month × kind token table instead. Hand analysts the `file` paths from
these rows; never reconstruct a path from an agent id.

## 1. Snapshot one session

A live session keeps appending, so freeze it before reading:

```bash
python3 -I .claude/skills/session-forensics/scripts/transcript.py snapshot <main transcript .jsonl> "$CLAUDE_JOB_DIR/tmp/snap"
```

It copies the main transcript, every `subagents/agent-*.jsonl` and its `.meta.json`
(`agentType`, `description`), task outputs, and `tool-results/` (large results the transcript
only previews — without them `grep`/`turn` see a 2KB stub).

## 2. Orient

```bash
python3 -I .claude/skills/session-forensics/scripts/transcript.py index    "$CLAUDE_JOB_DIR/tmp/snap/main.jsonl" "$CLAUDE_JOB_DIR/tmp/snap/subagents"   # one row per transcript
python3 -I .claude/skills/session-forensics/scripts/transcript.py stats    <transcript>       # wall time, tokens, tool mix
python3 -I .claude/skills/session-forensics/scripts/transcript.py friction <transcript>       # heuristic signals; --signals lists the kinds
```

Outliers in `index` (3× the turns of siblings of the same `agentType`, 10× the failures) are
where the story is. A friction text under several different agent ids is systemic; once is
usually noise.

## 3. Drill down

Search the raw `.jsonl` (covers tool inputs, results, assistant text and thinking), then read
the turns in full:

```bash
python3 -I .claude/skills/session-forensics/scripts/transcript.py grep <transcript> 'cant_reach' -i    # -> turn numbers
python3 -I .claude/skills/session-forensics/scripts/transcript.py turn <transcript> 312 --to 318      # -> untruncated
python3 -I .claude/skills/session-forensics/scripts/transcript.py render <transcript> --thinking --truncate 1200 --out "$CLAUDE_JOB_DIR/tmp/digest/<name>" --chunk 60
```

`writes <snapdir> --list` shows every file the agents wrote, chronologically — useful when
several task-authors reinvented the same helper. Turn numbers are stable per file, so a finding
can cite `agent-<id>.jsonl turn 314` and a verifier can go straight there.

Answer narrow questions with `grep` → `turn` alone; render and read chunks only when you don't
yet know what you are looking for.

## 4. Lenses for the conductor system

Narrow, non-overlapping, each answerable from transcripts. Pick those the question needs;
always keep `contradiction`.

| Lens | Asks |
|---|---|
| `waste` | where tokens and wall time went (per `agentType`), and which dispatches did nothing useful |
| `rediscovery` | facts agents worked out that the knowledge base or an agent prompt should have told them |
| `friction` | tool, harness and SDK failures that recur (failed-tool, denied, masked-failure, missing-tool) and the fix |
| `orchestration` | dispatch briefs missing what the agent needed, duplicated work, conductor invariants broken |
| `contradiction` | **adversarial**: are load-bearing conclusions true? Knowledge-base facts the curator wrote, runner diagnoses, review verdicts — check each against later runs and the game data |

Every finding needs evidence `{transcript, turn, quote}` and a concrete artifact to change: a
knowledge page, an agent prompt in `.claude/agents/`, a task, a tool, a skill. Then **check it
against the repo** before reporting: is it already written down (the knowledge base, `CLAUDE.md`,
the agent prompts, a skill)? An agent that did not read the page that says it is a different
finding from a missing page.

## Reading the numbers honestly

- `turns` counts assistant **and** user records; tool results are user records, so turns run
  ~3× the assistant messages. Compare agents with each other, not with an absolute.
- `wall_seconds` is first-to-last timestamp: real duration for a subagent; for the conductor it
  includes waiting on children.
- `usage` is deduped per API message id. A hand-rolled sum over raw records over-counts 3–5×.
  `cache_read_input_tokens` mostly measures turn count, not distinct material read.

## Known friction

- **Worktree-isolation guard**: Bash refuses commands whose program or target it cannot resolve
  statically (`python3 "$VAR"`, `git` inside `$(…)` or loops, a heredoc driver written and run in
  one call). Spell paths literally; write drivers with the Write tool and run them by path.
- **Crashes behind a pipe**: `cmd 2>&1 | tail` exits 0 whatever `cmd` did. `friction` reports
  these as `masked-failure`; treat them as seriously as `failed-tool`.
- **`pkill -f` matching its own shell**: a pattern that also appears later in the same command
  line (e.g. in a `nohup … <pattern>` relaunch) kills the calling shell (exit 144). Anchor the
  pattern (`^bun conductor/tools/client\.ts`) or kill by PID.

`scripts/verify-transcript.py` is the scripts' self-test (`python3 -I` it after editing
`transcript.py`).
