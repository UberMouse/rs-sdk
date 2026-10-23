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
3. **Rate model and methods (built).** Gathering, cooking and thieving families, curated method records, the
   floor, `training/` pages, `query.ts`, calibration against `stats.ts`. See "Phase 3 as built".
4. **Combat (melee built).** Accuracy, max hit, gear bonuses, kills/hr, drop tables and aggression hazards, as a
   combat family on the phase 3 contract (`ActionModel`), with methods in `methods.ts`. See "Phase 4 as built";
   Ranged and Magic come later.

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
  picks the fewest run ticks over the graph, not the straight line. The walker plans every walk over
  that graph (`lib/walk-graph.ts` `planWay`): the doors it can open, the connectors `climb` uses, and
  the moves `actions/cross.ts` makes (scripted moves, a queued script's included; teleports by an item used
  on a loc, an npc's op and dialogue or an item op; gate jumps; a roll priced at the bot's
  current level, one whose failure can take its hitpoints left refused), with a bank detour for an obj
  a move needs when the plan's bank record holds it. It does not take transports, nor a crossing `cross` can't
  make (`crossingRefusal`: the gnome gliders' interface clicks).

The unreached report was worked per `world-index-unreached-spec.md`: the sites nobody walks to (walled in by
collision, behind a minigame or a quest window) are `EXPECTED_UNREACHED` rows in `areas.ts`, each citing its
script, and the build fails on a stale one. The report is expected to be empty: the pockets players reach by a crossing the
index misses are rows too, their reasons naming the crossing (`wiki/world/README.md`, "The unreached report"), and
deriving those crossings is in `conductor/roadmap.md` (Review follow-ups). Outside the report: banker clusters
across booths; unnamed underground areas outside the walker's `planeOf`.

## Phase 3 as built

Built per `conductor/docs/world-index-phase3-spec.md`; the hand-written reference is the Methods section of
`wiki/world/README.md`. Where it differs from the design above:

- **Methods are curated, not enumerated.** `wiki/world/methods.ts` holds one record per method the conductor
  runs or has found (a tile in the site, a family, its params, a sink, its plans); the build resolves each
  (`model/method.ts`) and fails naming one it can't. There is no site x sink enumeration.
- **The model is the floor.** `model/cycle.ts` rates a method at a profile (levels, tool, food) as the
  tick-perfect rate over the shortest way, with drop, bank and process-bank sinks, eat ticks and tool slots; the
  families (`model/families/`: woodcutting, mining, fishing, pickpocket, stall, cooking) port the game's
  formulas, each citing its script. `server.ts` reads `TICK_MS` and `XP_RATE` from the engine.
- **No rate grid in world.json.** `methods[]` carries the resolved legs and sinks (see `WORLD_FORMAT` in
  `wiki/world/types.ts`); the rates are computed on demand and rendered into `wiki/training/<skill>.md` (a README
  beside them) as floor XP/hr by level next to the measured figures.
- **Measured figures are curated.** A record's `measured` is pasted from `stats.ts <bot> --methods`
  when a goal finishes; the build reads no run logs. `--methods` sets each method's plan runs beside the floor
  at each run's start levels and tool, and prints the paste-ready entry only when every counted run started the
  same. A plan names its method (`PlanDef.method`), checked both ways by `conductor/test/plans.test.ts`.
- **`query.ts`** has `methodRate(id, profile)` and `bestMethods(skill, profile, { met, maxWilderness,
  multiway })`: `met` omitted counts every token as met but a way's `skill:` tokens, which are held to the profile's
  levels either way. `methodRate` rates any profile over the first way that models, and checks no gate. A hazard is the maximum over the gather, processor and
  bank sites; a ProfileError drops a method and a data fault throws a MethodError naming it; the ranking is by
  floor XP/hr, ties by id, and each result carries its rated way and its measured figures.
- **No calibration report in the build.** The comparison is `stats.ts --methods` (percent of floor), not a
  build warning.

Known gaps:

- Combat is phase 4. Processing families with script-constant timings (firemaking, smelting, anvil smithing,
  fletching, spinning, crafting), runecraft and agility are added by the family contract when a method needs
  them.
- Only the axe and pickaxe are profile tools: fishing rods are not checked. The floor wields the axe or pickaxe
  and does not check its wield level.
- Hitpoints does not enter the floor; stun damage comes from the game's table.
- A level gained during a run makes a start-level floor understate it.
- A long-lived process caches world.json until restart.
- `iron-se-varrock-bank`'s measured figure was assembled by hand from iron-bulk's mine-leg phases, and
  `knight-ardougne-pickpocket`'s from knight-thieve's thieving and Ardougne South bank phases.
- Most promoted plans have no method yet; `bun test conductor/test/plans.test.ts` prints them.

## Phase 3b as built

Built per `conductor/docs/world-index-phase3b-spec.md` (survey: `world-index-phase3b-survey.md`); the hand-written
reference is the Methods section of `wiki/world/README.md`. Where it differs from phase 3:

- **Process sinks.** A sink is `{ mode: 'process', steps, end: 'bank' | 'drop' | 'keep' }`: ordered steps, each a
  family at `'here'`, a tile, or the nearest site of its kinds (a family with no kinds, firemaking, stops at a bare tile,
  `TileStop`). A `withdraw` family is a source that takes an obj from the bank the record sits in. A step `'here'` that
  uses a non-stackable supply (bow strings) is done as each item is gathered, so its load differs from carrying the
  supplies (`model/cycle.ts`).
- **Families added** (`model/families/`): superheat, smelting, smithing, spinning, fletching, firemaking, pick (the flax),
  agility, runecraft. `ActionModel` gained `batch`, `damage`, `restart`, `start` and `perTick`; `statRandomChance` (`roll.ts`) is the one stat-roll chance shared by the families.
- **Laps.** An agility attempt is a whole lap of a course site over its crossing and gate rows
  (`Gate.standTicks` gives a gate row's success ticks by stand); the family names the tile pairs it walks
  (`Family.walks`) and `method.ts` prices them under each way into `MethodWay.walks`. Hitpoints lost to falls are food
  per hour (`MethodDef.food`); a certain roll costs none. The course's skill gate is a `skill:` token of the way, which
  bounds a record's `minLevel`.
- **Use gates.** `USE_GATES` (`gates.ts`) adds what using a feature asks (Doric's anvil, the Rellekka furnaces, anvil and
  wheel) to its site's reach.
- **Worn items.** `Profile.worn` holds objs a family reads (a ring of forging, a staff of fire); a measured figure
  records what its runs wore.
- **Method legs.** `model/legs.ts` prices a leg over a random landing (the essence mine) at the chance-weighted mean
  of the walks on, a teleport at its script's delays, and carries the came-from context of the npc whose teleport an
  earlier leg crossed. Legs can be fractional (a chance-weighted mean); the training pages print them at one decimal. `distance.ts` is unchanged: nearest-bank figures still use the worst
  landing and the kind's constant.
- **Records.** The phase 3b records are linked to their promoted plans; `WORLD_FORMAT` is 20. Seven training pages
  (Smithing, Magic, Agility, Runecraft, Crafting, Fletching, Firemaking) joined the set.

Known gaps:

- The Wilderness ridge gates are not in the lap floor, and the runecraft landing is the mean, not what a bot gets
  on a given trip (`conductor/roadmap.md`, Review follow-ups).
- Firemaking line resets and HP regeneration are left out of the floor; pottery and Wilderness combat are not modelled.
- Several records have no measured figure yet (`conductor/roadmap.md`, Review follow-ups).

## Phase 4 as built

Built per `conductor/docs/world-index-phase4-spec.md` (survey: `world-index-phase4-survey.md`); the hand-written
reference is the Methods section of `wiki/world/README.md`. Melee only: Attack, Strength, Defence, Hitpoints and
Prayer (by burying). Where it differs from phase 3b:

- **Formulas** (`model/combat.ts`): effective levels, attack and defence rolls, the exact hit chance, max hit, the
  per-swing damage capped at the npc's remaining HP, E[swings] a kill by a DP over HP (`expectedSwings`), Hitpoints XP
  truncated per hit, the style's XP and the combat level, each citing its script.
- **Game data** (`model/npcs.ts`, `model/items.ts`, `sources/droptables.ts`): npc combat stats with the
  `combat.param` defaults, how each hunts (`huntsUpTo`), its retreat HP and any AI override script; worn bonuses,
  attack rates, the weapon category's styles, wield levels and `bone_exp`; the drop-table scripts parsed into expected
  counts a kill. `model/profile.ts` gained `prayers` and `boosts` (none by default; no drain or decay) and reads gear
  from `worn`.
- **The combat family** (`model/families/combat.ts`): one kill a success. Its ticks are E[swings] x the weapon's
  attack rate plus the run from the spawn to its nearest other spawn past the swing cooldown (`killGaps`, a mean over
  the area's spawns); the death ticks (`npc_death.rs2`) and the scaled respawn set the resource cap; the drops' pickup
  is priced on the kills that drop what is taken. The npc's default melee AI hits back at the profile's defence
  (`damage`). An npc with an AI override is a ModelError naming the script, and one the melee scripts special-case
  (`SPECIAL_NPCS`) is one too; a kill whose swing survival runs past `MAX_SWINGS` is a ProfileError.
- **Records** (`methods.ts`): `gear` (the worn objs, overlaid slot by slot by a query's `Profile.worn`: each worn obj
  takes its slots off the record's, `wearing`), `area` (a radius around `at` that gathers the npc's spawns across
  sites: the Edgeville dungeon's hill giants are three sites), `params: { npc }` and `loot` (`model/cycle.ts` Loot:
  stackables kept; bones buried in place, banked or left; other drops left unless `keep` names them). A bury costs what its
  swing gap (`BURY_SWING_GAP`) runs past the attack rate and gives `bone_exp`; each eat on a kill adds `EAT_DELAY` past the kill's
  free ticks.
- **Style by skill.** The style is no param: `styleParams` rates a record for the queried skill on the weapon's style
  that suits it (Attack accurate, Strength aggressive, Defence defensive; Hitpoints and Prayer the best of them), and
  `ResolvedMethod.levels` lists the skills its gear's styles train, Prayer too when it buries.
- **Hazards.** `ResolvedMethod.npcs` carries the largest max hit there, the npcs that hunt and up to which combat
  level, and the target's retreat; `areaHazard` the deepest Wilderness level and multiway over the area's sites.
  `query.ts` `methodHazard` makes a method aggressive at the profile's combat level (always in the Wilderness), and
  `bestMethods(skill, profile, { aggressive: false })` drops those. npc sites have a nearest bank (`distance.ts` SINKS),
  so a combat record banks for food at it; `WORLD_FORMAT` is 21.
- **The food gate.** A kill eats food only for an npc in `CALIBRATIONS` (`methods.ts`; `CALIBRATED_NPCS`): until a
  worker run has checked the model's damage on it, its cycle eats nothing, its trips end on a full inventory, and the
  pages say Food/hr uncalibrated where the npc can hit (the chicken's max hit is 0). A record is written when `killFigures` (`model/method.ts`) at the runs' profile is
  within `CALIBRATION_TOLERANCE` (25%) of the runs' damage and fight ticks a kill (first swing to killing swing);
  the whole kill's ticks and the gap between kills are reported only, as the gap is the combat task's overhead, not the
  floor's (the user's decision of 2026-10-23). The runs are `conductor/test/integration/smoke/combat-calibration.itest.ts`,
  measured with `conductor/tools/combat-ledger.ts`. The hill giant is calibrated (72 kills: damage 7.99 measured
  against 6.69 modelled, fight 25.9 ticks against 23.0; the gap 16.4 against 7.5 is a `conductor/roadmap.md` Review
  follow-up); the moss giant and the chicken are not.
- **Pages.** `wiki/training/` gained Attack, Strength, Defence, Hitpoints and Prayer, each rated on its own style, with
  a kills/hr column (at 99) on a page with a kill, the gear in Requires, a Hazard line per kill, and Food/hr in
  Supplies or "uncalibrated".
- **Records.** `hill-giants-edgeville` (plans hill-giants and giants-att-def), `moss-giants-varrock-sewers` and
  `chickens-lumbridge`; magic-blast-giants and ranged-magic-chickens stay unlinked. None has a measured figure: the
  plans' runs of 2026-10-16 fought on the food they started with and never banked, so none is a whole cycle.
  `test/methods.real.test.ts` holds the hill giants' floor at the start levels of those fight phases, food trips left
  out, above what they measured (they ran at 81-85% of it).

Accepted deviations:

- A retreat (`npcs.retreat`: the chicken's 1 HP) is priced as if the npc fought on; the page notes it.
- Legends' Quest counts as not complete in the drop context (`DROP_VARPS`), as a Profile holds no quest state: the
  jewel table's drops are the smaller set.
- A noted drop (`cert_<obj>`) is priced at the unnoted obj's cost, stackable (`model/items.ts`), as the engine gives it.
- The pickup of kept or buried drops is priced (`pickupTicks` on the kills that drop one); left drops are not picked up.
- `Profile.worn` overlays the record's gear per slot, so a query naming a helm keeps the record's weapon.

Known gaps:

- Ranged, Magic, prayer drain, potion decay, cannon, specials and multi-target attacks; green dragons, dragonfire and
  any Wilderness combat; damage from other aggressive npcs in multiway; HP regeneration in food cycles.
- `stats.ts --methods` (`conductor/lib/methods.ts` measuredFloor) rates every skill of a method on its first skill's
  style, so a combat method's Strength and Defence floors read 0 there; the pages and the real-data tests rate each
  skill on its own style.
