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
  while the GE database (`GE_DATABASE`, default `data/market.sqlite`) exists, printing the
  command that retires it.
- On the shared server the database was retired on 2026-10-09 (to
  `data/market.sqlite.retired-20261009T2233Z*`; it held no offers or trades, only checkpoint
  rows that duplicated `.sav` files).
- `GET /save` reports a GE checkpoint as its own source (`checkpoint`), and `writeSave` refuses
  one, so a leftover database can't silently undo a write.

## Design as built

### Engine: two endpoints on the management port

`server/engine/src/web/pages/saves.ts`, routed from `startManagementWeb`'s fallback. Served only
when the engine runs with `SAVE_ENDPOINTS=true`, which `up.sh` sets (403 otherwise), so a
deployed server never exposes them, and only to loopback clients (the management port listens on
every interface). Names are validated (1–12 of `[a-z0-9_ ]`, not only `_`/spaces; 400 otherwise).

| Endpoint | Behaviour |
|---|---|
| `GET /save/:name` | The save that is current now. Online: `player.save(false)`, with no side effects. Mid-logout: the save in flight to the login thread. Offline: the GE checkpoint if one exists (the next login loads it), else the `.sav`. 404 with `{path, webPort}` for an account with no save. Headers: `X-Save-Source: live\|logout\|checkpoint\|file`, `X-Save-Path` (the absolute `.sav` path this engine reads), `X-Save-Sha1`, `X-Engine-Web-Port` (which engine answered; the tools refuse when it isn't the one the bot plays on). |
| `POST /kick/:name` | Renews `requestLogout` every 5 s until the player has left the world and its save is on disk, up to 30 s. 200 `{loggedOut: true}`; 409 when it did not leave (combat). |

`GET` does not call `closeModal()`, so an export never disturbs the bot. The cost is that items
in temp invs (an open trade or duel offer) are not in the export. Restoring into an online
player is out of scope: kick, write, relog.

### Conductor library code

- `conductor/lib/saves.ts`, all through the engine (no local engine path to configure):
  - `saveStatus(env)` (`GET /save`, and a refusal when the engine that answered isn't the bot's),
    `exportSave`, `inWorld(status)` (live or logout), `kick`, and `logOut(env, { takeover })`
    (refuses while a controller is attached, or when the gateway can't say; then kicks);
    `controllerCount` (the gateway's `/status`) is in `lib/env.ts`;
  - `writeSave(env, bytes, { backupDir, label, onWrite })`: verifies magic, version and CRC; refuses
    while the player is in the world or has a GE checkpoint; keeps the save it replaces in
    `backupDir` as `pre-<label>`; writes atomically to the path the engine reported; then reads it back through
    the engine and fails unless the engine serves exactly those bytes from the file. A tool run
    from another worktree, or racing a login, can't report a write the engine never sees;
  - `decodeSave`: position, base levels, inv/worn/bank with item names from the content pack,
    and non-zero varps; save versions 5–8;
  - the library: `writeLibrarySave` (refuses to replace an entry unless asked), `readLibrarySave`,
    `listLibrary` (lists invalid entries rather than failing); names are validated on every
    path; entries are schema-checked (zod) when read.
- `conductor/lib/client.ts`:
  - `startLiteClient(bot, { timeoutMs, attached })` spawns the lite runner from this checkout's
    `server/webclient`, logs to `conductor/runs/<bot>/lite-client.log`, records its pid, and
    resolves on "Gateway connected". It is detached by default; `attached: true` ties it to
    the calling process, for tests.
  - `stopLiteClient(bot)` stops the recorded pid, but only if it is still that bot's lite
    runner. Clients started any other way are not tracked.
- The management origin is the bot's engine host on port 8898; `RS_MANAGEMENT_ORIGIN` overrides
  it for a stack on other ports.

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
    spec (schema-checked) by `sdk/test/utils/save-generator`'s `createSaveData` (levels,
    inventory, worn, bank, position, varps).
  - An existing entry is replaced only with `--replace`: other agents' tests depend on them.
- **Seeded:** `fresh-lumbridge` (post-tutorial starter kit) and `wc-lumbridge-1` (woodcutting
  from level 1, in the castle courtyard; tests pass the verified tree `area`).
- **Naming:** `<skill-or-activity>-<where>-<detail>`.
- `conductor/runs/<bot>/saves/` stays as the private, gitignored timeline of an account.

### Worker accounts and `load.ts`

`bun conductor/tools/load.ts <worker> <source> [--client] [--create] [--takeover]`:

- **Sources:** `lib:<name>` (library), `bot:<bot>` (a live copy, no logout) or `path.sav`;
  anything else is a usage error.
- **Only workers can be loaded into:** `load.ts` writes only to accounts whose `bot.env` has
  `WORKER=true`. `--create` makes one with `create-bot.ts --local` and marks it, and refuses a
  name the server already has an account for (`bots/` is per checkout, so the name could be
  another checkout's bot, even the main account). A failed or interrupted `--create` removes
  the bot directory it made, unless the save already reached the server.
- **A worker that is in the world** is kicked first (refused while a controller is attached,
  unless `--takeover`), then its tracked lite client is stopped, so a failed kick never leaves
  it online without a client. The save it had is kept in `conductor/runs/<worker>/saves/`.
- **Record of the load:** it keeps a copy of what it loaded as
  `conductor/runs/<worker>/saves/<stamp>-loaded.sav`, writes `loaded.json`, and prints
  `LOADED <json>` with that `replay` path, so a fix is retested from exactly the author's
  starting state even when it came from a moving `bot:` source.
- **Client:** `--client` starts the worker's lite client and waits for it to connect.

Worker names: `<bot>w<n>`, e.g. `conductor1w1`, at most 12 characters. The conductor tracks the
pool in durable state (`workers`) and assigns one per task-author brief. It stays assigned
through that change's review, whose fix authors reuse it, until the review commits or reverts.

Rules on a worker (conductor skill, `task-author.md`; the first two also in `CLAUDE.md`):

- no player trades with other accounts;
- never drive the main bot;
- change the bot only through `run-task.ts`;
- a busy bot means wait or report back.

### `save.ts`

- **snapshot** exports the live save, with no logout. `--logout` still logs the bot out first
  (the conductor's unsafe-exit step relies on it). `--library --purpose` also files the save in
  the library (`--replace` to overwrite an entry). Flags given where they mean nothing are
  usage errors.
- **restore** checks everything before it touches the bot (the save's magic, version and CRC,
  a GE checkpoint, then):
  - restoring the bot's newest snapshot (the normal rollback) needs no flag;
  - skipping past a newer snapshot needs `--force` (its own `pre-*` backups don't count as
    newer, unless the pick is itself a backup);
  - a library save or a file over an existing save needs `--force`: nothing shows it came from
    this account (workers use `load.ts`).

  Then it kicks the bot (refused while a controller is attached, unless `--takeover`), and
  `writeSave` keeps the replaced save as `pre-restore` and writes.
- **list** also lists the library.

### Gateway controller lease

- `server/gateway/gateway.ts` refuses a `control` connect while another controller is attached,
  with `sdk_error` `code: 'controller_busy'` naming the holder and the time it attached.
  `takeover: true` pre-empts, as every connect used to. The refusal text tells agents to wait or
  report back, not to take over.
- A dead socket stops holding the lease when it closes. Bun's default websocket `idleTimeout`
  (120 s, with pings) closes half-open sockets. A socket that closes while the gateway is still
  authenticating it is never registered, so it can't leave a lease nobody holds (bot client
  registration has the same guard).
- **SDK:** `SDKConfig.takeover` and `RunOptions.takeover` are new; `run-task.ts --takeover`
  passes it through, and a script takes over with `RS_TAKEOVER=1`. Only the first attach sends
  it: an auto-reconnect never pre-empts whoever took the free lease meanwhile.
- **Reconnects:** a reconnect can be refused by the SDK's own not-yet-closed session, so the SDK
  keeps retrying `controller_busy` on reconnect for 150 s (`leaseRetryWindowMs`, longer than
  the idle timeout). On a first connect it is fatal, and `connect()` rejects with the gateway's
  message. `connect()` claims its attempt before its first await, so concurrent calls share one
  socket, and a fresh attach drops the state cached from an earlier session, so callers wait
  for the bot's current state.
- **MCP:** `execute_code` acquires the bot's control connection for the call and releases it
  when it ends, so an idle MCP session holds no lease. Concurrent calls on one bot share one
  attach (reference-counted; the last one out disconnects, which also stops any background
  reconnect). A call against a bot that a task or script is driving is refused.
- **Scripts:** `bun bots/<bot>/*.ts` scripts connect without takeover, so they are refused while
  a task runs.
- **Tests:** `server/gateway/lease.test.ts` runs the real gateway (refusal, observer, takeover,
  release on close); `sdk/test/controller-lease.test.ts` covers the SDK side (a first-connect
  refusal doesn't reconnect, a reconnect retries through its own stale session and gives up
  once the window passes, `takeover` only on the first attach).

### Conductor process

- Concurrent bot claimants are capped at the worker pool plus the one runner.
- The pause/stop procedure is in the conductor skill:
  1. `ListAgents`, and stop every subagent.
  2. `pgrep -af run-task.ts`, and kill any orphan.
  3. `save.ts snapshot --logout` for the main bot.
  4. Worker clients may keep running.

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
| `GET /save`, `POST /kick` (opt-in, engine-reported path and identity) | done; tested on an isolated stack from this worktree (engine 18888/18898/43595, gateway 17780): live export, 404 with path, bad names refused, kick |
| `conductor/lib/saves.ts`, `client.ts`; `save.ts` | done; tested: live snapshot without logout; restore refusals before any kick (library or file without `--force`, skipping a newer snapshot); forced restore kicks, backs up and survives a relog; a management origin pointing at another engine is refused |
| Library, `library.ts`, two seed saves | done; tested: generate, snapshot `--library`, replace guard, load into a worker, relog at the saved position |
| Worker pool, `load.ts` | done; tested: live fork into a worker with a backup, kick of an online worker, refusal to load into a non-worker, a failed `--create` leaves nothing behind |
| Gateway lease, SDK `takeover`, MCP release | done; `server/gateway/lease.test.ts` and `sdk/test/controller-lease.test.ts` pass; MCP release not exercised against a live MCP client |
| Conductor skill, `task-author.md`, task-review fix brief, `CLAUDE.md`, READMEs, learnings | done |
| Branch review | round 1: 7 reviewers + 2 verifiers, 34 findings confirmed, all fixed; round 2 (whole branch again): 32 confirmed, all fixed |
| Shared server running this code | needs a merge to main, then an engine (`up.sh` sets `SAVE_ENDPOINTS=true`) and gateway restart, coordinated with other sessions using the shared stack |
| Automatic library saves at milestones; per-task failure-branch saves | open (roadmap) |
