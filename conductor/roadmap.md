# Roadmap: max the account

The conductor's long-range plan. The conductor keeps **Now** and **Backlog** current; the
retrospective agent proposes changes; knowledge (where things are, how they work) lives in
`learnings/` and `wiki/`, not here. Progress numbers come from `bun conductor/tools/progress.ts`.

Goal: 99 in all 19 skills (total level 1881) on the local server (members world, 25× XP).

## Now

conductor3, a fresh account started 2026-10-23 (local, members, 25x XP). conductor2's rows (to 2026-10-22) are in
git: `git show b7d3bcdc1:conductor/roadmap.md`. The route was re-planned from the world index alone, not from
`learnings/` (user, 2026-10-23): four research agents rated candidates with the rate model
(`resolveMethods([...METHODS, ...scratch])` rates a record not yet in `methods.ts`, as
`wiki/world/test/methods.real.test.ts` does); their reports are summarised in Max route below.

**The XP curve.** This server's 99 is 998,458 XP (`conductor/lib/xp.ts`; it doubles every 10 levels, not 7), so a
max is ~19M XP. Low and mid bands, unlock timing and quest rewards weigh far more than on the standard curve: quest XP
goes through `stat_advance` at 25x, so Waterfall Quest alone is Attack and Strength 83.

**Floor hours to 99** (model, tick-perfect; bots measure ~55-85% of it): ~27 h in all, ~40 h expected. Long poles:
Herblore 7-11 h (herbs only drop: no shop sells one), Runecraft ~5.6 h (earth, travel-bound), Prayer ~3 h after
melee (bones only). Every other skill is 0.3-2 h. Explore goals go to the long poles first: herb sources (chaos
druids, Edgeville dungeon), Runecraft altar and essence layouts, Prayer by quests and dragons.

**Drops** (research 2026-10-23, `.durable-state/research-2026-10-23.md` §Drops; the user asked for drop tables and
time-to-drop): no drop is worth hunting.
- The rune scimitar drops only from Fire giants (1/128): 93 min expected at melee 60 with rune, trains 8-25% slower
  than moss giants, and has a 13.5% chance of nothing after twice that. The rune sword (20.8k, Champions' Guild,
  32 QP, which Dragon Slayer needs anyway) gives 92-99% of its Strength rate. Otherwise smith one (Mining 85,
  Smithing 90).
- Axes: smith them (mithril 51, adamant 71, rune 86); the dragon and troll drops aren't modelled.
- Pickaxes: buy the adamant one.
- Armour: buy it; it doesn't change the XP floor.
- Arrows and food: buy the arrows and fish the food.
- Runes: buy them from Lundail or the Magic Guild.

**Pairings** (processing takes minutes; gathering sets the time): WC + FM/Fletching (willows win for chop-and-process),
Fishing + Cooking, flax + Crafting (strings feed Fletching), iron + Smithing + Magic (superheat), essence + Runecraft,
chaos druids + Herblore + melee + Prayer.

**Opening queue** (objectives in order; revise as goals report):
1. Thieving 40 (Lumbridge men, then Al-Kharid warriors with shrimp food) and a raw chicken banked: done (thieving-40, 11 min).
2. Tools and food: steel axe (Bob, Lumbridge, 200; the best axe any shop sells), fly rod (5); Fishing net 1-20, lure
   to ~50 with Cooking alongside; ~40 cooked trout/salmon banked (food for thieving and the Wilderness course): done
   (tools-food, Fishing 68, Cooking 71, 50+ fish banked, 15 min).
3. Quests with XP lumps or unlocks: Restless Ghost (Prayer 47) and Rune Mysteries (essence) done 07:06; Imp Catcher (Magic 44,
   superheat at 43), Waterfall (Att/Str 83). Druidic Ritual is optional (Herblore is not gated in this revision).
4. (done, Thieving 99 at 09:00; knights 72-99 in 17 min, 2.96M/h) Thieving 40-55 guards (Falador: guard-thieve; measured 40 -> 62 in 5.8 min, +65,520 XP, ~678k/h, ~280 gp/min, 9 trout), 55-99
   knights (in progress, 07:30: bot at Catherby (2834,3443) after `travel` Falador -> Ardougne crossed White Wolf Mountain
   and a lvl 38 wolf took ~10 HP in 30 s at combat 32; Catherby -> Ardougne is west of the wolves; to 25k coins banked); stay on knights for the gp (166k/h at 99) the route needs: adamant
   pickaxe 3.2k, staff of fire 1.5k, natures (Magic Guild at Magic 66), mithril arrows ~72k.
5. Agility: gnome course 1-52, Wilderness course 52-99.
6. Gathering 99s with their pairings. Melee: mithril scimitar (Zeke, 1,040), then the rune sword once at 32 QP. No
   fire giant hunt. Melee 50+ at Edgeville chaos druids doubles as the herb source.

**Goal sizing (retro, 07:30).** Seven runner dispatches in 80 min each got a 4-15 min goal; a runner costs 0.7-9 M cache
reads (melee-20: 9.1 M for a 7 min run, thieving-gp 7.6 M) and 3 of 8 plan runs were killed or restarted by plan
bugs (below), not by the game. At these curves, size a goal to a milestone that unlocks something, not to levels:
"melee 40 + Prayer 49 -> 60 (hill giants, one plan)", "Thieving 99 + 100k gp banked", "Fishing/Cooking 99 +
Agility 52", with each plan phase carrying its own `until` and `when` gates written up front. Runners keep driving the bot, on
Sonnet (user, 07:37: "Keep runners, bigger goals, run them on sonnet instead of opus"); the conductor's general-purpose
dispatches pass `model: sonnet` too.

