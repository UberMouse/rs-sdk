# Spec: world index phase 3, the training-method framework

Phase 3 of `world-index.md`: a framework that models a training method's rate from the game's own
formulas and the world index, shows it beside what the bots measured, and grows one method at a time as
the conductor finds new ones. It is not an enumeration of every method in the game: the seed methods
prove each part, and every later method is one curated record (plus, for a new kind of action, one
formula module).

Builds on phase 2 (`world-index-phase2-spec.md`, "Phase 2 as built" in `world-index.md`): sites with
`reach`, run-tick distances (`distance.ts`), the reach graph, the account tokens.

## Decisions (2026-10-18, with the user)

- **The framework first, methods as they are found.** A method is a curated record in
  `wiki/world/methods.ts`; the build models it. Rule-based enumeration of every site x sink is dropped.
  Seed with the methods below; the conductor adds the rest as it discovers and measures them.
- **Non-combat now, combat in phase 4.** Gathering, the data-driven processing (cooking) and thieving.
  Processing families whose timings are script constants (firemaking, smelting, anvil smithing,
  fletching, spinning, crafting) are added by the same contract when a method needs one.
- **The modelled rate is the tick-perfect floor**: ideal play, no wasted tick, banking at its minimum
  tick cost. A measured rate is at or below it; the gap is the headroom the conductor's tick-perfect pass
  (`conductor` skill, Optimizing a method) works on. Measured above the floor is a model bug.
- **XP/hr, plus gp/hr where natural**: products and loot at item value, and supplies consumed per hour
  (bait, feathers, food) with their value. No money-making ranking.
- **Measured rates are curated in the method record**, copied from `conductor/tools/stats.ts` when a goal
  finishes (as roadmap rows are today); pages show floor, measured and the gap. Run logs stay gitignored.
- Carried: members worlds always (never gate or rank on F2P); bots always run (run ticks only, no
  walking ticks, no run energy).

## Facts the model rests on (survey 2026-10-18)

| Fact | Source |
|---|---|
| A tick is `NODE_TICKRATE` ms, default **400** (not 600); `conductor/local/up.sh` does not override it | `server/engine/src/util/Environment.ts:54`, `engine/World.ts:126` |
| XP is multiplied by `NODE_XPRATE`, default **25**; script XP is in tenths (`rock_exp` 175 = 17.5 base) | `util/WorldConfig.ts:102,244`, `entity/Player.ts:1871` (`addXp`) |
| The level curve is `2^(level/10)`, not the standard `/7` | `entity/Player.ts`, `learnings/local-server.md` |
| `stat_random(L, low, high)`: `floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1 > floor(rand*256)`, L the boosted level capped at 99 | `engine/script/handlers/PlayerOps.ts:591` |
| Woodcutting: a roll every 4 ticks (`%action_delay` set to `map_clock + 3` the tick after a roll); `trees.dbrow` `successchance` per axe; deplete `random(8)=0` after a log; normal trees (`respawnrate=0`) deplete every log and respawn `120+random(80)` | `skill_woodcutting/scripts/woodcut.rs2` |
| Mining: a roll every pickaxe `mining_rate` + 1 ticks (`pickaxes.obj`); a `mining_rock_normal` rock's ore costs a tick more (`p_delay(0)`); a gem roll first (`random(256)=0`, glory `random(86)`) eats the swing; ore always depletes; `mine.dbrow` respawn; essence never fails or depletes | `skill_mining/scripts/mining.rs2`, `configs/mine.dbrow` |
| Fishing: per-spot scripts give the tool/fish pairs and levels; per-fish `success_low/high`, `productexp` on the `fishing_struct` param; bait used per catch; spots move every `280+random(250)` ticks, never deplete | `skill_fishing/scripts/fishing_spots/*.rs2`, `fishing.rs2`, `fishing.struct`, `fishing_movement.rs2` |
| Pickpocket: `stat_random` on `pickpocket.dbrow` `success_chance`; a fail stuns for `stun_ticks` and deals `stun_damage`; loot weighted out of 128 | `skill_thieving/scripts/thieving.rs2`, `configs/pickpocking/pickpocket.dbrow` |
| Stalls: no roll (fails only when watched); `stealing.dbrow` respawn, xp, weighted loot | `skill_thieving/scripts/stalls/stealing.rs2`, `configs/stalls/stealing.dbrow` |
| Cooking: one item per click, 3 ticks (`p_delay(1)` refuses the next two ticks' clicks); burn by `stat_random(cooking, successchance)` from `cooking_generic.dbrow` | `skill_cooking/scripts/cooking.rs2:143-190` |
| Banking costs no ticks of its own; the approach and the clicks are the cost | `interface_bank/scripts/bank.rs2:18`, `bank_booth.rs2`, `banker.rs2` |
| Respawns scale by `scale(4000-players, 4000, base)`, truncated: base - 1 at one player | `~scale_by_playercount` |

Each ported function cites its file and line again in a comment; where this table is wrong, the game
wins and the table is fixed.

## Global rules (apply to every task)

- Phase 1 and 2's global rules still bind (code in `wiki/world/`, tests in `wiki/world/test/`,
  `*.real.test.ts` for real data, `bun run verify:conductor`, determinism, generated files committed with
  their code and never hand-edited, the game is the source of truth).
