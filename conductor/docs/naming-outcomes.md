# Naming and outcomes

Fourth build from the 2026-11-14 audit. Every decision
here is the conductor's, made under the "drive this" instruction; each is marked **Assumption**.

## What is wrong today

1. **A plan can only tell why a run ended by reading its sentence.** A result carries a status, a
   reason sentence and (sometimes) the step or guard name. Three plans match on the sentence
   (`clock-tower` `/attacked/`, `monks-friend` `/unreachable/`, `troll-stronghold` on dialog text
   inside the reason), and `clock-tower` already misses two of the engine's attack wordings.
   Rewording a failure silently changes what those plans do.
2. **A misspelt or renamed param is dropped silently.** Params parse with a non-strict object, so
   an unknown key falls away and the task runs on its default. This is also why a rename is
   dangerous today.
3. **The full-inventory policy has three names** (`onFull`, `stopWhenFull`, `endWhenPackFull`),
   one task counts time in seconds (`pickup.maxWaitSeconds`) where every other one counts ticks,
   and two params use a hand-made schema where a shared one exists (`spell-items.item`, `shop.at`).
4. **Op failure reasons are unchecked strings in task code.** Each op declares its own union, but
   one helper widens to `string` and four task sites compare against `string[]` lists.

## What gets built

### A. Outcome codes

- A step's outcome may carry a code: `{ fail: string, code?: string }` and `{ done: string, code?: string }`.
  A guard's ending carries one too.
- `TaskResult.code?: string` and `PlanView.last.code` (plus `last.endedBy`, which exists on the
  result and is not exposed to plans).
- A task declares the codes it can end with: `TaskDef.outcomes?: Record<string, string>` (code →
  one sentence on when it happens). The engine's own codes are declared once in the engine
  (`died`, `under-attack`, `stuck`, `stopped`, as they exist). A step that returns an undeclared
  code ends the run `error`: a code a plan cannot look up is a bug.
- `--list <task>` prints the task's outcomes, so a plan author finds them where the params are.
- Codes are added only where a plan or the runner branches today, not for all failures:
  `attacked` (pickup, and the engine's under-attack endings), `unreachable` (talk),
  `dialog` (combat `stopOnDialog`; the dialog text stays in the reason, since it is game text, not
  our wording). **Assumption:** more codes are added when a plan needs one, with the plan.
- The three plans switch to `v.last.code`. `troll-stronghold` keeps its match on the dialog text,
  behind the code. **Assumption:** these three edits land without a live quest run (each is one
  predicate; unit tests pin the producers). Recorded as not run live.
- `lib/epilogue.ts` client-drop matching and `task-runner.md`'s prose on `died` / `under-attack`
  move to codes where the code exists.
- Plan lint gains one rule: a regex test or `.includes` on `.reason` in a plan is flagged, naming
  `last.code`.

### B. Strict params

- Task params refuse unknown keys at preflight (`preflight: unknown param "<key>"`), in the engine,
  so tasks keep their plain `z.object`. First step is a scan: every promoted plan through the plan
  lint with strict parsing, to list the keys that are dropped today. Each is either a typo (fix
  the plan) or dead (delete the key). **Assumption:** drafts under `conductor/runs/` are not
  migrated; they fail loudly on their next run, which is the point.
- Replay of an old recording with a renamed key then fails at preflight with the key's name, not
  with a divergence 200 ticks in.

### C. Renames (only where the gain is clear)

- thieving `stopWhenFull: boolean` → `onFull: 'continue' | 'stop'`, default `continue`.
- combat `endWhenPackFull: boolean` → `onFull: 'continue' | 'stop'`, default `continue`.
  Neither old name is in any plan. The enum values keep `drop` for the gathering tasks: `continue`
  and `drop` are different behaviours and get different words.
- pickup `maxWaitSeconds` → `maxWaitTicks` (default 150 = 90 s), in 7 plans, edited with it.
- `spell-items.item` uses `patternParam`; `shop.at` uses `AtSchema`.
- **Not renamed** (**Assumption**): `npc`, `target`, `name`, `item`, `food`, `product`. They are in
  40 to 60 plans each, the catalog text now states exact or pattern per field, and a rename
  splits the stats history for every method. Recorded in the roadmap as a known wart.

### D. Typed op failure reasons

- One exported `Failure<R extends string>` in `conductor/core` (or `actions/`), used by every op;
  `OpenFailure = Failure<string>` gets its real union.
- The four `string[]` comparison sites become lists typed by the op's union (`satisfies`), so a
  typo fails to compile.
- **Not done** (**Assumption**): merging the 90 values' synonyms. Only 41 are branched on, 43
  action tests and every recording pin the words, and the type fix removes the actual risk.

## Order

1. Outcome codes in the engine, result, view, catalog (`--list`).
2. Codes on the three producers, the three plans, epilogue, plan lint rule.
3. Strict params: the scan, the plan fixes, then the engine refusal.
4. Renames (full-inventory, pickup ticks, two shared schemas) with their plans and fixtures.
5. Typed failures.
6. Docs: task-author, task-runner, plans.md, review lenses, roadmap.

## Out of scope

Selector renames; reason rewording; places by name (next build); moving plans to new primitives.
