# Named places (design)

Fifth build from the 2026-11-14 audit. Facts: the survey of 2026-11-15 (summarised below). Every decision
here is the conductor's, made under the "drive this" instruction; each is marked **Assumption**.

## What is wrong today

1. **Every plan retypes its places.** No plan imports a shared place. The Varrock East bank is declared in 9
   training plans under 3 names; the Seers bank is spelled at least three ways. The 44 training plans hold
   about 224 coordinate objects (113 distinct), the 51 quest plans about 1,205.
2. **Nothing checks a typed coordinate.** A wrong digit is a walk to the wrong place, found on a live run.
3. **The world index already knows the services.** `wiki/world.json` (loaded by the conductor as `WORLD`) has a
   site per bank, furnace, anvil, range, altar and so on, each with a stand tile. Only banks are used by name
   (`lib/banks.ts`), and only inside the bank task.

## What gets built

### A. `place(name)` in `conductor/lib/places.ts`

- A plan writes `place('bank:varrock-east-bank').area(6)` or `place('furnace:al-kharid').at()` where it
  typed coordinates. The lookup runs when the plan file is imported, so an unknown name fails at plan load
  (and in the test that loads every promoted plan), with the nearest valid names in the message.
- A name is `<kind>:<area-slug>`: the index's site id without its ordinal, because the ordinal changes when
  the clustering changes. It resolves when that area has exactly one site of that kind. When it has several,
  the caller adds `{ near: { x, z } }` and gets the site whose stand is nearest; without `near` the error
  lists each candidate's stand. **Assumption:** `near` must be within 10 tiles of a stand, so a stale
  `near` fails rather than picking a far site.
- **Trade-off:** a removed name, or a `near` more than 10 tiles from every stand, fails at plan load; a stand that
  moves a tile or two after an index rebuild moves the plan's area with no error, which
  `conductor/test/plan-places.test.ts` turns into a test failure.
- A place gives `stand` (`{ x, z, level }`), `at(opts?)` (the task `at` shape) and `area(radius)` (the task
  `area` shape). `level` is included only when it is not 0, as plans write it today.
- Banks resolve through `lib/bank-sites.ts` (the bank table and curated stand overrides, which `lib/banks.ts`
  re-exports), so those stand fixes apply; it is kept apart from `banks.ts` so `places.ts` loads nothing beyond the index.
- Kinds allowed: the service kinds a plan stands at (bank, furnace, anvil, range, altar, rc-altar, rc-ruins,
  spinning-wheel, pottery-oven, pottery-wheel, tanner, water-source, sand-pit, agility-course).
  **Assumption:** resource clusters (tree, rock, fishing-spot, pickpocket, flax) are not named places: a tree
  site can span 300 tiles and its stand says nothing about where a plan gathers. Gathering areas stay literal.
- `bun conductor/tools/places.ts [kind] [text]` lists names with their stand tile and area, so an author
  finds the name without reading the JSON.

### B. Plans that can move without a live run

- Only where the place gives **exactly** the numbers the plan has today: the survey found 12 distinct
  training-plan coordinates that are a stand tile to the tile (the Varrock East and Draynor banks among
  them). Those literals become `place(...)` calls; the proof is that every promoted plan's phase params are
  deep-equal before and after.
- A coordinate 1 to 3 tiles off a stand is **not** moved: the walk would change, and a plan rewrite needs a
  live run. **Assumption:** those are listed in the roadmap for the plan-migration work.
- Plan lint gains an advisory count only if it costs nothing; no rule forces a name.

## Not built (left as notes for the owner)

- **Plan parameters.** Plans take none; near-duplicate files exist for variants (earth-runecraft / -28,
  knight-thieve / -bankfood, the three giants plans). A plan factory with checked params is the likely
  shape, but it changes the CLI contract (`--plan` refuses `--params` today) and the stats keys.
- **Level-band stages.** Bands are `when` predicates repeated per phase (110 comparisons in 31 files). A
  `stages([{ below: 10, phases }, ...])` helper would remove the repetition; it is a plan API change that
  wants live proof on at least one plan.
- **Named gathering and fighting areas** (hill giants, baby blues, Lumbridge trees): these have no index
  record; they would be a curated table. Deferred until plan parameters are decided, since the two interact.
- Quest-plan coordinates (about 1,205): mostly one-off story tiles; not places.

## Order

1. `place()` and its tests.
2. The listing tool and the docs (plans.md, task-runner.md, task-author.md, roadmap).
3. The exact-match plan edits with the before/after proof.