**Goal sizing worked (retro #2, 09:00).** After the milestone rule a runner cost ~1 M cache reads for a 17-50 min goal
(Kandarin agility+swordfish 1.0 M, knights 99 1.0 M) against 0.7-9 M for 4-15 min goals before; the one 5 M runner
(thieve-55-coins, 263 turns) was dispatched before the rule and spent its turns polling (four `sleep` calls blocked by
the harness, a nonexistent Monitor tool, three SubagentHandback repeats refused as "already delivered").

**Account 2026-10-24 (retro #3):** total 595; Thieving/Cooking/Fishing 99, Strength 54, Agility 52, Prayer 49, Magic 44
(Imp Catcher done 23:50, Falador-south r55 camp ~85 kills/h), HP 42, Attack 28, Defence 20, ten skills at 1. Imp
Catcher amulet in hand. Crafting 80 resumed 2026-10-24 after Imp Catcher (runner in flight; draft
`conductor/runs/conductor3/plans/crafting80.ts`, `interact` `npcId` 43 for woolly sheep landed 4778e2480).

**Queue now (retro #3), in order.** Quest plans proven on workers by the quest-library session (Cook's Assistant, Restless
Ghost, Rune Mysteries, Priest in Peril to 61, Imp Catcher, Knight's Sword, Elemental Workshop; Druidic Ritual, Ernest, Goblin
Diplomacy, Romeo & Juliet plans exist, Waterfall proven to the chest, Digsite and Merlin walkthroughs written) are the cheapest
XP left: run them in this order because each unlocks or lumps a band.
1. Melee to a safe floor (Att 28 -> ~40, Def 20 -> ~40) with `combat` `targetRange: "visible"` once landed (the
   modified combat.ts in the tree), because Knight's Sword (blurite fight killed a combat-55 start), Waterfall and
   Priest in Peril fights need it. Hill giants plan (`hill-giants`, bones for Prayer) is the vehicle.
2. Mine to 10, then **Knight's Sword** (Smithing 1 -> ~82, 318k XP; plan `knights-sword`, 761 s) before any Smithing.
3. **Waterfall** (Att/Str 83 at 25x) once its plan is landed; then **Elemental Workshop** (plan `elemental-workshop`, 227-279 s;
   server script says Crafting 50k + Smithing 50k, unconfirmed by a run: record the measured XP).
4. Druidic Ritual (Herblore 28 lump; Digsite checks Herblore 10) then **Digsite**
   (Mining 382k + Herblore 50k) before any Mining past 10; Priest in Peril to 61 for Morytania.
5. 32 QP set (Romeo & Juliet, Goblin Diplomacy, Ernest, Cook's Assistant, + route quests) -> rune sword, Dragon Slayer.
6. Then (Crafting 80 is in flight now) gathering/production 99s from the new floors, and the long poles (Herblore, Runecraft, Prayer).
Before each run, check the plan's `until`/`when` gates and the combat floor: three plan runs this week were killed or
mis-gated, not lost to the game.

Account (2026-10-23 09:00): total 490; Thieving 99, Cooking 95, Fishing 91, Agility 52, Prayer 49, Attack 28, HP 26,
Str/Def 20, the other nine skills at 1; ~25.5k coins banked; at Ardougne.
Next milestone: Fishing 99 + Cooking 99 (sharks, see Experiments), then melee/Prayer (Waterfall, hill giants), then the
gathering/production 99s from level 1.

## Unlocks

Skills and areas gated behind something other than levels, and quests whose 25x XP reward skips a band. Check the
quest page for its own requirements before planning it. Status is conductor3's.

| Unlock | Needs | Status | Page |
|---|---|---|---|
| Runecraft (essence mine) | Rune Mysteries (plan rune-mysteries) | done (conductor3 2026-10-23, 342 s) | `wiki/quests/rune-mysteries.md` |
| Herblore | nothing: identify and brew check only members + level (worker conductor3w5, 2026-10-23); Druidic Ritual only for its XP lump | open | `wiki/quests/druidic-ritual.md` |
| Prayer 47 | Restless Ghost (plan restless-ghost, ~5 min) | done (conductor3 2026-10-23: Prayer 20 -> 49, 359 s) | `wiki/quests/` |
| Magic 44 (superheat) | Imp Catcher (four bead drops from imps) | done (conductor3 2026-10-23 23:50: Magic 1 -> 44, Strength 42 -> 54; best plan = r55 camp at the Falador-south spawn cluster, ~85 kills/h) | `wiki/quests/` |
| Attack + Strength 83 | Waterfall Quest (no skill requirements; rope, runes) | todo; route proven to the chest on a worker (quest-library), plan not yet promoted; reward unverified | `wiki/quests/` |
| Defence 85 + Prayer 80 | Holy Grail (Merlin's Crystal first) | later | `wiki/quests/` |
| Baby blue dragons (Prayer 60-99) | dusty key: kill the jailer (combat 47, 2933,9693, always drops the jail key, `jailer.rs2:10`), open Velrak's cell, and he gives it; aggressive black knights nearby | later | - |
| Anti-dragon shield | Dragon Slayer started: the Guildmaster inside the Champions' Guild, whose door needs 32 QP (`champions_guild.rs2:2`; Oziach has no QP check) | later | - |
| 32 QP (rune sword, Dragon Slayer) | route quests (RG, RM, Imp, Waterfall, PiP, Druidic, Merlin, Grail) = 17 QP, plus Romeo & Juliet 5, Goblin Diplomacy 5, Ernest the Chicken 4, Cook's Assistant 1 = 32 exactly (no skill checks, goblins L2-5 only); spares Sheep Shearer, Doric's Quest. Plans being built in quest-library | todo | `wiki/quests/README.md` |
| Smithing 1 -> 82 | The Knight's Sword (plan `knights-sword` proven on questw4, 761 s, committed fa7187248; a combat-55 start died at the blurite fight, so melee ~40+ and food first): Mining 10 only (blurite, `mining.rs2:58`); reward Smithing 318,125 (`quest_squire.rs2:223`); redberry pie, 2 iron bars, pickaxe; ice warriors (L57) near the blurite route. Mine to 10 just before it, do it before any Smithing training | todo; plan proven, not yet run on conductor3 | `wiki/quests/README.md` |
| Mining 1 -> 85, Herblore 28 -> 57 | Digsite (members): Thieving 25, Agility 10, Herblore 10, checked mid-quest and boostable; reward Mining 382,500 + Herblore 50,000 (`quest_itexam.rs2:41-42`), no fights. So Druidic Ritual first; do it before any Mining training past 10 | todo, from scripts; plan queued after Knight's Sword | `wiki/quests/README.md` |
| Ranged 79, Fletching 75 | Temple of Ikov | todo, from scripts | `wiki/quests/README.md` |
| Morytania, Nature Spirit | Priest in Peril stage 61: one more talk to Drezel after completion (`holy_barrier.rs2`); the PiP plan includes it | todo | `wiki/quests/README.md` |

Quest index facts above are from the server scripts, unverified in game (quest-library, 2026-10-23). Leave out of
any route: Shield of Arrav, Hero's Quest, Throne of Miscellania and Legends' Quest each need two players (one per
gang). Order traps: Ned won't help with Prince Ali Rescue while hired for Dragon Slayer; starting Biohazard before
Plague City's dig blocks Plague City. Other top quest XP after the route: Dragon Slayer, Fremennik Trials.

## Backlog

Tasks the catalog needs, roughly in the order the account needs them. Each line: what, why,
status (`idea` / `authoring` / `in review` / `in catalog`).

- In catalog: `woodcutting`, `pickup`, `firemaking` (line burn with wall-edge check), `fletching`,
  `mining`, `combat` (melee, Ranged, Magic), `bank`, `shop`, `smithing`, `cooking`, `fishing`,
  `thieving`, `crafting` (pottery), `fill`, `agility` (Gnome course), `walkTo` stairs/ladders.
- In review / landed: firemaking wall-edge fix (bb9c4f533), cooking reach fix (25143a7db), travel +
  `passGate` (0d241f745), death ends a plan / idle rail / travel flee (ba9df8a92): all committed.
- **Flee with no food (done, 4882c35a3)**: `travel` with `flee: true` in combat at low HP and no food fails at once
  in `lowHpGuard` (`interrupts.ts`: `if (p?.combat.inCombat || hpFell) return { fail: ... no food }`),
  which left the bot standing in the fight. 4882c35a3 added `TaskDef.keepGoingWithoutFood`, which `travel`
  sets for `flee`: the guard no longer fails in combat or after a recent hit with no food (death and
  wilderness guards unchanged), with unit and smoke tests.
- **Plan gate bugs, three in one morning (idea, task-author/runner fix)**: (a) `guards` phase with no `until` kept
  thieving past 55 (run killed by hand); (b) tools-food `buy-axe` re-fired after the axe was banked, `when` gated on
  `inv` only, and the bank `upTo` took 27 of 155 feathers (fixed f2491ac8a); (c) `runs()` resets on restart. Proposal:
  `plan` validator (in `run-task.ts --plan` load) warns on a phase that is the last of its skill with no `until`, and
  on a `shop buy` whose `when` lacks a coin or bank-held check; document in `conductor/docs/plans.md`.
- **Runner wait idiom (done: task-runner.md already says so since 1e8b41494/fafa3391d; that runner predates them; Monitor note added)**: the thieving runner lost ~30 turns to harness-blocked `sleep N;
  cmd` calls and a nonexistent Monitor tool (transcript aeed6c5a: turns 77/144/153/196/200); the plan run is a
  background command, so say in task-runner.md: wait with `while pgrep ...; do sleep 10; done` in one call (the form
  that worked 6x) or end the turn and be woken by the notification; never `sleep N` followed by a command.
- **Fishing/Cooking 91-99 and the high-gp track (next)**: sharks at the Guild or Catherby (fallback in review), then
  gp: ~25.5k banked covers the adamant pickaxe (3.2k) and the mithril scimitar (Zeke); more gp from knights when needed.
- **White Wolf Mountain crossing (idea)**: every overland walk Asgarnia <-> Kandarin crosses it, and the wolves
  (cowardly, huntrange 2) hunt players up to combat 50 (lvl 25) and 76 (lvl 38). An `avoid` zone can't help with no
  other overland path; the options are combat 51+ (then only the lvl 38s), plenty of food with `travel` flee:true and
  minFood, or the boats (Port Sarim -> Karamja -> Brimhaven -> Ardougne, 30 gp each, unverified for bots). Batch the
  Kandarin goals (knights, gnome agility, Catherby fishing, Seers flax and longbows, moss giants (2549,3408)) so the
  account crosses once each way.
- **Run-task auto-journal + plan nudge (idea)**: runners still journal in batches and chain plain runs
  after four prompt fixes; make it structural (see the retrospective #4 proposals): `run-task.ts
  --objective <title> --journal <path>` appends the mechanical journal line itself, and the RESULT
  carries a `hint` after the 2nd plain run in a row on a bot since its last plan run.
- Next ideas, in order: `thieving` higher tier (Paladin/Hero at 70-80+) if guards stop paying;
  `mining` coal/mithril mode; `woodcutting` bank mode; `smithing` steel/coal plan; `crafting` beyond
  pottery (leather, gems); `agility` second course for 40+; quest tasks (Druidic Ritual, Rune Mysteries);
  `combat` upgrades (real food from the bank, better target than chickens); `prayer`; `fishing`
  lure/bait for trout/salmon.
- Done: `fletching` Make 10 batching and mixed-log tolerance; gates for stairs/ladders.

## Framework

Changes to the conductor system itself, decided with the user; not for the conductor to start
on its own.

- **Interruptible tasks: what is left.** Built on 2026-10-10 (`conductor/docs/interruptible-tasks.md`,
  which marks what was not built): generator steps, ops in `conductor/actions/`, guards at every
  wait, scripted-world unit tests, the integration suite, recording and replay. Left:
  - `conductor/tools/upstream-drift.ts`: list upstream `sdk/actions.ts` changes since the commit
    each op's "Ported from ... @ <sha>" header names, so fixes get re-ported. Drift is manual now.
  - Run `bun test conductor` inside `verify:conductor`, and require a green
    `bun run test:integration` before committing changes to `conductor/core` or `conductor/actions`.
  - A reactive simulator (the plan's "sim later") beyond `test/react.ts`'s scripted reactions.
  - walkTo crosses levels only through the curated table in `lib/connectors.ts` (Lumbridge castle, Falador -> Dwarven Mine, Wizards' Tower); no ferries, and a connector outside the table fails `no-connector`.
  - Recordings (about 2.8 MB per bot-hour) and integration leftovers (`conductor/runs/it*`, and
    one `it*` account and save per integration test in the shared engine) are never cleaned up.
- **Task → agent decisions.** Tasks can only end with a RESULT. Add a way for a task to raise a
  predefined decision to the supervising agent mid-run (pause with a question and options)
  instead of failing and making the conductor re-plan from scratch.
- **Account snapshot fixtures.** Built: the save library (`conductor/saves/`, `library.ts`),
  worker accounts (`load.ts`), live snapshots and server-side logout (`save.ts`), and the gateway
  controller lease; design in `conductor/docs/parallel-bots.md`. Left:
  - Record library saves automatically at important moments (before a quest, on reaching a
    combat zone).
  - Generated saves cover levels, inventory, worn, bank, position and varps through
    `sdk/test/utils/save-generator`; add quest-progress specs as quests come up.
  - A library save per committed task, including its failure branches (full inventory, no
    tool), so smoke tests can exercise them.
  - The library records no content version: a content repack that renumbers item or varp ids
    would change what a saved scenario means. Add one if repacks start happening.
- **Cleanup: the step tick budget outlived its job.** `stepTimeoutMs` was the only way to regain
  control from an `async` step stuck on an `await`; generator steps yield at every wait, where
  stops, the watchdog and guards already act, every wait has its own budget and every op its own
  cap (`WALK_MAX_TICKS`). What the budget still catches is a step that keeps yielding and never
  returns (a loop of ops that moves the bot or the inventory, so the watchdog never fires, and
  starves `isComplete` and step choice). Yet legitimate steps keep hitting it (mining's respawn
  wait, shop trades, smithing, long walks, each once ending `stuck`), and the fix spread budget
  bookkeeping into ops: `ctx.stepTicksLeft()`, walkTo's `reserveTicks`, callers' `AFTER_WALK_TICKS`
  sums. Proposed: raise the default to a generous backstop (about 10 min, far above any op's cap)
  and delete `stepTicksLeft`/`reserveTicks`, so walks fall back to their own cap. Alternative: drop
  the budget and make "a loop inside a step is bounded" a review-lens criterion. Touches
  `lib/engine.ts`, `lib/task.ts`, `actions/walk.ts` and `context.ts`, the walking tasks (combat,
  smithing, shop, firemaking, `lib/area.ts`) and their tests; re-review the tasks.

## Max route

The plan to max as fast as possible (conductor skill: Explore, then Execute). One row per skill: the planned route
by band with its model floor (research 2026-10-23, world index; ~55-85% of floor is what bots measure), floor hours
to 99, what conductor3 measured, and the next step. Explore goals target the long poles and the unmeasured rows.

| Skill | Lvl | Planned route (bands, floor XP/h) | Floor h | Measured (conductor3) | Next |
|---|---|---|---|---|---|
| Thieving | 99 | Man 1-25 -> Al-Kharid warrior 25-40 (476-633k) -> guards 40-55 (Falador or Ardougne, 0.76-1.13M) -> Knight of Ardougne 55-99 (2.0-7.0M; food 155 lobster-equivalents/h at 55, 52 at 99) | 0.28 | thieving-40: 1-40 in 11 min; Falador guards 40-62 ~678k/h; knights 72-99 in one 17-min run (plan knight-thieve-bankfood, area (2659,3308) r20, banked swordfish/tuna): 2.96M/h = 96.8% of floor, ~1,160 gp/min | done (conductor3 2026-10-23) |
| Agility | 52 | gnome course 1-52 (319k) -> Wilderness course 52-99 (1.58-1.91M, salmon) | 0.66 | gnome 1-52 in 550 s of laps (+37.8k, ~247k/h, 77% of the 319k floor; plan agility-from-ardougne, travel from Ardougne 107 s by the west route) | Wilderness course 52-99 next time the account is north-east (needs food; hazards) |
| Woodcutting | 1 | normal trees 1-15 -> oaks Draynor dropped 15-99 (672k-1.59M, steel axe); willows only beat oaks with an adamant (88+) or rune (69+) axe, which only Smithing 71/86 or drops give | 0.72 | - | steel axe at Bob's |
| Firemaking | 1 | trees-lumbridge-burn 1-30, willow-draynor-burn 30-99 (with WC) | 0.56 with WC | - | |
| Fletching | 1 | cut + string at a bank 1-40, willow-seers-longbow-bank 40-99 (474 strings from flax) | 0.54 with WC | - | |
| Mining | 1 | copper/tin 1-15 -> iron from a 3-rock stand tile, Al Kharid, dropped 15-99 (679k-1.07M, respawn-bound from 57); adamant pickaxe only (3.2k, rune doesn't pay back) | 0.98 | - | |
| Smithing | 1 | bronze then iron 1-33 -> superheat iron platebodies at Varrock East 33-99 (Magic alongside; ~1,055 natures, ~22k gp) | 0.64-1.15 | - | |
| Magic | 44 | Imp Catcher to 44, then superheat with Smithing; fire strike/bolt/blast 0.43 h as the alternative (~45k gp) | ~0.4 | Imp Catcher 1 -> 44 (21,875 XP quest lump) | |
| Fishing | 99 | small net 1-20 -> fly fishing Lumbridge dropped 20-99 (`lure-lumbridge-drop`, 547k-2.16M; banking +10 min) | 0.53 | net 1-10 in thieving-40; lure-cook-bank cycle (tools-food) 54-68 ~551k/h, ~85% of the `lure-lumbridge-cook-bank` floor; Catherby swordfish 68-91 +466.5k in ~48 min (~580k/h, radius-5 area idle); 91-99 with plan `catherby-shark-fallback` (harpoon + shark fallback, area (2848,3427) r15): +413.5k in 28.2 min, 880k/h = 92.9% of the `swordfish-catherby-cook-bank` floor, no idle phases, fallback never needed | done. Gap left: the Fishing Guild variant (shorter legs, unmeasured) for the route's 68-99 band |
| Cooking | 99 | lure-lumbridge-cook-bank 25-60 -> swordfish Catherby harpoon + range 60-99 (`swordfish-catherby-cook-bank`, 0.83-1.36M plus Fishing) | 0.85 with Fishing | shrimps 1-34 in thieving-40; lure-cook-bank 54-71 ~746k/h, ~80% of floor (tools-food); Catherby swordfish 71-93 +547k in ~48 min (~680k/h); 95-99 +262.5k in 186 s of cooking phases (~5.1M/h of range time) riding on Fishing | done. Cooking finishes before Fishing on this method: at 99 the plan banks raw fish and skips the range |
| Crafting | 80 | pottery 1-10 -> flax picked and spun at the Gnome Stronghold 10-99 (490k flat) | 1.3-2.0 | plan `crafting80` (Khazard shears, Ardougne sheep `npcId` 43, wool spun to 10, then the Stronghold flax loop): 1-80 in 55.8 min; flax loop 10-80 +266k in 48 min = ~332k/h, 68% of the `flax-gnome-spin-bank` floor (conductor3 2026-10-24) | 80-99: a flax-only plan naming `flax-gnome-spin-bank` so `--methods` measures it; the gap is picking (33% of loop time) and the walk down to the field (11%): spot search for a pick tile nearer the wheel stairs, fewer pick clicks per lap |
| Herblore | 1 | herbs from chaos druids, Edgeville dungeon (11 spawns, 0.445 herbs/kill; 126/203/247 herbs/h at melee 40/60/85; Wilderness 2 at the thugs beside them), with melee trained there (0.9-1.1M Str/h). Yanille druid warriors (Agility 40) are second, at 50-144/h; Taverley has only 6 spawns. XP per herb: 146 identify-only, 643 with buyable secondaries (eye of newt, chocolate dust), 1,261 with snape grass and limpwurt (tribesmen on Karamja give both at 37-50 and 22-30/h, and poison). Druidic Ritual 28 then 1,542 herbs: 6.2 h at melee 85; Eadgar's Ruse 80 cuts it to 4.6 h | 6-8 | - | **long pole**: rated with thugs as a proxy, since druids aren't combat features |
| Runecraft | 1 | Rune Mysteries, then earth via Aubury's essence (140k flat, travel-bound) | 5.6 | - | **long pole**: altar and essence layout search |
| Attack / Strength / Defence | 40/54/40 | cows Falador 1-25 -> scorpions Dwarven Mine 25-50 -> moss giants Kandarin (2549,3408) 50-99 (1.03-1.59M, rune scimitar); Waterfall Att/Str 83; maybe chaos druids alongside Herblore instead | 0.77 each | chickens 1-20 in 7 min (Att ~58k/h incl. the walk, Str ~110k, Def ~122k; melee-chickens); cows Falador (`melee40`, Zeke mithril scimitar, combat targetRange visible r22) Att 28-40 + Def 20-40 in 9.6 min: fight phases ~441k/h Att, ~403k/h Def, above the steel-scimitar floor (~430k at 40), no idle waits (conductor3 2026-10-24) | no scimitar hunt: mithril scimitar (Zeke), then the rune sword at 32 QP (Str 1,083k at 60 vs 1,098k for the rune scimitar); chaos druids for 50+ (herbs) |
| Hitpoints | 23 | rides along melee (3 x 99 melee gives ~993k) | 0 | - | |
| Prayer | 49 | Restless Ghost 47 (done: 20 -> 49 in 359 s) -> big bones at hill giants to ~60 -> baby blue dragons 60-99 (dusty key); Priest in Peril, Holy Grail lumps | ~3 after melee | - | **long pole** |
| Ranged | 1 | willow shortbow + mithril arrows on giants (by hand: 300k at 20 -> 1.48M at 99), ~72k gp arrows, 80% picked up | 0.81 | - | |

Model gaps the research found (fix where a route row leans on them): no walk between a site's features is priced
(multi-rock sites overstated: `iron-se-varrock-drop` 1.43M where no tile reaches all 4 rocks); `BANK_TICKS = 0`
inflates bank-standing floors (the training pages rate every Woodcutting level with a rune axe, and that is right: no
axe has a level check, `woodcut.rs2:197`; a smithed or dropped rune axe works from level 1);
Ranged and Magic combat unmodelled; no family for herblore, arrows, gems; chaos druids (and men, druids, unicorns)
are not combat npc features, and their drop table needs `%itgronigen`, which the drop varps don't set; the
combat model can't do food with no bank trip (hill giants); the stall family ignores being caught; pickpocket with food can't rate non-stackable loot; adult
dragons and trolls are ModelErrors.

Method records missing (world index data audit 2026-10-23, `conductor/docs/world-index-data-audit.md` §3; the
conductor adds them through method research, not the data fixes): the family models rate these, but `methods.ts` has no
record, so `bestMethods` can't offer them: sharks (`harpoon@76` on memberfish, Catherby and the Fishing Guild),
lobsters (`lobster_pot@40`), pike, slimy eels; every ore but iron and essence (tin, copper, coal, mithril, adamant,
gold, silver, clay, limestone, runite, blurite); maple, yew and magic trees; every stall (13 types, 17 sites; fix the
stall family's guard check first). Big-net, karambwan and lava eel catches are ModelErrors until `parseCatch` reads
their shapes. Miscellania's coal, maples and fish need the kingdom quest and lose their yield to the intercept procs.

## Experiments

Variants worth comparing with `bun conductor/tools/stats.ts`. Each line: hypothesis, variants, status.

- Area undershoot check at the first run (retro #3): Catherby fishing r5 -> r14 and Imp Catcher r22-35 (including an r22 the
  conductor wrote into a brief) -> r55 (~30 kills/h -> ring ~19/h -> camp ~85/h) were each caught by the user, not a log. Hypothesis:
  a gather/combat task that logs "targets in view outside the area: N of M ticks" in its RESULT (the tick records
  already hold it; the runner computed it by hand after the user's message, runner turn 1522) lets the runner widen
  the area in run 1 with no user. Variants: (a) task RESULT counter `seenOutsideArea`, runner brief rule "if > 10% of
  idle ticks, widen to cover every seen target tile + margin before run 2"; (b) `combat` `targetRange: "visible"`
  (user's idea, in review) which removes the area as the limit. Metric: idle ticks per kill and runs before the area stops growing.
- Runner restart after a harness kill (retro #3): the imp run was SIGTERMed at 61 min by low-memory (another session's world
  build), the runner reported and waited for the conductor (the notice told it not to restart), cost ~2 min and a
  conductor turn; the plan was resumable. Hypothesis: a runner may resume a resumable plan once when RESULT is
  `killed by SIGTERM` and `free -g` shows >8 GiB free. Status: proposal for task-runner.md.
- Review delegate hygiene (retro #3): `Task-review: fishing shark fallback` (general-purpose, 354 turns, 39.8 M cache reads,
  267 Monitor calls) polled a fix author with `Monitor sleep N; echo` loops; its sibling reviews cost 0.9 M. Fix proposed in
  the task-review skill brief: "while a dispatched agent runs, end your turn; do not poll", and "never edit task files
  yourself: dispatch task-author for fixes" (the interact review committed 4778e2480 with the reviewer's own C fixes).
  Metric: cache reads per review.

- Catherby swordfish idle gaps (retro #2): the 08:12 run (87.8% of Fishing floor, 70% of Cooking) cycled fishing 152 s,
  339 s, 180 s for the same 26 fish, then 60-100 s of cook-swordfish, cook-tuna and bank per cycle (about 25% of the
  wall time not fishing). Cause of the 339 s cycle (conductor, from its ticks): no Cage/Harpoon spot in view for ~130 s while 4-5
  Net/Harpoon (shark) spots were; the fishing task's shark fallback (in review) closes it. Variants: (b) Fishing Guild sharks/swordfish
  (`shark-fishing-guild-cook-bank`, `swordfish-fishing-guild-cook-bank`: records exist, no runs; Guild needs Fishing 68,
  range and bank beside the dock) for 91-99 on a worker first; (c) cook while fishing is impossible, so shrink the
  non-fishing 25% with one cook phase for both fish. Metric: Fishing XP/h vs 561k/h measured. Needs the shark fallback
  in fishing.ts landed.
- Goal sizing (retro 07:30): hypothesis, runner overhead (0.7-9 M cache reads each, ~6 min goals) dominates at this
  server's XP curve; milestone-sized goals with a runner, and known plans run by the conductor, cut tokens per XP
  at equal XP/h. Metric: cache-read tokens per 100k XP over the next 10 dispatches. Status: confirmed on two goals (retro #2): ~1 M cache reads per 17-50 min runner.
- Thieving gp: Falador guards 540k/h with 9 trout per 6 min (~1.5 trout/min, ~280 gp/min) vs knights at 62+; measure
  knights XP/h and gp/h once at Ardougne, and compare with staying at Falador guards until 70 (no mountain crossing).

- Orphaned runner stop (retro #9): after a Claude Code restart the conductor called TaskStop on dead runner agents (turns 4492/4496) and the harness SIGTERMed their live child `run-task` (w4 Wilderness plan, 40 min cap, stopped at 28). Fix proposed in the conductor skill: after a restart never TaskStop a runner whose run-task pid is live (`pgrep`); resume a new runner that waits on the pid. Metric: `killed by SIGTERM` lines whose cause is a stop.
- Runner handback discipline (retro #7): the smithing runner called SubagentHandback with message "placeholder"
  right after launching a background run (turn 38): the harness reminder says handback is how a turn ends, and
  "end your turn and wait" in task-runner.md reads the same. The tool then refused the real report. Fix proposed:
  task-runner.md items 3/4 say "end your turn with one plain line of text; SubagentHandback only for the final
  report". Metric: handbacks without a RESULT in `reported`.
- Smithing bulk vs loop: measured (retro #8): iron-bulk 112k/h incl travel vs iron-smith 140k, so bulk iron is not the route. Next: steel bars on a worker (coal from the bank, Mining 99), per-phase ticks, vs Ring of Forging iron; target >300k/h. Status: not started.

- Skill speed ranking at the current levels (XP/hr): Thieving guards 1.27M (with food), Mining iron adamant
  875k, WC oaks 780k, Cooking pot 345k, Smithing 140k, Fishing 95-200k, Crafting 65k, Fletching 70k.
  Hypothesis: Agility (Gnome ~2.2k XP/lap) beats the slow ones at level 1. Status: measure on the first run.
- Fletching: arrow shafts are the slowest gain. Hypothesis: shortbow/longbow (u) on oaks is 2-4x
  XP/log. Variants: shafts vs oak longbow (u) at Fletching 30+. Status: untested.
- Crafting past 35: pottery caps near Crafting 40 for useful XP; compare leather/gem cutting. Status: untested.
- Combat target: chickens Def 108k/h, Str 83k/h, Att 55k/h vs 300k-1M/h for gathering. Hypothesis:
  cows/goblins and a better weapon give 3-5x. Status: untested; run after Ranged/Magic.
- Mining rock: iron with the adamant pickaxe ~875k/h vs bronze 541k (different start level). Next: coal
  and mithril at 55-70+. Status: iron done.
- Woodcutting: oaks steel ~780k/h done; next willows/yews at WC 60+ and an oak -> bank loop vs drop.
- Firemaking: line burn: 26 logs Lumbridge field 5 lines 91.6s -> 9 lines 79.6s once wall edges are
  checked (author result). Compare against sidestep at the FM 60+ rate. Status: pending review.
- Cooking at the Lumbridge Cooking pot beats the range (west-side unreachable); done (345k/h).
- Tool tier skipping: steel axe done; test steel -> mithril directly beats stepping.
- Smithing method: iron kiteshield loop 140k/h (bars 50% smelt fail) vs smelt-only 131k/h. Variants: ring of
  forging, steel bars (coal), smithing bigger items per bar (platebody 5 bars). Status: untested.
- Tick-perfect pass on combat (priority): from a `melee40` and `ranged-magic` replay compute idle ticks per kill
  (walk, loot, eat, bury, re-target). Spot search for cows/goblins vs stronger targets (hill giants, guards)
  and weapon tier; A/B on a worker at one spot. Metric: XP/h per skill. Status: not started.
- Tick-perfect pass on willow-burn and Fishing/Cooking (cheap, ~1 h each left): burn line next to the trees,
  cook while fishing. Status: not started.
- Hand-curated connectors (`lib/connectors.ts`, 176 lines; Wizards' Tower door c0593d7f1, Taverley 2026-10-16)
  have cost two blocked goals. Hypothesis: the world-index phase 2 spec (connectors from the scripts) removes
  the class; schedule it before the next quest goal. Status: spec drafted, not authored.
- Runner process: plan-first from loop 1 and run to goal in the background. Metric: plain runs per goal
  and idle minutes between a RESULT and the next run (journal `at` gaps). Status: after the checklist
  restructure (retro #4) and `--objective` auto-journal; measure on the next three runners.
- Chain robustness: plans (`when` predicates on inventory) replaced numbered chains; one failure
  mode left: plan `when` bugs (pottery-craft craft-bowl matched an unfired pot). Status: watch.

## Review follow-ups

Review findings `task-review` deferred because their fix needs work outside the reviewed change
(most findings are fixed in the same pass).

- walkTo: the Wizards' Tower stairs/ladder room (x 3103..3107, z 3159..3163) is entered by a diagonal elf door (3107,3162) that `sdk/collision-data.json` lacks, so `collisionPaths` finds no route in from outside and `walkTo` into the tower ends `no-path` (connectors work from inside the room); needs diagonal-door support in the SDK collision data or in `walkOnPlane` (game G3)
- combat itest: the Mordred case's bot is left standing by Sir Mordred after the run; he respawns (100 ticks), attacks it, and the logged-off player cannot leave combat, so a combat smoke re-run within a few minutes fails `no free reachable Sir Mordred` until that player dies; needs integration-harness teardown that moves or logs out a fixture bot left in an aggressive NPC's range (contract T8)
- walkTo: connector `hazard` is only logged (`walk: WARNING at ...`); add an opt-in `WalkOptions` gate (e.g. a combat floor on the Falador mine stairs: scorpions hunt combat 28 and under) that returns a distinct reason, and make the shop task use it before walking into the Dwarven Mine; touches tasks outside the walk change (safety S1)
- walkTo: a quest-stage gate above the quest's completion value (`quest:priestperil>=61`, the holy barrier; `quest:mm>=10`) is met only when the caller lists it in `met` (lib/account.ts `meetsToken`), so a walk through one for an account with the quest done but the token unlisted ends a bare `no-path` that does not name the gate; make the no-path diagnosis name the unmet requirement tokens of the dropped edges, and have the first task or plan that crosses the barrier or goes to Ape Atoll pass the token (robustness R6)
- crafting: station helpers (find/walk-to wheel and oven) are local copies of the ones in smithing.ts; refactor both into lib/ (touches smithing.ts, out of the crafting review's scope) (code-quality Q4)
- fishing: learnings/fishing.md:76 labels the Al Kharid spot (3267,3148) Lure/Bait but map data says Net/Bait (npc 330); River Lum Lure/Bait spot (3238,3252) and the Draynor four hop tiles + dark-wizard hazard are missing (contract T6)
- bank: `bankInView` in `tasks/bank.ts` (/^bank booth$/, /banker/) is looser than `findUsableBooth` in `actions/bank.ts` (bank chests, Closed booths, usable options); export one shared predicate from the action so the no-walk shortcut cannot skip a walk and then fail no-bank-found (game G3, contract T5, code-quality Q3).
- Knowledge: `learnings/banking.md` lacks the stand tiles in `lib/banks.ts` (Varrock East verified by smoke 2026-10-10T01-34-59-869Z-bank; Falador West/East, Edgeville map-data only; Draynor/Al Kharid skip reasons) (contract T6).
- essence-mine: done 2026-10-16: `interactNpc(npc, option)` is in `conductor/actions/interact.ts` (with tests) and the Aubury Teleport uses it; the other raw `interactNpc` sends (bank, shop, fish, attack, pickpocket) still inline theirs.
- Knowledge: no `wiki/skills/runecraft.md` or learnings entry for the essence-mine landing spots, the portal exit coord (defaults to Sedridor when unset), or talisman-on-ruins entry (contract T6).
- interact/talk: `at.met` (lib/spot.ts AtSchema, requirement tokens such as `quest:priestperil>=4` passed to the walk) reaches both tasks but neither description mentions it; add the sentence from travel's description (interact.ts/talk.ts were owned by other changes during the quest-routing review) (contract T3).
- Engine/lib: `Counter` has no read method (tasks read with `add(0)`); add `value()` (shop review).
- Lib: pickup and fletching copy the same `attacked` step (fail on any `inCombat`); make it a
  shared guard in `lib/interrupts.ts` beside `underAttackGuard` (code-quality Q4, contract T1).
- Actions: the fletch op (`conductor/actions/fletch.ts`, ported from `bot.fletchLogs`) clicks the
  product's make-1 button, so the fletching task cuts one log per call (~4 s/log against 0.8 s);
  add Make 10 / Make X to the op and let the task batch (game-semantics G5). No SDK change needed.
- Lib: `lib/saves.ts` builds its own copy of the engine XP table (`LEVEL_XP`, tenths) and a
  private `levelForXp`; have it use `xpForLevel`/`levelForXp` from `lib/xp.ts` (scaling tenths)
  and drop the copy, which also gives the `lib/xp` exports a caller outside their test
  (code-quality Q3).
- Knowledge: `learnings/hazards.md` has no White Wolf Mountain entry (white wolves lvl 25/38 attack combat-22 bots on the Lumbridge -> Gnome Stronghold route; the `travel` task takes the HP hit and relies on carried food; ~8 HP lost over a 270 s run with 10 shrimps eaten) (safety S1).
- Actions: `clean` (dialog text strip) in `actions/gate.ts` duplicates `actions/climb.ts`; export one shared helper (touches climb.ts, out of the travel review's scope) (code-quality Q3).
- Lib: thieving copies combat's `foodInInventory`/`wantsToEat` (`tasks/combat.ts`); move both to
  a shared `lib/food.ts` taking `{ food, eatBelow }` and have both tasks import it (contract T5).
- Brief accuracy: the conductor's dispatch told a runner "Falador has a furnace, an anvil" (false: no
  Falador anvil, `learnings/smithing.md:48`) and cost it ~25 turns; briefs state only facts a page confirms.
- World index: make a new unreached site a `bun wiki/world/build.ts --check` failure, as the report is expected
  to be empty (`build.ts` prints it as a warning only).
- World index: derive the moves of side-effect gate candidates, which give no edge (`reach.ts` takes only
  `kind: 'gate'`): the Dwarf Cannon cave (`mcannoncave`, `mcannon_cave.rs2:10`), the Regicide pit traps
  (`quest_regicide.rs2:239`), the desert mine cart (`quest_desertrescue.rs2:829`), the Underground Pass pipes
  (`upass_pipe4`, `upass_pipe6`).
- World index: give the desert mining camp's mine doors (`thttmineentrance*`) their teleport into the mine
  (`quest_desertrescue.rs2:435`); their gate rows have no `to`, so the fill crosses them as a surface door.
- World index: Holgart's boat to the fishing platform (`holgart_ardougne.rs2:105`) as a curated crossing under
  its Sea Slug stage; it is in `TRANSPORTS_OUT_OF_SCOPE`.
- World index: settle the Underground Pass obstacles: the spear traps' and collapsed bridges' moves no bound run
  settles (`upass_obstacles.rs2:150`, `:368`), then recheck the three pockets' entries.
- World index: the Kharazi jungle cuts as chained moves: each cut moves the player two tiles on, onto open ground
  or the next jungle loc (`jungle_tree.rs2:141`, `:149`), and the locs stand on tiles the map flags blocked, so
  the `opens` rows free no way through.
- World index: approach-op gates used from range get their stands from the script: the Baxtorian Falls crossing
  rock is thrown from the bank 8 tiles north (`quest_waterfall.rs2:222`), so its row derives no landing and the
  islet the overhanging tree's rope row is used from (`:254`, landing on the ledge) is never reached; the
  Underground Pass guide rope is shot from z 9720 on (`upass_bridge.rs2:38`) while the tiles beside it are the
  chasm's.
- World index: the Hazeel Cult sewer raft as a crossing behind puzzle state: it reaches the passage's end only
  with all five valves turned right (`quest_hazeelcult.rs2:38`).
- World index: the Regicide dense-forest crossings at (2165, 3189) and (2173, 3156) exactmove onto tiles off
  walkable land (`quest_regicide.rs2:462`), which leaves tree:tirannwn:1 unreached.
- travel: `tasks/travel.ts:23` keeps its own `GATE_STAND_TOLERANCE`; import it from `actions/gate.ts` (code-quality
  Q3, from the gnome-exit fix).
- travel itest "enters the Wilderness only with wilderness: true" can flake: its 10 HP save is attacked in the
  Wilderness and ends `interrupt:low-hp` (run itpt9hcvdl8e, 2026-10-22); give the fixture more HP or food.
- World index: `distance.ts` `nearestSinks` ignores sink use gates (`gates.ts` USE_GATES): `furnace:falador:0`'s nearest anvil is Doric's quest-locked `anvil:asgarnia:1`, priced with no requirement; method records name their step sites explicitly to avoid it.
- World index: random landings at their chance-weighted mean and teleports at their script ticks are applied to method legs only (`model/legs.ts`); `distance.ts` nearest-bank figures still use the worst-landing pricing (out of scope of phase 3b).
- World index: random-landing rows from sources other than npc-teleports carry no `chance` (equal weights); a leg needing two random rows falls back to the whole-graph price; coin requirements may count more than once across landings.
- World index: measured figures pending (seed from `stats.ts --methods`, or `--phases` where a prologue ran): `agility-gnome-course` and `earth-runecraft-aubury-essence` (prologue runs; `--phases`), `agility-barbarian-course` (no plan), `iron-se-varrock-smelt-lumbridge-kiteshield` (no usable run; one 0.03 h run at 99.8% of floor: recheck), `trees-lumbridge-burn` (no runs).
- willow-longbows: the floor cuts and strings each bow as it is chopped (26 logs a trip) where the plan carries 13 strings and chops 13 a trip; a plan lever.
- Levers, not model gaps: the Wilderness ridge gates (excluded from the `agility-wilderness-course` lap floor; the agility task crosses them each lap) and the runecraft landing (the floor takes the mean over the mine's landings, about 150 tiles from 22 squares; the plan mines whichever rock it finds).
- Phase 4 note: the Wilderness combat opt-in comes later, with Prayer (user decision).
- combat task (tick-perfect): the between-kill overhead at the hill giants is 16.4 ticks measured against 7.5
  modelled (Task 8 calibration, 72 kills over runs itbxt3d6mz3d, itjtbdy3yqle, itfdyu1jmi8j): the walk to the bones,
  the pickup and the bury run one after another, leftover bones are buried too, and the next attack comes 2-3 ticks
  after the decision. The world index calibrates the fight only; this is the task's to close.
- combat task: the low-HP eat double-sends. In run itfdyu1jmi8j/2026-10-23T02-38-12-489Z-combat the guard sent Eat at
  tick 501 and again at 502, inside the eat delay, so the server refused the second and the run ended "could not eat
  Lobster: Failed to use inventory item"; the same ended the first calibration's run 2, one outside the pooled three.
  Gate the second eat on the first's effect.
- combat: the `visible` target mode is uncommitted (in review) in the tree (combat.ts, combat.test.ts, combat.itest.ts);
  the Mordred/Monk itests failed in default mode when authored (unverified against HEAD): re-run them on HEAD before committing.
- Plans: promote `imp-catcher` camp variant only (the roaming ring plan in `conductor/runs/conductor3/plans/` stays a draft: ~19 kills/h).
- Runner token use (retro #3): after the 2026-10-23 prompt fixes runners cost 0.1-0.9 M cache reads (fishcook99 0.34 M, imp roaming
  0.92 M, resume 0.10 M) against 5-14 M for the three before (thieve-55 13.9 M, melee-20 9.1 M, crafting80 6.9 M). Fixed; the leak
  moved to review delegates (above).
