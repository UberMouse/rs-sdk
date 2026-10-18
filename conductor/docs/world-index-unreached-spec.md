# Spec: working the world index's unreached report

Turns the unreached report of phase 2 ([`world-index-phase2-spec.md`](world-index-phase2-spec.md),
"Phase 2 as built" in [`world-index.md`](world-index.md)) into ordered tasks for the `sdd-loop`
skill: derive the crossings the graph is missing, record the sites that stay unreached on purpose,
and teach the conductor's walker to use every new crossing. This is not phase 3 (the rate model);
phase 3 gains from it, because a method needs its site reached and its sink distance known.

Status: **in build** on branch `worktree-world-index-unreached` (2026-10-18), via the `sdd-loop`
skill.

## Baseline (2026-10-18, `main` at `5bb613a5f`)

`bun run world` reports **400 unreached sites of covered kinds**: tree 201, pickpocket 54, rock 35,
fire 27, shop 19, rc-altar 11, fishing-spot 10, range 8, water-source 8, altar 6, bank 5, anvil 4,
furnace 3, spinning-wheel 3, pottery-wheel 2, stall 2, sand-pit 1, thieving-chest 1. Grouped by
proximity (same level and plane, within 20 tiles) they make about 150 pockets, 92 of them a single
site. `world.json` is 6.9 MB; the reach fill takes about 0.6 s and the distances about 1.3 s.

Root causes, from reading the report against the scripts and the build report's other sections:

| Bucket | Cause | Where | Sites (approx.) |
|---|---|---|---|
| A | **Unconditional scripted moves on loc ops.** `gate-scan.ts` runs every loc op trigger that moves the player but emits only those that branch on a condition (candidates). A trigger that moves with no condition (the Gnome Stronghold railing, the Mage Arena cellar ladder, the lighthouse stairs, agility walks) yields no row. The Gnome Stronghold gate is a `temporary-block` candidate, so no row either. | Tree Gnome Stronghold and its upper floors, both banks, Grand Tree, ball field, agility course, Tree Gnome Village, Mage Arena cellar, lighthouse, Haunted Mine crawl, Underground Pass | ~110 |
| B | **Queued moves.** `[queue,shantay_pass_enter]` (shantay_pass.rs2:103) moves the player after the op; `gate-landings.ts` does not follow a `queue`. | Desert south of the Shantay Pass: Bedabin camp, Desert Mining Camp and its mine | ~10 |
| C | **Teleports on item-on-loc, with random landings.** The runecrafting ruins (talisman on ruins, runecraft.rs2:19) land on a random dbrow `enter_coord`, the exit portals on `exit_coord`; listed out of scope in `gates.ts` (`TRANSPORTS_OUT_OF_SCOPE`) for that reason. | All 11 rc altars and the trees in their rooms | ~22 |
| D | **Teleports on npc ops and dialogue, with random or menu landings.** The essence mine (Aubury and four others, essence_mine.rs2:1, random among `essence_mine_teleports`, portal back to `%exit_essence_mine_coord`); Monkey Madness's glider and boat; the Miscellania longship (its own sail proc); the Fisher Realm (an item op); quest teleports into the Watchtower area, Shilo dungeon, Legends' cavern, Tai Bwo Wannai trio area, Horror from the Deep, Regicide camp; gnome gliders (interface button) and spirit trees (menu choice), out of scope today. | Rune essence mine, Ape Atoll, Crash Island, Miscellania, Fisher Realm and the quest areas | ~110 |
| E | **Pockets the collision walls in.** Lone trees and rocks 15-60 tiles from any reached tile, with no loc op on the pocket's edge that moves the player: forest decoration, cliffs. Probably unreachable in game too; to verify. | Tirannwn, Kandarin, Karamja, Feldip Hills, Crandor, cave fringes | ~80 |
| F | **Near misses.** 1-3 tiles off a reached tile: a door the scan missed or rejected, a stand tile on the wrong side of a wall (`place.ts`), or one of the build report's "rows the fill could not use" (a gate row with no derived landing: `swamp_bridge1`, `regicide_cross_over3`, `obstical_pipe2`, `crossing_rock_waterfall_quest`, `agilityarena_ladderdown`, the Underground Pass temple doors; walls whose sides are not read: `castlecrumbly`, `closet_door`). | Varrock (3154, 3428), Ardougne, Hemenster anvil, Black Knights' Fortress altar, Exam Centre, Fight Arena, Lumber Yard, Morytania swamp bridge | ~30 |
| G | **Unreached on purpose**, explained in `areas.ts` notes but still listed. | Tutorial Island, its caves and bank | ~10 |

