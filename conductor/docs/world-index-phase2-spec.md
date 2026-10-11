# Spec: world index phase 2, reachability and travel

Expands phase 2 of the approved design [`world-index.md`](world-index.md) ("Reachability and
travel") into ordered tasks, for the `sdd-loop` skill. Phase 1 ([`world-index-spec.md`](world-index-spec.md))
is built: `bun run world` writes `wiki/world.json` (features, sites, curated areas, `npcSpawns`) and
the `wiki/places|resources|services` pages; the NPC and shop generators read it. Phase 2 answers
"can a bot get there, and what does it need?" for every site, and gives phase 3 real walk distances.

Status: **draft, not yet scheduled** (2026-10-11). Re-read the code it names before starting: phase 1
landed after this was written.

## Decisions carried from the design

- **Computed, then annotated.** A flood fill over the offline collision data decides reachability;
  curated tables (`gates.ts`) supply only what the scripts are too complex to read, and every curated
  entry cites its script.
- **Requirements are sets.** A tile is reachable under one or more minimal requirement sets
  (`{}`, `{toll:10gp}`, `{quest:lost-city, members}`); a site's `reach` is its stand tile's sets.
- **Unreached is a report, not a failure.** A bank, shop or resource no requirement set reaches
  usually means a missing connector, gate or transport; the report is the curation to-do list.
- **Hazards stay flags.** Wilderness level and multiway are already on sites; phase 2 adds no
  scoring.
- **The conductor tables become views.** `conductor/lib/connectors.ts` and `banks.ts` read the
  generated data and keep only their curated overrides (stand tweaks, hazards, `auto: false` reasons).

## Global rules (apply to every task)

- Everything in phase 1's global rules still binds (code in `wiki/world/`, tests in
  `wiki/world/test/`, `*.real.test.ts` for real data, oxfmt/oxlint/tsc via `bun run verify:conductor`,
  determinism, generated files committed with their code and never hand-edited, the game is the
  source of truth, knowledge in `learnings/` per the `knowledge` skill).
- **Format changes bump `WORLD_FORMAT`** and update `load.ts` and its tests; `--check` stays green.
- **Performance budget:** `bun run world` stays under ~15 s and `world.json` under ~10 MB; report
  both in every task that changes them. Per-tile state uses typed arrays, not object maps.
- **Conductor code (Task 6 only)** follows the conductor rules in `CLAUDE.md`: unit tests in
  `conductor/test/`, `bun test conductor`, and a `task-review` pass on the change before it lands.
  No other task edits `conductor/`.
- Cite the script (file and line) for every gate, requirement and transport, in code comments or in
  the curated entry's `source` field.

## Task 1 — Connectors from the scripts

**Files:** `wiki/world/sources/connectors.ts`, `wiki/world/test/connectors.test.ts`,
`wiki/world/test/connectors.real.test.ts`; `build.ts`, `types.ts` (a `connectors` list in `World`).

Every `connector` feature (locs with an op trigger under `scripts/ladders+stairs/`) gets its landing
tile(s). The scripts use three forms (check them all in `ladders.rs2` and `stairs.rs2` before
writing a parser):

- relative jumps, `p_telejump(movecoord(coord(), dx, dlevel, dz))`, chosen by op (Climb-up /
  Climb-down) and sometimes by the loc's rotation;
- explicit tables, `case <level>_<mx>_<mz>_<x>_<z> : p_telejump(<coord>)` keyed by the loc's tile;
- labels shared by several locs (a `@label($coord)` the trigger calls with a computed coord).

Output per connector: loc tile, op name, direction (`up`/`down`/`other`), landing tile, and a stand
tile on the loc's plane chosen with the phase 1 reach test (`collision.ts`). A connector whose
landing cannot be derived is listed in the build report with the reason (never guessed).

### Acceptance criteria

- [ ] Every row of `conductor/lib/connectors.ts` is reproduced: same loc tile and landing, stand
      within 1 tile (a real-data test iterates the table).
- [ ] Landings are walkable in the collision data, and each up has its down (or is reported as
      one-way with its script).
- [ ] The build report counts derived, one-way and underived connectors; underived ones name the
      script construct that stopped the parser.
