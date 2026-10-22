# Spec: world index phase 3b, the processing families

Expands phase 3 (`conductor/docs/world-index-phase3-spec.md`, "Phase 3 as built" in `conductor/docs/world-index.md`)
with the families the conductor's next legs need: superheat, smelting, anvil smithing, spinning, fletching,
firemaking, runecraft, flax picking and the agility courses, on a cycle that chains process steps. The facts, each
cited to its script, are in `conductor/docs/world-index-phase3b-survey.md` (the survey, 2026-10-22); a task cites its
section (§1a ...) and reads the facts there, not the raw scripts again, unless a fact is missing or looks wrong.

## Decisions (2026-10-22)

From the user's standing steer for phase 3 ("the important thing is the framework for calculating and displaying
them, then keeping it updated as we discover new methods"; "XP/hr, plus gp/hr where natural"; a tick-perfect floor),
decided by the conductor:

- **A one-time setup at the start of a plan** (a travel to the site, a bank visit, wielding a tool) does not stop
  the plan naming its method when every later phase is the method's cycle. `stats.ts --methods` counts the whole run,
  so a short run under-reads; the README says so, and goal-length runs dilute it.
- **Agility courses:** Gnome, Barbarian and Wilderness (the three in `conductor/actions/course.ts` `COURSES`).
- **Runecraft:** the family takes any talisman altar from data; only the earth altar method is seeded.
- **No plan is retired.** Plans that do more than one cycle stay unnamed (survey §5).
- **The Wilderness lap floor leaves out the ridge gates** the agility task crosses each lap: the floor is the
  tick-perfect lap; the gates are a lever the page shows as a gap.
- **Random landings and teleports are priced for method legs only** (the mean landing walk; the Aubury teleport at
  its script delay). `distance.ts` and the nearest-bank figures on every other page are unchanged (another session
  just rewrote it); a whole-index fix is a follow-up.
- **Firemaking line resets are left out** (a looser floor), noted on the page.
- **Worn items go on the profile:** `Profile.worn` (a list of obj ids: staff of fire, ring of forging) beside
  `axe`/`pickaxe`. Phase 4 reuses it for gear.
- **HP regeneration stays out** of food cycles, as in phase 3.

## Global rules (apply to every task)

- Phase 3's global rules still bind: code in `wiki/world/`, tests in `wiki/world/test/` (`*.real.test.ts` for real
  data), `bun run verify:conductor`, `bun test wiki/world` and `bun test conductor`, determinism, generated files
  committed with their code and never hand-edited, the game is the source of truth.
- **Every formula cites its script** (file:line) and has a test against a value worked by hand from that script, in
  the test's comment. Server constants are read, not hardcoded.
- **Format changes bump `WORLD_FORMAT`** (15 on main) and update `load.ts` and its tests; one bump per task that
  changes the format.
- **Performance budget:** `bun run world` under ~30 s, `world.json` under ~12 MB; report both when a task changes
  the build.
- **Conductor edits** are limited to: the one `statRandomChance` call in `conductor/test/lib/walk-graph.test.ts`
  (Task 1), `method` on promoted plans in `conductor/plans/` and the consistency it needs (Task 9), and docs
  (Task 10). Anything else in `conductor/` stops and asks.
- Don't touch another session's open work: `wiki/world/areas.ts` `EXPECTED_UNREACHED`, `wiki/world/distance.ts`'s
  pricing for non-method uses.
- Comment density matches the surrounding code. The user's standing rules: members worlds only; distances in run
  ticks only, never walking ticks.

## Task 1 — One roll, and the queue cadence

**Files:** `wiki/world/roll.ts`, `wiki/world/model/roll.ts` (deleted), the five family imports
(`model/families/{woodcutting,mining,fishing,pickpocket,cooking}.ts`), `wiki/world/distance.ts` (the one
`statRandomChance` call, ~:132), `conductor/test/lib/walk-graph.test.ts` (its call), `wiki/world/test/roll.test.ts`
and `model-core*.test.ts`, `model/families/common.ts`.

- One `statRandomChance(level, low, high)` in `wiki/world/roll.ts`, in the engine's order (survey §3), with the
  model file's fuller comment; `model/roll.ts` deleted; callers repointed and their arguments swapped; the two test
  files' cases merged into `test/roll.test.ts`.
