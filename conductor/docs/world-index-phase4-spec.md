# Spec: world index phase 4, melee combat

Expands phase 3 and 3b (`conductor/docs/world-index-phase3-spec.md`, `world-index-phase3b-spec.md`, "as built" in
`conductor/docs/world-index.md`) with a `combat` family for melee: kills as actions, the scripted hit and damage
formulas, gear on the profile, parsed drop tables for gp/hr, and Food/hr gated on a calibration run. The facts, each
cited to its script, are in `conductor/docs/world-index-phase4-survey.md` (the survey, 2026-10-22); a task cites its
section (§1.1 ...) and reads the facts there, not the raw scripts again, unless a fact is missing or looks wrong.

## Decisions (2026-10-22)

From the user:

- **Melee first.** Attack, Strength, Defence, Hitpoints and Prayer (bury) only; Ranged and Magic are a later phase.
- **Parse the drop tables now** for gp/hr (and the herb supply later).
- **Food is blocked until calibrated.** No Food/hr figure is shown, and food trips are not in a floor, until a worker
  run's measured damage per kill agrees with the model (Task 8).
- **No Wilderness combat now.** Green dragons, dragonfire and the conductor's Wilderness opt-in come later, with the
  Prayer leg.

Decided by the conductor (survey §4):

- **Prayers and potions:** optional `Profile.prayers` and `Profile.boosts`, default none; no drain or decay model.
- **Gear:** a method record names its gear (like `food`); a query's `Profile.worn` overrides it. 3b's
  `Profile.worn: string[]` stays a list; each item's slot comes from its obj `wearpos`, and two items in one slot are a
  ProfileError.
- **Cannon, specials and multi-target attacks are out.** Multiway stays a hazard flag.
- **Bones and loot:** a `loot` policy on the record (`bury`, `bank` or `leave` for bones; stackables kept; other
  non-stackables left unless listed). Left products drop out of gp/hr.
- **Aggression** is a hazard field and a `bestMethods({ aggressive })` filter; it adds no modelled damage.
- **Overhead per kill** is geometric: the mean run ticks from a spawn to its nearest other spawn in the area, counted
  only beyond the attack cooldown, plus the death delay.
- **Page columns** keep `profileAt`: every other skill at the column's level (Defence and Hitpoints rise with Attack).
- **NPC AI overrides:** the default melee AI only; a target with an `ai_opplayer2`/`ai_applayer2` override is a
  ModelError naming its script.

## Global rules (apply to every task)

- Phase 3 and 3b's global rules still bind: code in `wiki/world/`, tests in `wiki/world/test/` (`*.real.test.ts` for
  real data), `bun run verify:conductor`, `bun test wiki/world` and `bun test conductor`, determinism, generated files
  committed with their code and never hand-edited, the game is the source of truth.
- **Every formula cites its script** (file:line) and has a test against a value worked by hand from that script, in
  the test's comment. Server constants are read, not hardcoded.
- **Format changes bump `WORLD_FORMAT`** and update `load.ts` and its tests; one bump per task that changes it.
- **Performance budget:** `bun run world` under ~30 s, `world.json` under ~12 MB; report both when a task changes the
  build.
- **Conductor edits** are limited to: `conductor/lib/methods.ts` and `conductor/tools/stats.ts` recording worn gear
  and combat levels (Task 7), the calibration smoke and its tool (Task 8), `method` on promoted plans (Task 9), and
  docs. Anything else in `conductor/` stops and asks.
- Comment density matches the surrounding code. The user's standing rules: members worlds only (`map_members` is
  true); distances in run ticks only, never walking ticks.

## Task 1 — Combat formulas

**Files:** `wiki/world/model/combat.ts` (new), `wiki/world/test/combat.test.ts`.

- Pure functions, each citing its script (survey §1.1-§1.3, §1.6, §1.7): effective level (`level*prayer/100 + 8 +
  style`; NPC `+9`), attack and defence rolls `eff*(bonus+64)`, the exact hit chance (`A>D ? 1-(D+2)/(2(A+1)) :
  A/(2(D+1))`), melee max hit `(eff_str*(bonus+64)+320)/640`, the per-swing damage distribution (0..max uniform on a
  hit, 0 on a miss) capped at remaining HP, E[swings to kill] by DP over remaining HP, expected Hitpoints XP per kill
  with per-hit truncation of 13.3×d, trained-skill XP per kill by style, and combat level (§1.5).
