# Plan viewer

A local web page that follows what a bot is running (a plan, or a task run on its own), shows its
past runs grouped by the conductor session that ran them, and shows the bot in a live 3D view of
the game world.

```bash
bun conductor/tools/plan-view.ts            # http://127.0.0.1:7790/
bun conductor/tools/plan-view.ts --port 7791 --root /path/to/checkout   # one checkout only
```

It is read-only: it reads the run logs and watches the bot in observe mode, which never takes
control, so it is safe beside a running plan or task-runner. It binds to 127.0.0.1 unless given
`--host`.

## What it shows

- **Bot picker and Follow live.** The bot list is every bot with plan or task logs, running ones
  first. Integration tests' throwaway bots (`it` and ten characters) are listed apart, last.
  Following, the page shows the bot's newest run, plan or task, and switches when a new one
  starts. Picking a past run turns following off; "Back to live" or the toggle turns it on again.
  The URL hash (`#bot=<bot>&run=<runId>`) keeps the view across a reload.
- **Sessions sidebar.** The bot's plans and its task runs of their own (marked `task`), grouped
  by Claude Code session and newest first. A plan's phase runs are not listed: they are inside
  their plan. Logs from before runs were stamped are grouped by day as "Untagged". A session that
  a checkout's `.durable-state/state.json` names is labelled as the conductor's, with its goal.
- **World.** rs-world, a live 3D view of the game, following the bot: its body, the NPCs and
  players around it, their animations, chat and hitsplats. It streams the engine's world feed
  straight from the browser, so it needs the engine started with `WORLD_FEED=true`
  (`conductor/local/up.sh` does); the panel says when the feed is off or the bot isn't logged in.
  "3D view" turns it off (remembered per browser); "Open in a new tab" opens it full size.
- **Run header.** State (running, ended with its status, or "no result" for a run whose process
  is gone without one), duration, stops, `requires`, session, and on the end, the result's
  reason, XP, levels and inventory delta.
- **Timeline** (plans). One lane per phase in plan order, a bar per phase run coloured by status
  (with an icon and label in the legend and the tooltip), and a "now" line while it runs. Click a
  bar to open that run below.
- **Phases** (plans). Each phase's task, params, its answer at the latest selection (`chosen`,
  `when false`, `until holds`, `skipped: failed last`, or "not checked" below the chosen one),
  runs, outcomes, time, XP and last reason. The running phase is highlighted.
