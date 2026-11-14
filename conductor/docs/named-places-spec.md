# Named places: spec

Expands `conductor/docs/named-places.md` into ordered tasks. A later task may use anything an earlier one
landed.

## Global rules (apply to every task)

- **Do not edit** `sdk/`, `server/`, `mcp/` or `wiki/` (generated or source). `conductor/plans/` is edited
  only by Task 3, and only as it says.
- **No behaviour change to any plan.** No phase's params change value in this build.
- **Contracts that stay working:** the `run-task.ts` CLI, `RESULT <json>`, `--list`, every promoted plan.
- **Formatting and lint**: finish with `bun run verify:conductor`. `bun run fmt` formats code in place; do
  not run a formatter over markdown files.
- **Unit tests** live in `conductor/test/**/*.test.ts`, need no server, never call `process.exit`. Run
  `bun test conductor` (never `bun test conductor wiki`, never two test runs at once).
- No integration tests and no live runs in this build.
- Game knowledge goes in `learnings/`, not in comments. Comments explain why, not what. No `Date.now()` in
  game logic.

## Task 1 — `place()`

**Files:** new `conductor/lib/places.ts`, new `conductor/test/lib/places.test.ts`; reads
`conductor/lib/world-index.ts` (`WORLD`) and `conductor/lib/banks.ts`.

- `place(name: string, opts?: { near?: { x: number; z: number } }): Place`.
- `name` is `<kind>:<area-slug>`: a site id of the index without its trailing ordinal (`bank:varrock-east-bank`,
  `furnace:al-kharid`). A name with an ordinal (`bank:varrock-east-bank:0`) is refused with a message saying
  to drop it.
- Allowed kinds, exported as a const list: `bank`, `furnace`, `anvil`, `range`, `altar`, `rc-altar`,
  `rc-ruins`, `spinning-wheel`, `pottery-oven`, `pottery-wheel`, `tanner`, `water-source`, `sand-pit`,
  `agility-course`. Any other kind is refused, naming the allowed kinds.
- Resolution: the sites of that kind whose id minus ordinal equals the name. None: throw
  `unknown place "<name>"` with up to 5 nearest names of that kind (same kind, slug containing or sharing the
  longest prefix with the given slug; pick a simple, deterministic measure and test it). One: that site.
  Several: with `near`, the site whose `stand` is nearest (Chebyshev distance, same level preferred only as a
  tie-break), refused when the nearest stand is more than 10 tiles from `near`; without `near`, throw
  listing each candidate's stand as `(x,z)` and say to pass `near`.
- For kind `bank` the stand comes from `lib/banks.ts` (its override stand where one exists); a bank that
  `banks.ts` marks skipped still resolves (a plan may name it deliberately).
- `Place = { id: string; kind: string; name: string; stand: { x: number; z: number; level: number };
  at(opts?: { tolerance?: number; level?: number }): { x: number; z: number; level?: number; tolerance?: number };
  area(radius: number): { x: number; z: number; radius: number; level?: number } }`. `name` is the area's
  display name (as `banks.ts` derives it) plus the kind when not a bank. `at()` and `area()` return fresh
  plain objects; `level` is present only when the stand's level is not 0 (or `opts.level` is given);
  `tolerance` only when given. The returned objects must parse with `AtSchema` / `AreaSchema`.
- `places(kind?: string): Place[]` lists every resolvable place (one entry per site; an ambiguous name
  appears once per site with its stand), sorted by name, for the tool of Task 2.
- No task schema changes: a plan calls `place()` in its own module scope.

### Acceptance criteria

- [ ] Unit tests on the real `WORLD`: a unique bank resolves to the stand `banks.ts` gives; a unique
      non-bank service resolves to its index stand; an ambiguous name throws listing stands and resolves
      with `near`; `near` too far throws; unknown name, ordinal form and disallowed kind each throw their
      message; `at()` / `area()` shapes (level omitted at 0, present otherwise) parse with the shared schemas.