## Decisions (2026-10-18, from the user)

- **Expected-unreached sites are a curated table**, not only area notes. The build filters them
  from the report and flags an entry stale once it is reached, as `outOfScopeSites` does for sail
  sites. The report reaching zero means the curation is done.
- **Order by what the conductor needs** for a maxed account: the Gnome Stronghold (bank, agility,
  thieving, trees), the rc altars and the essence mine (Runecrafting), then the desert, then the rest.
- **The walker uses every new crossing**: scripted moves, item-on-loc and npc-op teleports, queued
  moves. Each crossing's data says how it is done, so the data model (Task 2) is settled before
  rows are added, and the walker is built once the high-value crossings exist (Task 7).
- **Agility shortcuts with a fail chance:** use one when it saves ticks on average at the bot's
  current level. The fail rate comes from the shortcut's `stat_random` bounds, and the failure's
  own cost is counted (Task 2's expected cost, Task 7's rolled crossings). `cross` retries a
  failed roll while the plan still prices the shortcut as the better way.
- **Items a way needs that the inventory lacks:** if going to a bank for the item is faster,
  compute that on the fly in the walk plan (Task 7's bank detours).
- **Random-landing distance:** the longest landing, as a fixed per-landing edge cost stored at
  build (Task 2), so no search changes.

## Global rules (apply to every task)

- Everything in phase 2's global rules still binds: code in `wiki/world/`, tests in
  `wiki/world/test/` (`*.real.test.ts` for real data), oxfmt, oxlint and tsc via
  `bun run verify:conductor`, determinism, generated files committed with their code and never
  hand-edited (`bun run world` regenerates them; `bun wiki/world/build.ts --check` must pass), a
  script citation (file and line) for every curated or derived row, format changes bump
  `WORLD_FORMAT` and update `load.ts` and its tests.
- **Tests:** `bun test wiki/world` and `bun test conductor` both pass at every task's commit.
- **Performance budget:** `bun run world` under ~25 s, `world.json` under ~10 MB. Report both in
  every task that changes them.
- **Each task reports the unreached count before and after**, by bucket, and the sites it moved
  from unreached to reached. A task that reaches a site nobody in game can stand on is a bug.
- **Conductor code (Tasks 7 and 8 only)** follows the conductor rules in `CLAUDE.md`: unit tests in
  `conductor/test/`, a smoke test per new crossing kind in `conductor/test/integration/smoke/`
  (`bun run test:integration <filter>`, needs the shared local stack; integration tests make their
  own fixture bots, never a conductor bot). No other task edits `conductor/` beyond what keeps
  `bun test conductor` green after a `WORLD_FORMAT` bump (`conductor/lib/world-index.ts` and the
  modules that read the new fields).
- Game facts learned while curating go in `learnings/` per the `knowledge` skill; facts about the
  index's own coverage go in `wiki/world/README.md`. Comments match the surrounding density and
  voice; no knowledge base facts in code comments beyond the script citations.

## Task 1 — The pocket report and the expected-unreached table

**Files:** `wiki/world/build.ts` (`addReach`, `Unreached`, `formatUnreached`, `failed`),
`wiki/world/areas.ts` (`EXPECTED_UNREACHED`, notes), `wiki/world/types.ts` if a type moves,
`wiki/world/test/build.test.ts`, a real-data test.

1. **Pockets.** The unreached sites are grouped by pocket: the walkable tiles a flood from the
   site's stand (or centre) reaches over neighbour steps (`graph.stepMask` inside `graph.within`)
   and the existing edges, never entering a reached tile, up to a size cap. A pocket is reported
   once with its sites (by kind), its size in tiles, the nearest reached tile, and its **boundary
   hints**: the loc ops (placed locs on or beside the pocket's tiles whose config has an op, or a
   use-item trigger) and npc ops (spawns inside or beside it) that have a trigger, each with the
   trigger's script and line and what the scan made of it (a gate candidate of kind X; an
   unconditional move; no move found). A pocket whose flood hits the cap is reported as "open"
   (the site is on a large unreached landmass, such as Ape Atoll), with the hints found so far.
   The report stays warnings only, out of `--check`.
