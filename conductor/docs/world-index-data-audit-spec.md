# Spec: world index data audit, part 1 (stable keys, engine reads, site boxes, build checks)

Expands the approved plan `conductor/docs/world-index-data-audit.md` (§2) into ordered tasks: 2.1, the E6 part of
2.4, 2.3 without the fishing-pool merge, and checks 1-4 of 2.2. Each `## Task N —` section is one unit of
subagent-driven work: implemented and committed by one agent, then reviewed for spec compliance and code quality
before the next starts. Tasks are primitives-first; a task may use anything an earlier one landed.

Paths: `W/` = `wiki/world/`, `S/` = `server/content/scripts/`, `E/` = `server/engine/src/`.

Decisions (user, 2026-10-23), beyond the design doc:

- Wander is a new `roam` rect beside `bbox`, not a grown `bbox`: `bbox` stays the box of the placements, so stand
  candidates, `model/method.ts` `siteAt` and the area checks keep their meaning (Task 2).
- Check 3 (split resource) ships now for covered kinds other than `tree`; trees get it in the 2.4 spec, once
  they cluster per species across areas (Task 5).
- Check 5 (moving feature outside its site) goes with the fishing-pool merge, after the other session's Catherby
  fix lands: that fix already reads `fishing_movement_enum`. It landed on main (8bdc4b697) during Task 1, so main
  is merged in after Task 1 and the pool's remainder is Task 8 (user, 2026-10-23).
- Order: the engine reads (2.3) land before the checks (2.2), so each allowlist is written once, against the data
  the index ends this spec with.

## Global rules (apply to every task)

- **No changes to `server/engine` or `server/content`**: bots must run on upstream. The index reads engine data and
  never patches it.
- **Don't touch the main checkout.** It holds another session's uncommitted Catherby fishing fix (`W/areas.ts`
  rects, `W/place.ts` and `W/build.ts` fishing movement, `conductor/tasks/fishing.ts`, regenerated pages). Work only
  in this worktree; don't copy any of that work in.
- **Generated pages are never hand-edited**: `wiki/places`, `resources`, `services`, `training`, `npcs`, `shops`,
  `items` and `wiki/world.json`. Regenerate with `bun run world` and commit them with the code that changed them.
  `bun wiki/world/build.ts --check` passes at every commit. A change to `W/types.ts`'s world shape bumps
  `WORLD_FORMAT`.
