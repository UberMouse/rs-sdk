# Lens: robustness

Does every run end, end for the right reason, and say why?

## Criteria

- **R1 Bounded failure.** Every step that can fail repeatedly counts failures in `ctx.memory`,
  resets the count on success, and returns `{ fail }` past a small limit with the last failure's
  message in the reason. No step can loop forever without the watchdog being the only thing that
  ends it.
- **R2 Progress or fail.** A step that runs but changes nothing (no XP, position or inventory)
  is either waiting for something specific with a bound, or failing. Steps don't spin on
  conditions that cannot change.
- **R3 Step selection.** `when()` predicates are ordered so the first match is right: urgent
  states (full inventory, out of area, low HP) come before the grinding step; no step's `when` is
  always true unless it is last; two steps can't keep handing control back and forth.
- **R4 Preflight.** Missing requirements (tools, levels, items, being in the right region) are
  refused in `preflight` with a clear reason, not discovered as a mid-run failure.
- **R5 Recoverable interruptions.** The task survives what normally happens: a level-up dialog,
  a random event NPC, another player taking the resource, a respawn delay, the bot being
  attacked, a door closing behind it.
- **R6 Honest outcomes.** `{ done }` is returned only when the objective is met; failure reasons
  name the cause and the evidence (what was tried, what came back), so the conductor can tell a
  world problem from a script problem.
- **R7 Exceptions.** No `throw` for expected game outcomes; awaited promises can't reject
  unhandled; `ctx.state()` is not called where state may be absent without handling it.

## Bands

- **A** — a normal run ends in `stuck` or loops forever (watchdog or step timeout is the only
  exit), or ends `done` without meeting the objective.
- **B** — a common interruption (R5) or requirement (R4) ends the run with a misleading reason
  or after wasting most of it; an R1 counter that never resets, so long runs fail spuriously.
- **C** — an R6 reason that is vague but not wrong; a bound much larger than needed.
- **D** — an interruption you could not show happens in the task's spots.