2. **`EXPECTED_UNREACHED`** in `areas.ts`: entries by area id or site id, each with a reason and a
   script citation. The report leaves their sites out. An entry no unreached site matches is
   stale: the build reports it as an error (`failed(report)`), as an unreviewed gate is. The
   free-text "build.ts unreached report" sentences in area notes stay as notes for now (later
   tasks remove them as their pockets are reached, or turn them into entries). Seed the table with
   Tutorial Island, its caves and its bank (tutorial.rs2:300: finishing the tutorial telejumps the
   player to Lumbridge and nothing takes them back).

### Acceptance criteria

- [ ] `bun run world` prints the unreached report by pocket, not by site: each pocket with its
      sites by kind, size, nearest reached tile, and hints with script and line.
- [ ] The baseline's sites (less Tutorial Island's) come out as at most ~160 pockets. The task
      report gives the count and the ten largest pockets.
- [ ] A unit test on a scripted world pins the grouping (two sites in one pocket, two pockets
      apart), the size cap ("open"), and the hints (a loc with a trigger on the boundary is listed;
      one inside a reached area is not).
- [ ] `EXPECTED_UNREACHED` filters matching sites from the report; a stale entry makes
      `failed(report)` true. Unit tests cover both. Tutorial Island and its caves and bank are gone
      from the real report.
- [ ] `bun wiki/world/build.ts --check` passes; no generated page changes (the report is console
      output only).
- [ ] Out of scope: any new edge or row (that is Tasks 2 onward).

## Task 2 — The crossing model

**Files:** `wiki/world/types.ts`, `wiki/world/load.ts`, `wiki/world/build.ts`
(`serializeWorld`, `WORLD_FORMAT`), `wiki/world/reach.ts` (`Via`, `addEdge`, the graph),
`wiki/world/distance.ts` (`CROSSING_TICKS`), a new shared module for the `stat_random` chance
(used by `wiki/world/render/resources.ts` too), `conductor/lib/world-index.ts` and
`conductor/lib/walk-graph.ts` only as far as the format bump needs, their tests.

Today an edge is `{to, alts, via}` and `via` is `connector | gate | ship | cart | sled`. Extend
the world's rows so every crossing can say:

- **how it is done** (`act`): `loc-op {loc, op}`, `item-on-loc {obj | category, loc}`,
  `npc-op {npc, op, choices?}` (the dialogue choices on the path the scan or the curated row
  took), `item-op {obj, op}`, or `interface {component}` (gliders);
- **where it lands**: one tile, or a **set of tiles** (a random landing: an enum or dbrow of
  coords, read by the scan where it can, each equally likely unless the script weights the
  draw). The fill adds an edge to every landing tile under the same alternatives. Costs count the
  **longest landing**: the edge to landing i costs the crossing plus the run ticks from the
  landing farthest from i to i, computed once at build over the graph and stored on the row. A
  way through landing i then costs at least what the worst landing would (the triangle
  inequality), and is exact when the landings are close together, as the essence-mine and temple
  landings are. The searches stay plain Dijkstra, and the walker re-plans from wherever it lands;
