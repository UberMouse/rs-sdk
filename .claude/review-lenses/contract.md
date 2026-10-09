# Lens: task contract and reuse

Does the task fit the catalog the conductor plans with, and reuse what exists?

## Criteria

- **T1 Contract.** `defineTask` with `name` equal to the filename; params are a `zod/v4` object
  with sensible defaults; steps return `void | { done } | { fail }`; nothing re-implements what
  the engine already does (the shared guards for death, the Wilderness, low HP, dialogs and
  leftover modals; stop conditions; the watchdog; screenshots; the RESULT line).
- **T2 Params over hard-coding.** Locations, targets and "what to do when full" are params when
  the task makes sense in more than one place; defaults are the verified spot from the knowledge
  base. Magic numbers that encode game facts are named.
- **T3 Catalog description.** `description` tells the conductor what the task does, its
  requirements, and known-good spots, and matches the code (no promised mode the code lacks).
- **T4 Ops first.** A step in scope of the legacy scope rule (`common.md`) does its game actions
  with ops from `conductor/actions` (`chop`, `interactLoc`, …), and when none exists for an action the task
  needs, ports one (see T9) rather than calling `ctx.bot.*` or raw `ctx.sdk.send*`. `yield*
  call('bot.x', …)` is a stopgap for one action not being ported now, labelled with the method,
  not a second way to write steps; raw sends only with a stated reason and effect checks
  (game-semantics G1). Legacy steps outside that scope may keep using `ctx.bot.*` porcelain.
- **T5 No duplication.** Helpers that already exist in `sdk/`, `conductor/lib/` or another task
  are imported, not copied; a helper a second task now needs moves to `conductor/lib/`.
- **T6 Knowledge consistency.** Coordinates, names and requirements match `learnings/` and
  `wiki/skills/`; a fact the code relies on that the knowledge base lacks is flagged for the
  curator.
- **T7 Step shape.** A step in scope of the legacy scope rule (`common.md`) is a generator
  (`*run`, waiting with `yield*`) or, if it only decides, a plain `run` returning an `Outcome`; no
  `await` in it and no `async run`. Purity of `when` is robustness R3 and the streak/counter rule
  is R1; do not report them here. Per-run state is declared through the task's `memory` factory;
  casts on `ctx.memory` are code-quality Q1, not reported here. Guards are used as the contract
  intends: `allow` only for a guard the task replaces on purpose (`dialog`, `interface`), and
  `guards: [underAttackGuard]` (or the task's own `TaskGuard`) instead of threat checks in a step.
- **T8 Tests.** A new task, or a changed task whose edit is a port, new step or substantial
  rewrite (`common.md`), has unit tests in `conductor/test/tasks/<name>.test.ts`
  that use `simulate` and `world()` builders: the success path, every failure reason with its
  exact text, each streak or limit, preflight refusals, and the guards that matter to the task
  (low HP mid-step, a dialog or modal, being attacked).
  Any changed task also has an integration smoke in
  `conductor/test/integration/smoke/<name>.itest.ts`, on ground no other itest uses. A new or
  changed op has `conductor/test/actions/<op>.test.ts` and `integration/actions/<op>.itest.ts`.
  Flag tests that only restate the code, or that would pass on the pre-change code.
- **T9 Op layering.** An op in `conductor/actions` starts with `// Ported from sdk/actions.ts
  <method> @ <sha>` (or, with no upstream method, `// Not ported: sdk/actions.ts has no <thing>
  method; closest upstream is <method> @ <sha>.`) and a paragraph on how it differs from upstream; returns a tagged union (no
  throws for game outcomes); takes `ActionContext` first only if it reads state; waits only for
  its own effect, as a tick budget (`Math.ceil(ms / TICK_MS)` for a ported wall-clock wait),
  deciding from the wait's `state`; and has no threat, HP, dialog or interface handling, which
  belongs to the guards (save a dialog or interface the op opens and answers itself as explicit
  steps, like `fletch`'s make menu or `smith`'s anvil interface in `OP_OWNED_INTERFACES`).

Types, async hygiene, naming, comments and style are the `code-quality` lens.

## Bands

- **A** — the task can't be loaded or run by `run-task.ts` (name mismatch, broken params
  schema).
- **B** — engine behaviour re-implemented in a way that fights it (its own watchdog, swallowing
  the death interrupt); a description that promises what the code doesn't do; duplicated logic
  whose copies already differ; a T7 `await` in a step in scope; a
  T8 missing unit test (in scope), missing smoke (any changed task) or missing op test; a T9 op
  that handles threats or dialogs itself.
- **C** — hard-coding that only matters for future spots; a raw `send*` where an op exists
  but the effect is checked; naming.
- **D** — style preferences with no effect on the conductor or on maintenance.
