# World index data audit: survey and fix plan

Read-only audit, 2026-10-23, at main d46044057, with another session's uncommitted Catherby fishing fix in the tree
(it adds spot movement tiles to fishing sites and edits the Asgarnia, Kandarin and Catherby rects in `areas.ts`).
Paths: `S/` = `server/content/scripts/`, `E/` = `server/engine/src/`, `W/` = `wiki/world/`. The audit's scratch
scripts were not kept; the checks in §2.2 replace them.

Why: a runner sized its Catherby fishing area from the index and lost minutes idle. The index listed 2 harpoon
tiles, filed one site under Asgarnia, had no spot movement and no sharks. Each cause turned out to be a class.

## 0. Headlines

- **The builder reads part of the engine data and stops.** Fishing spots move on tick 1 (`timer=1` on every spot
  config, `E/engine/entity/Npc.ts:551`, `S/skill_fishing/scripts/fishing_movement.rs2`), so a spawn tile is almost never
  where the spot is; npc `wanderrange` (default 5, up to 63) is read nowhere in `W/`.
- **Hand-curated rects were never fitted to what is in them**, and no check catches a site filed in the wrong area.
  Port Sarim's rect misses 5 of its ~6 shops.
- **Site geometry hides the extent.** One tree site is 1245 trees of six species over 155×411 tiles; clustering is
  per leaf area, so one mine splits at an area edge; the stand tile is the walkable tile nearest the centre, wherever
  that is. `bbox` is in world.json but no page or runner brief shows it.
- **Rules key on one script directory or one category**, so features implemented elsewhere fall out silently.
- **Whole feature kinds are absent**: crops and pickables, ground item spawns, mill, livestock.
- **Curated tables can't say a use gate by quest state**, and `EXPECTED_UNREACHED` names sites by an ordinal id that
  any clustering change renumbers.
- **Verified fine**: tree and rock depletion and respawn, the mining and woodcutting formulas, fishing's roll order
  and cadence, the guild skill gates, all 801 script citations in the curated tables.

## 1. Findings

Counts are from the committed world.json unless marked. CONFIRMED = read in the engine and the index; SUSPECTED = not
checked against the game.

### 1.1 Engine data the builder doesn't read

