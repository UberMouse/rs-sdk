# Spec: world index phase 2, reachability and travel

Expands phase 2 of the approved design [`world-index.md`](world-index.md) ("Reachability and
travel") into ordered tasks, for the `sdd-loop` skill. Phase 1 ([`world-index-spec.md`](world-index-spec.md))
is built: `bun run world` writes `wiki/world.json` (features, sites, curated areas, `npcSpawns`) and
the `wiki/places|resources|services` pages; the NPC and shop generators read it. Phase 2 answers
"can a bot get there, and what does it need?" for every site, and gives phase 3 real walk distances.

Status: **in build** on branch `world-index-phase2` (2026-10-16), via the `sdd-loop` skill. Checked
against the code at that date: `wiki/world/` has `collision.ts` (the SDK bundle via `collisionPaths`),
`classify.ts` (kind `connector`), `sources/zones.ts` (`isF2p`), `types.ts` (`Site`, `World`,
`WORLD_FORMAT = 2`). Baseline: `bun run world` 4.9 s, `world.json` 5.8 MB.

## Assumptions (2026-10-16)

- **Collision is the SDK bundle as the bot's walker sees it**: `collisionPaths` in
  `conductor/actions/paths.ts` (`canStep`, `walkable`, with `EXTRA_DOORS` masked), the same data
  phase 1 places stand tiles with. Reach therefore means "a bot can walk there". Known gaps in the
  bundle (shape-9 ground doors other than the one in `EXTRA_DOORS`) are not patched here; they show
  up in the unreached report.
- **The bundle has every door open** (`initPathfinding` masks door walls). A door that `gates.ts`
  names is walled again inside the fill (from its loc tile, shape and angle), and the fill crosses
  it only as an edge that carries the gate's requirements. A one-way door (`ONE_WAY_DOORS`, left
  walled by the SDK) stays walled unless `gates.ts` gives it an edge.
- **Mainland-fill zones are not land.** `initPathfinding` allocates every empty zone in
  x 2304-3392, z 2944-3584 as open so its long-range search can cross gaps. Those zones are not
  in the data's zone list, and the fill does not enter them. A test pins this, and the build report
  counts fill-zone tiles adjacent to reached tiles.