- **what it costs**: `CROSSING_TICKS` per `via`, with new entries `scripted` and `teleport`;
- **its roll**, when the move is behind a `stat_random(stat, low, high)` (an agility shortcut):
  the stat, `low`, `high`, and **the failure outcome** (its delay ticks, where it leaves the
  player, which may be the start tile or somewhere else such as a river bank, and its damage).
  The success chance is the engine's (`server/engine/src/engine/script/handlers/PlayerOps.ts:591`;
  as `wiki/world/render/resources.ts` states it: (low + 1)/256 at level 1, rising evenly to
  (high + 1)/256 at 99), in one shared function the index, the pages and the walker call.

**Expected cost of a roll.** A rolled crossing's expected ticks at chance p are the success ticks
plus (1 - p)/p times (the fail ticks plus the way back from the fail tile to the start tile). The
way back is run ticks computed once at build and stored on the row, so at a given level the cost is
a plain edge weight. In the index, which has no account, the chance is taken at the lowest level
the requirement allows (the worst case for anyone who may use it).

The new `via` kinds are `scripted` (a loc op move with no gate decision: Task 3) and `teleport`
(item-on-loc, npc-op, item-op, interface: Tasks 4, 5, 8). Existing connector, gate and transport
rows gain an `act` where it is not implied (a door's open op is). This task adds the model and its
handling only; no new rows come from the scripts yet, so the real reach does not change.

### Acceptance criteria

- [ ] `world.json` can carry `act`, landing sets with their per-landing longest-landing costs, and
      rolls with their failure outcome; `WORLD_FORMAT` is bumped; `load.ts` reads and validates
      them, with tests.
- [ ] The fill reaches every landing of a multi-landing edge under the edge's alternatives; the
      distances use the stored per-landing cost. Unit tests on a grid (`wiki/world/test/grid.ts`)
      pin both, including a landing set where the longest-landing cost differs per landing.
- [ ] A rolled edge's cost in the index is the expected cost at its lowest allowed level; a unit
      test checks the formula against hand-computed values, including a fail tile that is not the
      start tile.
- [ ] One `stat_random` chance function, used by `render/resources.ts` (its rendered pages
      unchanged) and exported for the conductor.
- [ ] `conductor/lib/walk-graph.ts` ignores every `via` it does not know (a test pins it), so the
      walker's routes are unchanged until Task 7. `bun test conductor` passes.
- [ ] `bun run world` output is unchanged apart from the format number; `--check` passes after
      regenerating.

## Task 3 — Unconditional scripted moves on loc ops (bucket A)

**Files:** `wiki/world/sources/gate-scan.ts`, `wiki/world/sources/gate-landings.ts`,
`wiki/world/gate-list.ts` / `gates.ts` if a review entry changes, `wiki/world/build.ts`, tests,
regenerated `wiki/` pages, `wiki/world/README.md` and `conductor/docs/world-index.md` known gaps.

`gate-scan.ts` already runs every loc op trigger that moves the player, down every path, and
`gate-landings.ts` can bind a run to a placed loc and a tile to find its landing. Emit the moves it
does not make candidates of:

- A trigger whose every path moves the player with no condition becomes a `scripted` row per
  placed loc, landing from the bound run (`gateLander`), `act: loc-op`. An agility walk with a
  `stat_random` roll is followed the way it succeeds for the landing (as the scan already does),
  and also down the failing branch, to fill in the row's roll and failure outcome (Task 2). This
  applies to rolled gate rows too: gate candidates with a `skill` requirement and a roll get the
  same fields. A `stat` check before the move is a `skill:<skill>:<level>` requirement, so the
  row is a gate candidate as today. A move whose landing the bound run cannot settle is listed in
  the build report, not guessed.
- **`temporary-block` candidates** (5 today, the Gnome Stronghold gate among them,
  areas/area_gnome/scripts/gnome_gate.rs2:2) get a row each: the trigger's forcemove crosses the
  shut gate. The kind stays as reviewed in `gate-list.ts`; what changes is that a temporary block
  with a move now yields an edge.
- The Grand Tree doors (gnome_gate.rs2:63), the Gnome Village railing
  (gnomevillage_fence.rs2:1), the Mage Arena cellar ladder (mage_arena.rs2:1), and the lighthouse
  bridge and stairs (quest_horror.rs2:63, :186; the doorway stays a quest gate) are expected to
  come out of this generically. If one does not, the task report says why before it is curated.
- `sources/connectors.ts` keeps owning `ladders+stairs/`. A scripted move on a loc and op that
  already has a connector row is not added twice (the build fails on a duplicate).

### Acceptance criteria

- [ ] Unit tests on scripted triggers: an unconditional `p_telejump` to a literal, a `~forcemove`
      to a fixed tile, an agility walk with a roll (roll and failure outcome filled), a temporary
      block with a forcemove, a move whose landing is unsettled (reported), and a duplicate of a
      connector row (refused).
- [ ] A real-data test pins the Gnome Stronghold south bank (`gnome-stronghold-bank`), the Grand
      Tree bank, the Mage Arena bank and the lighthouse shop as reached, with their requirement
      sets.
- [ ] The report loses the Tree Gnome Stronghold, Grand Tree, ball field, agility course, Tree
      Gnome Village, Mage Arena cellar and lighthouse pockets, or the task report says why each
      one left is still there. Area notes in `areas.ts` that said these are unreached are updated.
- [ ] The known gaps "the Mage Arena ladder, the Gnome Stronghold gate and railing, the lighthouse"
      are gone from `wiki/world/README.md` and `conductor/docs/world-index.md`.
- [ ] Generated pages regenerated and committed; `--check` passes; build time and `world.json`
      size reported.

## Task 4 — Runecrafting ruins and portals (bucket C)

**Files:** `wiki/world/gates.ts` (`TRANSPORTS_OUT_OF_SCOPE`, a curated row if needed),
`wiki/world/sources/gate-scan.ts` or a new source for the ruins, tests, regenerated pages.

Move the ruins out of `TRANSPORTS_OUT_OF_SCOPE`:

- Each ruins loc gets a `teleport` row, `act: item-on-loc` with its talisman
  (skill_runecraft/scripts/runecraft.rs2:19), requirement `item:<talisman>:held`, landing the
  dbrow `enter_coord` set (`runecraft_table`). Each temple's exit portal gets a row back to the
  `exit_coord` set. Read the dbrow rather than curating the coords. If this revision has tiaras
  (`conductor/tasks/runecraft.ts` says it has none), add the worn form as an alternative.
- The scan's use-item triggers (`oplocu`) on the ruins are where the talisman check is: derive the
  rows there if the scan can read `last_useitem` against the dbrow's talisman, otherwise curate
  them in `gates.ts` with the dbrow as their source, so no coord is typed twice.

### Acceptance criteria

- [ ] All 11 rc altars are reached under `item:<talisman>:held` plus the altar's own access (a
      quest, `members`); a real-data test pins the air altar and one members altar.
