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

| Shape      | Ends `done` when                         | Tasks                                                    |
| ---------- | ---------------------------------------- | -------------------------------------------------------- |
| Producer   | the inventory is full (`onFull: 'stop'`) | woodcutting, fishing, mining                             |
| Consumer   | its input is used up                     | firemaking, fletching, cooking, smithing, crafting, fill |
| Errand     | its operations are made                  | bank, shop, pickup                                       |
| Open-ended | never on its own                         | combat, thieving (`stopWhenFull` aside)                  |

Only the open-ended tasks need an outside "until". `thieving` does not end when its food runs out: a phase needs an `until` on food, or the low-hp guard fails the run (`knight-thieve` does this). [v 2026-10-16 conductor2w3 local]

## The model

A plan is an ordered list of **phases**. A phase is one catalog task with params, plus:

- `when(v)`: whether the phase may start. Default: always.
- `until(v)`: optional; ends the phase `done` early. Checked at every tick of the phase.
- `onFail`: what a `failed` or `stuck` phase means for the plan. Default `'fail'`. A death always ends the plan, whatever this says.

The runner does what the engine does with steps, one level up:

1. Check each phase's `when` in order; the first that holds runs. None holds: the plan ends
   `failed` (`no phase applies (last: <phase> <status>: <reason>)`, the last part once a phase has
   run), and the plan log's `select` event shows what each phase's `when` and `until` answered
   and what they read off the view (`reads`, by phase: `{ "inv('Logs')": 0 }`; the plan's own
   `until`'s in `planReads`), the last phase run, and the inventory, free slots and known bank
   counts.
2. Run it as a normal `executeTask`: its own preflight, memory, guards, watchdog, step budget and
   leftover-modal close.
3. It ends `done` (by itself or by its `until`): back to 1. It ends `failed` or `stuck`: apply its
   `onFail`. It ends `error`: the plan ends `error` (a bug, not the world).

A phase's `when` is checked only at step 1, between phase runs, never during one: a phase without its own `until` keeps running past the level or count at which a later phase's `when` would hold. Put an `until` on an open-ended training phase when a later stage starts at a level. [v 2026-10-23 conductor3 local]

Choosing from state and not from a position in a list is what makes a plan resume: after a
restart, or a dispatch onto a half-full inventory, the first applicable phase is still the right
one.

A death is the exception: it ends the plan `failed` (`<phase>: died ...`) whatever the phase's
`onFail` and `maxFails` say, whether the death guard ended a phase run or a respawn is seen between
two runs.

The ordering rule that falls out is **consumers above producers**, so the inventory drains before
it refills.

## The API

```ts
// conductor/plans/chop-burn.ts (drafted as conductor/runs/<bot>/plans/chop-burn.ts)
import { definePlan, phase } from '@conductor/lib/plan';
import firemaking from '@conductor/tasks/firemaking';
import woodcutting from '@conductor/tasks/woodcutting';

export default definePlan({
    name: 'chop-burn',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            firemaking,
            { logs: 'Logs', area: { x: 3230, z: 3240, radius: 6 } },
            {
                when: v => v.full && v.inv('Logs') > 0,
            },
        ),
        phase(woodcutting, { tree: 'tree', onFull: 'stop', area: { x: 3195, z: 3220, radius: 12 } }),
    ],
});
```

- `phase(task, params, opts?)` takes the task's default export, so `params` is type-checked against
  `z.input<typeof task.params>`. `opts`: `{ name?, when?, until?, onFail?, maxFails? }`; `name`
  defaults to the task's name and must be unique in the plan when a task appears twice (two bank
  phases).
- `definePlan({ name, description?, phases, until?, requires?, method? })`. The plan's own `until(v)` ends
  the whole plan `done`. `requires` maps what the plan needs throughout to a predicate
  (`'combat level 5+'` above: the walk between the spots passes Giant spiders that attack lower
  levels): each is checked before every phase choice, and one that does not hold ends the plan
  `failed` with `plan requires <key>`. A `when` on every phase would refuse the same, but only as
  `no phase applies`.
