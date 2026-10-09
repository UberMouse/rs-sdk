# Lens: game semantics

Does the code's model of the game match how the game and the SDK actually behave?

## Criteria

- **G1 Dispatch is not effect.** A `sdk.send*` success (or an `ActionResult` with phase
  `dispatch`) only means the client wrote a packet. Every action whose outcome matters is
  followed by a wait on an observed effect — XP, inventory, position, dialog, message, or
  `state.opFeedback.opRejectedCount` — not by a fixed sleep or by trusting the result.
- **G2 Targets match exactly what is meant.** Name patterns are anchored and specific
  (`/^tree$/i`, not `/tree/i`, which matches "Tree stump"); locs that have inert duplicates are
  filtered by option (`withOption`); item patterns can't match items that must be kept
  (`/logs$/` vs a "Logs" quest item; `/axe$/` vs "pickaxe").
- **G3 Reachability.** Targets are found with `{ reachable: true }` or the code handles an
  unreachable target (gates, doors, fences, other floors); "I can't reach that" and
  `cant_reach` results are handled, not retried blindly.
- **G4 Modals and dialogs.** Inventory, equipment and interaction packets are not sent while a
  bank, shop or other modal is open (the server drops them silently). Skill dialogs are driven by
  option text (`clickDialogByText`, `bot.fletchLogs(...)`), never by assumed option order. A task
  that opens a dialog on purpose sets `ctx.memory.expectDialog` so the interrupt doesn't close it.
- **G5 Game time.** Waits are in ticks (`waitForTicks`, `waitForCondition`) and sized to the
  action (a tree can take many ticks; a respawn longer). Timeouts exist and are not so short that
  slow-but-normal actions fail.
- **G6 State freshness.** Decisions read `ctx.state()` after the previous action settled, not a
  snapshot taken before an `await`; positions use `worldX/worldZ` and check `level` (floor) where
  floors matter.
- **G7 Requirements are the game's.** Level, item, quest and membership requirements claimed in
  preflight, params or description match the game data (`wiki/`, `learnings/`), not guesses.

## Bands

- **A** — a G1–G4 error you traced to a normal-run path: the step reports success without the
  effect, targets the wrong thing (drops the axe, chops a stump forever), or sends into a modal
  so every action silently fails.
- **B** — the wrong model bites on a common-but-not-every-run path (a door that is sometimes
  closed, a dialog that appears on level-up), or a timeout that a normal action exceeds.
- **C** — correct today because of the spot or params used, wrong in a spot the params allow;
  a requirement that is stated imprecisely but not wrongly.
- **D** — relies on game behaviour you could not confirm either way.