- [ ] The exit portals' rows exist and land on the `exit_coord` sets.
- [ ] The trees inside the altar rooms leave the report, or get an `EXPECTED_UNREACHED` entry with
      a reason if they are decoration.
- [ ] `TRANSPORTS_OUT_OF_SCOPE` no longer lists the ruins.

## Task 5 — The essence mine (bucket D, first part)

**Files:** `wiki/world/gates.ts`, the source the rows come from, tests, regenerated pages.

Move the essence mine teleport out of `TRANSPORTS_OUT_OF_SCOPE`: a `teleport` row per wizard
(Aubury, Sedridor, Cromperty, Distentor, Brimstail; skill_runecraft/scripts/essence_mine.rs2:1),
`act: npc-op`, requirement `quest:runemysteries` (essence_mine.rs2:2), landing the
`essence_mine_teleports` enum. The portals return to `%exit_essence_mine_coord`, the wizard the
player came from, which a stateless graph cannot follow: each portal gets an edge to every
wizard's exit tile, with requirement `other:came from <wizard>`, so the fill reaches all of them,
and the walker (Task 7) uses only the edge for the wizard it came in by. Start from the npc's op
trigger; generalise the scan to `opnpc` triggers only if that is cheaper than a curated row per
wizard (the task report says which was done).