- [ ] A test asserts every `bank` site in `BANKS` has a unique `<kind>:<area-slug>` name (the survey says 25
      of 25); if not, the report says which collide.
- [ ] Importing `places.ts` reads no file beyond what `WORLD` already loads.
- [ ] Out of scope: resource kinds, a curated table of unindexed places, task schema changes, plans.

## Task 2 — The listing tool and the docs

**Files:** new `conductor/tools/places.ts`, a test for its pure listing function,
`conductor/docs/plans.md`, `.claude/agents/task-runner.md`, `.claude/agents/task-author.md` (one line each
where places or coordinates are discussed), `conductor/README.md` (tools list), `CLAUDE.md` tools sentence
only if it lists every tool, `conductor/roadmap.md`, `conductor/docs/plan-primitives.md` (the follow-up line
points here).

- `bun conductor/tools/places.ts [kind] [text]`: one line per place: name, `near` hint when ambiguous,
  stand `(x,z,level)`, display name. `kind` filters by kind, `text` by substring of the name. No bot, no
  network. The formatting lives in an exported pure function with a unit test.
- Docs: how a plan names a place (`place('bank:varrock-east-bank').area(6)`), that an unknown name fails at
  plan load, how to find names (the tool), that gathering and fighting areas stay literal, and that a
  coordinate is replaced by a name only when the numbers are identical or the plan is re-run live.
- Roadmap: this follow-up done in part; follow-ups: plan parameters, level-band stages, a curated table of
  unindexed areas, the coordinates 1 to 3 tiles off a stand (plan-migration), quest-plan coordinates.
- `task-runner.md` is size-watched: replace prose, do not append more than about 200 bytes; report its size.

### Acceptance criteria

- [ ] The tool prints the 25 banks for `bank`; the test pins the line format on two real places.
- [ ] Every doc statement checked against the code at HEAD.
- [ ] `bun run verify:conductor` and `bun test conductor` pass.

## Task 3 — Plans whose numbers do not change

**Files:** `conductor/plans/*.ts` (training and utility plans only: files that do not import
`@conductor/lib/quests`, and not `gertrudes-cat.ts`), `conductor/test/plans.test.ts` only if a guard is added.

- First, before any edit, write to the scratchpad a JSON dump of every promoted plan's phases
  (`plan name -> [{ phase name, task name, params }]`, params canonicalised with sorted keys) from the
  loaded plan modules. Keep the script in the scratchpad, not in the repo.
- A literal `{ x, z, ... }` in a training plan is replaced by a `place(...)` call **only** when the call
  returns exactly the same object: same x, z, radius/tolerance, and the same presence or absence of `level`.
  That means the literal's x and z equal the place's stand. Constants declared once per file
  (`const eastBank = { x: 3254, z: 3420, radius: 6 }`) become `const eastBank = place('bank:varrock-east-bank').area(6)`;
  the constant's name stays.
- Nothing else in a plan changes: no renamed constant, no reordered phase, no touched `when`.
- After the edits, dump again and compare: the two dumps must be byte-identical. The report gives the
  count of literals replaced per file, the place each became, and the comparison result.
- A literal within 1 to 3 tiles of a stand but not equal is left alone and listed in the report (file, line,
  coordinate, nearest place, distance) for the roadmap.

### Acceptance criteria

- [ ] The before and after dumps are identical (stated with both files' sha256).
- [ ] `git diff --stat` touches only training/utility plan files (and the roadmap list of near-misses).
- [ ] The plan lint test, the unknown-param scan and `bun test conductor` pass; `bun run verify:conductor` passes.
- [ ] Out of scope: quest plans, any coordinate not exactly equal, waypoint arrays (`travel` `to` lists
      stay literal even when one entry equals a stand).

## Out of scope for this spec

- Plan parameters, level-band stages, named gathering or fighting areas.
- Changing any task's schema or the bank task's nearest-bank choice.
