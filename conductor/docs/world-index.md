# World index: generated world data and training-spot analysis

Design for a generated, complete picture of the game world (every bank, shop, tree, rock, fishing
spot, service, NPC spawn and connector, with correct names, exact tiles and access requirements)
and an analysis on top of it that ranks training methods by modelled XP/hr. One generator,
`wiki/world/`, emits `wiki/world.json`; the wiki pages, and code tables like
`conductor/lib/banks.ts` and `conductor/lib/connectors.ts`, are views of it.

Decisions (2026-10-11):

- **One staged pipeline, one source of truth.** Extract -> classify -> place -> reach -> analyse ->
  emit. The NPC and shop generators read their locations from it instead of keeping their own.
- **Two consumers: code and agents.** `world.json` for code (typed, imported), markdown rendered
  from it for agents to read and grep.
- **Names come from a curated area file**, not from the nearest map label and not from per-region
  tables. Coverage is enforced: a bank, shop, resource or service site in no area fails the build.
- **Everything is classified by the game's own rules** (script triggers, dbrows, configs), never by
  name matching.
- **Reachability is computed** by a flood fill over the collision data, with gates and transports
  curated where scripts are too complex to read.
- **Rates are modelled from the game's formulas** and calibrated against measured runs
  (`conductor/tools/stats.ts`), not estimated.
- **Hazards are filters, not score weights.** The ranking is XP/hr (or gp/hr) under the agent's
  constraints.

## Why

The wiki today was generated per page type, with hand-written tables standing in for game data:

- `wiki/generate-npcs.ts` names a spawn by its 64x64 map square from `MAP_SQUARE_AREAS`, and many
  entries are wrong (`m48_50` is Draynor, labelled "Edgeville area"; Varrock West is "Wilderness";
  Falador West is "Camelot area"); squares not in the table print their id (`m42_54`).