- [ ] `world.json` gains `connectors` (format bump); pages unchanged except where a connector site
      now names its landing.

## Task 2 — Gates and transports

**Files:** `wiki/world/gates.ts` (curated), `wiki/world/sources/gate-scan.ts`,
`wiki/world/test/gates.test.ts`; build report section.

A **gate** is a loc (door, gate, barrier, shortcut) whose op script refuses passage unless a
condition holds. A **transport** moves the player between two tiles that no walk joins (boats,
charters, carpets, gnome gliders, fairy rings when in content, quest teleports out of scope).

- `gate-scan.ts` finds candidates from the scripts: door/gate locs whose op body (followed through
  calls as `classify.ts` does) branches on a quest varp (`%<quest>_progress`, `~quest_*`), a stat
  (`stat(<skill>)`, `stat_base`), worn or carried items (`inv_total(worn, ...)`, `inv_total(inv,
  ...)`), coins taken (`inv_del(inv, coins, n)`), or members (`map_members`, `~require_members`)
  before the move. Known examples to calibrate on: the Al Kharid border gate (toll), `chefdoor`
  (Cooking Guild), `crafting_guild_door`, `ranging_guild_door` (40 Ranged), the Lost City shed door
  in Lumbridge Swamp, guild and quest doors under `scripts/doors/`.
- `gates.ts` is the curated list: `{ loc, tile(s), requires: Requirement[], source, notes }`, where
  `Requirement` is a tagged union: `quest:<id>`, `skill:<skill>:<level>`, `item:<obj>` (worn or held),
  `coins:<n>`, `members`, `other:<text>`. Each scanned candidate is either confirmed here (with its
  requirement) or listed as "not a gate" with the reason; the build fails on an unreviewed candidate,
  so new content is never silently ignored.
- Transports: parse `scripts/interface_boat/` (`sail.rs2`, `sail.constant`) for ship routes (from,
  to, fare, members/quest conditions); curate the rest in `gates.ts` as `{ from, to, requires,
  source }`.

### Acceptance criteria

- [ ] The scan finds the calibration examples above with the right requirement kind; tests on
      scripted bodies cover each condition form.
- [ ] Every scanned candidate is confirmed or rejected in `gates.ts` (the build fails otherwise);
      every entry cites its script.
- [ ] Ship routes are derived from `sail.rs2`/`sail.constant` with their fares; Port Sarim -> Karamja
      and the Entrana boat (members, no weapons/armour: record as `other`) are pinned by tests.

## Task 3 — Reachability graph and flood fill

**Files:** `wiki/world/reach.ts`, `wiki/world/test/reach.test.ts`,
`wiki/world/test/reach.real.test.ts`.

- Nodes: walkable tiles on levels 0-3 and the underground and instanced planes, indexed into typed
  arrays (allocated zones only; `collision.ts`).
- Edges: neighbour steps the collision data allows (`canStep`, so walls block); doors the
  pathfinder opens are passable unless `gates.ts` names them; connectors (Task 1) as one-way edges;
  gates and transports (Task 2) as edges carrying their requirements.
- Members: a step into a non-F2P zone (`free2play.csv`, `isF2p`) adds `members`.
- Fill: from the Lumbridge spawn (3222, 3218, level 0), a multi-label BFS keeping, per tile, the
  antichain of minimal requirement sets (a set is dropped when a subset already reaches the tile).
  Bound the antichain size per tile (report tiles that hit the bound) so a gate-dense area cannot
  blow up memory.
- Deterministic: requirement sets are sorted, canonical strings.

### Acceptance criteria

- [ ] Synthetic-grid tests: open walk; a wall; a door; a gated door; a connector; two gates with
      overlapping requirements (antichain minimality); members zones; an unreachable pocket.
- [ ] Real-data facts (each a test with its evidence): Lumbridge, Draynor, Varrock, Falador reach
      with `{}`; Al Kharid with `{coins:10}` or a members route (verify which the data gives);
      Zanaris needs `quest:lost-city` (and whatever else its door requires); Entrana only by boat;
      the Dwarven Mine reaches with `{}` through the Ice Mountain ladder and Falador stairs.
