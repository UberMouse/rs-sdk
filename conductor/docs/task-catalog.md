# The task catalog: params documented once, on the schema

Design from the 2026-11-14 audit ([`plan-primitives.md`](plan-primitives.md), "Other follow-ups") and
a survey of the 32 catalog tasks the same day. Built per
[`task-catalog-spec.md`](task-catalog-spec.md).

## What is there today

- `bun conductor/run-task.ts --list` prints one JSON array: each task's `name`, `description` and
  its params as JSON Schema (`z.toJSONSchema`). It is 92,648 bytes, and every agent that needs one
  task's params reads all of it.
- A field's `.describe()` text already reaches that output. Only `wait` and `journal` use it. The
  other 30 tasks explain their params in the `description` string: 43,018 characters in total, up
  to 4,467 for one task (`interact`), against a doc comment that asks for "one or two lines".
- About 35-50% of a long description restates params. The rest is what the task does and when it
  ends, what it refuses, rules across params, game knowledge, verified spots and examples.
- The shared sub-schemas (`AreaSchema`, `AtSchema`, `TileSchema`, `ItemSpec`, `Pattern`) carry no
  description, so each of the 17 tasks that take an `area` explains it again.
- Rules across params (`interact`: `use` or `option`, not both) live in `.refine` calls that JSON
  Schema drops, and in prose.
- Nothing tests a description: no cap, no check that the prose still matches the schema.

## Decisions

- **A param is documented on its field**, with `.describe()`: what it means, in one or two
  sentences. Type, default, range and allowed values are not repeated there; the schema prints
  them. Shared sub-schemas are described once where they are defined; a task whose use differs
  re-describes the field at its use.
- **`description` goes back to what it was meant to be**: what the task does, when it ends done or
  failed, what it refuses. No param walk-through.
- **Two new optional `TaskDef` fields** hold what is neither:
  - `rules`: plain sentences for rules that span params or come from preflight ("`use` or `option`,
    not both", "`rock: 'essence'` needs `onFull: 'stop'`").
  - `spots`: verified spots, examples and where the task is used, one string each. `docs/plans.md`
    tells runners the verified spots are in the catalog; this is where.
- **`--list` becomes an index.** With no argument it prints one line per task (name, the first
  sentence of its description, its param names). `--list <task> [<task>...]` prints the full JSON
  for those tasks, and `--list --all` prints today's array with the new fields. An agent reads the
  index, then the tasks it needs.
- **A test guards it**: every param field of every catalog task, nested and shared ones included,
  has a description; a `description` is at most 900 characters; and no fact is lost in the move
  (checked by review, batch by batch, against the old text).
- **Behaviour does not change.** No schema changes shape, no default moves, no task step is
  touched. The move is of words.

## Assumptions (decided without asking, under "you can drive this")

- The `--list` output change is acceptable: its only readers are agents told by prompts and docs
  to run it, and those are updated in the same build.
- Game knowledge that sits in a description today (respawn times, which shop sells a pickaxe)
  stays in the catalog, in `spots` or `description`; moving it to the knowledge base is a separate
  pass.
- Param names are not unified here (five names for the full-inventory policy, `item` as a regex in
  some tasks and an exact name in others). Describing each field makes the difference visible; the
  renames are the next workstream.

## Not in this build

- Renaming or unifying params; outcome codes; shared step helpers.
- A text renderer for one task's params (the JSON Schema with descriptions is what agents read).
- Printing plan descriptions (95 plans set one and nothing reads it).