- Spawns are grouped per map square with one sample coordinate, so two banks in one square show as
  one row, and the bridge flag is ignored (Canifis bank's booths read as level 1).
- There are no loc pages at all: no trees, rocks, booths, furnaces, anvils, ranges or altars. Bank
  chests (Castle Wars, Duel Arena, Shantay) and bankers without pages (Miscellania, tutorial) appear
  nowhere; Fadli and Gundai have pages without locations.
- Agents choose where to train from scattered skill-page notes and `stats.ts` measurements; nothing
  says which sites exist, what they need, or how far the bank is.
- `conductor/lib/banks.ts` (7 F2P banks) and `connectors.ts` (stairs and ladders) are curated by
  hand from the same map files.

The game data has everything needed:

| Source | Gives |
|---|---|
| `server/content/maps/*.jm2` | every loc (`level x z: id shape rotation`) and NPC spawn (`level x z: id`) per map square, and tile flags (bridge `f2`) |
| `server/content/pack/*.pack` | id -> config name for locs, NPCs, objs |
| `scripts/**/configs/*.loc`, `*.npc`, `*.obj` (and `_unpack/*/all.*`) | names, ops, categories, stats, params |
| `scripts/**/configs/*.dbrow` | what a loc yields: `trees.dbrow` (level, xp, product, respawn, success chance per axe), `mine.dbrow`, fishing structs and params |
| `scripts/**/*.rs2` triggers | what can be used: `[oploc1,_tree]`, `[oploc1,_mining_rock_normal]`, `@openbank` callers, `[opnpc3,_bank_teller]` |
| `scripts/ladders+stairs/scripts/*.rs2` | connector landings (`case <level>_<mx>_<mz>_<x>_<z> : p_telejump(...)`) |
| `maps/labels.txt` | 136 world-map labels (seed for the area file) |
| `maps/free2play.csv`, `maps/multiway.csv` | F2P and multi-combat zones, per 8x8 zone |
| `sdk/pathfinding.ts` (rsmod collision data, door index) | walkability, offline |

Worked example (2026-10-11, scanning for `@openbank` locs and NPCs): 25 bank sites; no Lumbridge
bank in this cache; no Port Phasmatys (map square `m57_54` is absent); Canifis is one ground-floor
bank (level-1 tiles there carry the bridge flag).

## Data model

### Curated inputs (checked in, edited by hand)

- **`wiki/world/areas.ts`**: named, nested areas, each a list of rectangles with an optional level.
  `Misthalin › Varrock › Varrock West bank`, `Asgarnia › Dwarven Mine`. An area may carry
  `requires` (`members`, `quest:lost-city`, `toll:10gp`) and notes. The first draft is seeded from
  `labels.txt` and corrected by hand.
- **`wiki/world/gates.ts`**: doors and gates whose scripts guard them (loc tile + requirement:
  Al Kharid toll gate, Lost City shed, guild doors, Taverley gate), and transports (boats,
  charters, fairy rings) with their endpoints, requirement and gp cost. Where a script has a
  readable pattern (a quest varp check before `p_telejump`), the generator derives the gate and the
  curated entry only confirms it.

TypeScript, not JSON/CSV: type-checked, commentable, and diff-friendly.

### Generated: `wiki/world.json`

Three layers, plus methods (below):

- **Feature**: one placed thing, a loc or an NPC spawn. `kind` (`tree`, `rock`, `fishing-spot`,
  `bank`, `shop`, `furnace`, `anvil`, `range`, `fire`, `spinning-wheel`, `pottery-wheel`,
  `pottery-oven`, `water-source`, `altar`, `rc-altar`, `tanner`, `stall`, `pickpocket`, `npc`,
  `connector`, ...), `subtype` (`oak`, `iron`, `net/bait`, ...), game name, config name and id,
  tile with its effective level (bridge flag applied).
- **Site**: a cluster of same-kind features, the unit an agent chooses. Area path, centre, bounding
  box, stand tile, counts per subtype, and access: `f2p`, `multiway`, `wildernessLevel`, `reach`
  (`open`, `gated:[requirement sets]`, `unreachable`). "Varrock West mine: 3 iron, 2 tin"; "Draynor
  bank: 3 booths, 4 bankers".
- **Area**: the curated tree, with generated totals of what each contains.

### Rendered markdown

- `wiki/places/<area>.md`: everything in a town or region.
- `wiki/resources/<kind>/<subtype>.md`: every site of, say, `trees/yew` or `rocks/iron`, with
  requirements and access.
- `wiki/services/<kind>.md`: banks, furnaces, anvils, ranges, altars, ...
- `wiki/training/<skill>.md`: the ranked methods (below).
- `wiki/npcs/` and `wiki/shops/` keep their pages, with exact sites in place of map-square samples.

## Classification

A loc or NPC is a feature kind because the game says so, by the trigger and data that make it
usable:

- Trees: locs in `woodcutting_trees` dbrows (subtype from the row); rocks: locs in `mine.dbrow`;
  fishing spots: NPCs with fishing params/structs.
- Banks: locs and NPCs whose op reaches `@openbank` (`bankbooth`, `newbiebankbooth`, bank chests,
  `category=bank_teller`, the fairy, Shilo, Fadli, Gundai, Miscellania and tutorial bankers).
  Closed and "private" booths have no such op and are not banks.
- Services: the processor triggers (`smithing_furnace`, anvils, ranges and cooking fires, spinning
  and pottery wheels, ovens, `watersource`, `prayer_altar`, `rc_altar`/`rc_ruins`), tanners and
  shops (`category=shop_keeper` and NPCs whose op opens a shop).
- Thieving: stalls and pickpocketable NPCs from the thieving scripts.
- Combat: NPCs with combat stats and an attack op.
- Connectors: locs handled in `ladders+stairs` scripts.

A rule table maps each trigger/dbrow to a kind; a placement matching no rule is ignored, and a
placement matching two is a build error.

## Placement

- World coordinates: `x = 64 * mx + localX`, `z = 64 * mz + localZ`; underground areas are drawn at
  z + 6400 on level 0 and are their own planes (as in `connectors.ts`).
- Bridge flag: where the level-1 tile carries `f2`, that column's layers drop one level, so a
  level-1 loc there is on level 0 in game.
- Clustering: same-kind features on one plane within a kind-specific radius (bank 10, trees and
  rocks 8, NPC spawns 6) form a site; a site never spans two areas.
- Stand tile: a walkable tile adjacent to the feature on the public side (for booths, opposite the
  bankers), chosen from the collision data.
- Flags per site: `f2p` from `free2play.csv`, `multiway` from `multiway.csv`, `wildernessLevel`
  computed from z inside the Wilderness bounds.

## Reachability and travel

- **Nodes**: every walkable tile on levels 0-3 and the underground planes, from the offline
  collision data (typed arrays; about 9M tiles).
- **Plain edges**: neighbour steps under the pathfinder's collision flags; openable doors in the
  pathfinder's door index are passable.
- **Connectors**: generated from `ladders+stairs/*.rs2` and the loc tiles in the maps. Stand tile:
  a walkable tile beside the loc; landing: checked walkable.
- **Gated edges**: the gates and transports in `gates.ts`, each carrying its requirement.
- **Fill**: from Lumbridge spawn, a BFS with no requirements, then repeatedly open the gates on the
  frontier and expand, labelling every tile with its minimal requirement sets (`{}`,
  `{toll:10gp}`, `{quest:lost-city, members}`). Members comes from `free2play.csv`.
- **A site's reach** is the requirement sets of its stand tile.
- **Unreached content is a report, not a failure**, grouped by area. An unreachable bank, shop or
  resource usually means a missing connector, gate or transport: the report is the curation to-do
  list.
- **Path lengths** for the method model come from the same graph (doors and stairs included), so
  "distance to bank" is the walk taken.
- **Conductor tie-in**: the generated connectors replace the hand-written rows of
  `conductor/lib/connectors.ts`, whose tests (stand and landing walkable, a way back) run against
  the generated table; `conductor/lib/banks.ts` becomes a filtered view (F2P, surface, `auto`
  exclusions stay curated with their reasons).

## Analysis: training methods

A **method** is a site + an action + a sink (drop, bank at the nearest reachable bank, or process on
the way: fish -> range -> bank, ore -> furnace -> bank). Enumerated by rules per skill:

- Gathering (trees, rocks, fishing spots): every site x {drop, bank, process} where a sink is
  reachable.
- Processing (smelting, smithing, cooking, firemaking, spinning, pottery): processor sites paired
  with their nearest bank.
- Thieving: stall and pickpocket sites, plus the nearest bank for loot and food.
- Combat: attackable-NPC sites.

### Rate model

A TypeScript port of the game's formulas, each function citing the script and line it ports:

- **Per action**: success per attempt from `stat_random(level, low, high)` with the tool's row
  (`successchance` per axe/pickaxe), ticks per attempt, xp, depletion (`1/8` for trees),
  respawn from the dbrow. Resource availability caps the rate: k features with respawn R give at
  most so many items per hour however fast the player is.
- **Per trip**: inventory slots / items per tick, plus the pathfinder round trip site -> sink ->
  site (walk and run), plus a fixed banking overhead: banked XP/hr, drop XP/hr, items/hr.
- **Combat**: a port of the engine's accuracy and max-hit formulas against the NPC's stats, for a
  player profile (levels and gear bonuses); kills/hr from spawn density vs respawn; XP/hr; gp/hr
  from the drop tables at item value.
- **Grid**: rates across levels 1-99 per tool or gear tier; pages show the breakpoints.

### Hazards

Flags on the site and on the path to its sink: aggressive NPCs within range that attack the
player's combat level, Wilderness level, multiway, gating. Agents filter on them; the ranking is
plain XP/hr or gp/hr under the filters.

### Calibration

`stats.ts` measurements are keyed to method ids. Pages show modelled and measured side by side; the
build report lists methods where they differ by more than 25%, which points to model bugs.

### Outputs

- `methods[]` in `world.json`.
- `wiki/training/<skill>.md`: per level band, the top methods with banked and drop XP/hr, gp/hr,
  requirements, F2P, reach and hazards, and the measured figure where there is one.
- `wiki/world/query.ts`: `bestMethods(skill, level, { f2p, quests, gear, maxHazard })` for the
  conductor and agents.

## Testing

`bun test wiki`, no server needed:

- **Formula ports**: each tested against values worked by hand from its script (yew with a rune axe
  at level 60, iron rock respawn).
- **Real-data facts**: Varrock West has 6 booths; Lumbridge has no bank; Canifis bank is on
  level 0; the Gnome Stronghold banks are on level 1; Al Kharid needs `toll` or a members route;
  Zanaris needs `quest:lost-city`.
- **Flood fill**: small synthetic grids (doors, gates, connectors, overlapping requirement sets),
  plus the real-data facts.
- **Coverage**: every bank, shop, resource and service site lies in a curated area.
- **Freshness**: the committed `world.json` and pages match a fresh generation, so nobody edits them
  by hand.
- **Calibration** is a report, not a test (measurements move).

The `knowledge` skill and `wiki/README.md` are updated to list the new generated folders, the
curated inputs, and where corrections go (`areas.ts`, `gates.ts`, never the pages).

## Phases

Each phase is usable when it lands.

1. **Extract, classify, place.** `areas.ts` first draft; features, sites and areas in
   `world.json`; `places/`, `resources/`, `services/` pages; NPC and shop pages on exact sites
   (fixes the wrong names).
2. **Reachability and travel (built).** Generated connectors, `gates.ts` and transports, the flood fill,
   access flags on every site; `connectors.ts` and `banks.ts` become views. See "Phase 2 as built".
3. **Rate model and methods.** Gathering, processing and thieving first, then combat (formulas plus
   player profile); `training/` pages, `query.ts`, calibration against `stats.ts`.

## Phase 2 as built

Built per `conductor/docs/world-index-phase2-spec.md`; the hand-written reference is
`wiki/world/README.md`. Where it differs from the design above:

- **Requirement sets are canonical.** `wiki/world/requirements.ts` merges a requirement another in
  the set implies and drops a set another dominates (`canonicalSet`, `dominates`); coins and consume
  are summed per crossing, so a way with two tolls needs `coins:20`; quest stages merge into the
  strongest. The fill keeps at most `MAX_SETS` sets per tile (`reach.ts`).
- **Gates are scanned, then reviewed.** `sources/gate-scan.ts` finds every door or gate trigger that
  moves the player, and `gate-list.ts` confirms or rejects each, so the build fails on an unreviewed
  one; `gates.ts` holds the curated transports and quest overrides. Transports cover ships, carts
  and sleds (`sources/transports.ts`).
- **Connectors are derived, including trapdoors, manholes and gangplanks**, with `thenOp`,
  `relative` and one-way rows (`sources/connectors.ts`).
- **An npc cluster's reach** is that of the tiles beside it with a wall check (`besideCluster`,
  `place.ts`), not the nearest walkable tile.
- **Distances are run ticks.** `nearest.{bank,furnace,range,anvil}` (`distance.ts`) counts run ticks
  only, bots always run, with a fixed `CROSSING_TICKS` per crossing kind.
- **The conductor views are generated.** `conductor/lib/connectors.ts` builds its table from
  `world.json` (loaded once by `lib/world-index.ts`, which fails loudly when stale), with curated
  `OVERRIDES` (names, hazards) and `LEFT_OUT`; it is not hand-curated. `lib/banks.ts` `nearestBank`
  picks the fewest run ticks over the graph, not the straight line. The walker plans over that
  graph (`lib/walk-graph.ts`) and crosses only doors it can open.

Known gaps, listed by the build's unreached report: the scripted moves whose landing no bound run settles (a
`map_findsquare`, a coord kept in a varp; the build report lists them); a one-sided gate's stand level with
its loc counted on the checked side (the Shantay Pass's free east way out priced as taking a pass); banker
clusters across booths; unnamed underground areas outside the walker's `planeOf`.
