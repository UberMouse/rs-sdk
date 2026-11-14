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
- **T3 Catalog description.** the catalog entry tells the conductor what the task does and
  matches the code (no promised mode the code lacks): `description` (what it does, how it ends, what it
  refuses), each param's `.describe()`, `rules` (requirements) and `spots` (known-good places).
- **T4 Ops first.** A step does its game actions with ops from `conductor/actions` (`chop`,
  `interactLoc`, …), and when none exists for an action the task needs, ports one (see T9); raw
  `send` commands only with a stated reason and effect checks (game-semantics G1).
- **T5 No duplication.** Helpers that already exist in `sdk/`, `conductor/lib/` or another task
  are imported, not copied; a helper a second task now needs moves to `conductor/lib/`.
- **T6 Knowledge consistency.** Coordinates, names and requirements match `learnings/` and
  `wiki/skills/`; a fact the code relies on that the knowledge base lacks is flagged for the
  curator.
- **T7 Step shape.** A step is a generator (`*run`, waiting with `yield*`) or, if it only decides,
  a plain `run` returning an `Outcome`; no `await` in it and no `async run` (the types refuse one,
  and the engine ends a run whose step returns a promise as an error). Purity of `when` is robustness R3 and the streak/counter rule
  is R1; do not report them here. Per-run state is declared through the task's `memory` factory;
  casts on `ctx.memory` are code-quality Q1, not reported here. Guards are used as the contract
  intends: `allow` only for a guard the task replaces on purpose (`dialog`, `interface`), and
  `guards: [underAttackGuard]` (or the task's own `TaskGuard`) instead of threat checks in a step.
- **T8 Tests.** A new task, or a changed task whose edit adds a step or rewrites one (its logic
  rewritten, or a new behaviour added to it), has unit tests in `conductor/test/tasks/<name>.test.ts`
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

- **T10 Outcome codes.** A step or guard that ends a run a plan would branch on returns a `code`
  and declares it in `outcomes` (`TaskDef.outcomes`, `TaskGuard.outcomes`); a returned code that is
  not declared ends the run `error`. Every declared code has a sentence on when it happens that is true
  of the code, and a code a plan branches on has one. A plan (or its `when`/`until`) matching reason
  text (`.test`, `includes`, `match`, `startsWith`, a literal `===`) instead of `last.code` is flagged,
  unless an earlier operand of its `&&` chain tests `.code`.

Types, async hygiene, naming, comments and style are the `code-quality` lens.

## Bands

- **A** — the task can't be loaded or run by `run-task.ts` (name mismatch, broken params
  schema).
- **B** — engine behaviour re-implemented in a way that fights it (its own watchdog, swallowing
  the death interrupt); a description that promises what the code doesn't do; duplicated logic
  whose copies already differ; a T7 `await` in a step; a
  T8 missing unit test (where T8 asks for one), missing smoke (any changed task) or missing op test; a T9 op
  that handles threats or dialogs itself; a T10 plan matching reason text, or a code returned and not declared.
- **C** — hard-coding that only matters for future spots; a raw `send` where an op exists
  but the effect is checked; naming.
- **D** — style preferences with no effect on the conductor or on maintenance.