- **Phase run, or task run.** The open run (or the one picked): for a phase, the selection that
  started it (each phase's answer, the inventory, free slots and the bank as last seen); for a
  task run, its params. Then the steps entered and the last 200 lines of its log.
- **Bot.** Live position, HP, combat, inventory, equipment and skills, from an observe-mode
  connection. It is the bot now, not at the time of a past run.
- **Plan source** (plans). The copy of the plan file that ran; clicking a phase name highlights
  its line.

## Where the data comes from

The plan log (`conductor/runs/<bot>/<runId>-plan-<name>.ndjson`, events in
[`plans.md`](plans.md)) is enough to rebuild a plan's view; each phase run's own log adds its
steps. A task run's log (`<runId>.ndjson`, `<runId>` being `<fileStamp>-<task>`) is the same
whether it ran on its own or as a phase; the viewer shows it as a run of its own unless its
result names a plan (`partOf`) or a plan log names it as a phase (`phase-start`, `phase-end`, the
result's `recent`, or the open phase of a log from before `phase-start`). It reads task logs
before plan logs: `runPlan` logs `phase-start` before the phase's log exists, so a running phase
is never mistaken for a run of its own.

Two additions make following a live run exact:

- `phase-start` (`{ phase, index, runId, logFile }`), logged by `runPlan` when a phase run
  opens, names the log to tail while the run is in progress. Logs from before it name a run
  only at `phase-end`, so for those the viewer takes the first log of the phase's task stamped
  at or after its selection.
- The CLI's `source` event carries `pid` and `session`: first in a plan's log (with the plan file
  and its copy), and in a task run's own log (not in a phase's: its plan's has it). `pid` tells a
  running run from one hard-killed without a result (a dead pid). `session` is
  `$CLAUDE_CODE_SESSION_ID` (task-runners are subagents, so they share the conductor's), else the
  checkout's durable-state `sessionId`, else null. Logs without a pid count as running while they
  (or a plan's open phase's log) or their recording changed in the last 5 minutes.

The viewer reads `conductor/runs/` in this checkout and every worktree of it (`git worktree
list`), so runs from any worktree show up; `--root` narrows it. `bot.env` for the observer and the
world panel is looked up in the same checkouts.

### The world panel

rs-world ([github.com/maxbittker/rs-world](https://github.com/maxbittker/rs-world), a fork of
dennisdev's rs-map-viewer) renders the map from rs-sdk's rev 289 cache and streams players and
NPCs from the engine's world feed (`ws://<engine>/worldfeed`, `server/engine/src/web/worldfeed.ts`).
It shares memory with its workers (`SharedArrayBuffer`), which a browser allows only on a
cross-origin isolated page, and a page framed by one. So the viewer:

- serves its own page and chunks with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (it bundles the page with `Bun.build` on first
  request: Bun's HTML-import routes can't set headers);
- serves rs-world from its own origin at `/rs-world/`, proxied from the published build
  (`https://maxbittker.github.io/rs-world/`, the cache included) with the same headers. Files
  are cached under `$XDG_CACHE_HOME/rs-sdk/plan-view/rs-world` (else `~/.cache/...`):
  content-hashed ones (`static/`) are kept, the rest revalidated by ETag, and served from the cache
  when GitHub Pages can't be reached. The first load needs the network;
- frames `/rs-world/?live=<feed>&follow=<account>`, the feed from the bot's `bot.env` `SERVER`.

A browser isolates only a secure context, so open the viewer at `localhost` or `127.0.0.1`; from
another machine (`--host`) the panel says it can't, and the feed URL is the engine as the viewer
sees it. `GET /api/world?bot=` tells whether the feed is on: it opens the feed and waits for its
hello, else reads the refused handshake's status (404 off, 403 needs `WORLD_FEED_TOKEN`, 503 full).

## How it is built

`conductor/tools/plan-view/`:

- `model.ts`: pure folds of plan, task and phase logs into what the page shows (a task run of its
  own folds as a run of one phase, its own log), session grouping and which run to follow. No
  Node imports: the server and the page fold with the same functions.
- `store.ts`: finds the checkouts, lists and folds plan and task logs (cached by size and mtime),
  tells a task run of its own from a phase, decides liveness, tails growing logs (a half-written
  line waits for its newline).
- `observer.ts`: one observe-mode connection per viewed bot, a snapshot a second, closed 10
  seconds after its last viewer leaves.
- `world.ts`: the rs-world proxy and its cache, and the world feed probe.
- `server.ts`: `Bun.serve`: the page (built once, served cross-origin isolated), `GET /api/bots`,
  `/api/sessions?bot=`, `/api/run?bot=&runId=`, `/api/phase?bot=&runId=`, `/api/world?bot=`,
  `/rs-world/*`, and `/api/live?bot=`, a Server-Sent Events stream: `runs` when the list changes,
  `run` (a snapshot) when the followed run changes, `run-events` as its log grows, `run-state`
  when its process is found gone, `phase` and `phase-events` for its open phase run (a task run's
  own log), and `bot` snapshots.
- `app.ts`, `page.html`, `style.css`: the page, plain DOM, light and dark.

Tests: `conductor/test/tools/plan-view/` (folds over a real plan log in
`conductor/test/fixtures/plan-view/`, task runs and how they are told from phases, liveness, the
tail, the endpoints, the isolation headers, the rs-world proxy and feed probe on stubs, and a live
stream).
