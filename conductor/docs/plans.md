# Plans: composing catalog tasks

Design for running several catalog tasks as one dispatch that loops: chop -> burn -> chop,
fish -> cook -> thieve, mine -> bank -> smelt -> smith, fight -> bank -> fight. Built per
[`plans-spec.md`](plans-spec.md): `conductor/lib/plan.ts`, `run-task.ts --plan`, the promoted
`conductor/plans/chop-burn.ts`, and the goal-owning task-runner (`.claude/agents/task-runner.md`).

Decisions (2026-10-10):

- **A plan is TypeScript, written by the task-runner** for the dispatch it was given. It is not
  reviewed: running it is the review. Revisit if unreviewed plans prove a problem.
- **The API stays small enough that a plan reads like data**: a list of phases, each a catalog task
  with params and a few pure predicates. Anything JSON could express should be as reliable in it.
- **A failed phase fails the plan by default**; a phase can override that with `onFail`.
- **Each phase is a whole `executeTask` run.** The engine is unchanged apart from the hooks below.
- **No phase applies: the plan fails.** A gap in the `when`s should be loud; a plan that is meant to
  finish says so with its own `until`.
- **Plans are drafted in a per-dispatch scratch path; the conductor promotes the ones that worked**
  into `conductor/plans/` and commits them.
- **The conductor hands task-runners goals, not commands.** A runner owns a longer-term goal, works
  it through plans, and debugs what goes wrong; it comes back only when the goal is reached or a
  decision is the conductor's (see "Goals" below). Goals stay a few plans long for now, since task
  code is still the task-author's; the runner keeps its own durable state.

## Why

Today a chain is a numbered list of `run-task.ts` commands that the task-runner (an LLM) runs once,
in order, stopping at the first RESULT that is not `done`. It cannot loop, so "chop until full, burn,
repeat" is one dispatch per inventory, and it has a program counter, so it breaks when the
inventory is not what the chain assumed (the 2 stray Oak logs that failed a fletching preflight,
roadmap Experiments).

The catalog already has the shapes to compose:

| Shape | Ends `done` when | Tasks |
|---|---|---|
| Producer | the inventory is full (`onFull: 'stop'`) | woodcutting, fishing, mining |
| Consumer | its input is used up | firemaking, fletching, cooking, smithing, crafting, fill |
| Errand | its operations are made | bank, shop, pickup |
| Open-ended | never on its own | combat, thieving (`stopWhenFull` aside) |

Only the open-ended tasks need an outside "until".

## The model

A plan is an ordered list of **phases**. A phase is one catalog task with params, plus:

- `when(v)`: whether the phase may start. Default: always.
- `until(v)`: optional; ends the phase `done` early. Checked at every tick of the phase.
- `onFail`: what a `failed` or `stuck` phase means for the plan. Default `'fail'`.

The runner does what the engine does with steps, one level up:

1. Check each phase's `when` in order; the first that holds runs. None holds: the plan ends
   `failed` (`no phase applies`), and its log shows the `v` values every `when` read.
2. Run it as a normal `executeTask`: its own preflight, memory, guards, watchdog, step budget and
   leftover-modal close.
3. It ends `done` (by itself or by its `until`): back to 1. It ends `failed` or `stuck`: apply its
   `onFail`. It ends `error`: the plan ends `error` (a bug, not the world).

Choosing from state and not from a position in a list is what makes a plan resume: after a death,
a restart, or a dispatch onto a half-full inventory, the first applicable phase is still the right
one. The ordering rule that falls out is **consumers above producers**, so the inventory drains
before it refills.

## The API

```ts
// conductor/plans/chop-burn.ts (drafted as conductor/runs/<bot>/plans/chop-burn.ts)
import { definePlan, phase } from '@conductor/lib/plan';
import firemaking from '@conductor/tasks/firemaking';
import woodcutting from '@conductor/tasks/woodcutting';

export default definePlan({
    name: 'chop-burn',
    phases: [
        phase(firemaking, { logs: 'Logs', area: { x: 3230, z: 3240, radius: 6 } }, {
            when: v => v.full && v.inv('Logs') > 0,
        }),
        phase(woodcutting, { tree: 'tree', onFull: 'stop', area: { x: 3195, z: 3220, radius: 12 } }),
    ],
});
```