### Acceptance criteria

- [ ] The rune essence mine's rocks are reached under `quest:runemysteries`; the pocket leaves the
      report; a real-data test pins it.
- [ ] The mine's rocks have a nearest bank, by a portal and a wizard's exit tile.
- [ ] `TRANSPORTS_OUT_OF_SCOPE` no longer lists the essence mine.

## Task 6 — Queued moves (bucket B)

**Files:** `wiki/world/sources/gate-landings.ts`, `wiki/world/sources/gate-scan.ts` if the
candidate reading changes, tests, regenerated pages, docs' known gaps.

`gate-landings.ts` follows a `queue(<script>, ...)` the trigger issues and treats the queued
script's moves as the trigger's, under the trigger's conditions. This is the Shantay Pass's way in
(areas/area_alkharid/scripts/shantay_pass.rs2:79, the move at :103) and its pass item
(`consume:shantay_pass:1`, the `inv_del` before the `queue`). Its `act` carries the poster choice
("Yeah, that poster doesn't scare me!"), which the script asks only without a `thshantaydisc`
held, so `cross` answers it when it is shown. The `npc_find(shantay_guard_still)` check is a side
condition, read both ways. Other `queue`d moves the scan finds are reported; each either works,
or is listed with why not.

### Acceptance criteria

- [ ] The desert south of the pass is reached under its pass requirement: the Bedabin camp shop,
      the Desert Mining Camp and its mine (or that mine with its own quest requirement); a
      real-data test pins one of them.
- [ ] Unit tests cover a queued move with a condition before the queue, and a consumed item
      before it.
- [ ] The known gap "the Shantay Pass queued move" is gone from `wiki/world/README.md` and
      `conductor/docs/world-index.md`; the Kharidian Desert area note is updated.

## Task 7 — The walker crosses scripted moves and teleports (conductor)

**Files:** `conductor/lib/walk-graph.ts`, `conductor/actions/walk.ts`, a new
`conductor/actions/cross.ts`, `conductor/lib/account.ts` if a requirement form is new to it,
`conductor/test/**`, smoke tests in `conductor/test/integration/smoke/`.

The conductor's walker today crosses neighbour steps, doors it opens, and connector rows. Teach it
every `act`:

- `walk-graph.ts` plans over `scripted` and `teleport` edges whose alternatives the account meets
  (`meetsSet`, `lib/account.ts`): `quest`, `skill` and `members` by the account, `item:<obj>:held`
  and `consume` by the inventory, or by a bank detour (below). Edge costs are Task 2's: random
  landings at their stored longest-landing cost, and the walk re-plans from where it lands. The
  essence mine's `other:came from <wizard>` edges are met only for the wizard on record.
- **Rolled crossings (agility shortcuts)** are priced at the bot's **current** level: the chance
  from the shared `stat_random` function, then the expected cost of Task 2, fail and retry
  included. The route takes a shortcut only when that expected cost beats the best way without
  it, so a low-level bot walks round a shortcut a higher-level one takes. A crossing whose failure
  damage can reach the bot's current HP is not planned through.
