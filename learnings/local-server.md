# Local server

Facts true of the local stack (`conductor/local/up.sh`), which can differ from the hosted demo.
Tag server-dependent numbers elsewhere with `local` / `hosted` (see `.claude/skills/knowledge`).

## Rates

- XP rate is 25× (`xpRate: 25` in `server/engine/src/util/WorldConfig.ts`, overridable with
  `NODE_XPRATE`): a normal log gives 625 Woodcutting XP instead of 25. A 1-minute woodcutting run
  took level 1 → 22. [v 2026-10-09 conductor1 local]
- Tick rate is the default 400 ms (`NODE_TICKRATE`; `::speed <ms>` changes it until restart).
  Kept at 400 so learned timings transfer to the hosted server.

## Accounts and saves

- Login server is off: any username/password logs in, and the save is created on first login
  at `server/engine/data/players/main/<bot>.sav`. [v 2026-10-09 conductor1 local]
- The save is written on logout and on autosave (every 15 min), so copy or restore it only
  while the bot is logged out: `bun conductor/tools/save.ts snapshot|restore <bot> <label> --logout`.
- Stopping a client does not log the player out. The server keeps a disconnected player in the
  world for 500 ticks (~3.5 min at 400 ms, relaxed for bot background tabs) before an idle
  logout, and force-logs out after 1000 ticks. `/status/<bot>` reports `inGame: false` as soon as
  the client drops; `/playerpositions` lists who is really in the world. [v 2026-10-09 conductor1 local]
- To log out at once, press component 2458 (`logout:try_logout`):
  `sdk.sendClickComponent(2458)`. The save is written immediately (not within 10s of combat).
  [v 2026-10-09 conductor1 local]
- New accounts start in the tutorial; `bot.skipTutorial()` puts them in Lumbridge at
  (3222, 3222) with a starter kit in the inventory, nothing equipped: bronze axe, bronze pickaxe,
  tinderbox, small fishing net, shrimps, bread, bucket, pot, bronze dagger, bronze sword, wooden
  shield, shortbow, 25 bronze arrows, runes (25 air, 15 mind, 6 water, 4 earth, 2 body). [v 2026-10-09 conductor1 local]
