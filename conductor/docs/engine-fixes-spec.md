# Spec: engine fixes for the combat legs

Expands the two open blockers a survey of `main` at 3be5b410a found for the conductor's combat legs: a
`--until` stop that lands mid-fight leaves the bot fighting with no controller, and the walker has no way into
the Varrock Sewers moss giant room (logged as "No path to (3158, 9895) from (3151, 9894)"). Flee-with-no-food
(4882c35a3) and the Gnome course exit (c3bfcdfc5) are already on `main`; only their roadmap entries are stale.

## Global rules (apply to every task)

- `conductor/` and `wiki/world/` code is formatted and linted (oxfmt, oxlint, warnings denied); finish with
  `bun run verify:conductor` and `bun test conductor` (and `bun test wiki/world` when `wiki/world/` changes).
- Unit tests in `conductor/test/**/*.test.ts` on scripted worlds (`test/simulate.ts`, `test/world.ts`,
  `test/engine/harness.ts`); smoke tests in `conductor/test/integration/smoke/*.itest.ts`
  (`bun run test:integration <filter>`, the shared local stack on `:8888`/`:7780`; never start or restart it,
  report if it is down). Integration tests make their own fixture bots; never drive a conductor bot.
- Contracts that must keep working: the `run-task.ts` CLI and its last line `RESULT <json>`; `TaskResult`'s
  fields; a run's recording replays (`test/integration/replay/`).
- No `Date.now()` in game logic; waits are in ticks.
- Game knowledge goes in `learnings/` or `wiki/skills/` per the `knowledge` skill, not in code comments.
- Generated files (`wiki/world.json`, `wiki/places/`, `wiki/resources/`, `wiki/services/`, `wiki/training/`) are
  regenerated with `bun run world` and committed with their source, never hand-edited.
- Comment density matches the surrounding code.
- The user's standing rules: members worlds only; distances and route costs in run ticks only, never walking
  ticks.

## Task 1 — planeOf names the Varrock Sewers

**Files:** `conductor/lib/connectors.ts` (`UNDERGROUND_AREAS`, `planeOf`), `conductor/test/lib/connectors.test.ts`.

- Add an optional `level` to an `UNDERGROUND_AREAS` box and check it in `planeOf`; a box with no `level`
  matches every level, as today.
- Add `{ id: 'varrock-sewers', level: 0, minX: 3152, maxX: 3295, minZ: 9840, maxZ: 9919 }` **before**
  `edgeville` (first match wins). The Edgeville Dungeon has no tile at x >= 3152; the moss giant room
  (x 3153..3221, z 9874..9908) is a pocket of the sewers whose only opening is the web at (3210,9898).