| # | Finding | Evidence | Scale |
|---|---|---|---|
| A1 | Fishing spot positions are spawn tiles; spots teleport among their `fishing_movement_enum` tiles every 280-530 ticks from tick 1 | `S/skill_fishing/configs/fishing.npc` (`timer=1`, `param=fishing_movement_enum`), `fishing_movement.enum`, `fishing_movement.rs2:1-12` | 40 of 52 fishing sites; 271 enum tiles vs 132 spawns; 17 sites have enum tiles >10 tiles outside the site bbox. **Done**: main's 8bdc4b697 gave fishing sites their spots' tiles and a cover (`Site.movement`, the pages' Movement); Task 8 stands them from the pool (`place.ts` `standTile` with `SiteOptions.moves`: on a tile sharing an edge with one a spot moves to (`besideSpot`, the rule check 4's use tiles take), nearest the tiles' cover centre; 20 of 43 stands moved, Catherby's still on the shore) and its check 5 (`moving`) finds a pool moving out of its leaf area. At the merged HEAD 34 of 43 fishing sites move |
| A2 | One movement pool split into several sites | 8 enums over 17 sites (`0_34_50` feeds 3 Tirannwn sites; Entrana, Baxtorian Falls, Rimmington, Al Kharid, Barbarian Village, slimy eel east, `0_33_51` 2 each) | 17 sites. **Done**: main's 8bdc4b697 joins an enum's spots into one site within a leaf area and level (`place.ts` `joinShores`), which merged all 8: re-derived at the merged HEAD, no enum feeds two sites (`0_34_50` is `fishing-spot:tirannwn:1` alone). Check 5 (`moving`, `MOVING_ALLOW`, Task 8) keeps it so, and finds the one pool moving past its area's rects: Shilo Village's enum's west tile (2822, 2969), 3 tiles past the rect, allowlisted for the 2.5 refit |
| A3 | Npc wander range ignored: clusters are the spawn tiles' bbox | `E/.../NpcType.ts:101` (wanderrange 5, maxrange +2), `Npc.ts:702-735`; nothing in `W/` reads it | 92.5% (4198) of 4537 npc clusters wander past their bbox (re-derived in Task 2; the audit had ~74%); 133 of 150 pickpocket sites roam ≥5 (`knight_of_ardougne` 15 round one tile) |
| A4 | Respawn time not on sites or `npcSpawns` (the combat model has it: `W/model/npcs.ts:126`) | `NpcOps.ts:117` `respawnrate`, default 100 | rats 4 ticks ×410, blessed spiders 600 ×52 |
| A5 | Fishing pages show option names only, not level, tool, bait, catch, XP; `readSpots` already parses them for methods | `fishing.struct` (`productexp`, `success_low/high`), op scripts (`memberfish.rs2:14` shark 76 harpoon, `rarefish.rs2:23` lobster 40, `:128` tuna/swordfish 35) | every fishing page |
| A6 | Shop rule keeps the first `~openshop` of an npc | `W/classify.ts:355-359` (`.find(Boolean)`); Razmire `quest_mortton/scripts/razmire_keelgan.rs2:240,:243` | 3 npc configs open two invs on a members world, 2 of them placed (Task 3): Razmire (menu choice; `razmire_keelgan`, his unplaced serum form, too), Quartermaster (Regicide stage, `regicidegeneralshopkeeper.rs2:11-14`). Zaff, Rommik and Dommik open a second only off members worlds (`zaff.rs2:15-18`, `rommik.rs2:13-16`, `dommik.rs2:4-7`), which the rule skips |
| A7 | Script movement beyond wander | imps `npc_tele` up to 20 tiles (`npc/scripts/imp.rs2`); Canifis citizens `npc_changetype` to werewolves (`area_canifis/scripts/canafis_citizen.rs2:19-22`) | 47 imps (1 config), 20 citizens (6 configs). Over every config (Task 2): 103 move by an ai script of their own, 62 of them placed (522 spawns in 251 clusters); 36 of those are fishing spots (`fishing_movement.rs2`, already `Site.movement`) |

### 1.2 Classification rules keyed too narrowly

| # | Finding | Evidence | Scale |
|---|---|---|---|
| B1 | Stall rule reads only `skill_thieving/scripts/stalls/`; Ape Atoll's stalls are in a quest dir, and so is Yanille's ogre rock-cake counter in an area one | `W/classify.ts:422`; `S/quests/quest_mm/scripts/aa_market.rs2:1-13` (`@attempt_steal_aa_stall(level, low, high, xp, respawn)`); `S/areas/area_yanille/scripts/ogre_trader.rs2:21` (`rockcounter_withcakes`, Thieving 15) | 5 stalls (two at level 65), 1 counter (check 1) |
| B2 | `STATIONS` maps category `watersource` but not `well`; Shilo's sand pile has no category `sand_pit` | `W/classify.ts:44-57`; `S/general_use/configs/water_sources.loc:24,:57`; `S/areas/area_shilo/scripts/shilo_sandpit.rs2:4` (`sand1`, bucket of sand) | 15 wells (14 `well`, 1 `desertwell`; bucket only, `water_sources.rs2:69`), 3 sand piles (check 1) |
| B3 | Fishing subtypes fall back to raw labels | `W/classify.ts:336`: `category_632` (karambwanji), `category_633` (karambwan), `loc_2027` (waterfall fly), `loc_2630` (lava eel loc) | page names |
| B4 | Odd ones | `newbierange` not a range (its furnace is); `trappedchaosaltar` unclassified; Duel Arena nurses (Heal) unclassified | low value |

Nothing listed placed features whose op triggers no rule claimed, which is how B1 and B2 stayed hidden. Build check 1
(`unclaimed`, §2.2) lists them now; its allowlist's entries naming a kind are 2.6's to-do list.