- `phase(task, params, opts?)` takes the task's default export, so `params` is type-checked against
  `z.input<typeof task.params>`. `opts`: `{ name?, when?, until?, onFail? }`; `name` defaults to the
  task's name and must be unique in the plan when a task appears twice (two bank phases).
- `definePlan({ name, phases, until? })`. The plan's own `until(v)` ends the whole plan `done`.

### The view (`v`)

Predicates get one read-only view and must be pure: no I/O, no clock, no state of their own. That
keeps every phase choice re-derivable from a run's recorded states.

| Member | Meaning |
|---|---|
| `v.state` | the current `BotWorldState`, for anything below not covering it |
| `v.inv(item)` | inventory count; `item` is an exact name (case-insensitive) or a RegExp |
| `v.full` / `v.free` | every slot used / free slots |
| `v.bank(item)` | bank count as last seen open during this plan; `undefined` before that |
| `v.level(skill)` | base level |
| `v.hp` | `{ current, max }` |
| `v.runs(phase)` | times that phase has run in this plan |
| `v.last` | the previous phase's `{ phase, status, reason }`, or `null` |

`v.bank` exists because "smelt once enough ore is banked" needs it and the state only shows the bank
while it is open: the runner keeps the last bank contents it saw in any phase.

`v.runs` gives one-shot steps without a program counter: `when: v => v.runs('withdraw') === 0` is
today's chain step "withdraw first". A one-shot chain ends through the plan's `until` (e.g.
`until: v => v.runs('burn') > 0`), since running out of applicable phases is a failure.

### `onFail`

`'fail' | 'continue' | (r: TaskResult) => 'fail' | 'continue'`

`'continue'` goes back to selection with that phase skipped for the next selection, so a fallback
phase below it gets the turn. A phase that fails `continue` this many times in a row (`maxFails`,
default 3) fails the plan. A preflight refusal is a `failed` phase like any other: preflight is never
used as an implicit `when`, so a missing tinderbox fails loudly rather than leaving the plan chopping
forever.

## The runner's safety rails

- **No progress.** A phase that ends with XP, inventory and position all unchanged counts as idle; 3
  idle phases in a row fail the plan (`phases make no progress: <names>`). It catches two phases
  handing the turn back and forth (woodcutting `onFull: 'stop'` on an inventory full of something
  else ends at once; so does a consumer with nothing to consume).
- **Params up front.** Every phase's params are parsed against its task's schema before the plan
  acts, so a typo fails the plan in the first second, not after an hour of the first phase.
- **Predicate errors.** A `when` or `until` that throws ends the plan `error`, naming the phase.
- **Combat between phases.** `executeTask` refuses to start in combat. An `until` that holds while
  the bot is in combat waits until the fight ends (the combat task would otherwise be cut mid-kill
  and the next phase refused). Combat that starts in the gap between phases goes through the next
  phase's `onFail` like any refusal.
- **One controller connection for the whole plan**, so nothing can take the bot between phases.

## Stops and the engine hooks

- `--until` applies to the plan: `minutes:` counts from the plan's start, `xp:` from the plan's
  starting XP. A plan stop ends the running phase and the plan `done`.
- Engine change: `ExecuteOptions.externalStop?: (s: BotWorldState) => string | null`, checked in
  `checkRun` beside the task's stops. The runner passes one closure that checks the plan stops and
  the phase's `until` and remembers which fired, so the engine needs no new result field to say why
  a phase stopped.
- Recording: when an external stop fires, the recording gets a `{ k: 'stop', reason }` record at
  that tick and `ReplayDriver` applies it there, so a phase cut short by `until` still replays
  without running past its recording.

## Results, logs and stats

- Each phase writes its own NDJSON log and `.ticks.ndjson.gz` recording as a task run does today,
  so `replay.ts` works per phase unchanged.
- The plan writes `conductor/runs/<bot>/<runId>-plan-<name>.ndjson`: the plan source path, each
  phase start with the `v` values its `when` read, each phase result.
- The last stdout line stays `RESULT <json>`: a `TaskResult` with `task: "plan:<name>"`, the plan's
  totals (`xpGained`, `inventoryDelta`, `durationMs`, ...), `stepRuns` keyed by phase, and one extra
  field `phases: [{ phase, runId, status, reason, durationMs, xpGained }]`. The task-runner, the
  journal and `stats.ts` read it as they read any task's result; `params` holds each phase's task and
  params, so `stats.ts` keys a plan as one method and its XP/hour compares with single tasks.

