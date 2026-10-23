# rs-ops

A Claude Code mod (a function-hook plugin) for rs-sdk sessions. It has one feature: **idle
autocompact**, which compacts the main conversation while it waits, before its context fills.
It is ported from kawaka's `kx-ops` mod (`~/code/kawaka/.claude/skills/kx-ops/`, `autocompact.tsx`
and `autocompact-model.ts`; design notes in kawaka's `docs/claude-code-mods/`).

Claude Code loads this folder as `rs-ops@skills-dir` in any trusted session whose primary cwd is
this checkout. A session that was already running when the folder appeared loads it after
`/reload-plugins`. Saving a file here hot-reloads the mod in every session that has it loaded.

## The rules

A check runs 1 s after each main-loop turn ends and every 60 s, only while the main loop is idle
(no turn running, none about to start). The thresholds are in `hooks/autocompact-model.ts`.

| Rule | Fires when | Compaction keeps |
|---|---|---|
| 1, conductor | `.durable-state/state.json` under the session root is a `conductor` or `sdd-loop` run, not `done`, whose `sessionId` is this session, and its `inFlight` holds anything but a `gate`, at **over 25%** context | the `inFlight` entries and `standingInstructions` verbatim, the current goal, task, agent and bot, and any open gate; the conductor re-reads state.json afterwards |
| 2, failsafe | any other idle session at **75%** or more: a toast, then the compaction **60 s** later unless the person types (a keystroke, a recalled prompt, an undo or a clear cancels it for that idle period) | the thread: the user's request, decisions, open questions, every instruction verbatim |
| 3, idle-hours | opt-in per session (`/rs-autocompact stale on`): idle **6 h** at **20%** or more | as rule 2, plus background work still in flight |

What every rule shares:

- **Debounce.** After any attempt (a compaction, a veto or a failure) there is no other attempt
  for 20 min. The next one also needs the context 10 points above the first reading taken after
  the attempt.
- **Turns in the way.** A prompt typed over a running turn, or a task notification delivered into
  one, holds checks off until the next turn starts, or for 5 min after the turn ends.
- **Mark.** Every summary opens with `Compacted by rs-ops autocompact (rule N, X%).`, which is the
  only way a transcript tells it from a typed `/compact`.
- **Other compactions.** A `/compact`, or the engine's own threshold, clears the last reading, so
  nothing acts on a stale percent.

Rule 1 reads state.json's hand-kept `inFlight` alone, because kawaka's in-flight registry was not
ported. That is why the durable-state skill asks conductors to keep it current (*Autocompact* in
`.claude/skills/durable-state/SKILL.md`). kx-ops' rule 4 (compact once every watched PR is green)
and its decision trail were not ported either.

## Switches

| Scope | How |
|---|---|
| Global (user settings, every rs-sdk session) | `echo '{"autocompact":"conductor-only"}' \| claude plugin configure rs-ops@skills-dir --values-stdin`: `on` (default), `conductor-only` (rule 1 alone) or `off`. Running sessions reload live |
| This session | `/rs-autocompact on\|off`, `/rs-autocompact stale on\|off` |
| Diagnose | bare `/rs-autocompact`: the switches, what a check would do now and why, the last check, the last attempt, the context reading, any hold or open failsafe window, the run and its in-flight entries |

Each decision also goes to the debug log (`claude --debug`) as `rs-ops: autocompact …`.

## Layout

```
.claude-plugin/plugin.json   manifest and the `autocompact` userConfig
.claude-plugin/types/        engine declarations (gitignored, copied in by hand: see Checks)
hooks/hooks.json             { "modules": ["./register.tsx"] }
hooks/register.tsx           idle, then autocompact (outer first: autocompact reads idle's state)
hooks/idle.tsx               main-loop turn tracking (`rs-ops.idle`); holds the plugin's matcher-less
                             turn.start, turn.complete and prompt.submit
hooks/autocompact.tsx        the `$` half: checks, the failsafe window, `/rs-autocompact`
hooks/autocompact-model.ts   the pure half: every rule, threshold and text
hooks/util.ts, state-initial.ts  pure helpers, the shared idle atom's initial value
hooks/*.test.ts, testkit.ts  run by `claude plugin test`
types/index.d.ts             the `$.state` contract
```

A mod runs inside Claude Code, with no Node and no npm. Pass `$` only to functions declared in
the same file, and keep every value in `$.state`, because a hot reload drops module variables.
The `plugin-authoring` skill has the full API.

## Checks

Edit a copy outside `.claude/skills/` (a save here reaches every live session that loaded the
mod, broken or not), run the checks against it, then copy the files back:

```bash
claude plugin validate <dir>
claude plugin test <dir>
node_modules/.bin/tsc -p <dir>   # needs <dir>/.claude-plugin/types/claude-code.d.ts
```

Claude Code lays no types for a skills-dir mod. Get this build's `claude-code.d.ts` by loading
the `plugin-authoring` skill, which names where it wrote the file, and copy it into
`.claude-plugin/types/`.
