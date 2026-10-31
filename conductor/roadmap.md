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
Herblore 7-11 h (herbs only drop: no shop sells one), Runecraft ~5.6 h (earth, travel-bound), Prayer 3-6 h (bones only; retro #4), HP ~3 h of combat
after the quests. Every other skill is 0.3-2 h. Explore goals go to the long poles first: herb sources (chaos
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

**Account 2026-10-24 02:15 (retro #4):** total 940 (22.5% of max XP). Thieving/Cooking/Fishing 99, Mining 85, Smithing 82,
Crafting 80, Str 60, Herblore 57, Agility 52, HP 50, Prayer 49, Magic 44, Att 40, Def 40, Woodcutting 45 (oak runner in
flight), Ranged/Fletching/Firemaking/Runecraft 1. 10 QP (RG, RM, Imp, Druidic 4, Digsite 2, Knight's Sword 1). The bot holds a
**bronze pickaxe and a steel axe**; >= 25k coins banked; ~768 in the pack.

**Retro #4 finding: quest lumps beat grinding, and the queue ran grinds first.** At 25x the quest rewards are whole bands
(`wiki/quests/README.md` XP column; 99 = 998,458 XP). Crafting 1-80 cost 56 min of flax at 332k/h; the quests left would
have paid ~530k of the remaining 730k Crafting XP (Elemental Workshop 125k, Shilo 97k, Nature Spirit 75k, Fremennik 70k,
Observatory 56k, Shades 50k, Murder Mystery 35k, Dwarf Cannon 19k). The same holds for melee, so do the **quest sweep
before any more melee, Crafting or Herblore grinding**:
- Attack (16k now): Death Plateau 75k (1 QP, no fight), Vampire Slayer 120k (Count Draynor 34), Tree Gnome Village 286k
  (plan promoted; Khazard warlord 112), Fight Arena 304k (no plan; Khazard ogre 63, Bouncer 137), Waterfall 343k = 1.13M
  >= 99 with no Attack grind. Grand Tree 460k is spare (black demon 172).
- Strength (68k): Scorpion Catcher 165k (1 QP, no fights), Waterfall 343k, Dragon Slayer 466k = 1.04M >= 99.
- Defence (16k): Dragon Slayer 466k + Holy Grail 382k (Merlin first; both plans promoted) = 864k; Nature Spirit and
  Observatory top it to ~925k, a ~70k grind remains.
- Prayer (31k): Holy Grail 275k + Priest in Peril 35k -> ~340k (level ~79); the remaining ~650k is bones.
- Ranged/Fletching: Big Chompy Bird Hunting (Ranged 18k -> 42, which Temple of Ikov's "Ranged 40 base" needs), then Temple of
  Ikov (Ranged 262k -> 79, Fletching 200k -> 75; plan in progress), Tourist Trap (Fletching 232k -> 77, mid Smithing 20,
  Fletching 10); Fremennik Trials 70k each to 60 in WC, Fletching, Agility, Fishing, HP (mid WC 40, Fletching 25).
- Woodcutting: Monk's Friend 50k (1 QP, no fight), Fremennik 70k. Magic: Watchtower 382k -> 85 (mid Agility 25, Magic 14,
  Mining 40, Herblore 14; Gorad 68). Mining: Plague City 60k (plan in progress), Doric 32k. Herblore: Death Plateau ->
  Troll Stronghold (Dad 101, Troll General 113) -> **Eadgar's Ruse 275k** (needs Herblore 31, has it; no fight of its own),
  Jungle Potion 19k, Shades 50k. Agility: Grand Tree 197k -> 75, Regicide 343k (needs Underground Pass, Biohazard).
- QP: 10 now; Waterfall 1, TGV 2, PiP 1, Merlin 6, Grail 2, Elemental Workshop 1, Romeo 5, Goblin 5, Ernest 4, Cook 1 = 38
  >= 32, so Dragon Slayer opens with the quests the sweep does anyway.
- HP is the melee pole the quests do not touch (HP 33k; HP gets 1/3 of one style's XP per hit: 965k HP XP needs ~2.9M
  combat XP; Witch's House 158k, Nature Spirit 50k, Fremennik 70k help). After the sweep, one long combat grind at the
  best bones+herbs site (baby blue dragons or hill giants, chaos druids) finishes HP, Prayer and the Defence remainder,
  with the style set to whichever of Att/Str/Def is still short.
- Prayer is longer than "~3 h": the Prayer training page rates bones at 109k/h (hill giants) to 206k/h (baby blue dragons)
  at 99, so ~650k left is 3-6 h even after Grail; the Max route row below said ~3 h after melee. Treat it as the long pole
  with Runecraft and HP, and start the dusty-key/baby-blue work early.

**Account 2026-10-24 04:00 (retro #5):** total 1097 (28.6% of max XP). Thieving/Cooking/Fishing 99, Str 87, Smithing 87,
Mining 86, Crafting 85, Attack 84, Woodcutting 68, Herblore 57, HP 57, Agility 52, Prayer 49, Magic 44, Defence 40;
Ranged/Fletching/Firemaking/Runecraft 1. QP 12. Adamant pickaxe and axe held; ~8.7k coins (the waterfall armour and the
adamant tools spent the rest). Merlin's Crystal + Holy Grail in flight on a runner (merlins-crystal run 3 SIGTERMed by host
memory at beggar-door; restarting).

**Retro #5 finding: lumps pay 5-10x the grind per bot-minute, but the chain is bound by pack items, coins and plan bugs.**
Measured since retro #4: Waterfall 27 min = +711k Att/Str; Elemental Workshop 86 s of quest + ~25 min of prep and six
plan runs = +125k Crafting +126k Smithing; Digsite/Knight's Sword/Druidic ~59 min = Mining 1-85, Smithing 20-82. Against
that, WC oaks with the adamant axe is ~1.1M/h and WC 68-99 (881k) is ~0.8 h with no prep, so the grind is the right
filler when a quest waits on a pack item or coins. The prep and plan debugging, not the quest, is the cost: a runner that
adapts a promoted plan spends ~10 M cache reads (grail-chain, 175 turns, 45 min).

**Queue now (retro #5), in order.**
1. ~~Finish Merlin + Holy Grail~~ done 2026-10-24 (Defence 40 -> 85, Prayer 49 -> 81).
2. ~~Coins goal~~ done 2026-10-24: bank + pack >= 60k in 32 min (knight-thieve-bankfood with `until` on `v.bank('Coins') + v.inv('Coins')`, a one-line copy; pack +11,126). **Coins goal: Knights of Ardougne thieving to 60k gp** (plan knight-thieve-bankfood, ~1,160 gp/min, so ~45 min after the
   walk). Needed for: the rune sword (20.8k), Dragon Slayer costs, Plague City / Observatory pack items, Fremennik. One runner,
   milestone "60k banked", not a level. Do it before Dragon Slayer, and batch the Kandarin errands (Monk's Friend starts E
   Ardougne; Plague City; Observatory's dome is Kandarin) while at Ardougne.
3. ~~32-QP set~~ done 2026-10-31 (conductor3, one runner, QP 20 -> ~41): Monk's Friend 272 s, TGV 206 + 319 s (Attack +303k), Ernest 144 s (swordfish markers), Vampire Slayer ~8 min incl. Morgan/manor walker dead ends, Goblin Diplomacy 1,874 s (1,441 s of it the goblin-mail drop grind), Cook's ~5 min, Romeo ~5 min, Priest in Peril 505 s (Prayer +35k); the cost was walker dead ends after quests (Draynor Manor, Morgan, crypt; Spirit tree loop fixed b4d25b0b9) and one host-memory SIGTERM. **32-QP set** (QP 12 + Merlin 6 + Grail 2 = 20; Romeo 5, Goblin 5, Ernest 4, Cook 1 = 35; all promoted, cheap, no
   combat): one runner, four plans in a row. Add Monk's Friend (319 s, E Ardougne, bronze axe + 500 gp, Woodcutting 50k) and
   Vampire Slayer (312 s, Draynor, 10 swordfish + 200 gp; Attack 120k) in the same runner.
4. Dragon Slayer (plan promoted; needs 32 QP, ~466k Str/Def; expect a boat and anti-dragon prep: snapshot first).
5. **Woodcutting 68-99** on conductor3 with `oak-draynor-drop` north oaks (raise `until` to level:99 or a variant plan),
   ~0.8 h at ~1.1M/h, one runner, no prep: use it as the filler whenever 2-4 are blocked. Then Firemaking/Fletching from level 1
   alongside (willows).
6. Pack-item quests, after a prep plan: **Plague City** (bucket of milk, chocolate dust, snape grass in the pack; not
   Biohazard first; Mining 60k) and **Observatory** (3 planks, bronze bar, molten glass; Crafting 85 makes the glass; 56k
   Crafting). The `lib:observatory-start` save shows the pack. Jungle-potion (Herblore 19k), Tree Gnome Village, Priest in Peril,
   Death Plateau (blocked in review), Fight Arena/Nature Spirit/Dwarf Cannon (peer authoring) follow.
7. Then Mining 86-99 / Smithing 87-99 superheat, Crafting remainder, Ranged/Fletching quests (Big Chompy -> Ikov), and the long
   combat grind (HP, Prayer, Runecraft long poles).
Before each run, check the plan's `until`/`when` gates and the combat floor.

**Account 2026-10-31 07:32 (retro #6):** total 1207 (35.9% of max XP). Thieving/Cooking/Fishing 99, Attack 95, Strength 91,
Smithing 87, Mining 86, Defence 85, Crafting 85, Prayer 83, Woodcutting 73, HP 67, Herblore 57, Agility 53, Magic 44;
Ranged/Fletching/Firemaking/Runecraft 1. QP ~41. Adamant axe and pickaxe, 24,855 coins in the pack (the bank held only ~13k, not the 48k the state recorded). Dragon Slayer is
on a runner (Lost City stretch). Left to 99: Herblore 942k, Agility 957k, Magic 977k, HP 890k, Woodcutting 827k, Prayer 657k,
Defence 600k, Crafting 600k, Mining 572k, Smithing 549k, Strength 405k, Attack 198k, and 998k each in the four level-1 skills.

**Where the qp32-set wall time went (retro #6, runner agent-a8ed683cf81dc5772, 05:22-07:32 = 130 min, journal `qp32-set`).**
Quest plan runs that finished: ~50 min (Monk's 4.5, TGV 9, Ernest ~8, Vampire 5, Cook's 5, Romeo 5, PiP 8, plus Goblin's
non-grind 7). The rest:
- **Spirit tree loop 05:39-06:04, ~25 min (19%)**: `ernest-lawrune` phase `veronica` bounced between the maze railing and
  `stronghold_ent` (2543,3168) for 18 min, SIGTERMed by the runner at 05:57 after the user's message (runner turn 108: "Waiting
  for Ernest to finish." was its last look at 05:42; 14 min with no check), then ~7 min of escape `travel` legs (one wrong param,
  `area` for `to`, journal 05:57:20) and a second Ernest start killed after 2 min.
- **Goblin mail grind 24 min (18%)**: see Drops below.
- **Walker dead ends after quests ~6 min of hand `interact` calls**: Draynor Manor top floor / Morgan's house (journal 06:12-06:15, four
  failed interacts and two failed Vampire runs), vampire crypt (06:20-06:21, `No connector from level 0 (3077, 9774)`), fixed in the
  walker b4d25b0b9 and `learnings/draynor-manor.md`.
- **Priest in Peril reap 07:04-07:22 (18 min run, killed)**: the harness reaped the background shell ("stopped because the system
  is running low on memory", runner turn 290), not a `kill`; the rerun at 07:23 resumed and finished in 8 min.
- Prep: qp-prep 3 min (logs for TGV, its bronze axe), pip-prep 21 s (Pot, pickaxe). Small.
So ~54 of 130 min (42%) was the loop, the grind, dead ends and the reap; the quests themselves were 40%. The loop was the one
avoidable cost with a cheap detector (below).

**Retro #6 findings that change the order.**
1. **Melee deficits are now small, and combat feeds HP and Prayer which no quest does.** Left: Attack 198k, Strength 405k, Defence
   600k = 1.2M style XP, against HP 890k (needs ~2.7M combat XP at 1/3 per hit, so ~1.5M more than the deficits yield) and Prayer
   657k (bones). The training pages rate baby blue dragons at Taverley 1.38M/h Attack, 1.37M Strength, 456k HP, 206k Prayer at 99
   (HP ~320-370k/h at 70-80); moss giants Kandarin 1.6M/h melee but 101k/h Prayer. So retro #4's "lumps before grinding" stops
   paying after Dragon Slayer (932k Str+Def, a 75-min budget with prep, against ~1 h of grind that also gives HP and Prayer).
   After Dragon Slayer, skip Fight Arena (Bouncer 137, Att 304k for a 198k need) and Grand Tree's black demon; the one combat
   site is **baby blue dragons (dusty key) for Att/Def tail + HP 67 -> 99 + Prayer 83 -> 99, ~3.5-4 h, Prayer binding**. Dragon
   Slayer's anti-dragon shield is for exactly that site. This is the biggest block of remaining hours.
2. **The four level-1 skills and Herblore have the quest lumps left**: Ranged/Fletching (Big Chompy or Ranged 1 -> 40 by hand, then Temple
   of Ikov 262k Ranged + 200k Fletching; Tourist Trap 232k Fletching if the pick is Fletching, needs Fletching 10 mid), Herblore
   (Death Plateau -> Troll Stronghold -> Eadgar's Ruse 275k; Jungle Potion 19k), Agility (Grand Tree 197k, Tourist Trap pick 116k),
   Magic (Watchtower 382k), Crafting (Observatory 56k, Nature Spirit 75k, Dwarf Cannon 19k), Mining (Plague City 60k).
3. **Runecraft is the one long pole with no run yet** (floor 5.6 h; plans `earth-runecraft` and `earth-runecraft-28` exist): put a
   measured run in the next idle slot, and Firemaking from level 1 beside Woodcutting.

**Queue (retro #6), in order.**
1. ~~Dragon Slayer~~ done 2026-10-31 (conductor3): Strength 91 -> 99, Defence 85 -> 96 (+529k / +466k in the final run's RESULT), total 1229 (40.7%). Cost: ~15 min of prep (ds-prep: silk, Barbarian Outpost planks, clay bowl, Dwarven Mine iron+coal, Falador steel, nails, pot, mind bomb), one death in the lair (the `elvarg` phase named a Rune scimitar; save rolled back, fixed 30a5d3535, run-end epilogue b24c5f09d), a Maze drift fix (96e923f16), final run 1,091 s. Lost City stretch not reached (budget).
2. **Woodcutting 73 -> 99 filler** (`oak-draynor-drop` north oaks, `until` level:99, ~0.75 h, no prep) with willows + Firemaking 1-30
   beside it if a variant plan exists; also the slot to run Runecraft 1 -> 28 once (`earth-runecraft-28`, measure).
3. ~~**Dusty key then baby blue dragons**~~ key held and grind measured 2026-10-31 (retro #7); (new objective; Prayer 83 -> 99, HP, Attack tail): jailer kill at (2933,9693), Velrak's
   cell, Taverley dungeon site `baby-blue-dragons-taverley`; combat plan with bone burying and the anti-dragon shield. One runner,
   milestone "dusty key held", then "HP 80 + Prayer 90".
4. **Ranged/Fletching/Herblore/Agility quest batch** (one runner, plans on main): Death Plateau (Att 75k, 1 QP) -> Troll Stronghold
   (Dad 101, down to 20 HP) -> Eadgar's Ruse; Tourist Trap with the pick set to Fletching (proven 748 s; save
   `tourist-trap-start` holds Fletching 10 feathers); Temple of Ikov after Ranged 40 (Ranged 1 -> 40 on chickens or cows with a
   shortbow, ~10 min); Grand Tree (Agility 197k; black demon 172 fight, do it after the dragon grind raises HP); Plague City (60k
   Mining, bucket of milk, chocolate dust, snape grass), Biohazard (1,241 s, Thieving 31k; prerequisite of Underground Pass),
   Nature Spirit (needs PiP stage 61 done), Observatory.
5. Mining 86-99 and Smithing 87-99 (superheat), Crafting remainder, Magic (Watchtower 382k), then Herblore from chaos druids.
Each batch runner gets a prep line in its brief (below) and a stop rule for loops.

**Account 2026-10-31 11:37 (retro #7):** total 1272 (46.5% of max XP). Thieving/Strength/Cooking/Fishing 99, Woodcutting 97, Defence 96,
Attack 96, Smithing 87, Mining 87, Crafting 85, Prayer 85, HP 85, Herblore 57, Agility 53, Magic 44; Ranged/Fletching/Firemaking/
Runecraft 1. Left: Prayer 601k, HP 614k, Herblore 942k, Agility 957k, Magic 977k, Mining 552k, Smithing 541k, Crafting 600k, Defence 134k,
Attack 142k, Woodcutting 93k, and 998k each in the four level-1 skills. Dragon Slayer done (Dragonfire shield, Excalibur worn); the
Dusty key is held; the dragon runner is on Attack then Defence to 99 with Prayer 90 as the stop.

**Retro #7 findings (55 runs, 07:36-11:37; two runners, 11 task-author dispatches, 29 lens reviewers).**
1. **Dragon Slayer cost 118 min of runner time against the plan's 1,022 s** (runner a659fcf30428c9f13, 07:33-09:31): ds-prep 4 runs
   (planks looked up at a wiki spawn that is an NPC, `wiki/items/plank.md`; Razmire's shop closed), 6 failed quest-plan runs (klarense
   gate read the coin count, 24.8k held against "exactly 12000"; maze-red-door), then the death. The plan was "proven" from `lib:dragon-slayer-start`
   and carried that pack's assumptions into the real account: `weapon: 'Rune scimitar'` on the `elvarg` phase (since 2fe631eab) failed
   preflight ("Rune scimitar is neither worn nor in the inventory"), the plan ended `no phase applies` in the lair mid-fight, HP 47/68,
   and the bot died with nothing running. Fixed: weapon dropped (30a5d3535), `needs` start check, run-end epilogue (b24c5f09d). A
   restore of `dragon-slayer-start` plus ~25 min of redo prep was the price.
2. **The Dusty-key stretch was 38 journal runs for one objective** (dragons-prayer): 18 plan runs (14 failed, 2 SIGTERM), 8 `travel`, 8
   `interact`, 4 other one-offs. Ten of the plan failures were one cause, **the bot started on Crandor**: the Dragon Slayer plan ends in
   the lair, the walker has no connector off the island (`No connector from level 0 (2846, 9636) to (2932, 9700)` x8, 09:35-09:42).
   The runner spent 8 min reading quest scripts, found the volcano secret door and the Musa Point ferry, and hand-walked it
   (promoted as `karamja-home`, 5e8d86693). The second cause was the gate at (2924,9803) (`deepdungeondoor`, takes the Dusty key): the walker
   called it locked, Lesser demons (82) camp it and break the by-hand `interact` ("in combat at (2924,9802)"), and the bones are
   `Babydragon bones`, which `buryBones` did not know. The runner found the gate by reading the loc config and the nearby-object list (turns
   247-266), stopped at 55 of 90 min with a DECISION NEEDED, and 0643ee05b fixed both. **Fix upstream: the Dragon Slayer plan should end
   off Crandor** (rope, secret door, `karamja-home`) so the next objective starts at Port Sarim.
3. **Strength was trained at 99 for 48 minutes (+660k Strength XP: 321.8k in the 09:51 run, 322.3k in the 11:09 run).** The conductor's
   brief listed "Strength 99" in the stat line and asked the runner to report "the melee skill trained", but never named the style;
   the runner's plan (turn 238, copied from the giants plans) hard-codes `skill: 'Strength'` (combat's own default is Attack). The conductor
   caught it from the RESULT at 11:35, 25 min after the second run began. Combat has no maxed-skill check.
4. **Host memory SIGTERM at 11:08** killed the 3-min baby-blues run, bot left mid-fight at 67/79 HP: another session's `bun test conductor wiki`
   (pid 2636834, ~10.4 GB). Our own footprint is steady: each `run-task.ts` is 575-625 MB RSS and the 4-6 concurrent worker runs
   (3.5 GB) plus `bun wiki/world/build.ts` (4.2 GB seen at retro time) are the baseline the host reaps against. SIGTERM skips the epilogue (below).
5. **Epilogue gaps.** `needsEpilogue` is `status !== 'done'` and the signal handler prints the RESULT and exits in 6 s, so two bot-in-combat
   states had no guard: the SIGTERM at 11:08 (0 epilogue lines in `2026-10-31T11-05-14-443Z-plan-baby-blues-prayer.ndjson`) and the `done: reached 25 min`
   at 11:34 (the bot was idle in combat 66 s until the runner relaunched). Both were short only because a runner was awake.
6. **A fail message read wrong:** `fight: Baby blue dragon is level 48, above limit 5` (10:14) is the food-out cap (`NO_FOOD_MAX_NPC_LEVEL`,
   `combat.ts:276`), not a level problem; the runner took 30 s to see it. The plan had no restock trigger before the last food.

**Queue (retro #7), in order.**
1. **Dragons, now**: Prayer 90 stop kept, melee `skill` Attack then Defence to 99 (HP and Prayer ride along); one runner, milestone "Attack 99 + Defence 99
   + Prayer 90", food from Falador West. Then Prayer 99 (~4 h) as the long pole: dispatch it in 90-min runner goals and use the waits for
   the quest batch on workers, not the conductor's bot.
2. **Plan guards (task-author, one batch, Backlog below)**: combat refuses a maxed `skill`; plans check `weapon` against held items at start;
   epilogue for SIGTERM and for a `done` run that ends in combat; clearer food-out message.
3. Woodcutting 97 -> 99 (93k, ~6 min) as a filler when any run waits.
4. Quest batch (Death Plateau -> Troll Stronghold -> Eadgar's Ruse; Tourist Trap; Big Chompy -> Temple of Ikov; Grand Tree now that HP is 85) and Runecraft 1 -> 28
   once, per the retro #6 queue below; peers have landed plans and saves for Troll Stronghold, Tribal Totem, Sea Slug, Scorpion Catcher, Big Chompy.
5. Mining/Smithing 87 -> 99, Crafting remainder, Magic (Watchtower), Herblore: unchanged.

**Adamant axe pays back; the rune pickaxe does not.** Rate model (`methodRate` with the tool forced), WC oaks at Draynor,
dropped: steel -> adamant is 672k -> 1.00M/h at WC 15, 847k -> 1.25M at 30, 1.07M -> 1.57M at 50, 1.27M -> 1.88M at 70
(+50%); rune adds 6-17% more. Willows banked at Draynor: 739k -> 1.09M at 30. Willow burn (FM pair): 625k -> 857k at 30. An
adamant axe needs Smithing 71 (have 82), one adamantite bar (Smithing 70: one ore + 6 coal), Attack 31 to wield (have 40) and
no Woodcutting level (`woodcut.rs2:197`). Adamantite is at the Dwarven Mine (3044,9773), 3 rocks, 43 ticks from Falador East
bank, ~9% per attempt at Mining 85 (~20 s an ore, 800-tick respawn); coal is in the same mine. About 6 min of trip against
~20 min saved on oaks and 10+ min on the FM/Fletch willow pairs (the oak runner already at WC 45 would still save
~15 min). A **rune axe** (Smithing 86, runite ore; wield needs Attack 41) adds under 10%: skip. Pickaxes are not smithable;
rune over adamant is +4.6% on iron (1.026M -> 1.073M, respawn-bound): 32k gp never repays. Estimates are model floors; the
bot measures 55-85% of them.

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
| Herblore | nothing: identify and brew check only members + level (worker conductor3w5, 2026-10-23); Druidic Ritual only for its XP lump | done (conductor3 2026-10-24: Druidic Ritual Herblore 1 -> 28 in ~9 min, plan druidic-ritual with its bank-food phase) | `wiki/quests/druidic-ritual.md` |
| Prayer 47 | Restless Ghost (plan restless-ghost, ~5 min) | done (conductor3 2026-10-23: Prayer 20 -> 49, 359 s) | `wiki/quests/` |
| Magic 44 (superheat) | Imp Catcher (four bead drops from imps) | done (conductor3 2026-10-23 23:50: Magic 1 -> 44, Strength 42 -> 54; best plan = r55 camp at the Falador-south spawn cluster, ~85 kills/h) | `wiki/quests/` |
| Attack + Strength 83 | Waterfall Quest (no skill requirements; rope, runes) | done (conductor3 2026-10-24: plan waterfall-armour, 27.1 min one run, no deaths: Attack 40 -> 84 (+343,750), Strength 62 -> 87 (+367,550 incl. dungeon fights) at Defence 40 in bought mithril body/legs + adamant helm (11.3k gp), 20 swordfish, 3 eaten) | `wiki/quests/` |
| Defence 85 + Prayer 80 | Holy Grail (Merlin's Crystal first) | done (conductor3 2026-10-24: Merlin's Crystal 6 QP, final run 237 s; Holy Grail final run 282 s, Defence 40 -> 85 (+382,500), Prayer 49 -> 81 (+275,000), both in the RESULT; ~80 min of play for EW + Merlin + Grail incl. prep and debugging; plan bug: `holy-grail` uses coins (290-300 start) as its trip marker and loops ships with more) | `wiki/quests/` |
| Baby blue dragons (Prayer 60-99) | dusty key: kill the jailer (combat 47, 2933,9693, always drops the jail key, `jailer.rs2:10`), open Velrak's cell, and he gives it; aggressive black knights nearby | later | - |
| Anti-dragon shield | Dragon Slayer started: the Guildmaster inside the Champions' Guild, whose door needs 32 QP (`champions_guild.rs2:2`; Oziach has no QP check) | done (conductor3 2026-10-31: Dragonfire shield worn after Dragon Slayer) | - |
| 32 QP (rune sword, Dragon Slayer) | route quests (RG, RM, Imp, Waterfall, PiP, Druidic, Merlin, Grail) = 17 QP, plus Romeo & Juliet 5, Goblin Diplomacy 5, Ernest the Chicken 4, Cook's Assistant 1 = 32 exactly (no skill checks, goblins L2-5 only); spares Sheep Shearer, Doric's Quest. Plans being built in quest-library | done (conductor3 2026-10-31: QP ~41 after the qp32-set runner) | `wiki/quests/README.md` |
| Quest sweep for XP lumps (retro #4) | `wiki/quests/README.md` XP column: Att 1.13M, Str 1.04M, Def ~925k, Prayer 340k, Crafting ~530k, Ranged/Fletching 262k/432k, Magic 382k, Herblore 275k+ from quests alone (list in Now) | todo; promoted plans: Tree Gnome Village, Elemental Workshop, Merlin, Grail, PiP, Romeo, Goblin, Ernest, Cook; peer: Waterfall, Dragon Slayer, Ikov, Fremennik, Plague City, Grand Tree | `wiki/quests/README.md` |
| Smithing 1 -> 82 | The Knight's Sword (plan `knights-sword` proven on questw4, 761 s, committed fa7187248; a combat-55 start died at the blurite fight, so melee ~40+ and food first): Mining 10 only (blurite, `mining.rs2:58`); reward Smithing 318,125 (`quest_squire.rs2:223`); redberry pie, 2 iron bars, pickaxe; ice warriors (L57) near the blurite route. Mine to 10 just before it, do it before any Smithing training | done (conductor3 2026-10-24: plan ks-prep ~10 min from Smithing 1 (Rimmington ores, bronze to Smithing 20, Wydin flour + redberries, pie dish fired at Barbarian Village), then knights-sword 706 s; ice-dungeon fight at combat ~60 with swordfish not lethal, flee-to-ladder fired once) | `wiki/quests/README.md` |
| Mining 1 -> 85, Herblore 28 -> 57 | Digsite (members): Thieving 25, Agility 10, Herblore 10, checked mid-quest and boostable; reward Mining 382,500 + Herblore 50,000 (`quest_itexam.rs2:41-42`), no fights. So Druidic Ritual first; do it before any Mining training past 10 | done (conductor3 2026-10-24: plan digsite ~20.7 min in two runs; Mining 1 -> 85, Herblore 28 -> 57; the `grind` phase's combine misreports "Nothing interesting happens" though the charcoal is ground, so the first run failed and a rerun resumed) | `wiki/quests/README.md` |
| Ranged 79, Fletching 75 | Temple of Ikov | todo, from scripts | `wiki/quests/README.md` |
| Morytania, Nature Spirit | Priest in Peril stage 61: one more talk to Drezel after completion (`holy_barrier.rs2`); the PiP plan includes it | done (conductor3 2026-10-31: PiP 505 s, ends on the Morytania side (3423,3485)) | `wiki/quests/README.md` |

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
- **Waterfall dungeon connectors (retro #5, world/ops)**: three runs failed `No connector from level 0 (2603, 9912) to
  (2946, 3369)` / `(2566, 9901) to (2604, 9901)` / `No path to (2575, 9861) from (2511, 3463): no waypoints`
  (journal 03:15:40-03:18:09). The chalice room has regions in `lib/connectors.ts` (`waterfall-chalice`) but no exit: the
  runner worked around it with its own `grail-exit-prep` plan (Door (2604,9900) teleports to (2566,9901); a key on Door
  (2568,9893) from the north). Task-author: add the chalice-room exit and the dungeon <-> Glarial's tomb ladder to
  `lib/connectors.ts` (or a travel gate), so no plan needs a hand-walked exit; same class as the Wizards' Tower connectors.
- **Walker says unreachable for a wandering quest NPC (retro #5)**: `talk` ends `no reachable /^Sir Gawain$/ in sight (1 in view but
  unreachable from here)` twice (03:41, 03:42): Gawain wanders into a garden behind Door (2766,3504). Runner fixed it with a
  `gawain-door` phase; a task-author fix is for `talk`/`interact` to open the one closed door on the path to an NPC the walker flags
  unreachable. A peer session is on NPC wandering in the world index: leave the modelling to it.
- **Plan bugs, not game bugs (retro #5)**: the elemental-workshop plan took six runs on conductor3 (`nothing left to do`, `drop-sword`,
  `drop-gem` no progress, `Eat on Swordfish no effect`, `no reachable Crate at (2724,9894)` because it is `Boxes`), then 86 s;
  the promoted plan carries the fixes (7e38bc393). Brief rule: a promoted plan's foods, tools and loc names come from the state
  notes; the conductor's brief for a chain names the food the bot holds (Swordfish) so a runner does not sed it in per plan.
- **Host memory SIGTERMs (retro #5)**: three runs killed at 03:25 and 03:56 (oak worker, EW, merlins-crystal 13 min in) while another
  session's `bun test wiki/world` held ~12 GB. Not a task fault. Fix is outside the bot: the peer worktrees run heavy tests with
  `ulimit -v` or `systemd-run -p MemoryMax=8G`, and the conductor skill checks `free -g` before dispatching a long run.
- **Jail-guard interrupts (done, retro #5)**: three adamant-tools runs failed `under-attack` (02:35-02:41) at the Draynor oak cluster;
  fixed by the north oaks area (552bf14cb) and measured 1.1M/h with no attacks. Closed.
- **White Wolf Mountain crossing (idea)**: every overland walk Asgarnia <-> Kandarin crosses it, and the wolves
  (cowardly, huntrange 2) hunt players up to combat 50 (lvl 25) and 76 (lvl 38). An `avoid` zone can't help with no
  other overland path; the options are combat 51+ (then only the lvl 38s), plenty of food with `travel` flee:true and
  minFood, or the boats (Port Sarim -> Karamja -> Brimhaven -> Ardougne, 30 gp each, unverified for bots). Batch the
  Kandarin goals (knights, gnome agility, Catherby fishing, Seers flax and longbows, moss giants (2549,3408)) so the
  account crosses once each way.
- **Net-progress watchdog (retro #6, task-author / engine)**: the watchdog (`engine.ts` ~172, `DEFAULT_STUCK_AFTER_MS`) counts any change
  in XP, position, inventory or HP as progress, so a walker bouncing between two tiles (the `stronghold_ent` loop: 13 walk steps,
  18 min, journal 05:39-05:57, `walk: no-move: loc-op 1 stronghold_ent ... planning without it` repeated) never trips it, and the
  user noticed, not a log. Add a displacement check: `stuck` when, over N minutes (4-5), the bot stays within a few tiles of where
  it was, with no XP, inventory-count, quest-tab or phase change; plus a walk rule: the same loc-op logged `no-move` twice in one
  walk fails the walk `no-progress` naming the loc. The runner brief also needs a check cadence for long plans (one look every
  5-8 minutes at the log tail and position, stopping a run whose position is unchanged), because the runner waited 14 min blind.
- **Plan start check for held items (retro #6, task-author)**: the plans' header comment says "Needs: a Pot, a pickaxe, 2+ coins"
  (priest-in-peril.ts:12) and `requires` can only hold throughout, so a consumed prep item cannot be listed. Three misses in the
  qp32-set alone: TGV needs 6 logs held (no gather phase), PiP's Pot and pickaxe not fetched (pip-prep, runner turn 281), Holy
  Grail's coin marker (retro #5); Dragon Slayer's brief had to list the pack by hand. Add `needs: { 'Pot': 1, 'Coins': 2 }` to
  `definePlan` (start-only; the run fails at load with `plan needs 1 Pot` before moving) and print it in `--list`; wiki/quests pages
  already carry the item lists. Cheaper than a prep plan per quest for the runner to discover.
- **Harness memory reap (retro #6)**: Claude Code stops idle background shells at critically low memory (the task notification names
  `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`); it killed `priest-in-peril` at 18 min and the instruction is "do not restart on your
  own". Start plan runs with `setsid -f` like `up.sh` (the up-sh-detach memory) so the reap cannot take the run, and let runners resume
  once after SIGTERM when `free -g` allows (already in the Dragon Slayer brief).
- **Stale plan header (retro #6)**: `conductor/plans/dragon-slayer.ts` still carries "KNOWN GAP (DECISION NEEDED): ... Gangplank" although
  the quest page says 8c1819d62 fixed it and the plan was proven through the sail; delete the paragraph.
- **Generated Goblin drop page merges two tables (retro #6, wiki/world generator)**: `wiki/npcs/goblin.md` lists one drop table (Goblin mail
  5/128) for five variants, but `goblin_greenarmour` / `goblin_redarmour` (Goblin Village) use `goblin_village_drop_table` with mail
  at 10/128 (`server/content/scripts/drop tables/scripts/goblin.rs2`, 96..105 of 128). Fix in the page generator so the two tables show
  separately; the quests README already says "10/128 in Goblin Village".
- **Combat refuses a maxed style (retro #7, task-author)**: `combat` with `skill: 'Strength'` ran 48 min at Strength 99 and threw away ~660k XP
  (`baby-blues-prayer`, runs 09:51 and 11:09; the plan was a runner's copy of the giants plans, the brief named no style). Preflight:
  when `skill` is Attack/Strength/Defence/Ranged and the level (`levelForXp(xp)` from `conductor/lib/xp.ts`) is 99, fail `Strength is 99: train
  Attack or Defence (allowMaxed: true to override)`; the plan loader warns the same for a phase literal. Brief rule (conductor): a combat goal names the
  style and its cut-over (Attack until 99, then Defence).
- **Plans check their weapons at start (retro #7, task-author)**: `needs` is hand-written, so DS's `weapon: 'Rune scimitar'` was never listed
  (`needs` landed in 30a5d3535 after the death). At load, derive `needs` from every combat phase's `weapon`/`shield`/`ammo` (pack plus worn) minus
  those a prior phase buys or takes, and fail before the first phase. Also: a combat preflight failure in a fight already under way (`inCombat`)
  should fall back to the worn weapon rather than end the plan; `plans/` grep shows the same hard-coded-weapon pattern in giants-att-def, hill-giants (Mithril scimitar)
  and temple-of-ikov (Yew shortbow).
- **Epilogue covers signals and combat-ending done runs (retro #7, task-author, `run-task.ts` ~182-190)**: the signal handler prints the RESULT and exits
  after 6 s with no epilogue; give a first SIGTERM/SIGHUP the epilogue (cap 20 s, second signal exits) and run it for `done` results whose final state is
  `inCombat` with HP under 60%. Evidence: 11:08 reap (bot left at 67/79, 0 epilogue lines), 11:34 `done: reached 25 min` idle in combat 66 s. A harness
  reap may SIGKILL: also start plan runs detached (`setsid -f`, up-sh-detach) so a reaped shell does not take them (already a retro #6 item, still open).
- **Dragon Slayer plan ends on Crandor (retro #7, task-author)**: add a `leave-crandor` tail (rope (2833,9657), the secret door to the Karamja volcano,
  `karamja-home`) so the account ends at Port Sarim; today the next objective's first 10 plan runs fail `No connector` from the island.
- **Out-of-food message (retro #7, task-author)**: `chooseTarget` reports `${npc} is level 48, above limit 5` when the cap is `NO_FOOD_MAX_NPC_LEVEL`;
  say `out of food (level cap 5 without food)`. Plans with a bank trip should restock at `foodN < 4 && bones === 0` AND at `foodN <= 1` mid-fight.
- **`world.json`/`methods.ts` calibration for `baby-blue-dragons-taverley` (knowledge, wiki/world)**: add a CALIBRATIONS record from the 25.3-min run (8 Swordfish,
  61 kills, 112k Prayer/h) so the page stops saying "unmeasured and uncalibrated"; the 206k/h floor is 1.8x the measurement.
- **Memory (retro #7)**: `bun test conductor wiki` reached 10.4 GB (pid 2636834, another session) and reaped the dragon run; the quest-library
  brief now says one test file at a time. For our side: a `run-task.ts` is ~600 MB RSS (six concurrent = 3.6 GB) and `bun wiki/world/build.ts` 4.2 GB;
  profile what run-task loads (the world index JSON?) and lazy-load it, and add `free -g` + available >= 6 GB to the conductor skill's dispatch check.
- **zsh flag variable (retro #7, agent prompt)**: runner turn 116 passed `$J` (journal flags) and zsh did not split it: `unknown flag --objective dragons-prayer --journal ...`.
  Add to `.claude/agents/task-runner.md`: write `--objective X --journal PATH` out in full, never through a shell variable.
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
| Woodcutting | 68 | normal trees 1-15 -> oaks Draynor dropped 15-99 (672k-1.59M, steel axe); willows only beat oaks with an adamant (88+) or rune (69+) axe, which only Smithing 71/86 or drops give | 0.72 | plan `oak-draynor-drop` (steel axe, Draynor cluster, area (3112,3240) r16): 1-50 in 328 s; oaks phase 15-50 +30.9k in 143.6 s = ~775k/h, no idle waits; whole run 360k/h incl. the axe walk (conductor3 2026-10-24); **adamant axe** (smithed: Dwarven Mine ore + coal, Falador furnace, Dwarven Mine anvil): oaks WC 51-68 +81.6k in 270 s = ~1.09M/h, ~40% over steel; three runs there were stopped by the jail guards hitting through the fence; the plan moved to the north oaks `tree:draynor-village:1` area (3095,3283) r16 (552bf14cb): conductor3w1 WC 68-74 +67.5k in 247 s, ~1.1M/h chopping, no attacks | **WC 73 -> 97 on conductor3 (draft plan `wc-oaks-99`, north Draynor oaks, adamant axe, logs dropped, 2026-10-31): ~900k/h at 73-97** (15.6k XP/min seen at WC 77; the run's own RESULT is +727,500 in 35 min = 1.25M/h average incl. the axe fetch, so the rate climbs with level and the 900k/h is the conservative figure); stopped at 97 for the dragons. 93k left to 99 (~6 min): finish as a filler when the bot waits on anything; Monk's Friend 50k + Fremennik 70k |
| Firemaking | 1 | trees-lumbridge-burn 1-30, willow-draynor-burn 30-99 (with WC) | 0.56 with WC | - | |
| Fletching | 1 | cut + string at a bank 1-40, willow-seers-longbow-bank 40-99 (474 strings from flax) | 0.54 with WC | - | |
| Mining | 85 | copper/tin 1-15 -> iron from a 3-rock stand tile, Al Kharid, dropped 15-99 (679k-1.07M, respawn-bound from 57); adamant pickaxe only (3.2k, rune doesn't pay back) | 0.98 | Digsite 1 -> 85 (382.5k quest lump, ~20.7 min incl. the quest) | adamant pickaxe bought (2026-10-24); 85-99: best floors now `iron-se-varrock-drop` 1.43M at 85, then `coal-mining-guild-drop` 1.16-1.30M (8e35c441e; mithril/adamantite are respawn-bound, 215k/77k); Plague City 60k and Doric 32k are quest lumps |
| Smithing | 87 | bronze then iron 1-33 -> superheat iron platebodies at Varrock East 33-99 (Magic alongside; ~1,055 natures, ~22k gp) | 0.64-1.15 | ks-prep bronze 1-20 (13 bars, 2,015 XP), Knight's Sword 20 -> 82 (318k lump) | Elemental Workshop done (+125.7k, 82 -> 87); 87-99 superheat: `superheat-mithril-varrock-east-platebody` 1.61M vs iron 1.55M (8e35c441e; mithril costs 804 ore + 3.2k coal + 804 natures an hour, so iron unless ore is cheap; adamant 88+ unmodelled) (Magic 44 ok for superheat 43); an adamant axe (Smithing 71) is the one smithing side-trip that pays (see Now) |
| Magic | 44 | Imp Catcher to 44, then superheat with Smithing; fire strike/bolt/blast 0.43 h as the alternative (~45k gp) | ~0.4 | Imp Catcher 1 -> 44 (21,875 XP quest lump) | |
| Fishing | 99 | small net 1-20 -> fly fishing Lumbridge dropped 20-99 (`lure-lumbridge-drop`, 547k-2.16M; banking +10 min) | 0.53 | net 1-10 in thieving-40; lure-cook-bank cycle (tools-food) 54-68 ~551k/h, ~85% of the `lure-lumbridge-cook-bank` floor; Catherby swordfish 68-91 +466.5k in ~48 min (~580k/h, radius-5 area idle); 91-99 with plan `catherby-shark-fallback` (harpoon + shark fallback, area (2848,3427) r15): +413.5k in 28.2 min, 880k/h = 92.9% of the `swordfish-catherby-cook-bank` floor, no idle phases, fallback never needed | done. Gap left: the Fishing Guild variant (shorter legs, unmeasured) for the route's 68-99 band |
| Cooking | 99 | lure-lumbridge-cook-bank 25-60 -> swordfish Catherby harpoon + range 60-99 (`swordfish-catherby-cook-bank`, 0.83-1.36M plus Fishing) | 0.85 with Fishing | shrimps 1-34 in thieving-40; lure-cook-bank 54-71 ~746k/h, ~80% of floor (tools-food); Catherby swordfish 71-93 +547k in ~48 min (~680k/h); 95-99 +262.5k in 186 s of cooking phases (~5.1M/h of range time) riding on Fishing | done. Cooking finishes before Fishing on this method: at 99 the plan banks raw fish and skips the range |
| Crafting | 85 | pottery 1-10 -> flax picked and spun at the Gnome Stronghold 10-99 (490k flat) | 1.3-2.0 | plan `crafting80` (Khazard shears, Ardougne sheep `npcId` 43, wool spun to 10, then the Stronghold flax loop): 1-80 in 55.8 min; flax loop 10-80 +266k in 48 min = ~332k/h, 68% of the `flax-gnome-spin-bank` floor (conductor3 2026-10-24) | 85 now (Elemental Workshop +125k measured). 85-99: remaining Crafting quests first (Shilo 97k, Nature Spirit 75k, Fremennik 70k, Observatory 56k, Shades 50k, Murder Mystery 35k; ~530k of 730k), then a flax-only plan naming `flax-gnome-spin-bank` so `--methods` measures it; the gap is picking (33% of loop time) and the walk down to the field (11%): spot search for a pick tile nearer the wheel stairs, fewer pick clicks per lap |
| Herblore | 57 | herbs from chaos druids, Edgeville dungeon (11 spawns, 0.445 herbs/kill; 126/203/247 herbs/h at melee 40/60/85; Wilderness 2 at the thugs beside them), with melee trained there (0.9-1.1M Str/h). Yanille druid warriors (Agility 40) are second, at 50-144/h; Taverley has only 6 spawns. XP per herb: 146 identify-only, 643 with buyable secondaries (eye of newt, chocolate dust), 1,261 with snape grass and limpwurt (tribesmen on Karamja give both at 37-50 and 22-30/h, and poison). Druidic Ritual 28 then 1,542 herbs: 6.2 h at melee 85; Eadgar's Ruse 80 cuts it to 4.6 h | 6-8 | Druidic Ritual 1 -> 28, Digsite 28 -> 57 (56.4k) | **long pole**: rated with thugs as a proxy, since druids aren't combat features |
| Runecraft | 1 | Rune Mysteries, then earth via Aubury's essence (140k flat, travel-bound) | 5.6 | - | **long pole**: altar and essence layout search |
| Attack / Strength / Defence | 95/99/96 | cows Falador 1-25 -> scorpions Dwarven Mine 25-50 -> moss giants Kandarin (2549,3408) 50-99 (1.03-1.59M, rune scimitar); Waterfall Att/Str 83; maybe chaos druids alongside Herblore instead | 0.77 each | chickens 1-20 in 7 min (Att ~58k/h incl. the walk, Str ~110k, Def ~122k; melee-chickens); cows Falador (`melee40`, Zeke mithril scimitar, combat targetRange visible r22) Att 28-40 + Def 20-40 in 9.6 min: fight phases ~441k/h Att, ~403k/h Def, above the steel-scimitar floor (~430k at 40), no idle waits (conductor3 2026-10-24) | no scimitar hunt: mithril scimitar (Zeke), then the rune sword at 32 QP (Str 1,083k at 60 vs 1,098k for the rune scimitar); chaos druids for 50+ (herbs) |
| Hitpoints | 57 | rides along melee (3 x 99 melee gives ~993k) | 0 | - | |
| Prayer | 90 | Restless Ghost 47 (done: 20 -> 49 in 359 s) -> big bones at hill giants to ~60 -> baby blue dragons 60-99 (dusty key); Priest in Peril, Holy Grail lumps | 3-6 (retro #4: bones 109-206k/h at 99) | **baby-blue-dragons-taverley measured (conductor3 2026-10-31, plan `baby-blues-prayer`, one 25.3-min run, Prayer 83 -> 85, Def 96, HP ~80): ~112k Prayer/h (61 kills = 61 Babydragon bones at 750 XP, ~2.4 kills/min), ~253k HP/h, ~764k/h in the trained melee skill; 8 Swordfish in 25 min.** That is ~54% of the 206k/h floor. The run before it (23 min, 09:51) buried nothing (bones named `Babydragon bones`, fixed in 0643ee05b) and trained maxed Strength | **long pole**: Holy Grail done (49 -> 81, 2026-10-24); Dusty key held, gate walked (0643ee05b). 85 -> 99 is ~600k = ~5.4 h at 112k/h (HP 614k left is 2.4 h at 253k/h, Attack 142k + Defence 134k are 0.4 h at 764k/h, all in the same hours): the dragons are the critical path now, so every hour there must train a melee skill that is not 99. Experiment: Prayer/h with Attack 99 (kills die faster); **full run (plan `baby-blues-prayer` promoted 1d6bfbe0f, 2026-10-31): Prayer 83 -> 90, Att 95 -> 99, Def 96 -> 99 in ~107 min of fight, Prayer 104-112k/h = 70-77% of floor (145k/h); gap = restock walks 220 s per ~40 min + kill walking (~47 s/kill). Next: melee is 99, so the remaining 90 -> 99 (~463k, ~4.3 h) should train Ranged (or Magic) at the same time - research dispatched 13:10Z** |
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

- Prayer rate with Attack 99 (retro #7): hypothesis, baby blues die faster once Attack 95 -> 99 and the style is not wasted on a 99 skill; 112k Prayer/h
  (Prayer 83-85, Def 96, 61 kills in 25.3 min) is the baseline. Metric: Prayer/h and kills/min over the next two 25-min runs; also bones per food. If it stays
  under ~130k/h, 600k Prayer is 4.6+ h: price the adult blue dragons (1,800 XP a bone, Dragonfire shield, same dungeon) and the Wilderness green dragons
  (modelled 170k/h, out of bounds) before committing the hours.
- Goblin mail source (retro #6): Lumbridge goblins (3254,3236) r20: mail 5/128 (3.9%), 1,241 damage / ~247 kills / 3 mails in 1,441 s (5.8 s
  = 9.7 ticks per kill, ~82 kills per mail against 26 expected: unlucky, p ~0.4%, other drops matched their rates: Water rune 16 seen
  vs 12, Bronze sq shield 9 vs 6; the questw1 461 s run was ~56 kills). Expected for 3 mails: 77 kills = ~10.5 min at that kill rate,
  and the tail is long (95th percentile ~120 kills). Alternative: Goblin Village goblins (15 spawns, x 2951-2964 z 3491-3511, 70-tick
  respawn, 12 HP each, level 5, attackable) drop it 10/128: 38 kills expected, perhaps 10 s each at 12 HP, ~6 min, beside the generals where the
  mails are handed in. Variant plan: mails phase at (2958,3501) r15 after the woad (Falador) and before Aggie, instead of Lumbridge.
  Metric: seconds to 3 mails over 3 worker runs. Do not pre-spend a tool/area search on the Lumbridge cluster: a denser one only cuts
  the walk, kills per mail stay at 26.
- Looping walk detector (retro #6): hypothesis, a displacement watchdog catches the `stronghold_ent` class within 5 min instead of 18
  (see Backlog). Metric: minutes from first repeated no-move to the kill, over the next 5 walker failures.
- Quest lumps vs grinding (retro #4): hypothesis, for every skill still under ~85 the cheapest XP is the quest list in Now;
  metric: XP per bot-minute of each promoted plan (druidic 28 Herblore levels in 9 min; Digsite Mining 1-85 in ~21 min;
  Knight's Sword Smithing 20-82 in 12 min vs crafting80 267k in 56 min). Record each lump's measured XP.
- RESULT undercounts quest lumps (retro #4): the Knight's Sword RESULT lists `+4400 Strength ... +625 Agility` and no Smithing,
  though Smithing went 20 -> 82 (+318k, progress.ts); Digsite's run 2 lists `+187 Herblore, +100 Agility` and no Mining 19 -> 85;
  the squire-finish phase has `xpGained {}`. Phase XP seems to come from XP drops, which `stat_advance` does not send. Task-author
  fix: compute plan/phase `xpGained` from the skill XP before and after (state.skills), so journal lines and `stats.ts` show quest
  lumps. Metric: a quest run's RESULT names its lump.
- Adamant axe (retro #4): one trip (Dwarven Mine: 1 adamantite ore + 6 coal, Falador furnace Smithing 70, anvil Smithing 71) then
  WC oaks/willows with it. Model: +50% on oaks, +37% on willow-burn. Measure the first oak run with the adamant axe against the
  steel run (WC 15-45) with `stats.ts --methods`.
- Smithing 82-99 with mithril or adamant bars (retro #4, unmodelled): per bar a smelt (adamant 37.5) plus a smithed platebody
  (5 bars) pays about 2x the XP of an iron bar superheated, and the ore doubles as Mining XP (adamant 95 x 25), but adamantite
  respawns in 800 ticks and rocks are few (3 at the Dwarven Mine): add `coal`, `mithril` and `adamantite` method records and rate
  them before choosing, against iron superheat (463k/h measured at 60).
- Crafting 80-99 alternatives (retro #4): the training page has only the two flax methods (490k flat); no gem, glass or hide
  family. After the Crafting quests (~530k), ~200k is left: flax-gnome-spin-bank for 0.6 h is fine; do not model more.

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
- Runner wait pattern (retro #5): the grail-chain runner (agent-a3143008830c82503, 175 turns, 10.3 M cache reads, 45 min) launched 28
  background commands and ended 28 turns with a text-only "Waiting." (turns 21, 23, 36, 41, 43, 50, 57, 62, 66-68, 70-72, ...), each a
  notification to the conductor; 9 were `sleep N; tail` check-ins (turns 35, 37, 42, 44, 49, 58, 59) and two `sleep 1`
  no-ops (22, 117, 148), one blocked foreground `sleep 100` (turn 57) although task-runner.md item 3 allows one check-in per NEW
  draft. Hypothesis: with a proven plan plus `--until`, zero check-ins and no text-only turns cuts runner turns by about a third.
  Metric: text-only turns and `sleep` calls per runner.
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