- **Format changes bump `WORLD_FORMAT`** and update `load.ts` and its tests.
- **Performance budget:** `bun run world` under ~15 s, `world.json` under ~10 MB; report both.
- **Every formula cites its script** (file and line) and has a test against a value worked by hand from
  that script, in the test's comment.
- **Server constants are read, not hardcoded**: tick length and XP rate come from the engine defaults
  (`Environment.ts`, `WorldConfig.ts`) at build time, with a test that fails if those lines move.
- **Conductor code (Task 6 only)** follows the conductor rules in `CLAUDE.md`: unit tests, `bun test
  conductor`, a `task-review` pass. No other task edits `conductor/`.

## Task 1 — Model core

`wiki/world/model/`:

- `server.ts`: `TICK_MS`, `TICKS_PER_HOUR`, `XP_RATE` read from the engine sources; `xpForLevel` and
  `levelForXp` ported from `Player.ts`.
- `roll.ts`: `statRandomChance(level, low, high)`, the exact probability (the per-term floors kept).
- `profile.ts`: `Profile` = skill levels, the tools and worn items that change a roll (best axe and
  pickaxe held, glory, and later ring of forging), with `profileAt(skill, level, opts)` building the
  profile a page column uses (below).
- `family.ts`: the contract a formula module implements:

  ```ts
  interface ActionModel {
      ticksPerAttempt: number;
      success: number;             // probability per attempt
      xpTenths: Record<Skill, number>; // per success, before XP_RATE
      products: { obj: string; count: number }[]; // expected per success
      consumes: { obj: string; count: number }[]; // per success (bait) or per attempt
      failTicks?: number;          // extra ticks a failure costs (stun)
      deplete?: { chance: number; respawnTicks: number }; // per success, per feature
  }
  interface Family {
      id: string;                  // 'woodcutting', 'fishing', ...
      skills: Skill[];
      /** Fails with a reason when the site, params or profile can't be modelled. */
      model(site: Site, params: unknown, profile: Profile, world: World): ActionModel;
  }
  ```

- `rate.ts`: `ticksPerItem` from an `ActionModel` (attempts per success, fail ticks), and the resource
  cap: k features each yielding `1/chance` items per depletion and down `respawnTicks`, so at most
  `k * (1/chance) / (time to deplete + respawnTicks)` items per tick however fast the player is.

### Acceptance criteria

- `statRandomChance` matches the engine for low/high pairs from three dbrows at levels 1, 50, 99,
  including a case where the floors bite.
- `xpForLevel` matches `Player.ts` at levels 2, 50, 99; `TICK_MS` 400 and `XP_RATE` 25 read from source.
- The resource cap is tested on a synthetic one-feature and three-feature case worked by hand.

## Task 2 — Seed formula families

One module per family under `wiki/world/model/families/`, each implementing `Family` from the game data
the sources already read (`sources/dbrows.ts`, `sources/configs.ts`), with its script cited:

- `woodcutting` (per axe; normal tree special case), `mining` (pickaxe rate, gem roll, essence),
  `fishing` (spot type -> tool/fish pairs and levels, both fish of a pair weighted by the fall-through
  roll, bait), `pickpocket` (stun ticks and damage; food per hour from stun damage), `stall` (no fail
  modelled; owner/guard watching is a hazard note, not a rate), `cooking` (burn chance; used as a
  process step).
