# Review: shared rules

Every lens reviewer and the verifier read this file, then their lens file. The lens files are
the single source of truth for what the review checks; agents apply them, not their memory of
what a review "usually" asks.

## What is under review

Bot task code: `conductor/tasks/*.ts` and anything under `conductor/lib/` the change touches.
The contract is `conductor/lib/task.ts`; the loop that runs it is `conductor/lib/engine.ts`
(shared interrupts for death and dialogs, `--until` stop conditions, the progress watchdog,
step timeouts, auto-screenshots, the RESULT line). The SDK it drives is `sdk/actions.ts`
(`ctx.bot.*`) and `sdk/index.ts` (`ctx.sdk.*`); `CLAUDE.md` and `sdk/API.md` describe them.

## How to review

- Read every changed file in full, then the code it calls (the SDK methods, `conductor/lib`)
  and the reference task `conductor/tasks/woodcutting.ts`. Never judge from the diff alone.
- Walk your lens **item by item**: every numbered criterion is a separate check against every
  changed step, preflight and helper.
- The game is not buggy. When code assumes the game misbehaves, the assumption is the suspect.
- Use the evidence the run left: the author's smoke-test RESULT lines, and the NDJSON logs and
  screenshots under `conductor/runs/<bot>/` that they name.
- Report what is wrong with the code as written. Uncertain-but-plausible findings are welcome:
  the verifier demotes rather than deletes them.

## Bands

Each lens defines what A–D mean for it. Across lenses they mean, roughly:

- **A** — confirmed on a path a normal run reaches: crash, endless loop, death or item loss,
  or a RESULT that claims something that did not happen.
- **B** — reachable and costly: ends runs early, wastes most of a run, breaks the task
  contract, or leaves a failure unbounded.
- **C** — latent (no current path reaches it), or a quality issue with no runtime effect.
- **D** — speculative: needs an input or game state you could not show is possible.

Fixes are applied for A and B. C goes to the backlog. D is dropped.

## Finding format

Return JSON only:

```json
{ "lens": "<lens name>",
  "checked": ["<each criterion id you ran, e.g. G1..G7>"],
  "findings": [
    { "file": "conductor/tasks/x.ts", "line": 42, "criterion": "G3",
      "band": "A|B|C|D",
      "summary": "<one sentence: what is wrong>",
      "evidence": "<what you read or saw that shows it: code path, SDK behaviour, log line, screenshot>",
      "suggestion": "<the fix, concretely>" } ] }
```

An empty `findings` with the full `checked` list is a clean review.