- Integer arithmetic where the scripts truncate.

### Acceptance criteria

- [ ] Hand-worked tests: the survey §2 hill giant rows (p 0.725 max 10, p 0.797 max 10) and E[swings]; a chicken; the
  §1.6 NPC-on-player hill giant row (p 0.36, max 4); combat level for two profiles.

## Task 2 — Game-data readers

**Files:** `wiki/world/model/npcs.ts` or a `sources/` reader (new), `model/items.ts` (equipment), tests.

- NPC combat records: config stats and params with the `combat.param`/`npc_combat.param` defaults (attack, defence,
  strength, hitpoints, bonuses, attackrate, damagetype, huntmode/huntrange/vislevel, respawnrate, death_drop,
  max_dealt, combat_xp_multiplier), and whether the NPC has an AI override script (§1.5).
- Equipment: per-obj bonuses, wearpos, attackrate (default 4), attackrange, category -> style table (`combat.rs2`),
  wield levels from `S/levelrequire/scripts/*.rs2` (§1.10). Bones' `bone_exp` (§1.4).

### Acceptance criteria

- [ ] Tests on chicken, giant, mossgiant (the survey's table), and on the mithril and rune scimitars.

## Task 3 — Profile and gear

**Files:** `model/profile.ts`, `model/method.ts` (only where it builds profiles), tests.

- Gear bonus sums over `Profile.worn` (slot from wearpos; two in one slot is a ProfileError); optional `prayers`
  (attack/strength/defence 105|110|115) and `boosts`; derived `combatLevel`; a wield-level ProfileError.
- `profileAt` and `measuredProfile` carry the gear. Woodcutting and mining keep `axe`/`pickaxe`.

### Acceptance criteria

- [ ] Tests: bonuses for a scimitar plus armour; the slot clash and the wield-level errors; combat level matches Task 1.

## Task 4 — Drop-table parser

**Files:** `wiki/world/sources/droptables.ts` (new), tests.

- Parse `[ai_queue3,<npc>]` scripts (§1.8): fixed `obj_add`, `random(N)` if/else-if chains, `~randomherb`,
  `~randomjewel`, `~roll_on_drop_table` with the `drop_table` dbrows, `map_members` as true, tertiary `trail_*`
  dropped, plus the `death_drop` param. Output: expected count per obj per kill.
- An unsupported shape is a ModelError naming file:line, raised only when a method's NPC needs it.

### Acceptance criteria

- [ ] Tests on giant, moss_giant, chicken and one dbrow-table NPC, each total worked by hand.

## Task 5 — Cycle: loot policy, bury, eat ticks

**Files:** `model/cycle.ts`, `model/family.ts`, tests.

- A `loot` policy: stackables kept; bones `bury` (an in-place step: its tick, the re-click to resume attacking, Prayer
  XP), `bank` or `leave`; other non-stackables left unless listed. Food and kept loot share the inventory; a trip ends
  when food runs out or the inventory fills.
- Eat ticks: each food adds 3 ticks to the attack delay (§1.4, consume.rs2).
- A method whose damage is uncalibrated (Task 8's gate, a flag on the ActionModel or the record) gets no food in its
  cycle: trips end only on a full inventory.

### Acceptance criteria

- [ ] Synthetic cycle tests worked by hand: bury vs leave; food with kept loot; the uncalibrated no-food case.
- [ ] Every existing family's floor is unchanged.

## Task 6 — The combat family (melee)

**Files:** `model/families/combat.ts` (new), `index.ts`, tests.

- One kill of the target NPC as an `ActionModel` (survey §3.1): `ticksPerAttempt` = E[swings] × attackrate +
  overhead; `success` 1; XP by the style the method resolves (Task 7); Hitpoints XP; `products` from Task 4 per the
  loot policy; `deplete {chance 1, respawnTicks}` with the scaled respawnrate plus the death delay; `features` the
  spawns in the area; `damage` from the NPC's default melee AI against the profile's defence.
- A target with an AI override is a ModelError naming the script.

### Acceptance criteria

- [ ] Hand-worked tests on hill giants (two profiles), moss giants and chickens: ticks per kill, XP per kill, damage
  per kill, the respawn cap with one bot.

## Task 7 — Methods, query and world

**Files:** `wiki/world/methods.ts` (types), `model/method.ts`, `wiki/world/query.ts`, `wiki/world/distance.ts` (SINKS `npc`
only), `conductor/lib/methods.ts`, `conductor/tools/stats.ts`, tests.

- `MethodDef` gains `gear`, `params { npc }`, an `area` (radius around `at`) collecting spawns across sites, and
  `loot`.
- Style from the queried skill: Strength aggressive, Attack accurate, Defence defensive, Hitpoints the best of them,
  Prayer for methods that bury; `ResolvedMethod.skill` and `levels` follow (survey §3.4).
- `npc` sites get a nearest bank (SINKS `npc: ['bank']`; world rebuild, format bump).
- Hazard `aggressive` (at the profile's combat level, §1.5) and `maxHit`; `bestMethods({ aggressive })`.
- `stats.ts --methods` and `lib/methods.ts` record worn gear and combat levels in a measured figure.

### Acceptance criteria

- [ ] Tests: style resolution per skill; the aggression filter at two combat levels; npc sites carry `nearest`.

## Task 8 — Damage calibration

**Files:** a smoke test `conductor/test/integration/smoke/combat-calibration.itest.ts` and any tool it needs under
`conductor/tools/`, `wiki/world/methods.ts` (a calibration record), the gate in `model/method.ts`, tests.

- A worker fixture bot (made by the test, at set levels and gear, no food or ample food) fights hill giants and
  records per kill: ticks, HP lost (hitsplats or HP deltas plus food healed) and the kill ledger if the engine writes
  one (§1.5 `NpcOps.ts:96-116`).
- Compare with the model at the same profile. Within 25% on damage per kill and fight ticks per kill (from the
  player's first swing to the kill; the gap between kills is the task's overhead, not the floor's, by the user's
  decision of 2026-10-23 after the first calibration): write the measured
  figures to the method's calibration record, which opens the food gate for that NPC. Outside: investigate the
  survey §7 candidates (armour, NPC swing cadence, retaliation flinch, gaps between kills), fix the model, and re-run;
  never loosen the tolerance.
- If the model still disagrees after one investigation round, leave the gate shut and report the numbers.

### Acceptance criteria

- [ ] The smoke's RESULT lines and the model's figures for the same profile are in the report.
- [ ] The gate is pinned by a unit test: uncalibrated gives no Food/hr, calibrated gives the model's.

## Task 9 — Pages, seeds and docs

**Files:** `wiki/world/methods.ts`, `conductor/plans/*.ts` (`method` only), the regenerated `wiki/training/`
pages, `wiki/world/README.md`, `conductor/docs/world-index.md`, `conductor/roadmap.md`.

- Training pages for Attack, Strength, Defence, Hitpoints and Prayer with a kills/hr column and Food/hr in Supplies
  ("uncalibrated" until Task 8's gate opens; the row notes that its XP/hr leaves out food trips).
- Seeds: `hill-giants-edgeville` (plans hill-giants, giants-att-def), `moss-giants-varrock-sewers`,
  `chickens-lumbridge` (melee); measured figures from survey §1.11 where a run is a whole cycle with known levels.
  `magic-blast-giants` and `ranged-magic-chickens` stay unlinked (Ranged and Magic come later).
- "Phase 4 as built" in `conductor/docs/world-index.md`; the README's Methods section; the roadmap's stale "model
  within ~10%" claim replaced by the built model's figures.

### Acceptance criteria

- [ ] Real-data tests show each floor at or above its measured figure (or the model is fixed); `plans.test.ts` passes.
- [ ] Every doc claim is true of the committed code.

## Out of scope for this spec

- Ranged and Magic; prayer drain and potion decay; cannon, specials, multi-target.
- Green dragons, dragonfire, any Wilderness combat; the conductor's Wilderness opt-in (with the Prayer leg).
- NPC AI overrides other than as a ModelError; damage from other aggressive NPCs in multiway.
- HP regeneration in food cycles.
