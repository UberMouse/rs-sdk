# Spec: the task catalog

Expands the design `conductor/docs/task-catalog.md` into ordered tasks. Each `## Task N —` section
is one unit of subagent-driven work: implemented and committed by one agent, then reviewed for spec
compliance and code quality before the next starts.

## Global rules (apply to every task)

- **Do not edit** `sdk/`, `server/`, `mcp/`, `wiki/` or `conductor/plans/`.
- **Behaviour does not change.** No params schema changes shape: no field added, removed, renamed
  or retyped, no default, range, refinement or transform changed. No task step, preflight or
  action is touched. The only edits to a task file are `.describe()` calls on its schema fields,
  its `description`, and the new `rules` and `spots` fields. A check for this:
  `z.toJSONSchema(params, { io: 'input' })` with every `description` key removed is identical
  before and after for every task.
- **No fact is lost.** Every statement in a task's old `description` appears afterwards in exactly
  one of: a field's `.describe()`, `rules`, `spots`, or the new `description`. Wording may be
  tightened; numbers, names, coordinates and conditions may not change. A statement that the code
  contradicts is corrected to match the code and listed in the report.
- **Where a statement goes**: what one param means, on that field; a rule across params or a
  preflight requirement, in `rules`; a verified spot, an example params object or a "used by"
  pointer, in `spots`; what the task does, how it ends done or failed and what it refuses, in
  `description`.
- **A field's description** says what the param means and what it changes, in one or two
  sentences. It does not repeat the type, default, range or enum values the schema already
  prints, unless a value needs explaining (`'drop'` also drops ore held before the run). A number
  the code holds as a constant is interpolated from that constant, not typed again.
- **Contracts that stay as they are**: running a task or a plan with `run-task.ts`, the
  `RESULT <json>` line, `TaskResult`, recordings and replay. `--list` changes only as Task 1 says.
- **Formatting and lint**: finish with `bun run verify:conductor`. `bun run fmt` formats code in
  place; do not run a formatter over markdown files.
- **Unit tests** live in `conductor/test/**/*.test.ts`, need no server, never call `process.exit`.
  Run `bun test conductor` (never `bun test conductor wiki`, never two test runs at once).
- No integration tests and no live runs: nothing here changes what a task sends.
- Comments match the surrounding density: explain why, not what.

## Task 1 — The catalog's shape: `rules`, `spots`, shared descriptions, `--list`, the guard

**Files:** `conductor/lib/task.ts` (`TaskDef`), `conductor/lib/catalog.ts` (the catalog entry and
its checks), `conductor/run-task.ts` (`--list`), `conductor/lib/area.ts` and `conductor/lib/spot.ts`
(shared sub-schemas), `conductor/test/lib/catalog.test.ts`, `conductor/test/run-task*.test.ts` if
one covers `--list`.

- `TaskDef` gains `rules?: string[]` and `spots?: string[]`, documented as the design says, and
  the doc comment on `description` says what belongs in it.
- `conductor/lib/catalog.ts` exports:
  - `catalogEntry(def)`: `{ name, description, rules?, spots?, params }` with `params` the JSON
    Schema `--list` prints today (`io: 'input'`); `rules` and `spots` left out when empty.
  - `summaryLine(def)`: `<name>: <first sentence of description> (params: a, b, c)`, the params
    being the top-level names in schema order, required ones first; a root that is not an object
    (a pipe) lists its input object's fields.
  - `undescribedFields(def)`: the path of every params field with no description, nested and
    shared sub-schemas included (`area.radius`, `withdraw[].item`), walking objects, arrays,
    optionals, defaults, unions and a root pipe. A field whose schema is a described shared
    sub-schema counts as described through it; its own inner fields are still checked.
- `--list` with no further argument prints `summaryLine` for every task, one per line, then one
  closing line saying how to get a task's full entry. `--list <task> [<task>...]` prints a JSON
  array of `catalogEntry` for those tasks (an unknown name is an error naming the catalog).
  `--list --all` prints the array for every task.
- Describe the shared sub-schemas and each of their fields where they are defined: `AreaSchema`,
  `AtSchema`, `TileSchema`, `ItemSpec`, `Pattern` (from their existing doc comments, which stay).
- The guard, in `catalog.test.ts`, over every catalog task: `undescribedFields` is empty;
  `description` is at most 900 characters; `rules` and `spots` entries are non-empty strings. Tasks
  not yet migrated are listed in an explicit `NOT_YET` array in the test with a comment that Tasks
  2-5 empty it; the test fails if a task in `NOT_YET` already passes (so the list cannot rot).