## Where plans live

- **Drafts**: `conductor/runs/<bot>/plans/<name>.ts`, inside the gitignored run artifacts, next to
  the logs of the runs that used them. The task-runner writes them there (it gets the Write tool for
  that path only; it still never edits task or engine code) or reuses a promoted plan as it is.
- **Promoted**: `conductor/plans/<name>.ts`, committed. When a runner reports a draft that worked,
  the conductor `git mv`s it in and commits it with the runs' results in the message: git history
  is the plan's review.
- Imports go through a tsconfig path alias, `@conductor/lib/plan` and `@conductor/tasks/<task>`
  (Bun resolves tsconfig `paths`), so a plan reads the same in either place and promotion is a
  move. A plan imports nothing else.
- Run: `bun conductor/run-task.ts <bot> --plan <path> [--until ...]`. The format and lint hook runs
  on drafts as on any conductor file.

## Goals: how the conductor and task-runners split the work

Plans let a runner carry far more than one command, so the split moves up a level.

**The conductor** sets goals and decides between them: what to train next, which methods to try,
what to spend, when to write or fix task code, when to run a retrospective. A goal it hands a runner
has:

- an end state: `Fletching 40 and Firemaking 45`, `500 bronze bars banked`, `250 coins for a steel
  axe`;
- constraints: areas to avoid, what may be spent or sold, items that must not be risked;
- a budget: play time, and how many failed plans in a row before it stops trying;
- the starting knowledge: the learnings/wiki pages and spots that apply, and promoted plans to reuse.

**Goals stay modest for now**: a few plans' worth, such as a couple of levels in one or two skills or
one resource target, not hours of open-ended play. Task code is still the task-author's, so the
runner's debugging is bounded to what a plan controls: method, spot, params, phase order and
conditions. Lengthen goals once runners handle these reliably.

**The task-runner** owns the goal until it is reached. It picks the methods, writes and runs plans,
reads failures from the logs, screenshots and state, and changes its plan or params when the world
is at fault (a depleted area, a bad spot, stray items, a missing restock phase). It journals every
plan run (`journal.ts run ...`), so the run counts, stats and retrospectives keep working.

**The runner keeps durable state** in `.durable-state/runners/<bot>.json`, a companion file beside
the conductor's `state.json` (which the conductor owns, per the durable-state skill's one-owner
rule). It holds the goal, constraints and budget verbatim from the dispatch, the plans tried with
each one's verdict, the current plan path, a pending decision if one is open, and the lessons
collected for the curator. The runner writes it after every plan run and decision, and reads it
first on every turn: a resume via `SendMessage`, a compaction, or a fresh runner the conductor
dispatched onto the same goal because the old one was lost. The conductor's `state.json` records
the runner's agent ID and the path of its file, and the conductor reads the file on resume to see
where the goal stands without asking the runner.

It comes back to the conductor only when:

- the goal is reached, or its budget is spent;
- the fix is in task or engine code (a script fault: the conductor dispatches a task-author);
- a decision is outside the goal's constraints: spending or selling beyond them, a risky area, a
  quest or unlock, a different goal being the better use of time;
- the goal looks unreachable as set.

**Asking without ending.** For a decision, the runner leaves the bot safe (no plan running, out of
combat, at a bank or the spot), ends its turn with a `DECISION NEEDED` report (the question, the
options it sees, the evidence), and the conductor answers with `SendMessage` to that runner's agent
ID. That resumes the same runner with its context intact, so it carries on with the goal rather than
a fresh runner relearning it; the runner's state file covers the case where it cannot be resumed.

Consequences for the other loops:

- The knowledge-curator runs once per goal (or per decision report), on the runner's collected
  lessons and RESULT lines, not after every run.
- The retrospective still counts plan runs from the journal; "the same objective failing 3 times"
  becomes "a runner reporting the goal unreachable".
- The conductor skill's dispatch template becomes "Goal / constraints / budget / knowledge"; the
  numbered chains and the conductor's inventory walk-through go away (the plan's `when`s carry it).
  `.claude/agents/task-runner.md` gets the plan API, the debug loop, the return conditions and the
  decision report format.