- **Concurrent conductor edits**: a conductor run is adding Taverley connectors and a `taverley`
  underground area to `conductor/lib/connectors.ts` on `main`. Before Task 1's real-data test and
  again before Task 6, merge `main` into this branch so those rows are in the table being
  reproduced.

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
  `Requirement` is a tagged union: `quest:<id>`, `quest:<id>>=<stage>`, `skill:<skill>:<level>`,
  `item:<obj>:worn|held`, `category:<category>:worn|held` (any obj of an obj-config category, e.g. any
  axe: a script's `inv_totalcat` or a tool-checker proc such as `~woodcutting_axe_checker` maps to the
  categories it tests), `questpoints:<n>` (`%qp >= n`, e.g. the Champions' Guild door), `coins:<n>`,
  `consume:<obj>:<n>`, `members`, `loadout:<id>`, `other:<text>`
  (see Settled questions). Each scanned candidate is either confirmed here (with its
  requirement) or listed as "not a gate" with the reason; the build fails on an unreviewed candidate,
  so new content is never silently ignored.
- Transports: parse `scripts/interface_boat/` (`sail.rs2`, `sail.constant`) for ship routes (from,
  to, fare, members/quest conditions); curate the rest in `gates.ts` as `{ from, to, requires,
  source }`.

**Split (2026-10-16), built as two reviewed commits:**

- **Task 2a — requirements, quests, loadout rules, transports.** The `Requirement` type and its
  canonical string form (in `wiki/world/requirements.ts`); the quest table derived from the
  `send_quest_progress` calls with its curated overrides and varp ids (`World.quests`); loadout
  rules (`World.loadoutRules`, Entrana's from `has_entrana_restricted_items`); ship routes from
  `sail.rs2`/`sail.constant` plus curated transports (`World.transports`); format bump. Criteria:
  the quest and transport bullets of "Settled questions" and the third criterion below.
- **Task 2b — gate scan and curation.** `gate-scan.ts`, the curated gate list in `gates.ts`
  (every candidate confirmed or rejected, with a kind: gate / side effect / temporary block /
  quest window), the build failing on an unreviewed candidate, `World.gates`. Criteria: the first
  two below.

### Acceptance criteria

- [ ] The scan finds the calibration examples above with the right requirement kind; tests on
      scripted bodies cover each condition form.
- [ ] Every scanned candidate is confirmed or rejected in `gates.ts` (the build fails otherwise);
      every entry cites its script.
- [ ] Ship routes are derived from `sail.rs2`/`sail.constant` with their fares; Port Sarim -> Karamja
      and the Entrana boat (`{members, loadout:entrana}`) are pinned by tests.

## Task 3 — Reachability graph and flood fill

**Files:** `wiki/world/reach.ts`, `wiki/world/test/reach.test.ts`,
`wiki/world/test/reach.real.test.ts`.

- Nodes: walkable tiles on levels 0-3 and the underground and instanced planes, indexed into typed
  arrays (allocated zones only; `collision.ts`).
- Edges: neighbour steps the collision data allows (`canStep`, so walls block); doors the
  pathfinder opens are passable unless `gates.ts` names them; connectors (Task 1) as one-way edges;
  gates and transports (Task 2) as edges carrying their requirements.
- Members: bots always play on members worlds (user, 2026-10-16), so `members` is always satisfied.
  The fill treats the token as the empty requirement and never adds it to a set; `world.json` still
  records it on transports and gates where the scripts check `map_members`. No members-zone logic.
- Ships: Task 2a's ship landings are on the deck (level 1). The fill needs the moves between deck and
  quay as edges, from the gangplank locs (`general_use/scripts/gangplank.rs2`, relative moves),
  derived the way Task 1 derives connectors and reported the same way when underivable. Without
  them every boat leads nowhere.
- Fill: from the Lumbridge spawn (3222, 3218, level 0), a multi-label BFS keeping, per tile, the
  antichain of minimal requirement sets (a set is dropped when a subset already reaches the tile).
  Bound the antichain size per tile (report tiles that hit the bound) so a gate-dense area cannot
  blow up memory.
- Deterministic: requirement sets are sorted, canonical strings.

### Acceptance criteria

- [ ] Synthetic-grid tests: open walk; a wall; a door; a gated door; a connector; two gates with
      overlapping requirements (antichain minimality); a transport with a fare; an unreachable pocket.
- [ ] Real-data facts (each a test with its evidence): Lumbridge, Draynor, Varrock, Falador reach
      with `{}`; Al Kharid with whatever the data gives (the `{coins:10}` toll, or `{}` by another route);
      Zanaris needs `{item:dramen_staff:worn}` (the shed door checks the staff, not the quest); Entrana only
      by boat, `{loadout:entrana}`; Musa Point on Karamja by boat and gangplank, `{coins:30}`;
      the Dwarven Mine reaches with `{}` through the Ice Mountain ladder and Falador stairs.
- [ ] Runtime and memory reported; within the global budget.

## Task 4 — Access on sites and pages

**Files:** `types.ts`, `build.ts`, `render/*`, tests; regenerated output.

- Each `Site` and `NpcSpawn` gains `reach: string[][]` (minimal requirement sets of its stand tile,
  or of its nearest walkable tile for npc clusters); `[]` = unreachable.
- Pages: a Requires column on resource, service and place tables (`-` for `{}`, the sets joined
  with "or"); service and resource pages can be read as "where can a fresh account do X".
- Build report: unreached sites of covered kinds, grouped by area, with the nearest reached tile
  and the plane, as the curation to-do list.

### Acceptance criteria

- [ ] All 25 bank sites have `reach`; the mainland banks a walk reaches with no requirement are `[[]]`;
      Zanaris carries `{item:dramen_staff:worn}`.
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
- `banks.ts` derives `BANKS` from every bank site, on any level and members-only ones included (user,
  2026-10-16: bots always play on members worlds). "Nearest" becomes the fewest walk ticks over the
  Task 3 graph (Task 5's distances), not straight-line distance. A bank is a candidate only when the
  account meets one of its `reach` sets and its route chains no more connectors than the walker
  allows (`connectors.ts`). The curated `auto: false` reasons stay (Draynor's dark wizards); Al
  Kharid's toll is now a requirement, not a curated skip.
- Loading: the conductor reads `world.json` through `wiki/world/load.ts`, synchronously, once; a
  stale or missing file fails loudly at import, with the regenerate hint.

### Acceptance criteria

- [ ] `bun test conductor` green (bar any known baseline), and the task-review lenses pass on the
      change.
- [ ] Every change in which bank `nearestBank` picks, for the existing tests and for each catalog
      task's default area, is listed in the commit message with its reason (a closer bank by walk,
      a members bank, an upstairs or underground bank); none picks a bank the walker cannot reach.
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

## Settled questions (2026-10-16)

### Quest progress is read generically, with a short override table

Each quest's journal button calls `~send_quest_progress(questlist:<id>, %<varp>, ^<x>_complete)`
(or `~send_quest_progress_colour`, same arguments), and `general/scripts/quests.rs2:5` shows the
quest as done at `progress >= complete`. Every `^<x>_complete` is in `general/configs/quest.constant`;
varp ids are in `pack/varp.pack` (`147=zanaris`). So the scanner derives a quest table
`{ id: <questlist component>, varp, varpId, complete }` from those calls, with no per-quest table.

The forms it cannot read go in a curated override in `gates.ts`, each citing its script; the build
fails on any `questlist` component that is in neither:

- computed progress: `cog` (`~get_cog_progress`), `itexam` (`~itexam_progress`);
- bit-packed: `elemental_workshop` (`%elemental_workshop_bits` against `2 * ^..._complete`);
- literal thresholds: `haunted` (3), `upass` (one call passes `1`);
- two varps on one entry: `blackarmgang` (`%blackarmgang` / `%phoenixgang`, either gang);
- two endings: `ikov` (`^ikov_completed_armadyl` 80, `^ikov_completed_lucien` 90; `>= 80` is done).

**Requirement forms.** `quest:<id>` means `varp >= complete`. `quest:<id>>=<stage>` (with the stage
constant's name in `source`) covers a gate that opens part-way through a quest; completion
satisfies it too. Both assume quest varps only grow, which a test checks on the scanned
`%varp = ^const` assignments (the assignment constants for each quest are non-decreasing in stage
order, or the quest is listed as an exception).

**Which checks are gates.** 110 `oploc`/`aploc` triggers that move the player (`p_telejump`,
`p_teleport`, door procs) test a quest varp: 14 compare only against `_complete`, 40 use a
`>=`/`<` stage test, 55 use an exact `=` or a `switch_int`. Sampling the exact ones shows they
are mostly not access conditions. `gate-scan.ts` sorts each candidate into one of these, and
`gates.ts` records which:

- **gate**: a steady requirement (`_shilo_metalgate`, `quest:zombiequeen`);
- **side effect**: passable always, the check only advances the quest (`mcannoncave`) — not a gate;
- **temporary block**: shut only during a stage (`gnome_areagate` during The Grand Tree,
  `_varrock_gate`'s Biohazard search) — not a gate, with the reason;
- **quest window**: open only between two stages and shut once the quest is done
  (`dragonshipgangplank_on`, `quest_dragon_bought_ship` until `dragon_complete`) — kept out of the
  fill and listed in the build report. A bot mid-quest is driven by quest tasks, not the world index.

The fill models a settled account: each quest either not started, or complete, plus the
monotonic stage gates.

**Evaluating it.** The conductor already reads perm varps by id from a save (`SaveSummary.varps`,
`conductor/lib/saves.ts`). So `world.json` gains a `quests` table (`id`, `varpId`, `complete`, and
the stages any gate names), and a requirement is checked against a live bot with no new SDK state.

### Item conditions: two requirements and a loadout rule

The scripts check items in three ways, and they behave differently in the fill:

- **Hold or wear an item.** The Zanaris shed (`oploc1,zanarisdoor`,
  `quest_zanaris.rs2:91`) checks only `inv_total(worn, dramen_staff) > 0 & map_members`, not the
  quest varp; entering *completes* Lost City. Requirement `item:<obj>:worn` or `item:<obj>:held`.
- **Consume an item.** Shantay Pass (`inv_del(inv, shantay_pass, 1)`, `shantay_pass.rs2:38`), the
  Al Kharid toll. Requirement `coins:<n>` or `consume:<obj>:<n>`; phase 3 charges both per crossing.
- **Carry none of a category.** Entrana (`[proc,has_entrana_restricted_items]`,
  `monk_of_entrana.rs2:26`) refuses any carried or worn obj in 23 categories (`armour_*`,
  `weapon_*`, plus carried `cannon_parts`). The ban is by **category, not equip slot**: Ice gloves
  (`wearpos=hands`, no category) pass, while axes (`weapon_axe`) and pickaxes (`weapon_pickaxe`)
  are refused.

A category ban is not like the other requirements. Any account meets it by banking its gear, so it
never decides whether a tile is reachable; it limits what a trip can carry there. It is recorded
as a **loadout rule**: `world.json` gains `loadoutRules: { <id>: { forbidCategories: { <category>:
'carried'|'worn'|'both' }, source } }` (scope per category: Entrana bans `cannon_parts` only when
carried), and the edge carries the token `loadout:<id>`. Inside the
fill that token behaves like a requirement, so a route without the rule beats one with it and the
antichain stays minimal. Phase 3 resolves categories from the obj configs and drops a method whose
every route to its site carries a rule that bans the method's tool or weapon category. Entrana
then has no woodcutting or mining, but keeps fishing and cooking. `other:<text>` stays only for
conditions none of these forms fit, and the build report lists each one.

Tasks 2, 3 and 4 above are updated to match. Task 4's Requires column renders `loadout:entrana` as
"no weapons/armour (Entrana rule)".
