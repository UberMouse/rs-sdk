# Spec: the quest layer

Expands the design `conductor/docs/quest-layer.md` into ordered tasks. Each `## Task N —` section
is one unit of subagent-driven work: implemented and committed by one agent, then reviewed for spec
compliance and code quality before the next starts. Tasks are ordered primitives-first; a task may
use anything an earlier task landed.

## Global rules (apply to every task)

- **Do not edit** `sdk/`, `server/`, `mcp/` or `wiki/`.
- **Existing plans keep their behaviour.** Do not edit a file in `conductor/plans/` unless the task
  names it. Every new option, view member and task flag is optional and defaults to today's
  behaviour.
- **Contracts that stay as they are**: the `run-task.ts` CLI, the `RESULT <json>` line, the
  `TaskResult` fields (additions to log events are fine), and per-phase recordings and their replay
  (`conductor/tools/replay.ts`).
- **Predicates stay pure**: a view member reads the state and the plan's own record, never a clock
  or I/O. New view members are scalars or functions, never objects or arrays, so `recordReads`
  logs them.
- **Game time is ticks.** No `Date.now()` or `setTimeout` in `conductor/lib`, `tasks`, `actions`
  or `core`; time comes from `state.tick` or the injected `now()`.
- **Formatting and lint**: finish with `bun run verify:conductor` (oxfmt check, oxlint with
  warnings denied, `tsc --noEmit`). `bun run fmt` formats in place.
- **Unit tests** live in `conductor/test/**/*.test.ts` (bun:test), need no server and never call
  `process.exit`. Run `bun test conductor` (never `bun test conductor wiki`, never two test runs at
  once). A task adds tests beside the ones for the file it changes, in that file's existing style.
- **Integration tests** (`conductor/test/integration/**/*.itest.ts`) run only as
  `bun run test:integration <filter>` for the files a task names, never the whole suite, against
  the shared local stack (engine `:8888`, gateway `:7780`). If the stack is not listening, say so in
  the report and leave the itest written and unrun; do not start or restart the stack.
- **Live runs use the worker `conductor3w1` only** (load a save with
  `bun conductor/tools/load.ts conductor3w1 lib:<save> --client`), never another account, and only
  where a task says so.
- Game knowledge goes in `learnings/` or `wiki/quests/` per the `knowledge` skill, not in code
  comments. Comments match the surrounding density: explain why, not what.

Facts every task may rely on (measured 2026-11-14, see the design doc): the journal is interface
8134; its title is component 8144 and its text lines are components 8145 and 8147 to 8195, in
order; `conductor/actions/press.ts` already has `interfaceTexts(state)` (component id to text),
`interfaceOpen` and `pressComponent`; a click on a quest-tab entry opens the journal two ticks
later, closing takes two ticks, and the click destroys an open chat dialog or main modal.