## The examples as plans

Spots in capitals are constants the plan declares; the verified ones are in each task's description.

```ts
// 1. chop -> burn: above. 2. chop -> fletch: the same with fletching in place of firemaking.
phase(fletching, { product: 'arrow shaft', logs: 'Logs' }, { when: v => v.full && v.inv('Logs') > 0 }),
phase(woodcutting, { tree: 'tree', onFull: 'stop', area: TREES }),

// 3. fish -> cook -> thieve: the food thieving eats sets how often it fishes.
phase(thieving, { npc: 'Man', area: MEN, food: ['Shrimps'] }, {
    when: v => v.inv('Shrimps') > 0,
    until: v => v.inv('Shrimps') === 0,
}),
phase(cooking, { food: 'Raw shrimps', dropBurnt: true, area: RANGE }, { when: v => v.inv('Raw shrimps') > 0 }),
phase(fishing, { method: 'net', onFull: 'stop', area: DRAYNOR_NET }),

// 4. chickens -> feathers -> arrows
phase(fletching, { product: 'arrow shaft', logs: 'Logs', attachFeathers: true }, {
    when: v => v.inv('Feather') >= 75 && v.inv('Logs') >= 5,
}),
phase(woodcutting, { tree: 'tree', onFull: 'stop', area: TREES }, {
    when: v => v.inv('Logs') < 5,
    until: v => v.inv('Logs') >= 5,
}),
phase(combat, { target: 'Chicken', area: CHICKENS, loot: ['Feather'] }, { until: v => v.inv('Feather') >= 75 }),

// 5. mine -> bank -> smelt -> smith
phase(smithing, { mode: 'smith', bar: 'bronze', product: 'dagger', area: ANVIL }, { when: v => v.inv('Bronze bar') > 0 }),
phase(smithing, { mode: 'smelt', bar: 'bronze', area: FURNACE }, {
    name: 'smelt',
    when: v => v.inv('Copper ore') > 0 && v.inv('Tin ore') > 0,
}),
phase(bank, {
    area: BANK,
    depositAllExcept: ['Bronze pickaxe', 'Hammer'],
    withdraw: [{ item: 'Copper ore', count: 14 }, { item: 'Tin ore', count: 14 }],
}, { name: 'withdraw-ore', when: v => (v.bank('Copper ore') ?? 0) >= 14 && (v.bank('Tin ore') ?? 0) >= 14 }),
phase(bank, { area: BANK, depositAllExcept: ['Bronze pickaxe', 'Hammer'] }, { name: 'deposit', when: v => v.full }),
phase(mining, { rock: ['copper', 'tin'], onFull: 'stop', area: MINE }),

// 6. fight -> bank loot and restock food
phase(bank, {
    area: BANK,
    depositAllExcept: ['Bronze sword'],
    withdraw: [{ item: 'Trout', count: 10, upTo: true }],
}, { when: v => v.inv('Trout') === 0 || v.full }),
phase(combat, { target: 'Cow', area: COWS, food: ['Trout'], loot: ['Cowhide'] }, {
    until: v => v.inv('Trout') === 0 || v.full,
}),
```

## Task changes the examples need

- `bank`: a withdraw that takes what there is (`upTo: true`, or `count: 'all'`). Today it fails when
  the bank holds fewer than `count`, which ends example 6 on the last restock.
- Check per plan, not up front: example 4's fletching with `attachFeathers` on a mix of logs, shafts
  and feathers; example 5's bank phases with ore counts that come out unequal from mining.

## Tests

- Unit (`bun test conductor`, scripted worlds through `simulate`): phase selection order; `until`
  ending a phase and the plan going on; `until` waiting out combat; `onFail` fail, continue, the
  function form and `maxFails`; the no-progress rail; params checked up front; plan `--until` across
  phases; `v.bank` remembered across phases; predicate exceptions.
- Smoke (`conductor/test/integration/smoke/plan.itest.ts`): chop-burn on a worker, two full cycles.

## Later, not in the first cut

- Plan-level replay: re-derive the phase choices from the recordings at each phase boundary.
- Bank knowledge across plans (the last bank contents any run saw, from the run logs).
- A `once` flag if `v.runs(...) === 0` turns out to be common.