### 1.3 Kinds the index doesn't have

| # | Feature | Engine | Placed |
|---|---|---|---|
| C1 | Crops: wheat, potato, cabbage, onion | `S/general_use/scripts/pickables.rs2:2-60` (`[oploc2,...]`, respawn 20-50 in the call); `W/classify.ts:379-380` leaves them out on purpose | 1,936 |
| C2 | Other pickables: banana trees, pineapples, Kharidian cacti (knife), Miscellania heather | `area_karamja/scripts/banana_tree.rs2`, `area_desert/scripts/kharidian_cactus.rs2`, `area_brimhaven/scripts/pineapple_plants.rs2`, `area_miscellania/scripts/weed_herbs.rs2` | 402: 200 banana trees (5 on Ape Atoll), 161 cacti, 36 heather, 5 pineapple plants (and Ape Atoll's 6 quest plants, `quest_mm.rs2`) |
| C3 | Ground item spawns | 1,204 `==== OBJ ====` map entries; `W/sources/maps.ts parseMapSquare` skips the section; only `wiki/generate-items.ts:743` reads them, deduped by mapsquare with no tile | 1,204 |
| C4 | Flour mill chain: hoppers, levers, flour bins | `S/general_use/scripts/windmills.rs2` | 4 mills (4 hopper configs, 4 flour bins of one) |
| C5 | Livestock: sheep to shear, cows to milk | `general_use/scripts/shear_sheep.rs2` (57 sheep, 5 of them placed shorn); `npc/scripts/cow_milking.rs2` (`[opnpcu,cow]`; cows are only combat `npc:cow`; `cow2` and `cow_beef` are not placed) | 52 + 52 |

### 1.4 Area geometry (`W/areas.ts`)

The validator (`W/area-resolve.ts`) checks ids, parents, cycles, inverted rects and that a child sits inside its
parent; `build.ts` fails only on a covered site outside every area. A site in the wrong area, or one resource split
across two areas, passes. Rects look like map-label squares never refit to their features (labels themselves sit
inside their rects).

| # | Area | Committed rect | What falls outside |
|---|---|---|---|
| D1 | Port Sarim (line 148) | x 3023-3064, z 3197-3244 | `shop:asgarnia:4-8` (x 3012-3028), `range:asgarnia:2`, `fire:asgarnia:6`, `pickpocket:asgarnia:4`: ~9 sites as plain Asgarnia. Re-derived (Task 5): the five shops lie 6-15 tiles off the rect, past the near-miss check's 3 (kept at 3, user decision 2026-10-24), so they are 2.5's to refit, not a check-2 finding; the check finds only the fireplace (3024, 3245), a tile north |
| D2 | Crafting Guild (line 73) | x 2909-2932 | interior is east: tanner, spinning wheel, pottery wheel, water source, a rock (x 2933-2941) |
| D3 | Entrana | x2 2881 over z 3347-3410 | mainland coast (`tree:entrana:3` reach `[[]]`); its south edge is fixed in the working tree |
| D4 | Catherby | working tree's shore rect is z 3415-3440 | `shop:kandarin:3` (2834, 3445) still outside |
| D5 | SUSPECTED, 1-3 tiles out | Taverley shop and water sources, Burthorpe anvil, Chaos Temple altar, Champions' Guild range, Brimhaven/Shilo/Tai Bwo Wannai shops, Bandit Camp (2 shops, range, fishing), Camelot altar, Exam Centre pottery, Edgeville shop | ~15 sites |

The near-miss scan found 47 service and resource sites within 3 tiles of a named area they're not in, 129 within 10.
Re-derived at the near-miss check (`W/checks.ts`, Task 5, after main's Catherby refit): 63 covered non-tree sites lie
1-3 tiles outside a leaf area not their own, 196 within 10 (the same rule with a 10-tile gap); `W/allow.ts` `NEAR_MISS_ALLOW` lists the 63, 50 as rects
for 2.5 to refit and 13 beside a leaf drawn round one thing (a bank, a resource, a course).

### 1.5 Site geometry (`W/place.ts`)

| # | Finding | Evidence | Scale |
|---|---|---|---|
| E1 | Clustering runs per (kind, leaf area, level), so one place splits at an area edge | `place.ts` `buildSites`/`cluster` | pairs within `SITE_RADIUS` in different areas: rock 6 (Coal Trucks mine 2 + 16 coal, 90% outside its rect; Arandar limestone; Shilo gems; Pirates' Hideout), pickpocket 13, npc 84, tree 274, anvil 1, flax 1 (Rellekka 2 + 18), shop 1. Re-derived at the split check (`W/checks.ts`, Task 5: same config, a feature of each within the radius of the other on one level, as clustering links them): rock 6 (also the desert mining camp's tin, and the Mining Guild beside the Dwarven Mine, a split that is right), pickpocket 10, anvil 1 (West Ardougne), flax 1, shop 0; npc and tree not checked |
| E2 | Trees cluster by kind, not species, and single-linkage chains forests | `place.ts:144-165` | `tree:kandarin:60`: 1245 trees (970 normal, 155 oak, 79 maple, 30 willow, 7 magic, 4 yew) over x 2608-2763, z 3291-3702; 170 of 795 tree sites span ≥20 tiles |
| E3 | One radius per kind both over-merges forests and under-merges mines and town squares | near-miss pairs (radius < gap ≤ 2×radius): rock 24 (Al Kharid iron 11 apart), pickpocket 95 (Al Kharid men: 4 sites in one square), fishing 7 | |
| E4 | Stand = walkable candidate nearest the centre; may not reach most members, or any bank | `place.ts` `standTile` | Re-derived in Task 6 (build check `stand`, at 545b6b246): 54 sites (npc 37, tree 9, rock 6, pickpocket 2). 17 stands reach fewer than half their members by a free walk: 13 behind a gated door from them (the Barbarian Outpost's gate 0 of 8, the Wizards' Guild doors 8 of 17), 2 Tirannwn forests chained across the Regicide crossings and 2 sites straddling West Ardougne's wall (its doors ask Biohazard done); the walk is bounded to the site's roam grown by twice its kind's radius, so wandering npcs (Mort Myre's snails, 20 tiles) are walked to. 37 have no nearest bank from any stand, members included: 20 whose only way out is a rolled crossing with no price for its failure's way back (the Shilo Village cavern's 17), 16 in pockets the graph has no way out of (the Black Knights' Fortress's secret rooms, the Haunted Mine), 1 whose way out asks more than its way in. It finds no fishing site: the audit's `fishing-spot:kandarin:1` 7 of 9 were loc_2027s no tile uses (no stand reaches them), `tirannwn:1` is 1 of 4 by its spots' own tiles but 4 of 4 by their movement, and `desert-mining-camp-mine:1` is unreached. Tree stands cut off from every bank: 4, not 23 (a Mort Myre pocket, three in the Shilo cavern). Mid-way through the other session's rebuild, Catherby's stand landed inside Harry's shop (a 111-tile pocket entered only by the Taverley cellar ladder), giving Falador West at 266 ticks behind a dusty key; nothing flagged it then. Main's fix put it back on the shore, and no stand at HEAD has a bank way asking more than its members' |
| E5 | Nearest bank is priced from the stand only | `W/distance.ts` | farthest member's walk minus the stand's: fishing p90 43 tiles, max 226; tree p90 28 |
| E6 | `bbox` and `features` are in world.json but not on the pages or in the runner brief | `W/types.ts:75`; `W/render/resources.ts`; `.claude/agents/task-runner.md` ("size to overshoot") | every site; rock members up to 21 tiles from the centre, pickpocket 26 |

