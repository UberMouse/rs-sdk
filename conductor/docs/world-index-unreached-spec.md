# Spec: working the world index's unreached report

Turns the unreached report of phase 2 ([`world-index-phase2-spec.md`](world-index-phase2-spec.md),
"Phase 2 as built" in [`world-index.md`](world-index.md)) into ordered tasks for the `sdd-loop`
skill: derive the crossings the graph is missing, record the sites that stay unreached on purpose,
and teach the conductor's walker to use every new crossing. This is not phase 3 (the rate model);
phase 3 gains from it, because a method needs its site reached and its sink distance known.

Status: **draft for review** (2026-10-18), written on branch `worktree-world-index-unreached`.

## Baseline (2026-10-18, `main` at `5bb613a5f`)

`bun run world` reports **400 unreached sites of covered kinds**: tree 201, pickpocket 54, rock 35,
fire 27, shop 19, rc-altar 11, fishing-spot 10, range 8, water-source 8, altar 6, bank 5, anvil 4,
furnace 3, spinning-wheel 3, pottery-wheel 2, stall 2, sand-pit 1, thieving-chest 1. Grouped by
proximity (same level and plane, within 20 tiles) they make about 150 pockets, 92 of them a single
site. `world.json` is 6.9 MB. The reach fill takes about 0.6 s and the distances about 1.3 s.

Root causes, from reading the report against the scripts and the build report's other sections:

| Bucket | Cause | Where | Sites (approx.) |
|---|---|---|---|
| A | **Unconditional scripted moves on loc ops.** `gate-scan.ts` runs every loc op trigger that moves the player but emits only those that branch on a condition (candidates). A trigger that moves with no condition (the Gnome Stronghold railing, the Mage Arena cellar ladder, the lighthouse stairs, agility walks) yields no row. The Gnome Stronghold gate is a `temporary-block` candidate, so no row either. | Tree Gnome Stronghold and its upper floors, both banks, Grand Tree, ball field, agility course, Tree Gnome Village, Mage Arena cellar, lighthouse, Haunted Mine crawl, Underground Pass | ~110 |
| B | **Queued moves.** `[queue,shantay_pass_enter]` (shantay_pass.rs2:103) moves the player after the op; `gate-landings.ts` does not follow a `queue`. | Desert south of the Shantay Pass: Bedabin camp, Desert Mining Camp and its mine | ~10 |
| C | **Teleports on item-on-loc, with random landings.** The runecrafting ruins (talisman on ruins, runecraft.rs2:19) land on a random dbrow `enter_coord`; the exit portals on `exit_coord`. Listed out of scope in `gates.ts` (`TRANSPORTS_OUT_OF_SCOPE`) for that reason. | All 11 rc altars and the trees in their rooms | ~22 |
| D | **Teleports on npc ops and dialogue, with random or menu landings.** The essence mine (Aubury and four others, essence_mine.rs2:1, random among `essence_mine_teleports`, portal back to `%exit_essence_mine_coord`); Monkey Madness's glider and boat; the Miscellania longship (its own sail proc); the Fisher Realm (an item op); quest teleports into the Watchtower area, Shilo dungeon, Legends' cavern, Tai Bwo Wannai trio area, Horror from the Deep, Regicide camp; gnome gliders (interface button) and spirit trees (menu choice), out of scope today. | Rune essence mine, Ape Atoll, Crash Island, Miscellania, Fisher Realm and the quest areas | ~110 |
| E | **Pockets the collision walls in.** Lone trees and rocks 15-60 tiles from any reached tile, with no loc op on the pocket's edge that moves the player: forest decoration, cliffs. Probably unreachable in game too; to verify. | Tirannwn, Kandarin, Karamja, Feldip Hills, Crandor, cave fringes | ~80 |
| F | **Near misses.** 1-3 tiles off a reached tile: a door the scan missed or rejected, a stand tile on the wrong side of a wall (`place.ts`), or one of the build report's "rows the fill could not use" (a gate row with no derived landing: `swamp_bridge1`, `regicide_cross_over3`, `obstical_pipe2`, `crossing_rock_waterfall_quest`, `agilityarena_ladderdown`, the Underground Pass temple doors; walls whose sides are not read: `castlecrumbly`, `closet_door`). | Varrock (3154, 3428), Ardougne, Hemenster anvil, Black Knights' Fortress altar, Exam Centre, Fight Arena, Lumber Yard, Morytania swamp bridge | ~30 |
| G | **Unreached on purpose**, already explained in `areas.ts` notes but still listed. | Tutorial Island, its caves and bank; the Burthorpe Games Room (random landing, now in reach of C/D's multi-landing edge) | ~10 |

## Decisions (2026-10-18, from the user)

- **Expected-unreached sites are a curated table**, not only area notes. The build filters them
  from the report and flags an entry stale once it is reached, as `outOfScopeSites` does for sail
  sites. The report reaching zero means the curation is done.
- **Order by what the conductor needs** for a maxed account: the Gnome Stronghold (bank, agility,
  thieving, trees), the rc altars and the essence mine (Runecrafting), then the desert, then the rest.
- **The walker uses every new crossing**: scripted moves, item-on-loc and npc-op teleports, queued
  moves. That needs each crossing's data to say how it is done, so the data and the walker are
  designed together (Task 1) and the walker is built once the high-value crossings exist (Task 6).

## Global rules (apply to every task)

- Everything in phase 2's global rules still binds: code in `wiki/world/`, tests in
  `wiki/world/test/` (`*.real.test.ts` for real data), oxfmt, oxlint and tsc via
  `bun run verify:conductor`, determinism, generated files committed with their code and never
  hand-edited, a script citation (file and line) for every curated or derived row, format changes
  bump `WORLD_FORMAT` and update `load.ts` and its tests.
- **Performance budget:** `bun run world` under ~15 s, `world.json` under ~10 MB. Report both in
  every task that changes them.
- **Each task reports the unreached count before and after**, by bucket, and the sites it moved
  from unreached to reached. A task that reaches a site nobody in game can stand on is a bug.
- **Conductor code (Tasks 6 and 8)** follows the conductor rules in `CLAUDE.md`: unit tests in
  `conductor/test/`, `bun test conductor`, a smoke test per new crossing kind in
  `conductor/test/integration/smoke/` (run on a worker loaded from a library save, never the
  conductor's bot), and a `task-review` pass before it lands. No other task edits `conductor/`.
- Game facts learned while curating go in `learnings/` per the `knowledge` skill; facts about the
  index's own coverage go in `wiki/world/README.md`.

## Task 1: The pocket report, the expected-unreached table, and the crossing model

Tooling first, so every later task works from pockets with hints instead of 400 lines, and the
data shape the walker needs is settled before rows are added.

1. **Pockets.** `addReach` (build.ts) groups the unreached sites by pocket: the walkable tiles a
   flood from the site's stand (or centre) reaches over neighbour steps and the existing edges,
   within `graph.within`, without leaving unreached tiles. A pocket is reported once with its sites
   (by kind), its size in tiles, the nearest reached tile, and its **boundary hints**: the loc ops
   (placed locs on or beside the pocket's edge whose config has an op) and npc ops (spawns inside
   or beside it) whose trigger the scan found, each with the trigger's script and line, and what
   the scan made of it (a candidate of kind X; an unconditional move to (x, z); no move). A pocket
   whose flood hits a size cap is reported as "open" (the site is on a large unreached landmass,
   such as Ape Atoll).
2. **`EXPECTED_UNREACHED`** in `areas.ts` (with the areas, as area notes are today): entries by
   area id or site id, each with a reason and a script citation. The report leaves their sites out
   and lists each entry no unreached site matches as stale (an error, like an unreviewed gate). The
   free-text "build.ts unreached report" sentences in area notes move into these entries. Seed it
   with Tutorial Island and its caves and bank (tutorial.rs2:300).
3. **The crossing model.** Today an edge is `{to, alts, via}`, and `via` is `connector | gate |
   ship | cart | sled`. Extend the world's rows so every crossing says:
   - **how it is done** (`act`): `loc-op {loc, op}`, `item-on-loc {obj | category, loc}`,
     `npc-op {npc, op, choices?}` (the dialogue choices on the path the scan or the curated row
     took), `item-op {obj, op}`, or `interface {component}` (gliders);
   - **where it lands**: one tile, or a **set of tiles** (a random landing: an enum or dbrow of
     coords, read by the scan where it can, each equally likely unless the script weights the
     draw). The fill adds an edge to every landing tile under the same alternatives. Costs count
     the **longest landing** (settled 2026-10-18): the edge to landing i costs the crossing plus
     the run ticks from the landing farthest from i to i, computed once at build over the graph and
     stored on the row. A way through landing i then costs at least what the worst landing would
     (the triangle inequality), and is exact when the landings are close together, as the
     essence-mine and temple landings are. The searches stay plain Dijkstra, and the walker
     re-plans from wherever it lands;
   - **what it costs**: `CROSSING_TICKS` per `via`, with new entries `scripted` and `teleport`;
   - **its roll**, when the move is behind a `stat_random(stat, low, high)` (an agility shortcut):
     the stat, `low`, `high`, and **the failure outcome** the scan reads on the roll's other branch
     (its delay ticks, where it leaves the player, which may be the start tile or somewhere else
     such as a river bank, and its damage). The success chance is the engine's
     (PlayerOps.ts:591; the formula `wiki/world/render/resources.ts` already states: (low + 1)/256
     at level 1, rising evenly to (high + 1)/256 at 99), in one shared function both the index and
     the walker call.

   **Expected cost of a roll.** A rolled crossing's expected ticks at chance p are the success
   ticks plus (1 - p)/p times (the fail ticks plus the way back from the fail tile to the start
   tile). The way back is run ticks computed once at build and stored on the row, so at a given
   level the cost is a plain edge weight. In the index, which has no account, the chance is taken
   at the lowest level the requirement allows (the worst case for anyone who may use it).

   The new `via` kinds are `scripted` (a loc op move with no gate decision: Task 2) and `teleport`
   (item-on-loc, npc-op, item-op, interface: Tasks 3, 4, 7). Existing connector, gate and transport
   rows gain an `act` too where the walker needs one (a gate's open op is already implied). Bump
   `WORLD_FORMAT`.

### Acceptance criteria

- The report prints pockets, not sites. The 400 baseline sites come out as at most ~160 pockets,
  each with its hints. A unit test on a scripted world pins grouping, the size cap and the hints.
- `EXPECTED_UNREACHED` filters, and a stale entry fails the build. Tutorial Island is gone from the
  report. Unit tests cover filtering and the stale check.
- `world.json` carries `act` and landing sets. `load.ts` reads them. The fill and distance handle a
  multi-landing edge (unit tests on a grid). No reach changes yet, apart from the expected filter.
- `conductor/lib/walk-graph.ts` still ignores every `via` it does not know (a test pins it), so the
  walker is unchanged until Task 6.

## Task 2: Unconditional scripted moves on loc ops (bucket A)

`gate-scan.ts` already runs every loc op trigger that moves the player, down every path, and
`gate-landings.ts` can bind a run to a placed loc and a tile to find its landing. Emit the moves
it does not make candidates of:

- A trigger whose every path moves the player with no condition becomes a `scripted` row per
  placed loc, landing from the bound run (`gateLander`), `act: loc-op`. An agility walk with a
  `stat_random` roll is followed the way it succeeds for the landing (as the scan already does),
  and also down the failing branch, to fill in the row's `roll` and failure outcome (Task 1). This
  applies to rolled gate rows too: the gate candidates with a `skill` requirement and a roll get
  the same fields. A `stat` check before the move is a `skill:<skill>:<level>` requirement, so the
  row becomes a gate candidate as today. A move whose landing the bound run cannot settle is listed in the report, not guessed.
- **`temporary-block` candidates** (5 today, the Gnome Stronghold gate among them,
  gnome_gate.rs2:2) get a row each: the trigger's forcemove crosses the shut gate. The kind stays
  as reviewed in `gate-list.ts`. What changes is that a temporary block with a move now yields an
  edge.
- The Grand Tree doors (gnome_gate.rs2:63), the Gnome Village railing
  (gnomevillage_fence.rs2:1), the Mage Arena cellar ladder (mage_arena.rs2:1), the lighthouse
  bridge and stairs (quest_horror.rs2:63, :186; the doorway stays a quest gate) are expected to
  come out of this generically. If one does not, say why in the task report before curating it.
- `sources/connectors.ts` keeps owning `ladders+stairs/`. A scripted move on a loc that already has
  a connector row for that op is not added twice (the build fails on a duplicate).

### Acceptance criteria

- Unit tests on scripted triggers: an unconditional `p_telejump` to a literal, a `~forcemove` to a
  fixed tile, an agility walk with a roll, a temporary block with a forcemove, a move whose landing
  is unsettled (reported).
- A real-data test pins the Gnome Stronghold bank (`gnome-stronghold-bank`), the Grand Tree bank,
  the Mage Arena bank and the lighthouse shop as reached, and their requirement sets.
- The report loses the Tree Gnome Stronghold, Grand Tree, ball field, agility course, Tree Gnome
  Village, Mage Arena cellar and lighthouse pockets, or each pocket still listed says why.
- The known gaps "the Mage Arena ladder, the Gnome Stronghold gate and railing, the lighthouse" are
  gone from `wiki/world/README.md` and `conductor/docs/world-index.md`.

## Task 3: Runecrafting ruins and portals (bucket C)

Move the ruins out of `TRANSPORTS_OUT_OF_SCOPE`:

- Each ruins loc gets a `teleport` row, `act: item-on-loc` with its talisman (runecraft.rs2:19),
  requirement `item:<talisman>:held`, landing the dbrow `enter_coord` set (`runecraft_table`).
  Each temple's exit portal gets a row back to the `exit_coord` set. Read the dbrow rather than
  curating the coords. If this revision has tiaras (runecraft.ts says it has none), add the worn
  form as an alternative.
- The scan's use-item triggers (`oplocu`) on the ruins are where the talisman check is, so derive
  the rows there if the scan can read `last_useitem` against the dbrow's talisman. Otherwise curate
  them in `gates.ts` with the dbrow as their source, so nothing is typed twice.

### Acceptance criteria

- All 11 rc altars are reached under `item:<talisman>:held`, plus the altar's own access (the
  death altar's quest, for example). A real-data test pins air and one members altar.
- The trees inside the altar rooms leave the report, or go to `EXPECTED_UNREACHED` with a reason if
  they are decoration.

## Task 4: The essence mine (bucket D, first part)

Move the essence mine teleport out of `TRANSPORTS_OUT_OF_SCOPE`: a `teleport` row per wizard
(Aubury, Sedridor, Cromperty, Distentor, Brimstail; essence_mine.rs2:1), `act: npc-op`, requirement
`quest:runemysteries` (essence_mine.rs2:2), landing the `essence_mine_teleports` enum. The portals
return to `%exit_essence_mine_coord`, the wizard the player came from, which a stateless graph
cannot follow. Give each portal an edge to every wizard's exit tile, with requirement
`other:came from <wizard>`, so the fill reaches all of them, and the walker (Task 6) uses only the
edge for the wizard it came in by. Start from the npc's op trigger, and generalise the scan to
`opnpc` triggers only if that is cheaper than a curated row per wizard; the task report says which
was done.

### Acceptance criteria

- The rune essence mine's rocks are reached under `quest:runemysteries`. The pocket leaves the
  report. A real-data test pins it.
- Distances from the mine's rocks to the nearest bank go through a portal and a wizard.

## Task 5: Queued moves (bucket B)

`gate-landings.ts` follows a `queue(<script>, ...)` the trigger issues and treats the queued
script's moves as the trigger's, with the trigger's conditions. This is the Shantay Pass's way in
(shantay_pass.rs2:79, the move at :103) and its pass item (`consume:shantay_pass:1`, the
`inv_del` before the `queue`). Its `act` carries the poster choice ("Yeah, that poster doesn't
scare me!"), which the script asks only without a `thshantaydisc` held, so `cross` answers it when
it is shown. The `npc_find(shantay_guard_still)` check is a side condition, read both ways. Other
`queue`d moves the scan finds are reported. Each either works, or is listed with why not.

### Acceptance criteria

- The desert south of the pass is reached under its pass requirement: the Bedabin camp shop, the
  Desert Mining Camp and its mine (or that mine with its own quest requirement). The known gap "the
  Shantay Pass queued move" is gone from the docs.
- Unit tests cover a queued move with a condition before the queue.

## Task 6: The walker crosses scripted moves and teleports (conductor)

The conductor's walker (`conductor/lib/walk-graph.ts`, `conductor/actions/walk.ts`) today crosses
neighbour steps, doors it opens, and connector rows. Teach it every `act`:

- `walk-graph.ts` plans over `scripted` and `teleport` edges whose alternatives the account meets
  (`meetsSet`, `lib/account.ts`): `quest`, `skill` and `members` by the account, `item:<obj>:held`
  and `consume` by the inventory, or by a bank detour (below). Edge costs are Task 1's: random
  landings at their stored longest-landing cost, and the walk re-plans from where it lands. The essence mine's `other:came from <wizard>` edges are met only for the
  wizard on record.
- **Rolled crossings (agility shortcuts)** are priced at the bot's **current** level: the chance
  from the shared `stat_random` function, then the expected cost of Task 1, fail and retry
  included. The route takes a shortcut only when that expected cost beats the best way without
  it, so a low-level bot walks round a shortcut that a higher-level one takes. One safety rule on
  top: a crossing whose failure damage can reach the bot's current HP is not planned through.
- **Bank detours for held items, computed per plan.** When a way needs an item the inventory lacks
  (a talisman, a Shantay pass, coins for a toll), the plan also prices the way that goes first to a
  bank (`nearestBank` over the graph), withdraws it, and goes on. It takes the detour when that
  total, bank time included, beats the best way without the item. The item has to be in the bank
  by the plan's record (`lib/plan.ts` `bank(item)`, the count as last seen open; unknown counts as
  absent), and the bot needs a free slot, or the stack to add to. The detour is planned in the
  walk graph and done by the walk (open the bank, withdraw, close: the existing bank actions).
  If the bank turns out not to hold the item, the walk re-plans without it.
- A generic `cross` action (`conductor/actions/cross.ts`) does an `act`: walk to the crossing's
  approach, send the op (`interactLoc`, `useItemOnLoc`, `interactNpc` and the dialogue choices,
  the item op, the interface click), wait for the move with a deadline from the trigger's delays,
  and report `crossed`, `refused` (a game message, an `opRejected`), or `no-move`. It reuses
  `obstacle.ts`'s refusal and fall messages.
- `walk.ts` sends `cross` for each such edge on its route, as it sends `climb` for connectors.
- **The bespoke crossings stay** until `cross` covers them: `actions/gate.ts` (`passGate`, the
  Gnome Stronghold gate), `travel.ts`'s `gnome-gate` step, `essence-mine.ts`'s teleport and portal,
  `runecraft.ts`'s ruins and portal. Once the smoke tests pass, each becomes a call of `cross` or of
  `walkTo` with the destination, in this task or a follow-up the task report names. Decide which
  in the task, keeping each change reviewable on its own.
- Wilderness rules are unchanged: a route does not enter the Wilderness unless it starts or ends
  there.

### Acceptance criteria

- Unit tests on scripted worlds: a plan through a scripted move, through a teleport the account
  can and cannot use (item missing, quest not done), through a random landing (re-plan), and the
  essence-mine portal edge chosen by the wizard on record.
- Rolled crossings: one shortcut on a grid is skipped at a low level and taken at a high one, at
  the level where the expected costs cross. The damage rule refuses a shortcut at low HP.
- Bank detours: taken when the bank holds the item and the detour is shorter; skipped when the
  bank count is unknown, zero, or the detour is longer; re-planned when the withdraw finds nothing.
- Smoke test (in addition to those below): a route through a rolled shortcut at a level where it
  pays, and a bank detour for a talisman before the air ruins.
- Smoke tests on a worker loaded from a library save: walk from Lumbridge into the Gnome
  Stronghold bank (gate inward), and out again (gate outward); use a talisman on the air ruins and
  leave by the portal; Aubury into the essence mine and out by a portal. `bun run
  test:integration <filter>` passes for each.
- `task-review` passes. `bun test conductor` passes.

## Task 7: The remaining teleports and transports (bucket D, rest)

A `teleport` or transport row each, derived where the scan reaches it, else curated in `gates.ts`
with its script:

- Monkey Madness: Waydar's glider to Crash Island (mm_waydar.rs2:116), Lumdo's boat to Ape Atoll
  (mm_lumdo.rs2:24), and the way back.
- The Miscellania longship (misc_sailor.rs2:13): its own sail proc. Read `~misc_longship_sail` in
  `sources/transports.ts` if it fits the sail model, else a curated row.
- The Fisher Realm (Holy Grail; the whistle's item op), the Watchtower area, the Shilo Village
  quest dungeon, Legends' Quest cavern, the Tai Bwo Wannai trio area, Horror from the Deep's area,
  the Regicide camp, the Haunted Mine's inner areas, Rogues' Castle's upper floors (L1-L3), the
  Burthorpe Games Room stairs (random landing, stairs.rs2:491), the Mage Arena pool
  (magearena_waterportal1, mage_arena.rs2:15).
- Gnome gliders (`interface` act) and spirit trees (menu choice, per-tree quest): a row per
  destination with the choice in its `act`.
- Holgart's boats (quest-staged dialogue) and the Fishing Trawler (a minigame) stay out of scope.

Each row the walker cannot do yet (an `act` `cross` does not handle) is `LEFT_OUT` in the
conductor with its reason, so the walker never plans through it.

### Acceptance criteria

- Each pocket listed above leaves the report, or goes to `EXPECTED_UNREACHED` with its reason.
- A real-data test pins Ape Atoll, Miscellania's bank and the Fisher Realm as reached, with their
  requirement sets.
- `TRANSPORTS_OUT_OF_SCOPE` holds only the Trawler and Holgart, each with its reason.

## Task 8: Near misses and the rows the fill could not use (bucket F)

Pocket by pocket, from Task 1's hints: a door the scan missed (fix `gate-scan.ts`) or a rejection
in `gate-list.ts` that was wrong, a stand tile on the wrong side of a wall (`place.ts` stand rules),
a landing not derived (the "rows the fill could not use": `swamp_bridge1`, `regicide_cross_over3`,
`obstical_pipe2`, `crossing_rock_waterfall_quest`, `agilityarena_ladderdown`, the Underground Pass
temple doors), or a wall whose two sides are not read (`castlecrumbly`, `closet_door`). Where the
scripts do not settle it, check in game on a worker (`load.ts <worker> lib:<save> --client`,
`screenshot.ts`) and record the finding in `learnings/`.

### Acceptance criteria

- No pocket within 5 tiles of a reached tile is left in the report without an
  `EXPECTED_UNREACHED` entry.
- The build report's "rows the fill could not use" is empty, or each remaining row says why.
- Any `place.ts` stand rule change keeps `bun test wiki/world` green and lists the stand tiles it
  moved.

## Task 9: Pockets the collision walls in (bucket E), and the docs

- For each pocket left, check that no loc or npc op on its boundary moves the player (Task 1's
  hints say so). Spot-check a sample in game on a worker. Record the pockets in
  `EXPECTED_UNREACHED` as "walled in by collision", with the boundary checked. One entry may cover
  an area's walled-in decoration trees if the reason is the same.
- Docs: `wiki/world/README.md` (the unreached report section: pockets, hints,
  `EXPECTED_UNREACHED`, the crossing model), `conductor/docs/world-index.md` ("Phase 2 as built"
  known gaps, now closed or moved to the table), `conductor/README.md` if the walker's abilities
  are described there.

### Acceptance criteria

- `bun run world` prints `unreached: every site of a covered kind is reached from the Lumbridge
  spawn` (no site unreached outside `EXPECTED_UNREACHED`).
- Follow-up, not in this task: make a new unreached site a `--check` failure, so a regression in a
  source is caught. This spec leaves it as a proposal for the review of Task 9.

## Out of scope for this spec

- The rate model and methods (phase 3).
- Teleport spells, jewellery and tablets: player-side travel, not a crossing of the map. The walker
  may use them later, as a separate design.
- Banker clusters across booths, and the walker's `planeOf` gaps for unnamed underground areas:
  known gaps, neither of which makes a site unreached.

## Settled questions (2026-10-18, from the user)

1. **Agility shortcuts with a fail chance:** use one when it saves ticks on average at the bot's
   current level. The fail rate comes from the shortcut's `stat_random` bounds, and the failure's
   own cost is counted (Task 1's expected cost, Task 6's rolled crossings). `cross` retries a
   failed roll while the plan still prices the shortcut as the better way.
2. **Items a way needs that the inventory lacks:** if going to a bank for the item is faster,
   compute that on the fly in the walk plan (Task 6's bank detours).
3. **Random-landing distance:** the longest landing, in the index and in the walker, as a fixed
   per-landing edge cost stored at build (Task 1), so no search changes.
