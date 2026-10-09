# Lens: code quality

Is this well-written TypeScript that the next author can read, trust and change? Game behaviour
belongs to the other lenses; this one judges the code as code.

## Criteria

- **Q1 Types.** `bunx tsc --noEmit -p .` is clean for `conductor/`. No `any`, `as`, or `!`
  hiding a value that can be absent or the wrong shape at runtime (SDK state fields marked
  optional, `find` results, `ctx.memory` reads). Params types come from the zod schema
  (`z.infer`), not a hand-written copy. Unions over loose strings where the set is closed.
- **Q2 Async hygiene.** Every promise is awaited or deliberately handled: no floating
  `ctx.bot.*` / `ctx.sdk.*` calls, no `async` callbacks in `forEach`, timers from
  `setTimeout`/`Promise.race` cleared, nothing left running after the step returns.
  (Throwing for expected game outcomes is robustness R7, not this.)
- **Q3 Simplicity.** No dead code, unreachable branches or unused params/imports; no
  over-nesting a guard clause would flatten; standard array methods over manual index loops
  where they read better; game numbers (levels, coordinates, ids, limits) are named constants
  or params, not bare literals repeated across steps; no repeated work a local variable
  would hold (several `ctx.state()` scans for the same thing in one step).
- **Q4 Naming and shape.** Names say what a thing is in game terms (`logsInInventory`, not
  `n`); step names describe the state they handle; a step's `run` does one job, and logic two
  steps share is a helper in the task file (or `conductor/lib/` once a second task needs it).
- **Q5 Comments.** A comment explains **why** — the game behaviour, constraint or failure it
  guards against — and stands alone for a reader with only this file. Flag: comments that
  restate the code; references to the session, plan, review or a finding id; narration of the
  change ("now", "used to", "temporarily"); comments made wrong by the change, including
  existing ones above modified code; comments that survive the halving test (half as long,
  nothing a reader can act on lost) — give the shortened text.
- **Q6 Consistency.** Matches the surrounding code in `conductor/` and `sdk/`: 4-space indent,
  single quotes, semicolons, relative imports, `zod/v4`, the reference task's layout
  (constants, params schema, `defineTask` with preflight then steps). Comment density like the
  neighbours'.
- **Q7 Logging.** `ctx.log` for events the conductor or a runner will want in the NDJSON log
  (a failure with its message, a decision), not once per loop iteration. No stray
  `console.log`. Temporary debug logging carries one greppable tag (e.g. `[dbg:woodcutting]`)
  so it can be found and removed, and doesn't ship in a committed task.

## Bands

- **A** — a Q1 cast or `!` hiding a value you confirmed is absent on a normal path, or a Q2
  floating promise whose rejection goes unhandled or whose effect lands after the step
  returned (interleaving with the next step's actions).
- **B** — a Q1 hole on SDK data that can be absent (not yet seen absent); a Q2 promise or
  timer leak with no observed effect; a Q5 comment that is now wrong; duplicated logic within
  the change whose copies can drift; Q7 per-loop log spam or debug logging left in.
- **C** — Q3/Q4/Q6 clarity issues; Q5 trivial, narrating or over-long comments; magic numbers.
- **D** — style preferences the surrounding code doesn't follow either.