- A second test pins the behaviour rule for the whole build: a committed fixture
  `conductor/test/fixtures/catalog-shapes.json` holds, per task, the params JSON Schema with every
  `description` key removed, generated at this task's start; the test compares each task's
  current shape to it.

### Acceptance criteria

- [ ] `--list` prints 32 summary lines plus the closing line; `--list wait journal` prints two
      full entries; `--list --all` prints all; `--list nope` fails naming the catalog. Tests cover
      each through whatever the existing run-task tests use, or directly on the exported functions
      if `--list` has no test harness (say which).
- [ ] `undescribedFields` unit tests on hand-built schemas: nested object, array of objects,
      optional and default wrappers, a union with an object arm, a shared described sub-schema, a
      root pipe.
- [ ] The guard passes with `wait` and `journal` outside `NOT_YET` and the other 30 inside, and
      fails in the two ways described (checked by mutation, stated in the report).
- [ ] The shape fixture exists and its test passes; adding `.describe()` to a field does not
      change a shape, changing a default does (checked by mutation).
- [ ] Out of scope: any task file other than what `wait`/`journal` need to pass the guard.

## Tasks 2-5 — Move each task's param prose onto its schema

One task per batch, the same work on different files:

- **Task 2 — interaction tasks:** `interact`, `talk`, `items`, `locate`, `herd`, `combolock`.
- **Task 3 — combat and movement:** `combat`, `thieving`, `prayer`, `agility`, `travel`,
  `teleport`.
- **Task 4 — gathering:** `mining`, `woodcutting`, `fishing`, `pick`, `pickup`, `fill`,
  `essence-mine`, `runecraft`.
- **Task 5 — processing and trade:** `cooking`, `crafting`, `firemaking`, `fletching`, `herblore`,
  `smithing`, `spinning`, `spell-items`, `bank`, `shop`.

**Files:** the batch's files in `conductor/tasks/`, and `conductor/test/lib/catalog.test.ts` (remove
the batch from `NOT_YET`).

For each task in the batch: give every params field a `.describe()` (inline, or on a local
sub-schema); move each statement of the old `description` to where the global rules say; write
the new `description`; add `rules` for cross-param rules (include every object-level `.refine`
message's rule, and preflight requirements the old text stated); add `spots`. Before editing a
task, save its old description (`git show HEAD:conductor/tasks/<task>.ts`) and afterwards account
for every sentence: the report carries, per task, a short table of old statement to new home for
anything that is not a plain param restatement, and a list of statements corrected against the
code.

### Acceptance criteria (each batch)

- [ ] Every task of the batch is out of `NOT_YET` and the guard passes.
- [ ] The shape fixture test passes untouched (the fixture file is not edited).
- [ ] `git diff` on each task file touches only the params schema's `.describe()` calls, the
      `description`, `rules` and `spots` (and imports or constants those need).
- [ ] The report's accounting covers every sentence of each old description.
- [ ] `bun run verify:conductor` and `bun test conductor` pass.
- [ ] Out of scope: tasks of other batches; renaming anything.

## Task 6 — Docs and agent prompts

**Files:** `.claude/agents/task-runner.md`, `.claude/agents/task-author.md`,
`.claude/agents/retrospective.md`, `.claude/skills/conductor/SKILL.md`, `CLAUDE.md` and `AGENTS.md`
(the one `--list` line each), `conductor/README.md`, `conductor/docs/plans.md` (where it says the
verified spots are in a task's description, and the stale claim that `--list` lists plans),
`conductor/roadmap.md` (this follow-up done; the next ones stay), `conductor/docs/plan-primitives.md`
(the follow-up line points here), `.claude/review-lenses/` where a lens speaks of a task's
description.

Every place that tells an agent to read the catalog says: `--list` for the index, `--list <task>`
for a task's params, rules and spots. `task-author.md` gains the authoring rule: each param
described on its field, `rules`, `spots`, what `description` is for, and that the guard test
enforces it. Keep `task-runner.md` within 29,300 bytes.

### Acceptance criteria

- [ ] No doc or prompt still describes `--list` as printing every task's full schema, or tells an
      agent to find params or spots in a task's description prose.
- [ ] Each statement about the catalog matches the code landed by Tasks 1-5.
- [ ] `bun run verify:conductor` and `bun test conductor` pass.
- [ ] Out of scope: code.

## Out of scope for this spec

- Param renames and unification, outcome codes, step helpers, named places.
- Moving game knowledge from the catalog to the knowledge base.
- Printing plan descriptions.
