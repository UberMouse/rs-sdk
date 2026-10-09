# Lens: task contract and reuse

Does the task fit the catalog the conductor plans with, and reuse what exists?

## Criteria

- **T1 Contract.** `defineTask` with `name` equal to the filename; params are a `zod/v4` object
  with sensible defaults; steps return `void | { done } | { fail }`; nothing re-implements what
  the engine already does (death/dialog interrupts, stop conditions, the watchdog, screenshots,
  the RESULT line).
- **T2 Params over hard-coding.** Locations, targets and "what to do when full" are params when
  the task makes sense in more than one place; defaults are the verified spot from the knowledge
  base. Magic numbers that encode game facts are named.
- **T3 Catalog description.** `description` tells the conductor what the task does, its
  requirements, and known-good spots, and matches the code (no promised mode the code lacks).
- **T4 Porcelain first.** `ctx.bot.*` is used where a method exists (`chopTree`, `walkTo`,
  `openBank`, `depositItem`, `dropItem`, …); raw `ctx.sdk.send*` only with a stated reason and
  with effect checks (game-semantics G1).
- **T5 No duplication.** Helpers that already exist in `sdk/`, `conductor/lib/` or another task
  are imported, not copied; a helper a second task now needs moves to `conductor/lib/`.
- **T6 Knowledge consistency.** Coordinates, names and requirements match `learnings/` and
  `wiki/skills/`; a fact the code relies on that the knowledge base lacks is flagged for the
  curator.

Types, async hygiene, naming, comments and style are the `code-quality` lens.

## Bands

- **A** — the task can't be loaded or run by `run-task.ts` (name mismatch, broken params
  schema).
- **B** — engine behaviour re-implemented in a way that fights it (its own watchdog, swallowing
  the death interrupt); a description that promises what the code doesn't do; duplicated logic
  whose copies already differ.
- **C** — hard-coding that only matters for future spots; a raw `send*` where porcelain exists
  but the effect is checked; naming.
- **D** — style preferences with no effect on the conductor or on maintenance.