- [ ] Runtime and memory reported; within the global budget.

## Task 4 — Access on sites and pages

**Files:** `types.ts`, `build.ts`, `render/*`, tests; regenerated output.

- Each `Site` and `NpcSpawn` gains `reach: string[][]` (minimal requirement sets of its stand tile,
  or of its nearest walkable tile for npc clusters); `[]` = unreachable.
- Pages: a Requires column on resource, service and place tables (`-` for `{}`, the sets joined
  with "or"); service and resource pages can be read as "where can a fresh F2P account do X".
- Build report: unreached sites of covered kinds, grouped by area, with the nearest reached tile
  and the plane, as the curation to-do list.

### Acceptance criteria

- [ ] All 25 bank sites have `reach`; the F2P mainland banks are `[[]]`; Zanaris carries its quest.
- [ ] The unreached report exists and is clean for banks and shops, or each remaining entry is
      explained in `gates.ts`/`areas.ts` notes.
- [ ] `--check`, determinism and the format bump hold.

## Task 5 — Walk distances to sinks

**Files:** `wiki/world/distance.ts`, tests; `types.ts`/`build.ts`.

For every resource and processor site, the walked distance (ticks, walking and running) from its
stand tile to the nearest reachable bank and, where phase 3 needs it, the nearest processor of the
right kind (furnace for ore, range for raw fish, anvil for bars), under the site's own requirement
sets (a site reachable with `{}` uses only `{}` paths). Computed with one multi-source BFS per sink
kind over the Task 3 graph, not a path per site.

### Acceptance criteria

- [ ] `nearest: { bank?: { site, walkTicks, runTicks, requires }, ... }` on resource and processor
      sites (format bump); rendered as a "nearest bank" column.
- [ ] Real-data spot checks against `conductor/tools/stats.ts` runs or `learnings/` routes where they
      exist (e.g. Draynor willows -> Draynor bank, Varrock West mine -> Varrock West bank), within
      a stated tolerance.

## Task 6 — Conductor views

**Files:** `conductor/lib/connectors.ts`, `conductor/lib/banks.ts`, their tests; `task-review`.

- `connectors.ts` builds its table from `world.json`'s connectors, keeping curated per-connector
  overrides (stand tweaks, `hazard`) in a small map keyed by loc tile; its existing tests (stand
  and landing walkable, a way back) run against the generated table.
- `banks.ts` derives `BANKS` from bank sites with `reach` `[[]]` on the surface, F2P, keeping the
  curated `auto: false` reasons (Draynor's dark wizards, Al Kharid's toll — the latter now also
  visible as a requirement).
- Loading: the conductor reads `world.json` through `wiki/world/load.ts`, synchronously, once; a
  stale or missing file fails loudly at import, with the regenerate hint.

### Acceptance criteria

- [ ] `bun test conductor` green (bar any known baseline), `nearestBank` behaviour unchanged for the
      existing tests, and the task-review lenses pass on the change.
- [ ] No catalog task changes behaviour unless a test shows the generated data corrected a curated
      row (then say which and why).

## Task 7 — Docs

`wiki/world/README.md` (requirements, gates.ts, the unreached report), the `knowledge` skill (where
gate corrections go), `CLAUDE.md` (agents can filter pages by Requires), `conductor/docs/world-index.md`
(phase 2 marked built, with any decision that changed).

## Out of scope for this spec

- Phase 3 (rate model, methods, training pages, `query.ts`).
- Teleports (spells, jewellery, tabs): they need a player profile; phase 3 decides whether to model
  them.
- Dynamic state: doors a player closes, NPC aggression along paths, random events.
- Fixing `conductor/lib/wilderness.ts` (a separate follow-up: the phase 1 build found it may
  disagree with `wilderness_levels.rs2` on upper floors and the underground limit; check first).

## Open questions to settle before Task 2

- Whether quest completion can be read generically (a single quest-points or progress varp per
  quest) or needs a per-quest table; decide from `scripts/quests/` before writing the scanner.
- How to represent "no weapons or armour" (Entrana) and similar inventory conditions so phase 3 can
  honour them; `other:<text>` is the fallback.