### 1.6 Curated tables and what they can express

| # | Finding | Evidence | Scale |
|---|---|---|---|
| F1 | `EXPECTED_UNREACHED` and other entries name sites by ordinal id; the build fails only on an entry matching nothing, so a renumbered id silently hides a different site | `W/areas.ts` (148 distinct `kind:area:n` ids at 3043e7c19, re-derived from the table: many are template-built, `` `tree:kandarin:${i}` ``); the working-tree Catherby edit already renumbered `tree:asgarnia:23` to `:20` and removed `:6` | 173 sites suppressed (148 by id, 25 by area) |
| F2 | `USE_GATES` gates by loc config only; quest-state uses are missing | Viking stalls `S/skill_thieving/scripts/stalls/stealing.rs2:35,:42` (`%viking < ^viking_complete`); Miscellania coal (`mining.rs2:32-48`, `%misc_quest`) and maples (`woodcut.rs2:68-77`), and its intercept procs take the yield | 4 stall sites, Miscellania coal, maple and fishing sites |
| F3 | Stall family ignores guards (5 tiles, line of sight) and the 10-tick post-combat block | `W/model/families/stall.ts` returns `success: 1`; `stealing.rs2` `stealing_check_for_guard` | latent: no stall record yet |
| F4 | Shilo cart priced flat `coins:10`; script charges 5% of carried coins, 10-200 | `W/gates.ts:136`; `S/.../hajedy.rs2:51-55` | 1 transport pair |
| F5 | Moves the crossing model can't say | interface-only gliders (walker refuses, reach counts); two-op moves and loc spells (Legends cavern); ~20 sites in `EXPECTED_UNREACHED` by crossings the index misses; 193 scripted moves whose landing no run settles; 79 unpriced fail-backs (28 Brimhaven arena); 32 lock-picked doors with no roll (priced free); 48 `other:` requirements, including the Barbarian Outpost gate's barcrawl | tracked in part in roadmap Review follow-ups |