- A registry (`families/index.ts`) maps family id -> module; adding a family is one file, one registry
  line and its tests.

### Acceptance criteria

- Hand-worked tests per family from its script and dbrow: yew with a rune axe at Woodcutting 60; iron
  with an adamant pickaxe at Mining 60 (gem roll included); trout/salmon fly fishing at Fishing 40;
  Falador guard pickpocket at Thieving 40; salmon cooking burn rate at Cooking 30.
- A family asked for an unknown site subtype, tool or a level under the requirement fails with a reason.

## Task 3 — Method records and the cycle model

`wiki/world/methods.ts` (curated, like `areas.ts`):

```ts
interface MethodDef {
    id: string;                  // stable, kebab-case; plans name it
    name: string;
    family: string;              // the action at the site
    at: Tile;                    // a tile in the site (sites renumber; tiles don't)
    params: unknown;             // family-specific: tree type, tool, fish, npc ...
    sink:
        | { mode: 'drop' }
        | { mode: 'bank'; bank?: Tile }  // omitted: the site's nearest bank
        | { mode: 'process-bank'; process: { family: string; at?: Tile; params: unknown }; bank?: Tile };
    plans?: string[];            // promoted plans that run it (conductor/plans/)
    measured?: Measured[];
    notes?: string;
    source?: string;             // where the method came from (a goal report, a spot search)
}
interface Measured {
    xpPerHour: Partial<Record<Skill, number>>; // game XP, XP_RATE included, as stats.ts prints it
    level: Partial<Record<Skill, number>>;     // at the start of the measured runs
    bot: string;
    date: string;                // YYYY-MM-DD
    hours: number;               // run time behind the figure
    from: string;                // e.g. "stats.ts plan:lure-cook-bank --since 2026-10-14"
}
```

`model/cycle.ts` turns a resolved method and a profile into rates, as the floor:

- **Load**: free slots = 28 minus the tools carried (a stackable product or a drop sink changes the
  arithmetic; say how in the code).
- **Gather**: load x `ticksPerItem`, slowed to the resource cap where it binds.
- **Drop sink**: `DROP_TICKS` per item, one named constant with its source (the op rate the server
  accepts), unless a family drops as it goes.
- **Bank sink**: run ticks site stand -> bank stand -> site stand over the reach graph under the method's
  reach set, plus `BANK_TICKS` (the minimum clicks: open, deposit-all, close; one named constant with its
  source). An explicit `bank` tile uses that bank, not the nearest.
- **Process-bank sink**: site -> processor -> bank -> site, plus load x the process family's ticks;
  burnt items still take their ticks.
- **Out**: XP/hr per skill (game XP, `XP_RATE` applied), items/hr, gp/hr of products at item value
  (`cost` on the obj config), supplies/hr and their value, and the binding term (player rate, resource
  cap, or travel share), so a page says why the floor is what it is.

`distance.ts` gains `runTicksBetween(from, to, reachSet)` (the existing Dijkstra, point to point) if the
nearest-sink tables don't already answer it.

Seed methods, each with its plan and the measured figure copied from `stats.ts` (or the roadmap row it
came from, cited):

| id | family | sink | plan |
|---|---|---|---|
| `iron-se-varrock-bank` | mining | bank (Varrock East) | `iron-bulk` (mine leg) |
| `iron-se-varrock-drop` | mining | drop | (mine-ore draft) |
| `lure-lumbridge-cook-bank` | fishing | process-bank: cooking at the Lumbridge pot, bank Varrock East | `lure-cook-bank` |
| `guard-falador-pickpocket` | pickpocket | bank | `guard-thieve` |
| `knight-ardougne-pickpocket` | pickpocket | bank | `knight-thieve` |
| `oak-chop-bank` or a willow site the plans use | woodcutting | bank | `chop-burn`'s chop leg if it fits, else unmeasured |

### Acceptance criteria

- The build resolves every record: `at` inside a site of the family's kind, tiles of explicit sinks
  inside a bank or processor site, the method's reach set non-empty, the family able to model it at its
  minimum level. Any failure stops the build naming the record and the reason.