**Amendment (2026-11-14, found by Task 2's smoke test):** the journal's title is the name the
quest's journal script passes to `~quest_journal("<name>", ...)`, which differs from the tab name
for 16 of the 68 quests (Cook's Assistant shows "The Cook's Quest"). So wherever Tasks 1 and 2 say
the title is mapped or compared through `QUESTS[id].name`, read: through the quest's journal
title, `QuestInfo.journalTitle` where it is set and `name` otherwise. `quests.test.ts` checks each
row's journal title against the `quest_journal` literal of the quest's journal script. Task 2's
smoke test expects the `cook` run's reason to match `/Lumbridge Castle/` (its last line), not
`/Cook/`. Task 2 carries this fix, including the Task 1 code it touches.

## Task 1 — Journal memory, its view members, and `observes` tasks

**Files:** `conductor/lib/journal-memory.ts` (new), `conductor/lib/plan.ts` (`PlanView`, `runPlan`:
`observe`, the watched driver, `view()`, the bookkeeping after a phase run), `conductor/lib/task.ts`
(`TaskDef.observes`), `conductor/lib/quests.ts` (a lookup from tab name to quest id, if none
exists), tests in `conductor/test/lib/journal-memory.test.ts` (new) and
`conductor/test/lib/plan.test.ts`.

**Journal memory** (model it on `conductor/lib/bank-memory.ts`, including how a phase's driver is
wrapped so states a phase reads are observed too):

- `journalOf(state)`: `null` unless interface 8134 is open; otherwise `{ title, lines }`, `title`
  the text of component 8144, `lines` the non-empty texts of components 8145 and 8147-8195 in
  component order. `null` too when the open interface has no title text (a client whose dump
  carries no text).
- The memory keeps, per quest id, the text last seen (the lines joined by single spaces) and is fed
  every state the plan or a phase reads. The title is mapped to a quest id through
  `QUESTS[id].name`; a title that matches no quest is ignored.
- The first time a quest's journal is seen, and each time its text differs from the text kept, the
  runner emits a plan log event `{ type: 'journal', quest, text, changed }` (`changed` false for
  the first sight). The same text seen again emits nothing.

**View members** (documented in their doc comments):

| Member                     | Meaning                                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journalSays(id, pattern)` | `undefined` when this plan run has not seen the quest's journal; else whether `pattern` matches the kept text. The pattern is tested statelessly (the existing `stateless` helper). Unknown quest id throws like `quest(id)` |
| `journalAge(id)`           | `undefined` when not seen; else the number of acting phase runs that ended since it was last seen (0 right after a read)                                                                                                     |

**`TaskDef.observes?: true`**: a task that only looks. For a run of such a task in a plan, the
runner:

- does not set `v.last` (so `v.last`, `lastDone` and `lastFailed` keep describing the last acting
  run), and does not clear or set `skip` or `prevDone`;
- leaves the run out of the idle rail and of the `maxWaits` count, in both directions (it neither
  adds an idle run nor resets one), with one exception: when a `journal` event with
  `changed: true` was emitted during the run, the idle run is cleared, as a run that made progress
  clears it;
- does not age the journal (`journalAge`).

Everything else about the run is as for any phase: its summary, its `phase-start`/`phase-end`
events, `v.runs(name)`, its recording, `maxFails` and `onFail` when it fails.

An acting phase run is any run of a task without `observes`.

### Acceptance criteria

- [ ] `journalOf` returns title and lines for a state with 8134 open, drops empty lines, keeps
      component order, and is `null` for another interface, a closed one, and a dump without text.
- [ ] `v.journalSays` is `undefined` before a sight, then follows the text of the quest named,
      with a pattern spanning two wrapped lines matching, and a `/g` pattern giving the same answer
      twice.
- [ ] A journal seen in a state only a phase's driver read (never the plan's own read) reaches the
      memory.
- [ ] `v.journalAge` is 0 after the sight, rises by one per acting run, and does not rise for an
      `observes` run.
- [ ] After an `observes` run, `v.last` is the acting run before it; a `'continue'` skip set by
      that acting run still applies at the next selection.
- [ ] Three idle acting runs with `observes` runs between them still end the plan by the idle
      rail; an `observes` run during which the journal text changed clears the idle run.
- [ ] The `journal` event is emitted on first sight and on change only.
- [ ] Unit tests pin each criterion above. No existing test changes meaning.
- [ ] Out of scope: the task that opens the journal (Task 2); anything in `conductor/plans/`.

## Task 2 — The `journal` task

**Files:** `conductor/tasks/journal.ts` (new), an action in `conductor/actions/` only if the
existing `press.ts`/`modal.ts` ops do not cover it, `conductor/test/tasks/journal.test.ts` (new),
`conductor/test/integration/smoke/journal.itest.ts` (new), the scripted world in `conductor/test/`
if it needs a journal interface, `conductor/lib/journal-memory.ts` (only to share `journalOf`).

A catalog task `journal`, `observes: true`, params `{ quest }` (a `QUESTS` id, `.describe()`d;
an unknown id is a params error naming `lib/quests.ts`). Its component id is the `questlist:<id>`
entry of `server/content/pack/interface.pack`; resolve it the way `press.ts` resolves component
names, and fail the run with a reason if the pack has no such entry.

One run:

1. If a chat dialog is open (`state.dialog.isOpen`) or a main modal other than the journal is open
   (`state.modalOpen`), end **failed** without clicking: `journal not read: <dialog|modal> open`.
   The click would destroy it.
2. Click the entry and wait until `journalOf(state)` gives a journal whose title is the quest's tab
   name, at most 10 ticks. One re-click is allowed after 5 ticks.
3. Close the journal (the existing modal-close op) and wait until it is gone.
4. End **done** with the reason `journal: <the last line>` (the last non-empty line, cut to 120
   characters).

Failures, each with its own reason: the journal never opened; an interface opened whose title is
another quest's; the journal opened with no text lines (`journal has no text: this client's
interface dump carries none`). On any failure after a click the task still closes whatever it
opened.

The shared guards (death, low HP, dialogs, modals) act at every wait as for any task. If the modal
guard would close the journal before the task has seen it, exempt the journal from that guard for
this task the way other op-owned interfaces are exempted (`OP_OWNED_INTERFACES` in
`actions/dismiss.ts`), and say so in the report.

The task does not return the text: the plan's journal memory (Task 1) keeps it from the states the
run read.

### Acceptance criteria

- [ ] Unit tests on a scripted world: a normal read (click, open two ticks later, close, done with
      the last line); refusal with a dialog open and with a modal open, with no click sent in
      either; never opens; wrong title; no text lines; unknown quest id refused at params.
- [ ] In a plan (simulated), a `journal` phase makes `v.journalSays` defined at the next selection
      without setting `v.last`.
- [ ] `conductor/test/integration/smoke/journal.itest.ts` reads a journal on a live fixture bot
      (the fixture pattern the other smoke tests use; a fresh account's not-started quest is
      enough: `cook`, expecting text that matches `/Cook/`) and passes with
      `bun run test:integration smoke/journal`.
- [ ] `bun conductor/run-task.ts --list` shows the task with a description that says it refuses
      while a dialog or modal is open and that it needs the lite client.
- [ ] Out of scope: `defineQuest`; any plan.

## Task 3 — `defineQuest`

**Files:** `conductor/lib/quest.ts` (new), `conductor/test/lib/quest.test.ts` (new),
`conductor/test/simulate.ts` only if a helper is needed.

```ts
export default defineQuest({
    id: 'fluffs',                      // a QUESTS id
    name: 'gertrudes-cat',             // the plan's name
    description: '...',
    requires: { ... },                 // optional, merged over QUEST_TAB_REQUIRED
    needs: [...], needsUnless,         // optional, as on a plan
    defaults: { onFail, maxFails },    // optional; the quest default is { onFail: 'retry', maxFails: 3 }
    settle,                            // optional, as on a plan
    steps: [
        step('leaves', pickup, { ... }, { done: v => v.held('Doogle leaves') > 0 }),
        step('start', talk, { ... }, { reached: v => v.quest('fluffs') !== 'none' }),
        step('pay', talk, { ... }, { reached: journal(/paid the boys/i) }),
    ],
});
```

`step(name, task, params, opts?)` with `opts`: `reached?: Predicate | JournalMark`,
`done?: Predicate`, `skip?: Predicate`, and `until`, `onFail`, `maxFails`, `settle` as on a phase.
`journal(pattern)` makes a `JournalMark`. `defineQuest` returns a `PlanDef` (through `definePlan`),
with `until: v => v.questDone(id)`, so everything that takes a plan takes a quest.

**The cursor**, a pure function of the view, for steps `0..n-1`:

- `holds(i)`: for a predicate `reached`, its value; for a `JournalMark`, `v.journalSays(id,
pattern) === true`.
- `base` = one past the last `i` whose `holds(i)` is true; 0 when none.
- `ranPast(i)`: the last acting run (`v.last`) is a step `j` of this quest with `j > i`, or `j === i`
  and it ended done.
- A step `i >= base` is **passed** when any of:
    - `skip(v)` is true;
    - it has `done` and `done(v)` is true;
    - it has neither `done` nor `reached`, and `ranPast(i)`;
    - it has a predicate `reached` and no `done`: never (only `base` passes it);
    - it has a `JournalMark` and no `done`: `ranPast(i)` and the journal cannot confirm it now,
      meaning `blocked(v)` (below) is true. With a fresh journal that does not match, it is not
      passed and runs again.
- The cursor is the first step `>= base` that is not passed. When every step is passed and the
  quest is not done, no phase applies and the plan fails as plans do today.

**The journal read.** If any step has a `JournalMark`, the compiled plan's first phase is
`phase(journal, { quest: id }, { name: 'journal' })`. With
`blocked(v) = v.state.dialog.isOpen || v.state.modalOpen`, its `when` is:

```
v.questStarted(id) && !blocked(v) &&
  (v.journalAge(id) === undefined ||
   (v.journalAge(id) > 0 && (the last acting run was a step with a JournalMark || v.lastFailed())))
```

Each step compiles to a phase named after it with `when: v => !needsRead(v) && cursor(v) === i`,
in story order, carrying its `until`, `onFail`, `maxFails` (the quest's defaults where unset) and
`settle`. A quest with no `JournalMark` has no `journal` phase and never reads the journal.

**Checked when the quest is defined** (throwing with the quest's name and the step): an unknown
quest id; duplicate step names; a step named `journal`; an empty `steps`; a `JournalMark` pattern
with the `g` or `y` flag.

### Acceptance criteria

- [ ] Simulated plan runs (the harness `plan.test.ts` uses) pin: steps run in story order from a
      fresh state; a state where a late `reached` holds starts after it; `done` steps are stepped
      over and run again when their evidence goes away; a step with no evidence runs once, and
      again after a new `runPlan` (a restart); `skip`.
- [ ] A journal quest: the read runs first once the tab shows started, not before; after a step
      with a `JournalMark` the read runs before the next step; a fresh journal that does not match
      re-runs the step; with a dialog open the read is not selected and the step is passed
      provisionally; after a failed run the read runs before the retry.
- [ ] A failed step is retried up to `maxFails` under the default, and a step's own `onFail`
      overrides it.
- [ ] The compiled plan passes `invalidParams` and the plan lint (`lib/plan-lint.ts`) where the
      lint applies to a `PlanDef`; each definition-time check has a test.
- [ ] The cursor and `needsRead` are exported for tests and are pure (same view, same answer).
- [ ] Out of scope: converting a plan; docs.

**Amendment (2026-11-14, found building Task 3):** as first written, a `JournalMark` step passed
provisionally while a dialog was open stopped being passed once the next step ran and the dialog
closed, so it ran a second time. The rule is now: a `JournalMark` step with no `done` is passed
when `ranPast(i)` and the journal is not fresh (`blocked(v)` or `v.journalAge(id) !== 0`); with a
fresh journal (`journalAge` 0) that does not match, it is not passed. And the journal read is also
needed (same guards: started, not blocked, `journalAge > 0`) while any `JournalMark` step at or
after `base` with no `done` is passed that way, so the confirmation happens at the first selection
with no dialog or modal open.

**Amendment (2026-11-14, from Task 3's code review):** a step whose `until` is set and holds on
the view is passed, as by a `done` that holds (before, such a step was never chosen and nothing
else applied). A throw from a step's `reached`, `skip`, `until` or `done` is rethrown as
`step "<name>" <which> threw: <message>`.

## Task 4 — `gertrudes-cat` as a quest, proven live

**Files:** `conductor/plans/gertrudes-cat.ts` (rewritten with `defineQuest`, same plan name and
file), `wiki/quests/` or `learnings/` for what the runs teach (the one exception to the global
`wiki/` rule: `wiki/quests/*.md` is agent-maintained), `conductor/test/plans.test.ts` only if it
needs to know about quests.

Rewrite the plan in story order: get doogle leaves, season the sardine, open the door, start with
Gertrude, pay Shilop/Wilough, climb up, feed milk, feed the sardine, climb down, search the crates,
climb up, return the kitten, go back and finish. Keep the params (tiles, names, choices) of the
current phases: they were proven by runs. Take each journal pattern from the quest's journal script
(`server/content/scripts/quests/quest_fluffs/`), and confirm it against the journal text the live
run logs (`journal` events). Use `done` for what the state shows (items, floor) and a `reached`
journal mark for each stage the journal words differently. The plan must no longer use `v.runs` or
`v.last`, and the three `shilop` phases become one step.

Live proof on `conductor3w1` (lite client; the stack is up):

1. `bun conductor/tools/load.ts conductor3w1 lib:gertrudes-cat-start --client`, then
   `bun conductor/run-task.ts conductor3w1 --plan conductor/plans/gertrudes-cat.ts` to quest done.
2. Load the save again, run with `--until minutes:1` (or kill the run once it is past the payment),
   then run again in a fresh process with no stop: it must pick up at the right step and finish.
3. Once more with the kill at a different point, after the kitten is found if the first was before.

A run that fails is debugged from its plan log and fixed in the plan; a failure whose cause is in
`lib/quest.ts`, the `journal` task or the runner is fixed there with a unit test that reproduces
it, and reported as such.

### Acceptance criteria

- [ ] The report quotes the three `RESULT` lines (status done, quest done) and, for the two resumed
      runs, the step each resumed at and why that was right.
- [ ] The plan file reads in story order, has no `v.runs`/`v.last`, no duplicated phase, and is
      shorter than the 177-line original.
- [ ] `bun test conductor` passes, including the plan lint over the rewritten file.
- [ ] Anything the runs taught about the quest is in `wiki/quests/gertrudes-cat.md` (or the page
      the knowledge skill names) with provenance.
- [ ] Out of scope: any other plan.

## Task 4b — Delayed stages: a confirming read that waits, and a wait for completion

Added 2026-11-14 from Task 4's live runs: a quest script often moves the stage some ticks after the
step's task has ended (Gertrude's Cat: about 12 ticks after the kitten is used, about 9 after the
last dialog), so a read straight after the step sees the old stage and the step runs again, and a
quest completed by a delayed script ends "no phase applies".

**Files:** `conductor/tasks/journal.ts`, `conductor/lib/quest.ts`, their tests
(`conductor/test/tasks/journal.test.ts`, `conductor/test/lib/quest.test.ts`),
`conductor/plans/gertrudes-cat.ts`, `wiki/quests/gertudes-cat.md` if a fact changes.

**The `journal` task waits for an expected line.** New optional params `expect` (a regex source,
matched case-insensitively against the journal's lines joined by single spaces, the text
`v.journalSays` tests) and `withinTicks` (default 20, 1 to 100). With `expect`: when the journal
read does not match, the task closes it, waits 4 ticks and reads again, until it matches or
`withinTicks` have passed since the first read. Every click keeps the no-dialog, no-modal check.
It ends **done** either way (the journal was read; whether it matched is the plan's to judge),
with the reason `journal: <last line>` and, when the wait ran out, `(no "<expect>" within N
ticks)` appended. Without `expect` the task is unchanged.

**`journal(pattern, { within })`.** A `JournalMark` takes an optional `within` (ticks, default 20).
For each step with a `JournalMark`, `defineQuest` compiles a read phase named `journal:<step>`
with `{ quest, expect: pattern.source, withinTicks: within }`, selected when a read is needed and
the last acting run was that step ending done. The plain `journal` phase takes every other needed
read. Both are `observes` runs. A pattern's flags other than `i` are refused at definition (it is
passed to the task as a source and matched case-insensitively there; `v.journalSays` uses the
pattern as written).

**The wait for completion.** `defineQuest` appends a last phase named `complete`:
`phase(wait, { ticks: 20, orFail: true }, { until: v => v.questDone(id) })`, selected when no read
is needed and every step is passed (`cursor` is null). It is retried under the quest's defaults,
so a quest that never completes fails with the wait's reason after `maxFails` waits, where it
failed "no phase applies" before. `journal`, `complete` and any name starting `journal:` are
refused as step names.

**`gertrudes-cat`** drops its `reward` step, and `return-kitten` drops what it only needed for the
delayed stage if the confirming read now covers it (keep whatever the live run shows is still
needed, and say which). One live run from `lib:gertrudes-cat-start` to quest done on `conductor3w1`
proves it.

### Acceptance criteria

- [ ] Journal task unit tests: `expect` matching at the first read (one open and close, no wait);
      matching at the third read (three opens, done, reason without the suffix); never matching
      (done with the suffix after `withinTicks`); a dialog opening between reads ends the run
      failed with `journal not read: dialog open` and no further click.
- [ ] Quest unit tests: after a mark step ends done the phase selected is `journal:<step>` with
      that step's pattern and `within`; after a failed run or at the first selection it is
      `journal`; a stage that moves 10 ticks after the step is confirmed without the step running
      twice; `complete` runs when every step is passed and ends the plan done when the quest
      completes during it; a quest that never completes fails after `maxFails` waits; the reserved
      names and the flag check each have a test.
- [ ] The live `RESULT` line (status done, `plan until met`) is quoted, with the plan's phase
      order from its log showing `journal:return-kitten` and `complete`.
- [ ] `bun test conductor` and `bun run verify:conductor` pass; `smoke/journal` still passes.
- [ ] Out of scope: other plans; docs (Task 5).

**Amendment (2026-11-14, from the code review of Tasks 4 and 4b):** a journal mark is always
case-insensitive (`journal()` adds the `i` flag, so the cursor and the step read agree). A step
whose own `onFail` is the string `'continue'` is run past once its run has ended, failed or done
("try this, carry on if it fails"); a `done` still judges such a step alone, and a function
`onFail` does not move the story on. The `journal` task sizes its watchdog for its longest run and
closes only the journal.

## Task 5 — Docs and agent prompts

**Files:** `conductor/docs/plans.md` (a section on quests: `defineQuest`, `step`, the two kinds of
evidence, the cursor rule in plain words, when the journal is read and why never over a dialog,
`observes`, the `journal` task, `v.journalSays`/`v.journalAge`, what a step with no evidence means
after a restart), `conductor/README.md` (one or two lines where plans are introduced),
`.claude/agents/task-runner.md` (a new quest plan is written with `defineQuest`; how to find a
quest's journal wording; keep the file within its size cap, raising the cap only if no wording can
be trimmed without losing an instruction), `conductor/roadmap.md` (the quest-layer follow-up
becomes done; add: convert the remaining quest plans as each is next run, browser-client journal
text, quest requirements declared once, step skeletons from journal scripts),
`conductor/docs/plan-primitives.md` ("Next: the quest layer" points at `quest-layer.md`).

### Acceptance criteria

- [ ] Each fact in the docs matches the code landed by Tasks 1-4 (names, defaults, the exact read
      conditions, the refusal reasons).
- [ ] The docs say the journal read needs the lite client and what happens on the browser client.
- [ ] `bun run verify:conductor` and `bun test conductor` pass (a test pins the task-runner
      prompt's size).
- [ ] Out of scope: code changes.

## Out of scope for this spec

- Converting the other quest plans.
- Journal text on the browser client (a `server/webclient` change).
- A persisted per-bot quest record.
- The other audit follow-ups (task catalog `.describe()`, task bookkeeping helpers, naming and
  outcome codes, named places).
