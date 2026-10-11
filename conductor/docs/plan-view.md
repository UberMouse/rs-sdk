# Plan viewer

A local web page that follows the plan a bot is running, and shows its past plans grouped by
the conductor session that ran them.

```bash
bun conductor/tools/plan-view.ts            # http://127.0.0.1:7790/
bun conductor/tools/plan-view.ts --port 7791 --root /path/to/checkout   # one checkout only
```

It is read-only: it reads the run logs and watches the bot in observe mode, which never takes
control, so it is safe beside a running plan or task-runner. It binds to 127.0.0.1 unless given
`--host`.

## What it shows

- **Bot picker and Follow live.** The bot list is every bot with plan logs, running ones first.
  Following, the page shows the bot's newest plan and switches when a new one starts. Picking a
  past plan turns following off; "Back to live" or the toggle turns it on again. The URL hash
  (`#bot=<bot>&run=<runId>`) keeps the view across a reload.
- **Sessions sidebar.** The bot's plan runs, grouped by Claude Code session and newest first.
  Logs from before runs were stamped are grouped by day as "Untagged". A session that a
  checkout's `.durable-state/state.json` names is labelled as the conductor's, with its goal.
- **Plan header.** State (running, ended with its status, or "no result" for a plan whose process
  is gone without one), duration, stops, `requires`, session, and on the end, the result's
  reason, XP, levels and inventory delta.
- **Timeline.** One lane per phase in plan order, a bar per phase run coloured by status (with an
  icon and label in the legend and the tooltip), and a "now" line while it runs. Click a bar to
  open that run below.
- **Phases.** Each phase's task, params, its answer at the latest selection (`chosen`,
  `when false`, `until holds`, `skipped: failed last`, or "not checked" below the chosen one),
  runs, outcomes, time, XP and last reason. The running phase is highlighted.
- **Phase run.** The open run (or the one picked): the selection that started it (each phase's
  answer, the inventory, free slots and the bank as last seen), the steps entered, and the last
  200 lines of its log.
- **Bot.** Live position, HP, combat, inventory, equipment and skills, from an observe-mode
  connection. It is the bot now, not at the time of a past plan.
- **Plan source.** The copy of the plan file that ran; clicking a phase name highlights its line.

## Where the data comes from

The plan log (`conductor/runs/<bot>/<runId>-plan-<name>.ndjson`, events in
[`plans.md`](plans.md)) is enough to rebuild a plan's view; each phase run's own log adds its
steps. Two additions make following a live plan exact:

- `phase-start` (`{ phase, index, runId, logFile }`), logged by `runPlan` when a phase run
  opens, names the log to tail while the run is in progress. Logs from before it name a run
  only at `phase-end`, so for those the viewer takes the first log of the phase's task stamped
  at or after its selection.
- The CLI's `source` event carries `pid` and `session`. `pid` tells a running plan from one
  hard-killed without a result (a dead pid). `session` is `$CLAUDE_CODE_SESSION_ID` (task-runners
  are subagents, so they share the conductor's), else the checkout's durable-state `sessionId`,
  else null. Logs without a pid count as running while they or their open phase's log or
  recording changed in the last 5 minutes.

The viewer reads `conductor/runs/` in this checkout and every worktree of it (`git worktree
list`), so plans run from any worktree show up; `--root` narrows it. `bot.env` for the observer is
looked up in the same checkouts.

## How it is built

`conductor/tools/plan-view/`:

- `model.ts`: pure folds of plan and phase logs into what the page shows, session grouping and
  which plan to follow. No Node imports: the server and the page fold with the same functions.
- `store.ts`: finds the checkouts, lists and folds plan logs (cached by size and mtime), decides
  liveness, tails growing logs (a half-written line waits for its newline).
- `observer.ts`: one observe-mode connection per viewed bot, a snapshot a second, closed 10
  seconds after its last viewer leaves.
- `server.ts`: `Bun.serve` with the page as an HTML import (Bun bundles `app.ts` and
  `style.css`; no build step), `GET /api/bots`, `/api/sessions?bot=`, `/api/plan?bot=&runId=`,
  `/api/phase?bot=&runId=`, and `/api/live?bot=`, a Server-Sent Events stream: `plans` when
  the list changes, `plan` (a snapshot) when the followed plan changes, `plan-events` as its log
  grows, `plan-state` when its process is found gone, `phase` and `phase-events` for its open
  phase run, and `bot` snapshots.
- `app.ts`, `page.html`, `style.css`: the page, plain DOM, light and dark.

Tests: `conductor/test/tools/plan-view/` (folds over a real plan log in
`conductor/test/fixtures/plan-view/`, liveness, the tail, the endpoints and a live stream).