- Cycle tests on synthetic methods worked by hand: drop, bank, process-bank, a resource-capped case.
- A real-data test per seed: the floor at the measured levels is at or above the measured XP/hr (a seed
  measured above its floor is a model bug to fix before landing, not a test to loosen).

## Task 4 — world.json and the training pages

- `methods[]` in `world.json` (`WORLD_FORMAT` 13): each record resolved (site id, stand, sink site ids,
  run ticks of each leg, reach sets), but **no rate grid**: rates are computed by the model from a
  profile, so a model fix shows in the pages without a format change.
- `wiki/training/<skill>.md`, one per skill with a method, plus `wiki/training/README.md`, rendered and
  `--check`ed like the other pages. One row per method:
  where (area, linked to its place page), requires (reach + levels + tools), sink, floor XP/hr at level
  columns (the method's minimum level, then 10, 20 ... 99, each with the best tool usable there and the
  other skills at the same level clamped to their requirement), gp/hr and supplies/hr at 99, the binding
  term, and the measured figures: XP/hr, at what level, `measured / floor` %, bot and date.
- A method a level column is under the requirement for shows `-`.

### Acceptance criteria

- Pages fresh under `bun run verify:conductor`; a render test on a synthetic world.
- `wiki/training/README.md` says what the floor means (tick-perfect, not a forecast) and how to add a
  method (Task 7's checklist), in a few lines.

## Task 5 — Query

`wiki/world/query.ts`, for the conductor and agents:

- `methodRate(id, profile)` -> the cycle output.
- `bestMethods(skill, profile, { met?: (token) => boolean, maxWilderness?, multiway? })` -> methods
  whose reach some set of which `met` accepts (`conductor/lib/account.ts` tokens), whose levels and tools
  the profile has, under the hazard filters (Wilderness level and multiway from the site; aggression is
  phase 4), ranked by floor XP/hr, the measured figure beside it.

### Acceptance criteria

- Unit tests on a synthetic world: filtering by reach, level, tool and hazard; ranking order.
- A real-data test: at Mining 60 with an adamant pickaxe, the seed iron methods rank, and the bank one
  is below the drop one.

## Task 6 — Conductor tie-in

- `definePlan` takes an optional `method: string` (a method id); a conductor unit test fails when a
  promoted plan names a method `world.json` doesn't have, and lists promoted plans with no method
  (a to-do list in its output, not a failure).
- `bun conductor/tools/stats.ts <bot> --methods`: per method with runs (via its plans), the measured
  XP/hr beside the floor at the bot's levels at the start of those runs, the gap, and a ready-to-paste
  `measured` entry for `methods.ts`.
- The seed plans gain their `method`.

### Acceptance criteria

- Unit tests for the plan-method check and for `--methods` on fixture results; `task-review` on the
  change.

## Task 7 — Docs and the upkeep loop

- `wiki/world/README.md`: a Methods section (what a record is, the floor, how measured figures get in,
  where corrections go) and the add-a-method checklist: write the record (a tile in the site, params,
  sink, plan); new kind of action -> a family module with a hand-worked test; `bun run world`; read the
  page row; after measuring, paste `stats.ts --methods`'s entry.
- `.claude/skills/conductor/SKILL.md`: on a GOAL report, update the method's `measured` the same turn
  as the roadmap row; when a plan is promoted, it names a method (new record if none); a spot search
  that finds a better layout adds a method; pick methods with `bestMethods` / the training pages and
  budget a tick-perfect pass against the floor.
- `.claude/skills/knowledge/SKILL.md`, `CLAUDE.md`: `wiki/training/` is generated; methods are
  corrected in `methods.ts` and the family modules.
- `conductor/docs/world-index.md`: "Phase 3 as built", and phase 4 (combat) in Phases.

## Out of scope for this spec

- Combat: accuracy, max hit, gear bonuses, kills/hr, drop tables, aggression hazards (phase 4).
- Processing families with script-constant timings (firemaking, smelting, anvil smithing, fletching,
  spinning, crafting), runecraft and agility: each added by the family contract when a method needs it.
- Enumerating every site as a method; a money-making ranking.
- Run energy and walking ticks; F2P or members gating.
- Reading run logs during the build (measured figures are curated).