- **Bank detours for held items, computed per plan.** When a way needs an item the inventory lacks
  (a talisman, a Shantay pass, coins for a toll), the plan also prices the way that goes first to
  a bank (`nearestBank` over the graph), withdraws it, and goes on, and takes the detour when that
  total, bank time included, beats the best way without the item. The item has to be in the bank
  by the plan's record (`conductor/lib/plan.ts` `bank(item)`, the count as last seen open;
  unknown counts as absent), and the bot needs a free slot, or the stack to add to. The detour is
  planned in the walk graph and done by the walk with the existing bank actions; if the bank turns
  out not to hold the item, the walk re-plans without it.
- A generic `cross` action (`conductor/actions/cross.ts`) does an `act`: walk to the crossing's
  approach, send the op (`interactLoc`, `useItemOnLoc`, `interactNpc` and the dialogue choices,
  the item op, the interface click), wait for the move with a deadline from the trigger's delays,
  and report `crossed`, `refused` (a game message, an `opRejected`), or `no-move`. It reuses
  `obstacle.ts`'s refusal and fall messages, and retries a failed roll while the plan still prices
  the shortcut as the better way.
- `walk.ts` sends `cross` for each such edge on its route, as it sends `climb` for connectors.
- **The bespoke crossings stay** until `cross` covers them: `actions/gate.ts` (`passGate`, the
  Gnome Stronghold gate), `travel.ts`'s `gnome-gate` step, `essence-mine.ts`'s teleport and portal,
  `runecraft.ts`'s ruins and portal. Once the smoke tests pass, each becomes a call of `cross` or
  of `walkTo` with the destination, in this task or a follow-up the task report names, keeping
  each change reviewable on its own.
- Wilderness rules are unchanged: a route does not enter the Wilderness unless it starts or ends
  there.

### Acceptance criteria

- [ ] Unit tests on scripted worlds: a plan through a scripted move; through a teleport the
      account can and cannot use (item missing, quest not done); through a random landing
      (re-plan); the essence-mine portal edge chosen by the wizard on record.
- [ ] Rolled crossings: one shortcut on a grid is skipped at a low level and taken at a high one,
      switching at the level where the expected costs cross; the damage rule refuses it at low HP.
- [ ] Bank detours: taken when the bank holds the item and the detour is shorter; skipped when the
      bank count is unknown or zero, or the detour is longer; re-planned when the withdraw finds
      nothing.
- [ ] Smoke tests on fixture bots: walk from Lumbridge into the Gnome Stronghold bank (gate inward)
      and out again (gate outward); use a talisman on the air ruins and leave by the portal; Aubury
      into the essence mine and out by a portal; a route through a rolled shortcut at a level
      where it pays; a bank detour for a talisman before the air ruins. Each passes with `bun run
      test:integration <filter>`.
- [ ] `bun test conductor` and `bun run verify:conductor` pass.

## Task 8 — The remaining teleports and transports (bucket D, rest)

**Files:** `wiki/world/gates.ts`, `wiki/world/sources/transports.ts`, the scan if it reaches a
trigger, `conductor/lib/connectors.ts` or the walker's left-out list for rows `cross` cannot do,
tests, regenerated pages.

A `teleport` or transport row each, derived where the scan reaches it, else curated in `gates.ts`
with its script:

- Monkey Madness: Waydar's glider to Crash Island (quests/quest_mm/scripts/mm_waydar.rs2:116),
  Lumdo's boat to Ape Atoll (mm_lumdo.rs2:24), and the way back.
- The Miscellania longship (areas/area_miscellania/scripts/misc_sailor.rs2:13): read
  `~misc_longship_sail` in `sources/transports.ts` if it fits the sail model, else a curated row.