- `method` (optional) is the id of the training method the plan runs, a record of
  `wiki/world/methods.ts` whose `plans` lists this plan back. `conductor/test/plans.test.ts` fails
  when the two disagree either way (a method world.json lacks, or one that doesn't list the plan; a
  method listing a plan that isn't promoted or names another method) and prints the promoted plans
  with no `method` as a to-do list. `stats.ts <bot> --methods` sets each method's plan runs beside
  its floor at the levels each run started on. A plan names a method only when its whole run IS
  that method's cycle: one that does more (iron-bulk mines, then smelts and smiths) names none, as
  its whole-run XP/hr measures another activity.

### The view (`v`)

Predicates get one read-only view and must be pure: no I/O, no clock, no state of their own. That
keeps every phase choice re-derivable from a run's recorded states.

| Member              | Meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `v.state`           | the current `BotWorldState`, for anything below not covering it         |
| `v.inv(item)`       | inventory count; `item` is an exact name (case-insensitive) or a RegExp |
| `v.full` / `v.free` | every slot used / free slots                                            |
| `v.bank(item)`      | bank count as last seen open during this plan; `undefined` before that  |
| `v.level(skill)`    | base level                                                              |
| `v.hp`              | `{ current, max }`                                                      |
| `v.quest(id)`       | `'none'`, `'started'` or `'done'` from the quest tab (see below)        |
| `v.questDone(id)`   | the quest tab shows the quest green                                     |
| `v.runs(phase)`     | times that phase has run in this plan                                   |
| `v.last`            | the previous phase's `{ phase, status, reason }`, or `null`             |

`v.quest` and `v.questDone` take the id of `conductor/lib/quests.ts` (the content's `questlist:` name:
`imp`, `runemysteries`, `priest`, `fortress`, ...; an unknown id throws). Quest varps are not sent to the
client, so progress comes from the quest tab: the server colours each entry red, yellow or green at login
and on every progress change, and the client state carries those colours (`state.questTab`). That is three
states, not the stage number: a phase that needs the exact stage still chooses from the inventory and the
previous phase, and uses `questDone` for its `until`. A state with no quest tab (a client that predates it,
or before the login script ran) reads `'none'`, so `questDone` is false until the tab is seen; a quest plan
declares `requires: { ...QUEST_TAB_REQUIRED }` (from `lib/quests`) so it fails fast with a reason instead of
looping on such a state.

`v.bank` exists because "smelt once enough ore is banked" needs it and the state only shows the bank
while it is open: the runner keeps the last bank contents it saw in any phase. The client lists the bank
empty for the one tick before it reports it closed, so a single empty tick after a listed one is ignored
(two in a row are taken as an emptied bank). A bank emptied by a final withdraw-all and closed on the very
next tick therefore reads as its pre-withdraw contents until it is next opened.

`v.runs` gives one-shot steps without a program counter: `when: v => v.runs('withdraw') === 0` is
today's chain step "withdraw first". A one-shot chain ends through the plan's `until` (e.g.
`until: v => v.runs('burn') > 0`), since running out of applicable phases is a failure.

`runs()` counts are per run-task process and reset when the run is restarted, so a one-shot buy or withdraw phase gated on `runs()` fires again after a restart. Gate it on held state instead (coins, items held or banked); `tools-food` gates its axe purchase on Coins >= 200. [v 2026-10-23 conductor3 local]

### `onFail`

`'fail' | 'continue' | (r: TaskResult) => 'fail' | 'continue'`

`'continue'` goes back to selection with that phase skipped for the next selection, so a fallback
phase below it gets the turn. A phase that fails `continue` this many times in a row (`maxFails`,
default 3) fails the plan. A preflight refusal is a `failed` phase like any other: preflight is never
used as an implicit `when`, so a missing tinderbox fails loudly rather than leaving the plan chopping
forever.

A phase that fails `continue` with no fallback phase whose `when` holds leaves nothing to select, so the plan ends `failed` with `no phase applies` after that one failure; give a `continue` phase a fallback (a restock, a travel phase). [v 2026-10-23 conductor3 local]

## The runner's safety rails

- **No progress.** A phase run is idle when it ends with total XP, inventory and position as they
  were when it started, or in an end state another phase run already reached since XP last rose; 3
  idle phases in a row end the plan: `done` (`nothing left to do: <names> done (<last reason>)`, plus
  `; plan until not met` when the plan has an `until`; this `done` means the phases ran out of work,
  not that the `until` was reached) if every one of them ended `done`, since the
  phases have nothing left to do; a phase re-chosen that ends `done` at once, in the state it
  started in, right after it ended `done`, ends it at the first repeat. `failed` (`phases make no
progress (...): <names>`) if any ended failed or stuck, a real stall. It catches two
  phases handing the turn back and forth (woodcutting `onFull: 'stop'` on an inventory full of
  something else ends at once; so does a consumer with nothing to consume), and two that undo each
  other (deposit then withdraw, walk there then back), each changing the state but the plan going
  nowhere.
- **Params up front.** Every phase's params are parsed against its task's schema before the plan
  acts, so a typo fails the plan in the first second, not after an hour of the first phase.
- **Done-at-once twice ends the plan.** A phase that ends done at once (no change), twice in a row from the same start state, ends the plan as done. Split a repeated action into distinct phases (`manhole-open`/`manhole-down`, `cell-door-a`/`-b`), vary the start tile of a retry, or give the phase an `until` on the position change. [v 2026-10-24 questw7 local]
- **Stale view after a cast, jump or pickup.** The next phase selection can read the pre-action inventory or loc view and re-pick the same phase (a spell cast wastes a 25-tick bloom; repeated jumps). Guard such a phase with `v.last` plus a short walking settle phase. An `items drop` of several named items fails preflight if one is absent: one phase per junk item. A `pickup` can fail "attacked while picking up" near monsters: two identical phases with `onFail: 'continue'`. [v 2026-10-24 questw1 local]
- **Predicate errors.** A `when` or `until` that throws ends the plan `error`, naming the phase.
- **Combat between phases.** `executeTask` refuses to start in combat. A stop or `until` that lands
  in a fight (the bot attacked, or still fighting its own target) ends the phase after the engine
  settles the fight (at most 100 ticks); any phase that does not end done after the stop or `until`
  fired (a guard failing in the settle is the common case) ends the plan failed, whatever `onFail` says. Combat that starts in the gap between phases goes through the next phase's `onFail` like any
  refusal.
- **The Wilderness is opted in per phase.** A phase that ends in the Wilderness (`travel` or `interact`
  with `wilderness: true`) leaves the bot there, and the Wilderness guard ends any later phase that has not
  opted in too, so the phase that follows (the next `interact`, the `travel` out) sets `wilderness: true`
  as well; each opted-in phase needs its own `minFood` food at its start.
- **One controller connection for the whole plan**, so nothing can take the bot between phases.

## Stops and the engine hooks

- `--until` applies to the plan: `minutes:` counts from the plan's start, `xp:` from the plan's
  starting XP. A plan stop ends the running phase and the plan `done`.
- Engine change: `ExecuteOptions.externalStop?: (s: BotWorldState) => string | null`, checked in
  `checkRun` beside the task's stops. The runner passes one closure that checks the plan stops and
  the phase's `until` and remembers which fired, so the engine needs no new result field to say why
  a phase stopped.
- Recording: when an external stop fires, the recording gets a `{ k: 'stop', tick, check, reason }`
  record: the stop fired on the `check`th externalStop call, on the state of `tick`. The replay
  gives the engine an externalStop that returns the recorded reason on that same call, so a phase
  cut short by `until` still replays to the same end without running past its recording.

## Results, logs and stats

- Each phase writes its own NDJSON log and `.ticks.ndjson.gz` recording as a task run does today,
  so `replay.ts` works per phase unchanged.
- The plan writes `conductor/runs/<bot>/<runId>-plan-<name>.ndjson`: the plan source path with the
  CLI's `pid` and Claude Code `session` (`source`), a `select` event per phase choice (the phase
  chosen, what each phase's `when` and `until` answered, the last phase run, inventory, free slots
  and known bank counts), each phase run's start (`phase-start`, naming its log) and end
  (`phase-end`, with the run's own `durationMs` and `xpGained`), and the plan's result. The plan viewer ([`plan-view.md`](plan-view.md)) reads it.
- The last stdout line stays `RESULT <json>`: a `TaskResult` with `task: "plan:<name>"`, the plan's
  totals (`xpGained`, `inventoryDelta`, `durationMs`, ...), `stepRuns` keyed by phase, and three
  extra fields: `phases`, one entry per phase `{ phase, task, runs, statuses, durationMs, xpGained,
lastReason }`, `recent`, the last 3 phase runs `{ phase, runId, logFile, status, reason }`, and
  `bankDelta`, the bank as last seen open less as first seen open (the bank changes only while
  open, so that is the plan's change to it; absent when the plan never saw the bank open).
  A plan that ends done after at least one phase reads `PLAN_SETTLE_TICKS` more states (`runPlan`'s optional
  `nextTick`) before building the result, so reward XP published after the `until` holds (a quest's lump)
  appears in the plan total but in no phase's `xpGained`.
  The task-runner, the journal and `stats.ts` read it as they read any task's result; `params`
  holds each phase's task and parsed params (the same whether the plan ran or not), so `stats.ts`
  keys a plan as one method and its XP/hour compares with single tasks.
- `stats.ts <bot> --methods` reads a plan's whole runs per curated method (`method` above): the XP/hr
  of each skill the method trains over the plans' total run time, and beside it each run's floor at
  the base levels it started on (read from its first phase run's recording) and the best axe or
  pickaxe held at any of its phase runs' starts. The gap is the runs' XP over the XP their floors
  make in their hours (the floor printed is that, per hour); runs whose recording shows no start count
  in neither, and the report says how many. A `measured` entry for `wiki/world/methods.ts` is printed
  when every counted run started at the same levels and tool; otherwise a table of the runs, and
  `--since` narrowed to runs at one level gives one. A run that levels up trains above its start
  levels, so its floor understates.
- A plan killed by a signal (SIGINT, SIGTERM, SIGHUP) ends `error`, `killed by <signal>`, with its
  totals so far in the RESULT and the plan log, the cut phase run counted as `error`; so stats keeps
  its XP and runs although its phase runs (`partOf`) count only with `--phases`. A hard kill
  (SIGKILL, a crash) leaves the plan log without a result: stats then counts none of the plan, and
  its finished phase runs only with `--phases`.

## Where plans live

- **Drafts**: `conductor/runs/<bot>/plans/<name>.ts`, inside the gitignored run artifacts, next to
  the logs of the runs that used them. The task-runner writes them there (it gets the Write tool for
  that path only; it still never edits task or engine code) or reuses a promoted plan as it is.
- **Promoted**: `conductor/plans/<name>.ts`, committed. When a runner reports a draft that worked,
  the conductor moves it in (`mv` + `git add`: the draft is untracked, so `git mv` refuses it) and
  commits it with the runs' results in the message: git history is the plan's review.
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
