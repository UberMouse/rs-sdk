# Local server

Facts true of the local stack (`conductor/local/up.sh`), which can differ from the hosted demo.
Tag server-dependent numbers elsewhere with `local` / `hosted` (see `.claude/skills/knowledge`).

## Rates

- XP rate is 25× (`xpRate: 25` in `server/engine/src/util/WorldConfig.ts`, overridable with
  `NODE_XPRATE`): a normal log gives 625 Woodcutting XP instead of 25. A 1-minute woodcutting run
  took level 1 → 22. [v 2026-10-09 conductor1 local]
- Standard RuneScape XP-per-level values do not apply on this server: the level table is
  different, and levels come far sooner. `getLevelByExp` in
  `server/engine/src/engine/entity/Player.ts` uses `2^(level/10)` where standard RuneScape uses
  `2^(level/7)`. XP as the SDK reports it (`skill.experience`, no unit change) at level 15 / 30 /
  50 / 70 / 99 = 1,860 / 7,345 / 32,619 / 133,230 / 998,458 (standard level 99 is 13,034,431). The
  standard 13,363 for level 30 does not apply; a bot at 7,500 XP is level 30. Observed: WC 1,875 ->
  7,500 XP is level 15 -> 30. `conductor/lib/xp.ts` uses this table (MAX_XP 998,458), so
  `progress.ts` distances are correct. [v 2026-10-10 conductor2 local; table read from engine code]
- Tick rate is 400 ms, not 600: `server/engine/src/util/Environment.ts` defaults `NODE_TICKRATE` to
  400, and `conductor/local/up.sh` and the engine's env set nothing else. (`::speed <ms>` changes it
  until restart.) Same as hosted, so learned timings transfer. [v 2026-10-09 conductor1 local]

## Accounts and saves

- Login server is off: any username/password logs in, and the save is created on first login
  at `server/engine/data/players/main/<bot>.sav`. [v 2026-10-09 conductor1 local]
- The save file is written on logout and on autosave (every 15 min); a live save can be read
  from the engine without a logout. Snapshot and restore: `conductor/README.md`.
  [v 2026-10-09 pbtest1 local]
- The Grand Exchange is off locally (`GE_ENABLED=false` in `up.sh`), so the `.sav` file is the
  whole saved state of an offline player. [v 2026-10-09 pbtest1 local] While the GE database
  (`data/market.sqlite`) exists, a login loads the player's GE checkpoint instead of the `.sav`
  (`PlayerLoading.load`, read from code), so `up.sh` refuses to start the engine until it is
  retired.
- Quest points are recounted at login from the quest varps (`quests.rs2` `update_questpoints`), so a library save that sets only the QP varp is overwritten. A save meant to have 32 QP needs real quest varps: 14=7 (Merlin's Crystal), 29=2, 31=100, 32=3, 62=6, 80=4, 144=100, 222=30, 273=110 gave 32 QP (nine quests: Merlin's Crystal, Cook's Assistant, Doric's Quest, Ernest the Chicken, Goblin Diplomacy, Druidic Ritual, Romeo and Juliet, Demon Slayer, Prince Ali Rescue). [v 2026-10-24 questw1 local]
- A save made by `library.ts generate` can hold different unset varps from a fresh account: varp 28 (the Temple of Ikov ice-arrow chest location) is -1 on a fresh account but 0 in a generated save, and with 0 no chest ever held arrows. When a quest mechanic depends on a varp's initial value, set it in the library save (the Ikov start save sets `{28:-1}`); see [Temple of Ikov](../wiki/quests/temple-of-ikov.md). [v 2026-10-24 questw5 local]
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

- Skill make menus (fletching) take Make 10 batches at one log per 2 ticks; a level-up dialog stops the batch, and at 25x XP early levels come every log or two, so batching pays from the mid levels. See `learnings/fletching.md`. [v 2026-10-11 conductor2w4 local]

- Death: the bot kept its 3 most valuable items (Adamant pickaxe, bronze sword, wooden shield) and lost the rest (5 anchovies); it reappeared near (3226, 3330) at full hp, observed after a death at the Varrock stone circle (3223, 3373), not the Lumbridge spawn. [v 2026-10-11 conductor2 local]