- The Fisher Realm (Holy Grail; the whistle's item op), the Watchtower area, the Shilo Village
  quest dungeon, Legends' Quest cavern, the Tai Bwo Wannai trio area, Horror from the Deep's area,
  the Regicide camp, the Haunted Mine's inner areas, Rogues' Castle's upper floors (L1-L3), the
  Burthorpe Games Room stairs (random landing, ladders+stairs/scripts/stairs.rs2:491), the Mage
  Arena pool (magearena_waterportal1, mage_arena.rs2:15).
- Gnome gliders (`interface` act) and spirit trees (menu choice, each tree's quest): a row per
  destination with the choice in its `act`.
- Holgart's boats (quest-staged dialogue) and the Fishing Trawler (a minigame) stay out of scope.

Each row the walker cannot do yet (an `act` `cross` does not handle) is left out of the walker's
plans with its reason, so it never plans through it.

### Acceptance criteria

- [ ] Each pocket listed above leaves the report, or gets an `EXPECTED_UNREACHED` entry with its
      reason.
- [ ] A real-data test pins Ape Atoll, Miscellania's bank and the Fisher Realm as reached, with
      their requirement sets.
- [ ] `TRANSPORTS_OUT_OF_SCOPE` holds only the Trawler and Holgart, each with its reason.
- [ ] Rows `cross` cannot do are left out of the walker's plans, with a test.

## Task 9 — Near misses and the rows the fill could not use (bucket F)

**Files:** `wiki/world/sources/gate-scan.ts`, `wiki/world/gate-list.ts`, `wiki/world/place.ts`,
`wiki/world/reach.ts` (wall sides), `wiki/world/areas.ts`, `learnings/` for findings checked in
game, tests, regenerated pages.

Pocket by pocket, from Task 1's hints: a door the scan missed (fix `gate-scan.ts`) or a rejection
in `gate-list.ts` that was wrong, a stand tile on the wrong side of a wall (`place.ts` stand rules),
a landing not derived (the "rows the fill could not use": `swamp_bridge1`, `regicide_cross_over3`,
`obstical_pipe2`, `crossing_rock_waterfall_quest`, `agilityarena_ladderdown`, the Underground Pass
temple doors), or a wall whose two sides are not read (`castlecrumbly`, `closet_door`). Where the
scripts do not settle it, check in game on a worker (`bun conductor/tools/load.ts <worker>
lib:<save> --client`, `screenshot.ts`) and record the finding in `learnings/`.

### Acceptance criteria

- [ ] No pocket within 5 tiles of a reached tile is left in the report without an
      `EXPECTED_UNREACHED` entry.
- [ ] The build report's "rows the fill could not use" is empty, or each remaining row says why.
- [ ] A `place.ts` stand rule change keeps `bun test wiki/world` green and the task report lists
      the stand tiles it moved.

## Task 10 — Pockets the collision walls in (bucket E), and the docs

**Files:** `wiki/world/areas.ts` (`EXPECTED_UNREACHED`), `wiki/world/README.md`,
`conductor/docs/world-index.md`, `conductor/README.md` if it describes the walker's abilities.

- For each pocket left, check that no loc or npc op on its boundary moves the player (Task 1's
  hints say so). Spot-check a sample in game on a worker. Record the pockets in
  `EXPECTED_UNREACHED` as "walled in by collision", with the boundary checked; one entry may cover
  an area's walled-in decoration trees when the reason is the same.
- Docs: `wiki/world/README.md` (the unreached report section: pockets, hints,
  `EXPECTED_UNREACHED`, the crossing model), `conductor/docs/world-index.md` (the known gaps,
  closed or moved to the table), `conductor/README.md` if the walker's abilities are described
  there.

### Acceptance criteria

- [ ] `bun run world` prints `unreached: every site of a covered kind is reached from the Lumbridge
      spawn` (no site unreached outside `EXPECTED_UNREACHED`).
- [ ] The docs describe pockets, hints, `EXPECTED_UNREACHED`, the crossing model and the walker's
      new crossings.
- [ ] Out of scope: making a new unreached site a `--check` failure. The task report proposes it as
      a follow-up.

## Out of scope for this spec

- The rate model and methods (phase 3).
- Teleport spells, jewellery and tablets: player-side travel, not a crossing of the map. The walker
  may use them later, as a separate design.
- Banker clusters across booths, and the walker's `planeOf` gaps for unnamed underground areas:
  known gaps, neither of which makes a site unreached.