- **Every new `--check` failure ships with an allowlist** in which every entry has a `reason` and a `source`: a
  script line (`file:line` under `S/`) or a map line (`maps/mX_Z.jm2:line`), in the style of `EXPECTED_UNREACHED`
  (`W/areas.ts`). An entry that matches no finding is stale, and one that names nothing is invalid: both fail the
  build, as `expectedUnreached` does for `EXPECTED_UNREACHED`. A check's test reproduces the findings it targets
  (the design doc's §1.2-1.5 examples, re-derived) before anything is allowlisted.
- **Allowlists and curated tables name sites by `SiteKey`** (Task 1), never by an ordinal site id.
- **Re-derive before building on a number.** The design doc's counts come from an audit at an older main. Re-derive
  every count or claim a task's acceptance criteria rest on from the code and `server/content`; where the doc is
  wrong, fix the doc in the same task's commit.
- Distances are run ticks; bots always run. Members worlds only: don't model F2P gating.
- `mcp/` is out of scope.
- `W/` and `conductor/` code is oxfmt/oxlint clean (warnings denied). Finish with `bun run verify:conductor`,
  `bun test conductor` and `bun test wiki/world`. Unit tests on scripted data go in `W/test/*.test.ts`, tests that
  read `server/content` or `world.json` in `W/test/*.real.test.ts`.
- Integration tests: run only those of files the task touches. Never run the full integration suite.
- New curated tables document themselves in `W/README.md`'s "Where corrections go" table.
- Comments match the surrounding density and voice: say why, cite the engine or script line a rule rests on.
  Game knowledge for agents goes in `learnings/` per the `knowledge` skill, not in comments.

## Task 1 — Stable site keys

**Files:** new `W/site-key.ts`; `W/areas.ts` (`ExpectedUnreached`, `walledIn`, every `EXPECTED_UNREACHED` site
entry); `W/build.ts` (`expectedUnreached` and its call in `buildWorld`); `conductor/lib/banks.ts` (`OVERRIDES`);
tests `W/test/site-key.test.ts`, `W/test/site-key.real.test.ts`, the existing `expectedUnreached` and banks tests;
`W/README.md`; the design doc §1.6 F1 if its count is off.

A `SiteKey` is `{ kind: FeatureKind; at: Tile }`: the one site of `kind` holding a feature whose `tile` equals `at`
(level, x and z). A feature tile, not a bbox, because boxes overlap (one tree site spans 155×411 tiles) while a
feature belongs to exactly one site, whatever clustering does to the others. `W/site-key.ts` exports the type, a
`siteKeyName(key)` for reports (`tree (2731, 3487, 0)` or similar, stable and greppable), and a resolver over placed
sites and their features that returns each key's site id, and reports a key that matches no site or more than one.

- `ExpectedUnreached` becomes `({ area: string } | { site: SiteKey }) & { reason; source }`; `walledIn` takes a
  `SiteKey`. Convert every site entry. For each, take a tile from the site the id names in the committed
  `world.json` (its first feature by tile order is fine), and keep the existing grouping helpers (the
  `.map(i => ...)` lists become lists of keys or tiles); readability of the table matters, so a group may list its
  tiles as `[x, z]` pairs on one level when that reads better.
- `expectedUnreached` resolves the keys first. A key matching no site, or several, is `invalid` (an error, as
  today's unknown id is); a resolved entry that matches no unreached site is `stale` (as today). The report names
  entries by `siteKeyName`, not by id.
- `conductor/lib/banks.ts` `OVERRIDES` is keyed by `SiteKey` (`kind: 'bank'`, a booth's or banker's tile),
  resolved against `WORLD` when the module loads; a key resolving to no bank site or several throws at import,
  naming it. `BankSite.id` stays the site id.
- Site ids stay in `world.json` and on the pages: only curated references change.

### Acceptance criteria

- [ ] No ordinal site id (`kind:area:n`) is left in `W/areas.ts` or `conductor/lib/banks.ts` (a grep for
      `'[a-z-]+:[a-z0-9-]+:[0-9]+'` and template-built ids finds none). Other ordinal ids in curated tables
      anywhere under `W/` (grep `gates.ts`, `methods.ts`, `gate-list.ts`) are converted too, or the task's report
      says there are none.
- [ ] The resolver reports a key matching no site and a key matching two (scripted sites in a unit test), and
      `bun run world` fails on either in `EXPECTED_UNREACHED`.
- [ ] A real test relabels every site id in the built world with a seeded shuffle within each kind (the clusters'
      order permuted), re-resolves every `EXPECTED_UNREACHED` and `OVERRIDES` key, and asserts the suppressed
      set (as the sites' feature lists) is unchanged.
- [ ] `bun run world` output lists the same number of expected-unreached sites as before the change (`expected`
      in the report), with no invalid or stale entries; `world.json` and every page are byte-identical to before.
- [ ] `W/README.md` says curated references use a `SiteKey` and why.
- [ ] Out of scope: changing how sites cluster or are numbered.

## Merge of main, after Task 1

Main's 8bdc4b697 (fishing spots carry their movement tiles, `W/sources/fishing-movement.ts`; `SiteOptions.shore`
and `free`; `Site.movement`; the Catherby shore filed under Kandarin; shark records) is merged into the branch after
Task 1 is reviewed, before Task 2. Conflicts in `W/areas.ts` keep the `SiteKey` entries; main's renumbered or
removed ids are re-checked by `bun run world` (no invalid or stale entry). Pages regenerated in the merge commit.
Later tasks build on main's `COVER_MARGIN`, `coverOf` and `Site.movement` rather than duplicating them.

## Task 2 — Npc wander, respawn and scripted movement

**Files:** `W/sources/configs.ts` or a new `W/sources/npc-movement.ts` (the reader); `W/place.ts`
(`spawnClusters`, `buildSites`, `besideCluster`); `W/types.ts` (`NpcSpawn`, `Site`); `W/build.ts` (where the reader's
output is passed in and the beside tiles are built); the npc pages' renderer (`wiki/generate-npcs.ts`) for the new
fields; tests in `W/test/place.test.ts` and a real test; `W/README.md`.

Read per npc config, from its `.npc` config and the engine's defaults (`E/cache/config/NpcType.ts:98-126`,
`E/engine/entity/Npc.ts` `wanderMode` and `wander`):

- `wander`: how far from its spawn tile an npc of the config can walk on its own, Chebyshev. `wanderrange`
  (default 5) when its default mode wanders and its `moverestrict` lets it move; 0 for `moverestrict=nomove` and
  for a default mode that does not wander (read which modes do from `Npc.ts`; a patrol mode's extent is its patrol
  coords, which the reader takes as the box of those coords). Cite the engine lines in the reader.
- `respawnTicks`: `respawnrate`, default 100 (`NpcType.ts:105`).
- `moves`: scripted movement beyond wander, derived, not curated: a config whose own triggers (ai, timer, queue)
  call `npc_tele` or `npc_changetype` is marked `{ how: 'teleports' | 'changes-type', source: 'file:line' }`. Imps
  (`S/npc/scripts/imp.rs2`) and the Canifis citizens (`S/areas/area_canifis/scripts/canafis_citizen.rs2:15-20`) must
  come out marked; report how many configs are and fix the doc's §1.1 A7 counts.

On every `NpcSpawn` cluster and every site whose features are npcs (`source === 'npc'`): `wander` (the largest of
its configs'), `respawnTicks` (the smallest), `moves` when any config has one, and `roam`: `bbox` grown by `wander`
on every side. `bbox` is unchanged. `besideCluster` builds its tiles from `roam` instead of `bbox` (an npc that
wanders 15 tiles is used from anywhere in that box); stand tiles are unchanged. The npc pages show wander, respawn,
roam and `moves` per cluster.

### Acceptance criteria

- [ ] Unit tests on scripted configs: the default (5), an explicit `wanderrange`, `nomove` (0), a non-wandering
      default mode (0), a patrol, a default `respawnrate` and an explicit one.
- [ ] A real test: `knight_of_ardougne` has wander 15 (the doc's A3 example), imps and Canifis citizens carry
      `moves`, and the share of npc clusters with wander past their bbox is re-derived and written into the doc's
      A3 row in place of "~74%" if it differs.
- [ ] `roam` contains `bbox` on every cluster and npc-sourced site, and equals it where `wander` is 0.
- [ ] `besideCluster` is fed `roam`; a test shows a cluster whose roam crosses a wall still leaves out the ring
      tiles across it.
- [ ] Stand tiles and `model/method.ts` `siteAt` results are unchanged (a real test or a diff of `world.json`'s
      `stand` values in the report).
- [ ] `WORLD_FORMAT` bumped; pages regenerated; `bun run world` has no new error. Any reach change on pages is
      the intended effect of the wider beside tiles, and the task report names a few with before/after.
- [ ] Out of scope: modelling teleports or type changes; chase range (`maxrange`); the combat model's own
      respawn reading (`W/model/npcs.ts:126`) beyond reusing the reader if that is trivial.

## Task 3 — Fishing yields on the pages, and every shop of an npc

Two independent changes, one diff.

**Files:** `W/render/resources.ts` (`dataSection`, case `fishing-spot`), `W/model/families/fishing.ts` (`readSpots`,
reused, not duplicated), the `fishing.struct` reader if there is none; `W/classify.ts` (the `shop` rule and
whatever turns a rule's result into features); tests in `W/test/render.test.ts`, `W/test/classify.test.ts` and real
tests; the design doc §1.1 A5/A6 if wrong.

**Fishing yields (A5).** Each fishing page's Data section gets, per op of the spot, a table: Level, Tool, Bait,
Catch, XP, from what `readSpots` already parses and `S/skill_fishing/configs/fishing.struct` (`productexp`,
`success_low`, `success_high`). A spot op that catches two fish rolls the second (higher level) fish first: say
so under the table, citing the script line. A catch shape `readSpots` can't parse (big net, karambwan, lava eel)
renders a row saying so with the op script's line, not a guess.

**Every shop (A6).** The `shop` rule keeps every distinct inv an npc's (or loc's) triggers open, not the first
(`.find(Boolean)` today): one shop feature per inv, same placement, subtype the inv. Razmire Keelgan
(`S/quests/quest_mortton/scripts/razmire_keelgan.rs2:240`, `:243`) has two. `owned_shop` still applies only when no
trigger names an inv.

### Acceptance criteria

- [ ] The shark row (harpoon, Fishing 76, `S/skill_fishing/scripts/fishing_spots/memberfish.rs2:14`), lobster
      (40) and tuna/swordfish (35/50, the two-fish note) appear on their pages, matching the struct; a render
      unit test pins one table.
- [ ] Every fishing page has the table or an explicit "can't read this catch" row; none silently omits an op.
- [ ] Razmire has two shop features (two subtypes); a real test re-derives the npcs with more than one inv and
      the doc's "~5 npcs" is corrected if off. The shop pages list Razmire under both shops.
- [ ] Pages regenerated; `bun run world` clean.

## Task 4 — Site boxes on the pages, and sizing guidance

**Files:** `W/render/resources.ts` (the Sites table), the services and places renderers wherever a table lists sites
(`W/render/*.ts`: find each table with a Centre or Stand column), `W/render/common.ts` for a shared cell;
`W/README.md`; `.claude/agents/task-runner.md` (the "Size a gathering `area` to overshoot" bullet); render tests.

Every Sites table gets a `Box` column: the site's `bbox` as `x x1-x2, z z1-z2` (one tile: the coord), and, for a
site with a `roam` (Task 2), a `Roam` column in the same form, where the kind's pages hold npc-sourced sites
(pickpocket, npc, a bank's bankers if shown). Also an `Area to copy` cell or line that turns the box into a plan
`area`: the box's centre and the radius that covers it plus the margin (use `roam` where there is one). The radius
is straight-line, not Chebyshev: a plan's area holds what is within its radius of the centre in a straight line
(`conductor/lib/area.ts` `inArea`), so a Chebyshev radius misses a box's corners; `coverOf` is straight-line too.
Use main's `COVER_MARGIN` and `coverOf` (`W/sources/fishing-movement.ts`; move them to a shared module if they
outgrow fishing) rather than a second constant or formula; a fishing site's area to copy is its movement cover,
which main's Movement section already prints, so its row points there rather than repeating it.

`W/README.md` and the task-runner bullet say: size a gather area from the site's Box (Roam for npcs) plus the
margin, as the page's "Area to copy" gives it, never from the centre and a guessed radius; a tight area idles the
bot while a target stands just outside. Keep the bullet's Catherby example and its "say so under lessons" rule.

### Acceptance criteria

- [ ] Every generated table that lists sites shows Box (and Roam where present); a render test pins the cell
      format and the area-to-copy arithmetic (centre and radius, odd and even spans, one-tile box).
- [ ] The area-to-copy radius covers every tile of the box (test: every corner within radius of the centre).
- [ ] README and task-runner text updated as above, consistent with each other and naming the margin.
- [ ] Pages regenerated; `bun run world` clean.
- [ ] Out of scope: moving fishing spots (their tiles come with the pool merge), changing any bbox.

## Task 5 — Check plumbing, near-miss areas and split resources

**Files:** new `W/checks.ts` (the checks), new curated `W/allow.ts` (the allowlists; or beside `EXPECTED_UNREACHED`
in `W/areas.ts` if that reads better: say which in README); `W/build.ts` (`BuildReport`, `failed`, `formatReport`,
the call in `buildWorld`); tests `W/test/checks.test.ts`, `W/test/checks.real.test.ts`; `W/README.md`; the design
doc §1.4/§1.5 counts.

**Plumbing.** One shape every check in this spec uses: a check returns findings, each naming its site(s) by
`SiteKey` plus a detail line; an allowlist entry is `{ key(s), reason, source }`; matching yields left (errors),
invalid entries (a key resolving to no site) and stale ones (no finding matches): all three fail the build and print
as `ERROR <check>: ...` lines like the unreached ones. Reuse `W/site-key.ts`; generalise `expectedUnreached`'s
matching into the shared helper only if it stays readable, else keep them separate.

**Check 2, near-miss area (D).** A covered site, not a tree, whose bbox lies outside a named leaf area's rects
(on its level, or the rect's every-level) but within 3 tiles of one (Chebyshev gap between rects, 1-3), and whose
leaf area is a different area. Port Sarim's shops (`shop:asgarnia:4-8` at the audit) are the doc's D1 example.

**Decision (user, 2026-10-24):** check 2 keeps the 3-tile gap. Port Sarim's shops lie 6-15 tiles off its rect, so
they are not a check-2 finding: they go to 2.5's refit list, and the real test pins the Port Sarim fireplace instead.

**Check 3, split resource (E1).** Two covered sites, not trees, of the same kind holding a feature of the same
config, with a feature of each within `SITE_RADIUS[kind]` (Chebyshev, same level) of the other: the gap `place.ts`
`cluster()` links by. Their leaf areas differ. The Coal Trucks mine (rock), the Rellekka flax and the doc's anvil
and shop pairs are its examples. An allowlist entry names both sites of a pair.

**Amended (round-1 review):** the measure was the gap between the sites' bboxes, which is looser than clustering
(it links feature to feature), so a finding did not mean clustering would have linked the pair but for the area edge.

Allowlist the current findings with reasons that say what is wrong and what fixes it (most: "rect not fitted to
the place; 2.5 refits it"), citing the map line of a feature or the script of the op. Group entries by place where
several share one reason.

### Acceptance criteria

- [ ] Unit tests on scripted areas and sites: a site 2 tiles outside a leaf rect is found, 4 tiles is not, one
      inside is not; a same-config pair across an area edge within the radius is found, beyond it is not, a
      different-config pair is not, trees are skipped.
- [ ] A real test reproduces Port Sarim's shop row (check 2) and the Coal Trucks split (check 3) before the
      allowlist is applied (call the check without it).
- [ ] An allowlist entry no finding matches fails the build (stale), and one whose key resolves to nothing fails
      it (invalid): unit tested.
- [ ] `bun run world` and `--check` pass with the allowlists; the re-derived counts replace the doc's (47 near
      misses, rock 6 / pickpocket 13 / anvil 1 / flax 1 / shop 1) where they differ.
- [ ] README documents both checks and their allowlist in "Where corrections go".
- [ ] Out of scope: fixing any rect (2.5), tree pairs (2.4).

## Task 6 — Check 4: stand connectivity

**Files:** `W/checks.ts`, `W/allow.ts`, `W/build.ts` (the inputs the check needs: the reach graph, collision, the
sites' member use tiles); tests; README; the design doc §1.5 E4 counts.

A site with a stand and a non-empty `reach` (unreached sites are the unreached report's) fails when either:

- **Members cut off**: fewer than half its features are usable from the stand's walk component. A feature is usable
  when one of the tiles it is used from (locs: `reachTiles`; npcs: the walkable beside tiles `besideCluster`
  gives; fishing spots: the walkable tiles beside each of the site's `movement` tiles, since a spot can stand on any
  of them) is in the component. The component is the tiles a walk from the stand reaches
  by steps and by crossings that need nothing (an empty requirement set), bounded to the site's bbox grown by
  `2 * SITE_RADIUS[kind]` (enough for every member, cheap for big forests). Use `W/reach.ts`'s graph (`ReachGraph`,
  `edgeFrom`, `stepMask`) rather than a second step model.
- **Cut off from banks**: the kind takes products to a bank (`distance.ts` `SINKS`) and its `nearest.bank` is absent,
  or needs a requirement no member's own use tile needs (the Catherby case: a stand inside Harry's shop, whose only
  way out is a ladder behind a dusty key, while the shore needs nothing).

**Amended (implementation):** only a feature with a use tile some walk from the Lumbridge spawn gets to counts as
a member; one used from nowhere (a duck mid-pond, a banker behind the counter) is not this check's to report, and a
site with no members is skipped. The bank test compares by `requirements.ts` `dominates`: the bank's way must ask
no more than one member's way in, that member's use tiles' sets joined with the use gates and in the came-from
context the nearest sinks were searched under, as `build.ts` `addReach` joins them. The walk is bounded to the rect
holding the site's roam (its bbox when it has none), every use tile and the stand, grown by `2 * SITE_RADIUS[kind]`:
an npc is used from up to its wander past its spawn, a fishing spot from beside tiles its spots move to, a
connector (radius 0) from tiles beside its bbox. The stand is in the bound by construction and is walked like any
tile: an opened loc on it asking something leaves the walk nothing. A site wandering more than 64 tiles
(`MAX_WANDER`, a map-wide `wanderrange`) is not walked and is a finding of its own, allowlisted like any other.

### Acceptance criteria

- [ ] A scripted-world unit test builds the Catherby case the doc's E4 describes (a stand in a pocket entered only
      by a gated crossing, the members outside) and the check finds it; a site whose stand sees all members passes.
- [ ] A real test reproduces E4's examples at HEAD (re-derive: `fishing-spot:kandarin:1` 7 of 9, `tirannwn:1` 3 of
      4, and the fishing and tree stands cut off from every bank), by key, before the allowlist.
- [ ] Current findings allowlisted with reasons; the doc's E4 counts corrected where off.
- [ ] `bun run world` stays within the time it took before plus a small margin (say the before/after in the
      report); the check doesn't flood-fill the whole map per site.
- [ ] Out of scope: changing how stands are chosen (2.4).

## Task 7 — Check 1: unclaimed triggers

**Files:** `W/classify.ts` (expose what each rule claimed, if needed), `W/checks.ts`, `W/allow.ts`,
`W/sources/triggers.ts` (read only, unless a helper is missing); tests; README; the design doc §1.2/§1.3 counts.

Find every placed loc or npc config (one placed in a map) with an op trigger, including the use-item ops
(`oplocu`, `opnpcu`) and `ap*` ops, whose body or the procs and labels it calls (as `classify.ts`'s `reach` follows
them) has a gather or processing shape, and that no rule turned into a feature. Shapes: `stat_advance`,
`~openshop`, `inv_add` together with a `loc_change`/`loc_del` or a `p_delay`/`anim` loop (a gather), and
`~pickup_loc_floor`. Tune the shapes so dialogue that hands out a quest item does not flood the list: measure first
and say in the report what each shape caught and what was cut. Findings are per config, named `loc <config>` /
`npc <config>` with the trigger's `file:line`; an allowlist entry names one config or a group sharing a reason.

This list is the to-do list for 2.6. Allowlist it with reasons that name the missing kind (`crop: 2.6`,
`well: 2.6`, `ape atoll stall: 2.6`, `mill`, `livestock`) or why the config is no feature (a quest one-off, a
cutscene prop), with the trigger's line as `source`.

### Acceptance criteria

- [ ] A unit test on scripted triggers: an unclaimed `stat_advance` loc is found, a claimed one (a tree) is not, a
      dialogue-only `inv_add` npc is not, a shape reached through a called proc is found.
- [ ] A real test finds, before the allowlist: the Ape Atoll stalls (`S/quests/quest_mm/scripts/aa_market.rs2`),
      the wells (category `well`, `S/general_use/configs/water_sources.loc`), the crops
      (`S/general_use/scripts/pickables.rs2`), banana trees and Kharidian cacti, the mill hopper, sheep shearing and
      cow milking (doc B1, B2, C1, C2, C4, C5).
- [ ] Every finding allowlisted with a reason and source; the report prints the total and the per-reason counts;
      the doc's counts for those rows corrected where off.
- [ ] README documents the check and that its allowlist is 2.6's to-do list.
- [ ] Out of scope: adding any new kind or rule (2.6), ground item spawns (C3: not a trigger).

## Task 8 — Fishing pools: check 5, stand from the pool

**Files:** `W/checks.ts`, `W/allow.ts`, `W/place.ts` (`standTile` for fishing sites), `W/build.ts`,
`W/sources/fishing-movement.ts` (reused); tests (extend `W/test/fishing-spots.real.test.ts`); README; the design
doc §1.1 A1/A2 rows and §2.3's fishing-pool bullet (mark what main's 8bdc4b697 and this task did).

Main's `shore` join merges spots sharing an enum only within one kind, leaf area and level, so a pool can still be
split.

- **Check 5, moving feature outside its site (A1, A2):** an enum feeding fishing features of two or more sites; and
  a site whose `movement` tiles reach past its leaf area's rects (a pool filed in one area that roams into
  another). Findings by `SiteKey` and enum name; allowlisted with reasons, as the other checks are.