- With the box in place the north ladder pair (3230,3504) <-> (3229,9904) stops being left out ("into an
  underground area planeOf does not name"); the level-2 trapdoor (3242,3505) -> (3241,9905) stays out.

### Acceptance criteria

- [ ] `planeOf(0,3158,9895)` and `planeOf(0,3236,9858)` are `0u-varrock-sewers`; `planeOf(0,3151,9894)` is
  `0u-edgeville`; `planeOf(2,3241,9905)` is unchanged (`2u`); a test pins each.
- [ ] `CONNECTORS` has the north ladder pair and `LEFT_OUT` no longer lists it; the existing walkable-stand and
  way-back checks pass.
- [ ] Out of scope: the manhole (Task 2).

## Task 2 — Manhole connectors

**Files:** `conductor/lib/connectors.ts` (`CLIMB_OP`, `leftOut`), `conductor/actions/climb.ts` (`OPTIONS`,
`findClosed` or its equivalent), `conductor/test/lib/connectors.test.ts`, `conductor/test/actions/climb.test.ts`.

- The Varrock manhole (3237,3458) is a two-op connector: a closed `Manhole` shows `Open`, the open one shows
  `Climb down` with a space (`server/content/scripts/general_use/configs/manholes.loc:5,12`,
  `general_use/scripts/manholes.rs2:1-10`; the world row carries `thenOp {op:1, opName:"Climb down"}`).
- Accept `Climb down`/`Climb up` with a space as well as a hyphen, in both `CLIMB_OP` and `climb`'s option match.
- Let a Manhole be opened like a trapdoor: `leftOut` and `climb` accept `/trapdoor|manhole/i` on the feature and
  the loc name. A closed manhole is re-opened the same way.
- Optional: an `OVERRIDES` name for the manhole ("Varrock Sewers manhole").

### Acceptance criteria

- [ ] `CONNECTORS` has the Manhole (3237,3458) down and its ladder (3237,9858) up; neither is in `LEFT_OUT`.
- [ ] A `climb.test.ts` case: on a closed Manhole showing only `Open`, the op sends Open, waits for `Climb down`,
  sends it, and returns ok on reaching the sewers plane; an open manhole is climbed directly.
- [ ] Trapdoor handling is unchanged (its existing tests pass).

## Task 3 — Walking into the sewers

**Files:** `conductor/test/lib/walk-graph.test.ts` (or `connectors.test.ts`), `conductor/test/actions/walk-planes.test.ts`,
a smoke test `conductor/test/integration/smoke/walk-varrock-sewers.itest.ts` (or a case in `travel.itest.ts`).
Code changes only if the tests show a gap Tasks 1-2 left.

- Real-data planning (60 s timeout, like the existing real-world tests): `planConnectors` from (3151,9894) to
  (3158,9895) is [Edgeville Dungeon trapdoor (up), Manhole]; from Varrock East bank to (3165,9879) it is
  [Manhole]. The survey's probe found 130 run ticks from Varrock East bank and 210 from Edgeville bank; pin the
  hops, not the tick counts.
- `walk-planes.test.ts`: a walk whose start and destination differ only by the new box plans a climb rather than
  falling back to `walkOnPlane`.
- Smoke: `travel` from Varrock East bank to (3158,9895), tolerance 6, with a slash weapon (a scimitar) wielded;
  assert it arrives and the log shows the manhole climbed down and the web slashed. The fixture bot is made by
  the test (the library has no such save).

### Acceptance criteria

- [ ] The planning tests and the walk-planes case pass and pin the hops above.
- [ ] The smoke passes on the local stack; its RESULT line is in the report.
- [ ] Out of scope: making the world fill know a web needs a blade (`wiki/world/collision.ts:75-81`).

## Task 4 — World index labels and knowledge

**Files:** `wiki/world/areas.ts` (the `edgeville-dungeon` and `varrock-sewers` rects only), the regenerated world
outputs, `wiki/skills/attack.md`, `conductor/roadmap.md`.

- `areas.ts`: `edgeville-dungeon`'s rect ends at x 3151 and `varrock-sewers` starts at x 3152 (z 9840..9919; keep
  the Edgeville rect for its other z rows if a split is needed), so the moss giants are listed under the Varrock
  Sewers. `bun run world`; commit the regenerated pages with the source.
- `wiki/skills/attack.md`: the moss giants are reached from Varrock East bank through the manhole, with a slash
  weapon wielded for the web; mark the existing x 3152 wall fact verified once Task 3's smoke passed.
- `conductor/roadmap.md`: fix the moss giant location ("east Edgeville Dungeon") in "Now" and "Max route"; mark the
  Backlog "Flee with no food" entry done (4882c35a3).

### Acceptance criteria

- [ ] `bun run verify:conductor` reports the world fresh; `wiki/places/varrock-sewers.md` lists the moss giants.
- [ ] Every edited knowledge fact carries its provenance per the `knowledge` skill.
- [ ] Out of scope: other area rects (another session owns `EXPECTED_UNREACHED` in `areas.ts`; touch only the two
  rects).

## Task 5 — The engine settles a fight before ending done

**Files:** `conductor/lib/engine.ts` (`finish`, `executeTask`, `checkRun`; nothing else), `conductor/test/engine/engine.test.ts`.