- `queueTicks` in `families/common.ts` for a weak-queue cadence (survey §0: queued from a click d, from inside a
  queue d+1), beside `clickTicks`.

### Acceptance criteria

- [ ] One `statRandomChance` in the repo; every existing test passes; the merged tests keep every hand-worked case.
- [ ] `queueTicks` tests worked by hand: smelt 5 ticks a bar, spin 3, cut 3 (survey §1b, §1f, §1h).

## Task 2 — Flax and agility courses as feature kinds

**Files:** `wiki/world/classify.ts`, the source readers it needs, `wiki/world/types.ts` (`WORLD_FORMAT`),
`wiki/world/load.ts`, the renderers that list feature kinds, tests.

- A `flax` feature kind from the pickable trigger (survey §1f, `[oploc2,flax]`).
- An `agility-course` feature kind, one site per course (Gnome, Barbarian, Wilderness): its obstacles in lap order
  (from the course varp index) and its lap bonus (the proc's `stat_advance`), read from the course scripts
  (survey §1d).
- `WORLD_FORMAT` bump; `bun run world` regenerates; the flax fields and the courses show on their place pages.

### Acceptance criteria

- [ ] Real-data tests: the Seers flax field is a `flax` site; each of the three courses is one `agility-course`
  site with its obstacles in lap order and its lap bonus (values checked against survey §1d).
- [ ] Budget reported.

## Task 3 — Crossing success ticks and fall damage

**Files:** `wiki/world/sources/gate-scan.ts` (the bound-run tick sum, ~:529-536, ~:1336-1344), the curated rows it
needs in `wiki/world/gates.ts`, `wiki/world/types.ts` (the crossing row), tests.

- A scripted crossing carries its success ticks: the bound run's `p_delay`/`p_arrivedelay` sum, a forced walk
  counted one tick per tile (survey §0).
- The Wilderness course pipe's landing and the rope swing (missing today, survey §1d), derived or curated.
- Fall damage as an HP-linear form `floor(HP x a / b) + c` (survey §1d gives the Wilderness 15/100 and 216/1000),
  not the value at HP 99.
- `WORLD_FORMAT` bump if the row changes shape.

### Acceptance criteria

- [ ] Tests worked by hand for a Gnome obstacle, a Wilderness obstacle with a forced walk, and a fall at HP 52
  and 99.
- [ ] Every obstacle of the three courses has success ticks; the pipe and the rope swing are crossings.

## Task 4 — The process sink, the withdraw source, damage and walks

**Files:** `wiki/world/model/family.ts`, `model/cycle.ts`, `model/method.ts`, `wiki/world/methods.ts` (the types
and the one `process-bank` record), `model/profile.ts` (`worn`), tests.

The contract extension of survey §4:

- `ActionModel.damage` (expected HP lost per success besides `failDamage`) and `batch` (inputs per product).
- `Family.walks(site, params, world)`: tile pairs priced by method.ts under the way's reach set, passed to `model`.
- The sink `{ mode: 'process', steps: ProcessStepDef[], then: 'bank' | 'drop' | 'keep', bank? }`; a step's `at` is
  `'here'`, a tile, or omitted (the nearest site of its kinds). `process-bank` migrates to it (format bump; the one
  record moves).
- Steps chain (each takes the previous product plus supplies: a stackable supply one slot, a non-stackable one a slot
  per unit), the tour (gather stand -> each step site not `'here'` -> bank when `then: 'bank'` -> stand), `then: 'drop'`
  with `dropTicks` at the last step, `then: 'keep'` for a stackable end product.
- The `withdraw` source (`family: 'withdraw'`, params `{ obj }`): no gather; the load is the free slots over the first
  step's input slots; the tour starts and ends at the bank.
- Food: `foodPerSuccess = (failDamage x fails/success + damage) / heal`; eat ticks only for `failDamage`.
- `Profile.worn: string[]` (default `[]`), read by families; `profileAt` and `measuredProfile` carry it.

### Acceptance criteria

- [ ] Synthetic cycle tests worked by hand for each new shape: a two-step chain, drop at the processor, keep, withdraw,
  a non-stackable supply, food with `damage`.
- [ ] The migrated record's floor and the training pages are unchanged.
- [ ] Out of scope: any new family (Tasks 5-8).

## Task 5 — Superheat, smelting and smithing

**Files:** `model/families/{superheat,smelting,smithing}.ts`, `model/families/index.ts`, tests.

- `superheat` (process, in place; params ore; staff of fire in `worn` saves the fire runes): survey §1a.
- `smelting` (process at a furnace; bar; the iron 50% fail, ring of forging in `worn`): survey §1b.
- `smithing` (process at an anvil; product; hammer; `batch` bars per product): survey §1c.

### Acceptance criteria

- [ ] One hand-worked test per family from its script, e.g. superheat iron with a staff of fire: 3 ticks, 530 + 125
  tenths, one nature rune.

## Task 6 — Spinning, fletching, firemaking and flax picking

**Files:** `model/families/{spinning,fletching,firemaking,pick}.ts`, `index.ts`, tests.

- `spinning` (process at a spinning wheel): survey §1f.
- `fletching` (process in place; cut a product or string a bow, bow string as a non-stackable supply): survey §1h.
- `firemaking` (process in place or at a tile; log; no site kinds; line resets left out): survey §1i.
- `pick` (gather on `flax`: 2 ticks, a flax vanishes 3 times in 16 for 10 ticks): survey §1f.

### Acceptance criteria

- [ ] One hand-worked test per family.

## Task 7 — Agility laps

**Files:** `model/families/agility.ts`, `index.ts`, tests.

- One `ActionModel` per lap on an `agility-course` site (survey §4, "Agility as a lap"): the obstacles' success ticks
  plus a click tick each plus the lap's walks (`Family.walks`), each rolled obstacle's expected fail cost, the
  obstacles' XP plus the lap bonus, and `damage` the expected fall damage at the profile's HP.

### Acceptance criteria

- [ ] Hand-worked tests: the Wilderness lap at Agility 52 and 99, the Gnome lap at Agility 1 (no falls), the
  Barbarian lap at its level.

## Task 8 — Runecraft and its legs

**Files:** `model/families/runecraft.ts`, `index.ts`, `model/method.ts` (leg pricing), tests.

- `runecraft` (process at an `rc-altar`, reached via its ruins; runes per essence by level; any talisman altar from
  data): survey §1e.
- Method legs price a random landing at the mean of its landings' walks and the Aubury teleport at its script delay
  (survey §1e, §4), for method legs only. The essence mine leg needs the walker's essence-mine context
  (`cameFromContext`), which `wayFinder` lacks today: add it for method legs.

### Acceptance criteria

- [ ] Hand-worked tests: earth runes per essence at RC 1, 26, 55 and 99; a leg over the 22 landings priced at their
  mean.

## Task 9 — Method records and plan links

**Files:** `wiki/world/methods.ts`, `conductor/plans/*.ts` (`method` only), the regenerated `wiki/training/` pages,
tests.

- The records of survey §5 marked "yes": khazard superheat, superheat-banked, superheat-mine, iron-smith, the
  Wilderness, Gnome and Barbarian courses, earth runecraft (aubury essence), flax-spin, willow longbows, chop-burn,
  willow-burn; each with its family, params, sink and plans, linked both ways (`conductor/test/plans.test.ts`).
- `measured` from survey §5 only where a figure is a whole-cycle plan run with known start levels; otherwise leave it
  for `stats.ts --methods` after the next goal (say so in the record's notes).
- Training pages for Smithing, Magic, Agility, Runecraft, Crafting, Fletching and Firemaking.

### Acceptance criteria

- [ ] The build resolves every record; real-data tests show each floor at or above its measured figure (or the
  model is fixed, never the figure loosened).
- [ ] `bun test conductor/test/plans.test.ts` passes and its to-do list shrinks accordingly.

## Task 10 — Docs

**Files:** `wiki/world/README.md` (Methods: process steps, withdraw, laps, worn items), `conductor/docs/world-index.md`
("Phase 3b as built"), `conductor/roadmap.md` (the Wilderness-gate and runecraft-landing levers; the whole-index
landing pricing follow-up).

### Acceptance criteria

- [ ] Every claim is true of the committed code.

## Out of scope for this spec

- Combat (phase 4), pottery, the Wilderness combat opt-in.
- Landing and teleport pricing for the whole index (`distance.ts`).
- Retiring plans; firemaking line resets; HP regeneration.