- **Stand from the pool:** a fishing site's stand candidates are the walkable tiles beside any of its `movement`
  tiles (not only the spawns' grown bbox), preferring, after main's `walked`/`free` order, the one nearest the
  movement cover's centre; `nearest` is then priced from that stand as today.

**Amended (implementation):** "not only the spawns' grown bbox" is read as *instead of* it, not as a union: a site
whose spots move takes only the tiles beside its spots' tiles (the spawns are among them), since a union would let
bbox tiles at the spawn end win the `walked`/`free` order, and §2.3 of the design doc already says "beside its
spots' tiles". "Beside" is one rule for the stand and check 4's use tiles (`place.ts` `besideSpot`, which
`checks.ts` `useTiles` calls too): `besideCluster` of the one tile with no wander, walkable, so a tile sharing an
edge that steps onto it or passes the entity reach test, not a diagonal one nor one across a wall. A spot that
does not move keeps the grown bbox, as any npc site does. At the merged HEAD no enum feeds two sites (8bdc4b697's
join merged the A2 enums), so check 5's real test pins 0 of those and the one pool roaming out (Shilo Village).

### Acceptance criteria

- [ ] A real test reproduces, before the allowlist, every enum that still feeds several sites at the merged HEAD
      (re-derive from the doc's A2 list: `0_34_50` in Tirannwn and the others) and any pool roaming out of its area.
- [ ] Unit test: a scripted pool whose spawns sit at one end of its enum gets a stand beside the enum's middle.
- [ ] Catherby's stand stays on the shore (main's test still passes); stand changes on other fishing sites are
      listed in the report with before/after.
- [ ] Findings allowlisted; `bun run world` clean; doc rows updated.
- [ ] Out of scope: clustering across leaf areas (2.4), which is what would remove most check 5 findings.

## Out of scope for this spec

The next specs, in this order:

1. **2.4 site geometry** (the rest of it): cluster per kind and level across leaf areas, area by majority (E1);
   trees per species, walk-distance linkage (E2, E3); stand from the best-connected component (E4); `nearest` as a
   range over member stands (E5); check 3 extended to trees.
2. **2.5 area refits**: work the check 2 and 3 allowlists down, starting with Port Sarim, the Crafting Guild,
   Entrana, Catherby's shop row. Starts only after the other session's Catherby fix lands and main is merged in.
3. **2.6 new kinds**: wells and Ape Atoll stalls, ground item spawns, pickables, mill and livestock, and the raw
   fishing subtype names (B3), working check 1's allowlist down.
4. **2.7 curated table forms** (F2-F5).

Method records (§3) stay with the conductor's roadmap.