- Today a stop ends the run on the tick it fires (`engine.ts:493-503`, checked in `checkRun` on every wait tick),
  and `finish` only eats (`:332-344`), leaving the bot fighting on auto-retaliate with no controller; the next run
  is refused at `:413-414`.
- In `finish`, for `status === 'done'` only, when `isAttacked(state)` holds: run a **settle op** under the run's
  enabled shared guards (death, wilderness unless allowed, low-hp eating, dialog, interface; not task guards),
  waiting `wait('settle fight', s => !isAttacked(s), SETTLE_TICKS)` with no `onTick` stops (so the stop cannot fire
  again) and `TickStall` kept. The engine sends nothing; the server keeps the bot's attack going and
  auto-retaliate answers any other attacker.
- `SETTLE_TICKS = 100` (60 s): one moss giant kill models at about 68 ticks, so ~30 s would often cut it short.
- The result keeps the stop's reason with a suffix: `; fight settled in N ticks` or `; still in combat after 100
  ticks`. A guard that fails during the settle (death, low HP with no food under fire) makes the result `failed`
  with the guard's reason appended.
- `failed`, `stuck` and `error` endings are not settled. The start refusal at `:413` stays as it is.

### Acceptance criteria

- [ ] Engine tests (`describe('a stop in a fight')`): a `minutes:` stop while attacked ends `done` at the first tick
  not attacked, with no step send after the stop and `result.inCombat` false; a fight longer than
  `SETTLE_TICKS` ends at the cap, `done`, with the "still in combat" suffix; low HP during the settle with food
  eats; with no food under fire ends `failed` with the low-hp reason; a stop with no attacker (stale `inCombat`,
  last hit long ago) ends on its tick as today; an `externalStop` mid-fight is settled the same way; a `failed`
  run mid-fight is not settled.
- [ ] `test/integration/replay/` passes unchanged.

## Task 6 — Plans rely on the engine's settle

**Files:** `conductor/lib/plan.ts` (the `until` check around `:612-623` only), `conductor/test/lib/plan.test.ts`
(`:419-452`), `conductor/test/integration/smoke/combat.itest.ts`, `conductor/docs/plans.md` (one line),
`conductor/roadmap.md` (the combat "Review follow-ups" bullet).

- Delete the raw `player.combat.inCombat` hold on a phase's or the plan's `until` (`plan.ts:622-623`): it has no
  bound and reads a flag that stays true ~20 ticks after a kill. A holding `until` now returns its reason at once
  and the engine settles the fight (Task 5), bounded and on `isAttacked`.
- `plans.md`: one line that a stop or `until` landing in a fight ends after the fight settles (at most 100 ticks).
- Close the roadmap's combat follow-up bullet.

### Acceptance criteria

- [ ] `plan.test.ts`: "a phase's until ... waits for the fight to end" and "the plan's until waits out a fight
  too" still stop at tick 9, now through the engine (their `fight` series sets `lastDamageTick` so `isAttacked`
  holds); "the plan's stops do not wait for a fight" becomes "the plan's stops wait out a fight" (stops at tick 9
  with `inCombat: false`); a new case for a fight longer than the cap.
- [ ] Smoke `combat.itest.ts`: a `combat` run with a stop that lands mid-fight (e.g. `xp:<skill>:1` on a target
  taking several hits) ends with `result.inCombat === false` and `durationMs` past the stop; a second run started
  at once is not refused "in combat". Its RESULT lines are in the report.

## Out of scope for this spec

- A Wilderness opt-in for `combat` (green dragons for Prayer): with the Prayer leg, after a safety review.
- The world fill knowing a web needs a blade.
- Deleting the orphan branches `worktree-agent-af5fd966a23050bf7` and `worktree-agent-ac795ec0b2e903e3a` (the user
  decides).
- Any other roadmap follow-up.

**Assumption:** `SETTLE_TICKS` is 100 (60 s); a `minutes:` stop may end up to 60 s late, which beats a refused
next run and an unattended fight.
