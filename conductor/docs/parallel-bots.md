# Parallel bots: a save-state library, worker accounts, live saves, a controller lease

Status: built (branch `parallel-bots`); see "Build status" for what is left. Source: conductor
run 1 (findings F13, F15, F36, F40 in that run's `.durable-state/process-findings.md`; report
problem #1).

## Problem

Run 1 drove one bot (`conductor1`) from up to four agents at once: runners, task authors' smoke
tests, and the fix authors that review orchestrators spawn. Each retried a refused `run-task.ts`
every 30 s for up to 15 min.

- ~30+ agent-minutes went on waiting, and some smoke runs were skipped.
- Every smoke test first walked the bot to its own spot.
- One fix author stepped around the refusal with an ad-hoc script, which pre-empted a running
  mining task and dropped items (F36).
- Stopping an orchestrator orphaned its fix author, which kept driving the bot (F40).

Smoke tests also had no fixed starting state. A woodcutting test ran wherever the main account
happened to stand, with whatever it happened to carry.

## What the engine gives us

1. **A save is not tied to its account.** `Player.save()` (`server/engine/src/engine/entity/Player.ts`)
   serialises position, stats, perm varps (tutorial and quest progress), every perm inv (bank
   included) and a CRC. It does not serialise the username: `PlayerLoading.load(name, bytes, client)`
   takes the name as an argument. Any save loaded under another name is an exact copy.
2. **Local accounts need no registration.** The local login is off (`LOGIN_SERVER` defaults to
   false, `server/engine/src/server/login/LoginThread.ts`), so any username logs in with any
   password:
   - no `.sav` file means a fresh account;
   - an existing `.sav` gets loaded.
3. **Web handlers run on the tick thread with direct access to `World`**, so an online player's
   save can be exported without a logout. `startManagementWeb` serves a second port,
   `WEB_MANAGEMENT_PORT` (default 8898), that is not exposed publicly.
4. **`player.requestLogout = true` is the engine's own logout.** If combat delays it, the engine
   drops the request after messaging the player, so a server-side kick renews it until the
   player has left.

## Decisions

- **Only the main account counts.** `conductor1` advances only through conductor-scheduled
  task-runner dispatches. Work on worker accounts is scratch and is thrown away; nothing is
  promoted back. Smoke-test XP, which drove most of run 1's levels, no longer counts, so the
  conductor schedules real runs for progress.
- **Smoke tests start from a library save.** The usual way to test a change is to load a scenario
  save into a worker, for example a woodcutting save to test the woodcutting task. A live copy of
  the main account (`bot:conductor1`) is one more source, for when a test needs the account
  exactly as it is now.
- **The Grand Exchange is off on the local server**, and `.sav` files on disk are the only save
  store (next section).
- **The gateway refuses a second controller** unless the newcomer asks for `takeover`. This flips
  "last controller wins".

## Grand Exchange off; `.sav` files are the only save store

With the GE on, a second save store existed:

- `PlayerLoading.load` replaces the save it was handed with the `accounts` row in
  `data/market.sqlite` whenever a row exists (`PlayerLoading.ts`, "Exchange participants use the
  atomic ledger checkpoint").
- `World.checkpointPlayers` enrolls every online player on each autosave, logout and reconnect.
- So a restore that only copied a `.sav` would have been silently replaced by the newer database
  row at the next login. Found by reading the code.

`GE_ENABLED=false` alone is not enough: `playerSaveStore()` still opens the database while the
file exists. Now:

- `conductor/local/up.sh` starts the engine with `GE_ENABLED=false`, and refuses to start it
  while `data/market.sqlite` exists, printing the command that retires it.
- On the shared server the database was retired on 2026-10-09 (to
  `data/market.sqlite.retired-20261009T2233Z*`; it held no offers or trades, only checkpoint
  rows that duplicated `.sav` files).
- `writeSave` refuses while `market.sqlite` exists.

## Design as built

### Engine: two endpoints on the management port

`server/engine/src/web/pages/saves.ts`, routed from `startManagementWeb`'s fallback. Refused
(403) when `NODE_PRODUCTION` is set.

| Endpoint | Behaviour |
|---|---|
| `GET /save/:name` | The save as it is now. Online: `player.save(false)`, with no side effects. Mid-logout: the save in flight to the login thread. Offline: the `.sav`. 404 for an unknown account. Headers: `X-Save-Source: live\|logout\|file`, `X-Save-Sha1`. |
| `POST /kick/:name` | Renews `requestLogout` every 5 s until the player has left the world and its save is on disk, up to 30 s. Returns `{loggedOut}`; 409 when it did not leave (combat). |

`GET` does not call `closeModal()`, so an export never disturbs the bot. The cost is that items
in temp invs (an open trade or duel offer) are not in the export. Restoring into an online
player is out of scope: kick, write, relog.

### Conductor library code

- `conductor/lib/saves.ts`:
  - `exportSave`, `kick`, `inWorld`;
  - `writeSave`: verifies magic, version and CRC, refuses while the player is in the world or
    while `market.sqlite` exists, and writes atomically;
  - `decodeSave`: position, base levels, inv/worn/bank with item names from the content pack,
    and non-zero varps; save versions 5–8;
  - the library: `writeLibrarySave`, `readLibrarySave`.
- `conductor/lib/client.ts`:
  - `startLiteClient(bot, { timeoutMs, attached })` spawns the lite runner from this checkout's
    `server/webclient`, logs to `conductor/runs/<bot>/lite-client.log`, records its pid, and
    resolves on "Gateway connected". It is detached by default; `attached: true` ties it to
    the calling process, for tests.
  - `stopLiteClient(bot)` stops the recorded pid, but only if it is still a lite runner.
- A stack on other ports is reached through `RS_ENGINE_DIR`, `RS_ENGINE_ORIGIN` and
  `RS_MANAGEMENT_ORIGIN`.

### The save-state library

- `conductor/saves/<name>.sav` plus `<name>.json`, committed. A save is about 1 KB.
- The JSON is written by `writeLibrarySave`, never by hand:

  ```
  { name, purpose, source, sha1, createdAt, saveVersion, summary }
  source: {kind: "snapshot", bot} | {kind: "generated", spec} | {kind: "file", path}
  ```

  `summary` holds position, base levels above 1, inventory, worn, bank and varps.
- **How a save gets in:**
  - `save.ts snapshot <bot> <name> --library --purpose "..."`: a live bot, no logout;
  - `library.ts generate <name> --preset <NAME> | --spec '<json>' --purpose "..."`: built from a
    spec by `sdk/test/utils/save-generator`'s `createSaveData` (levels, inventory, worn, bank,
    position, varps).
- **Seeded:** `fresh-lumbridge` (post-tutorial starter kit) and `wc-lumbridge-1` (woodcutting
  from level 1).
- **Naming:** `<skill-or-activity>-<where>-<detail>`.
- `conductor/runs/<bot>/saves/` stays as the private, gitignored timeline of an account.

### Worker accounts and `load.ts`

`bun conductor/tools/load.ts <worker> <source> [--client] [--create] [--takeover]`:

- **Sources:** `<name>` / `lib:<name>` (library), `bot:<bot>` (a live copy, no logout) or
  `path.sav`.
- **Only workers can be loaded into:** `load.ts` writes only to accounts whose `bot.env` has
  `WORKER=true`. `--create` makes one with `create-bot.ts --local` and marks it.
- **A worker that is in the world** has its lite client stopped and is kicked first. This is
  refused while a controller is attached, unless `--takeover`.
- **Record of the load:** it writes `conductor/runs/<worker>/loaded.json` and prints
  `LOADED <json>`, so evidence can name the state a test started from.
- **Client:** `--client` starts the worker's lite client and waits for it to connect.

Worker names: `<bot>w<n>`, e.g. `conductor1w1`, at most 12 characters. The conductor tracks the
pool in durable state (`workers`) and assigns one per author or review brief; an orchestrator's
fix author uses its parent's worker.

Rules on a worker (conductor skill, `task-author.md`, `CLAUDE.md`):

- no player trades with other accounts;
- never drive the main bot;
- change the bot only through `run-task.ts`;
- a busy bot means wait or report back.

### `save.ts`

- **snapshot** exports the live save, with no logout. `--logout` still logs the bot out first
  (the conductor's unsafe-exit step relies on it). `--library --purpose` also files the save in
  the library.
- **restore** checks everything before it touches the bot:
  - while the bot is online its live state is newer than any snapshot, so restoring needs
    `--force`;
  - a library save over an existing save needs `--force` (workers use `load.ts`).

  Then it kicks the bot (refused while a controller is attached, unless `--takeover`), keeps the
  replaced save as `pre-restore`, and writes.
- **list** also lists the library.

### Gateway controller lease

- `server/gateway/gateway.ts` refuses a `control` connect while another controller is attached,
  with `sdk_error` `code: 'controller_busy'` naming the holder and the time it attached.
  `takeover: true` pre-empts, as every connect used to.
- A dead socket stops holding the lease when it closes. Bun's default websocket `idleTimeout`
  (120 s, with pings) closes half-open sockets.
- **SDK:** `SDKConfig.takeover` and `RunOptions.takeover` are new, and `run-task.ts --takeover`
  passes it through.
- **Reconnects:** a reconnect can be refused by the SDK's own not-yet-closed session, so the SDK
  retries `controller_busy` on reconnect up to 5 attempts. On a first connect it is fatal, and
  `connect()` rejects with the gateway's message.
- **Other clients:** the MCP server and `bun bots/<bot>/*.ts` scripts connect without takeover,
  so they are refused too while a task runs.

### Conductor process

- Concurrent bot claimants are capped at the worker pool plus the one runner.
- The pause/stop procedure is in the conductor skill:
  1. `ListAgents`, and stop every subagent.
  2. `pgrep -af run-task.ts`.
  3. `save.ts snapshot --logout`.

## Risks and open questions

- **Shared world.** Workers share one world with the main account:
  - They compete for the same rocks, trees and NPCs, so a worker's smoke test can be starved by
    the main bot at the same spot.
  - Shop stock moves for everyone.
  - Ground items are visible to all accounts.

  The conductor avoids sending a worker to the runner's spot.
- **Client cost.** Each worker needs its own lite-client process; this is unmeasured. Measure
  before raising the pool above 3.
- **Content version.** A library save records content ids (items, varps), but no content
  version. A repack that renumbers ids would silently change a scenario's meaning; add a
  version to the JSON if repacks start happening.
- **Temp-inv items.** A save exported mid-trade misses the offered items.
- **Agent-definition reload (F38).** If `.claude/agents/*.md` load from the main checkout, the
  worker rules reach agents only once this branch is merged to main; until then they go in the
  briefs.

## Build status

| Step | State |
|---|---|
| GE off; database retired on the shared server | done 2026-10-09 |
| `GET /save`, `POST /kick` | done; tested on an isolated stack from this worktree (engine 18888/18898/43595, gateway 17780) |
| `conductor/lib/saves.ts`, `client.ts`; `save.ts` rewrite | done; tested: live export matches the file save, an older snapshot restored over a moved bot survives a relog, refusals happen before any kick |
| Library, `library.ts`, two seed saves | done; tested: generate, snapshot `--library`, load into a worker, relog at the saved position |
| Worker pool, `load.ts` | done; tested: live fork of a bot into a worker, kick of an online worker, refusal to load into a non-worker |
| Gateway lease, SDK `takeover` | done; tested: second controller refused with the holder named, observer allowed, takeover pre-empts, count back to 0 |
| Conductor skill, `task-author.md`, task-review fix brief, `CLAUDE.md`, README | done |
| Shared server running this code | needs a merge to main, then an engine and gateway restart (coordinate with other sessions using the shared stack) |
| Automatic library saves at milestones; per-task failure-branch saves | open (roadmap) |