## 2. Plan

Decisions (user, 2026-10-23): this doc is the deliverable, no build yet; all four new-kind groups are in scope
(ground items, pickables, wells + Ape Atoll stalls, mill + livestock); method records (§3) stay with the conductor
and are listed in the roadmap.

Order matters: 2.1 first because every later step renumbers sites; 2.2 before 2.5 so the refits are driven by a
check rather than by eye; 2.4 after 2.3 because merged fishing pools and wander-grown boxes change what clusters.

### 2.1 Stable site keys (F1)

Key every curated site reference (`EXPECTED_UNREACHED`, method `at` already uses a tile) by a tile in the site, or by
area + kind + subtype, resolved at build time; fail the build when a key resolves to more than one site or none.
Files: `W/areas.ts` (`walledIn` and the entries), its resolver in `W/build.ts`. Done when renumbering every site
(shuffle the cluster order in a test) leaves the suppressed set unchanged.

### 2.2 Build checks for each class

Make these `--check` failures with a reviewed allowlist (each entry with a reason), so a class can't come back:

1. **Unclaimed triggers** (B1, B2, C): every placed loc or npc config with an op trigger, a gather or processing
   shape (`inv_add`, `~pickup_loc_floor`, `stat_advance`, `~openshop`) and no feature kind. The output is the to-do
   list for 2.6. Built (`W/checks.ts` `unclaimedTriggers`, `W/README.md` "Build checks"): per trigger no rule claimed,
   over its reach. Measured on the placed configs: a bare `inv_add` caught 661 configs, most of them dialogue handing
   out quest items, so the gather shape is `inv_add` with a `loc_change`/`loc_del`/`npc_changetype` in one body or
   with a `p_delay`/`anim` while a body re-runs the op (70 configs); a `stat_advance` of a stat but agility 70; one of
   agility 78, 62 of them on configs the reach graph crosses by (`World.crossings` or `World.gates`: the xp is the
   crossing's, cut), leaving 16, obstacles the build has no crossing for; `~pickup_loc_floor` 4 (the crops);
   `~openshop` 0 (the shop rule claims every one). Cows' milking and the mill hoppers have none of those, so a
   use-item shape was added: the item taken (`inv_del`) with one given or an `anim`/`p_delay` (143). Ops labelled
   Talk-to are cut, and an npc's labelled Attack (a loc's is a training dummy's use): 13 configs. An attackable npc's
   kind claims only its Attack ops. 268 configs found: 126 quest one-offs, 29 minigame, 11 doors, 7 tutorial, 6
   treasure-trail steps, 3 empty rocks, 11 more with no feature (9 repeatable uses giving only quest items, quest
   water, a ghast to fight), 26 with no planned kind (cat buyers 3, chompy hunting 4, dig site finds 5, elemental
   workshop 3, key chests 3, combat dummies 2, repairs 2, a beehive, a flour barrel, a dye maker, a monkey skinner),
   15 open items §2.6 lists (13 uncrossed agility obstacles, 2 quest pickpockets), and 34 naming a 2.6 kind (stalls
   6, wells 2, sand pit 1, crops 4, pickables 13 with Jungle Potion's 5 herbs, mill 5, livestock 2, a furnace with
   no category). 128 findings
   are use-item only, 106 of them quest one-offs, quest items, treasure-trail steps and key chests (a key or item
   used on a chest, a door or an npc): 2.6 can narrow the use shape before it adds kinds.
2. **Near-miss area** (D): a covered non-tree site within 3 tiles of a named leaf area's rects but resolved to
   another area. Sites further off a rect than that, such as Port Sarim's shop row (6-15 tiles west of it), are not
   its findings: 2.5 refits them from its own list.
3. **Split resource** (E1, D): same-config sites in different areas with a feature of each within `SITE_RADIUS` of
   the other, which clustering would have linked but for the area edge.
4. **Stand connectivity** (E4): a stand whose free walk component holds a use tile of fewer than half the site's
   members, or with no way to a bank that asks no more than the members' own ways in.
5. **Moving feature outside its site** (A1, A2): an enum tile outside its site's tiles, or one enum feeding two sites.
   Built (`W/checks.ts` `movingFeatures`, Task 8): an enum feeding the features of two or more fishing sites, and a
   fishing site with a spot tile in no rect of its leaf area (since 8bdc4b697 a site's tiles hold its enums' tiles, so
   an enum tile outside them can't happen; one outside the area can). At the merged HEAD: 0 enums over several sites, 1 pool out of its area (Shilo Village).

Files: `W/build.ts` (or `W/test/*.real.test.ts`), `W/classify.ts` for 1.

### 2.3 Engine reads (A)

- **Fishing pools**: one site per movement enum (A2); site `tiles` = the enum's tiles (A1, landing in the other
  session); stand and `nearest` from the pool. Coordinate with that session before starting. **Done**: main's
  8bdc4b697 made one site per enum within a leaf area and level (`joinShores`) and gave sites the enum's tiles
  (`Site.movement`); Task 8 stands each fishing site beside its spots' tiles, nearest their cover's centre, prices
  `nearest` from there, and adds check 5. An enum crossing an area edge would still split: clustering across leaf
  areas is 2.4's.
- **Wander and respawn** (A3, A4): `wander` (effective `wanderrange`, 0 for `nomove`/no-wander modes) and
  `respawnTicks` on `NpcSpawn` and npc-kind sites, and a `roam` rect beside `bbox` (`bbox` grown by wander;
  `bbox` itself unchanged, user decision), which `besideCluster` builds from. Read in `W/sources/npc-movement.ts`.
- **Fishing yields** (A5): per option, a Level / Tool / Bait / Catch / XP table on the fishing pages, from what
  `readSpots` already parses plus `fishing.struct`; note the two-fish roll (second fish rolled first).
- **Every shop of an npc** (A6): a shop feature per distinct inv.
- **Imps, Canifis citizens** (A7): mark as roaming / state-changing on their clusters rather than model them.

### 2.4 Site geometry (E)

- Cluster per kind and level across leaf areas, then assign the site's area by its members' majority (E1).
- Trees per subtype (species) (E2); per-kind radius with a walk-distance link instead of Chebyshev, so a wall or river
  splits and a town square joins (E3).
- Stand from the walk component holding most members and a way to a bank (E4).
- `nearest` as a range over member stands (min and max ticks), the max on the page (E5).
- Render `bbox` (or span) in the Sites tables and say in `W/README.md` and `.claude/agents/task-runner.md` to size a
  gather area from `bbox` plus margin (E6). This one has no dependency and can go first.

### 2.5 Area refits (D)

Work the 2.2 near-miss and split lists (`W/allow.ts`, whose entries' reasons name this section): Port Sarim (with
its shop row, 6-15 tiles west of the rect, past check 2's gap), Crafting Guild, Entrana east edge, Catherby's shop row, then each
SUSPECTED row, each against collision and the features named after the place. Rects only; no engine or content change.

### 2.6 New kinds (C, B)

In order of bot use: wells and Ape Atoll stalls (rule fixes, B1-B2; the stall page needs a reader for the call's
arguments), ground item spawns (C3: an `obj-spawn` list with tile, quantity and respawn in world.json, resolved to
areas like any site; the item pages then read it instead of `parseObjSpawns`), pickables (C1-C2: a `pickable` kind,
subtype the obj, respawn from the call), then mill (C4) and livestock (C5: shear and milk as npc-kind features). Fix
the raw fishing subtype names (B3) with a name table in the same pass.

Open items check 1 found that are rule or reach-graph gaps, not new kinds (`W/allow.ts` `UNCLAIMED_ALLOW` reasons
point here):

- **Quest pickpockets** (2.6, a rule fix as B1): the Dig Site workmen (`digworkman1`, `digworkman2`,
  `S/quests/quest_itexam/scripts/digsite_workman.rs2:45`). The pickpocket rule reads only
  `skill_thieving/scripts/pickpocketing/` (`W/classify.ts:492`).
- **A furnace with no category** (2.6, a rule fix as B2): `regicide_furnace` (`S/quests/quest_regicide/scripts/quest_regicide.rs2:693`)
  runs `@use_furnace`, but `STATIONS` maps only category `smithing_furnace`.
- **A gate row's free config** (a later reach-graph fix): `tree_ropeswing2`, the free config of
  `_island_rope_swing` (`W/gate-list.ts` `byConfig ''`). World.gates does not write it, and `deriveScriptedMoves`
  leaves gate candidates to the gate list, so the swing has no crossing.
- **Gate candidates kept out of the gates** (a later reach-graph fix): `agilityarena_handholds`,
  `trollromance_piste_walk_barrier_down`, `ttcellclimbrock1`, `upass_pipe4`, `upass_pipe6`. `W/gate-list.ts` lists
  them as not-a-gate or side-effect, and `deriveScriptedMoves` skips gate candidates, so no crossing is made.
- **Moves read as no passage, or unsettled** (a later reach-graph fix): `agilityarena_ropeswing`,
  `ttcellclimbrock2`-`4`, `zqrockjump2` (no passage read from their moves), `zqrockjump1`, `zqrockjump3` (moves no
  bound run settles; the build report's scripted moves).

### 2.7 Curated table forms (F2-F5)

- `USE_GATES` keyed by zone or var as well as config: the Viking stalls under `quest:viking`; Miscellania coal, maple
  and fishing under the kingdom quest, with a note that the yield is intercepted (F2).
- Stall family: guards in sight and the post-combat block before any stall record is written (F3).
- Scaled fares: a coins requirement that can say a percentage with a floor and cap, or the cap as the price (F4).
- F5 is the existing Review follow-ups list in `conductor/roadmap.md`; add the 32 lock-picked doors' missing roll and
  the barcrawl `other:` on the Barbarian Outpost gate there.

## 3. Out of scope: method records

Modelled catches and resources with no `methods.ts` record are left to the conductor's method research (roadmap,
Max route, "Model gaps"): sharks (`harpoon@76`, memberfish), lobsters (`lobster_pot@40`), pike, slimy eels, every
ore but iron and essence, maple, yew and magic trees, and all stalls. Big-net, karambwan and lava eel catches raise a
ModelError until `parseCatch` learns their shapes.
