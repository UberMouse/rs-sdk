# World index phase 3b survey: the families the conductor's next legs need

Survey 2026-10-22, worktree `world-index-phase3b` at main `3be5b410a`. Read-only. Paths below are relative to the
worktree; content scripts are under `server/content/scripts/` (written `scripts/` here), the engine under
`server/engine/src/` (written `engine/`). Measured figures were read with
`bun conductor/tools/stats.ts <bot> --task plan:<name> --json --root /home/taylorl/code/rs-sdk` (run logs only, no bot
touched). Run ticks between tiles were read with `wayFinder(reachGraph(loadWorld()))` over the committed world.json.

## 0. Engine timing rules every family below rests on

| Fact | Value | Source |
|---|---|---|
| `p_delay(n)` at tick T | player delayed until T+1+n; the script resumes at T+1+n | `engine/engine/script/handlers/PlayerOps.ts:376-380`, `engine/engine/World.ts:776,779` |
| A click while delayed | refused (packets are read before the delay clears), so the next op after `p_delay(n)` runs at T+2+n (`clickTicks(n)` in `families/common.ts`) | `OpLocHandler.ts:14`, `OpHeldTHandler.ts:16`, `OpHeldUHandler.ts:16` |
| `p_arrivedelay` | 1 tick, only when the player moved this tick | `PlayerOps.ts:359-367` |
| `weakqueue(d)` | queued from a click/dialog (before the tick's queue pass) runs at T+d; queued from inside a queue script runs at T+1+d at the earliest (the LinkList cursor is saved before the new tail is added) | `engine/engine/entity/Player.ts:966-976`, `engine/datastruct/LinkList.ts:97-111` |
| A weak-queue batch (smelt, spin, cut, pottery) ends on any new click | `clearPendingAction` -> `closeModal` -> `weakQueue.clear()`; closing a level-up chat box does the same | `Player.ts:810-813, 1020-1023` |
| Eating costs no ticks of its own | `player_consume_item` has no `p_delay`; it adds 3 to `%action_delay` (matters to skills that read it: pickpocket, firemaking, smelting; not agility) | `scripts/player/scripts/consumption/consume.rs2:115-131` |
| Ops per tick | `USER_EVENTS_PER_TICK` (5) USER_EVENT packets; OpHeld/OpHeldU/OpHeldT are USER_EVENT | `engine/network/game/client/model/OpHeldU.ts:5`, `wiki/world/model/server.ts:90` |
| A forced walk (`~forcemove`, `~agility_force_move`, `~forcewalk`) | one tile per `p_delay(0)`: n tiles = n ticks (Chebyshev, diagonal steps) | `scripts/skill_agility/scripts/agility.rs2:18-43, 47-91` |
| `~agility_exactmove(..., md, ...)` | `p_delay(md)`: md+1 ticks | `agility.rs2:94-100` |

## 1. Facts per activity

### 1a. Superheat Item (Magic + Smithing)

| Fact | Value | Source |
|---|---|---|
| Trigger | `[opheldt,magic:superheat_item]`, cast on an inventory item | `scripts/skill_magic/scripts/spells/superheat.rs2:1` |
| Cadence | one cast per click, `p_delay(1)` -> 3 ticks a cast (`clickTicks(1)`); OpHeldT refused while delayed. Measured 26 ore in 78 ticks (roadmap Smithing row, w2) | `superheat.rs2:67`, `OpHeldTHandler.ts:16` |
| No auto-repeat, no fail roll | one ore per click; no failure branch | `superheat.rs2:3-67` |
| Magic level | 43 | `scripts/skill_magic/configs/magic_spells.dbrow:181-187` (`levelrequired,43`) |
| Runes | 1 nature + 4 fire; a worn staff whose `magic_staff_table` row names the rune zeroes it (staff of fire, fire battlestaff, mystic fire, lava) | `magic_spells.dbrow:186`, `scripts/skill_magic/scripts/magic.rs2:53-88, 90-106`, `scripts/skill_magic/configs/magic_staff.dbrow` (`magic_staff_fire`) |
| Magic XP | 530 tenths a cast (1,325 game XP) | `magic_spells.dbrow:187`, `magic.rs2:108-109` |
| Smithing XP | the bar's smelting struct `productexp` (iron 125 tenths = 312.5 game XP); gold x2.5 with goldsmith gauntlets | `superheat.rs2:56-60`, `scripts/skill_smithing/configs/smelting/smelting.struct:17-27` |
| Smithing level | the bar's `levelrequired` (iron 15) | `superheat.rs2:37-40`, `smelting.struct:24` |
| Iron with 2+ coal and Smithing 30 -> steel | so the floor must assume no coal carried | `superheat.rs2:27-30` |
| Iron never fails (no 50% roll) | unlike the furnace | compare `smelting.rs2:198-209` |
| Must close the bank first | the cast targets the inventory com, which the bank modal hides | `OpHeldTHandler.ts:30-37` |

### 1b. Smelting (furnace)

| Fact | Value | Source |
|---|---|---|
| Triggers | `oploc2` -> smelting chat menu (Make 1/5/10/X per bar); `oplocu` ore on furnace -> one bar | `scripts/skill_smithing/scripts/smelting/smelting.rs2:1-29, 31-98` |
| Cadence (menu) | the button at T queues `smelting_ore` with delay 4: first bar at T+4; each later bar: `%action_delay = clock+1`, `start_smelt_ore` (delay 0, next tick), then `smelting_ore` 3 later from inside the queue: **5 ticks a bar** steady | `smelting.rs2:137-144, 146-165, 167-188, 225-228` |
| Cadence (ore on furnace) | `p_arrivedelay`, weakqueue delay 2: one bar, 3 ticks | `smelting.rs2:100-115` |
| Iron fail | `randominc(1) = 1` -> fail, 50%, unless a Ring of forging is worn on a members world; a fail costs the same ticks and the ore | `smelting.rs2:198-209` |
| XP / level | struct `productexp`/`levelrequired`: bronze 62/1, iron 125/15, steel 175/30 (2 coal), mithril 300/50 (4 coal), adamant 375/70 (6), rune 500/85 (8) | `smelting.struct:1-114` |
| Interrupts | any click ends the batch (weak queue) | section 0 |

### 1c. Anvil smithing

| Fact | Value | Source |
|---|---|---|
| Trigger | bar used on an anvil opens the interface; buttons make 1, 5 or 10 (no Make-X) | `scripts/skill_smithing/scripts/smithing/smithing.rs2:1-36, 39-76, 86-211` |
| Cadence | per item `p_delay(1)` then `p_delay(2)`: **5 ticks an item**, the player delayed throughout; next click accepted one tick after the last delay | `smithing.rs2:271-301` (272, 286) |
| XP | `bar_amount x xpperbar`: iron 250 tenths/bar -> platebody (5 bars) 1,250 tenths = 3,125 game XP, kiteshield (3 bars) 750 | `smithing.rs2:282-283`, `scripts/skill_smithing/configs/smithing/smithing.struct:12-16` |
| Levels | iron platebody 33, iron kiteshield 27 (the bar's own 15 to open the interface) | `scripts/skill_smithing/configs/smithing/smithing.dbrow:804-813, 1068-1077`, `smithing.rs2:93-99` |
| Tool | a hammer in the inventory | `smithing.rs2:100-104` |

### 1d. Agility courses

Each obstacle's own ticks below are summed from its script's delays (section 0 rules); the walk between obstacles is
run ticks over the reach graph; every obstacle adds 1 tick for the refused click when its last delay ends. Lap
progress is a varp: an obstacle counts only if it is the next (`progress + 1 >= n`), and the bonus is paid when the
last one completes. World.json already holds most obstacles as `scripted` crossings with landings, rolls, fail ticks,
fail landing and the run ticks back (`roll.fail.back`).

**Wilderness course** (`scripts/skill_agility/scripts/wilderness_course.rs2`; locs in map `m46_61`)

| # | Obstacle (loc, tile) | Own ticks (success) | XP tenths | Roll / fail | Fail damage | Source |
|---|---|---|---|---|---|---|
| 1 | Pipe `obstical_pipe2` (3004,3938), from (3004,3937) | 11 (`p_delay(0)` + exactmove md3 + 2x `p_delay(0)` + exactmove md3); 11-tick lock | 125 | none; Agility 49 | - | `:48-77` (lock :66, xp :76) |
| 2 | Rope swing `obstical_ropeswing2` (3005,3952), start (3005,3953) | 2 (+distance to start if not on it) | 200 | `stat_random(200,250)` | `floor(HP*15/100)+1`, telejump into the pit (3004,10357), climb out | `:79-103` (roll :89, fail :90, xp :102) |
| 3 | Stepping stones `wilderness_stepping_stone` (3001,3960) | 12 (arrivedelay + 5 jumps md1 + 1 md0) | 200 | `stat_random(180,250)` after the 3rd jump | `floor(HP*216/1000)+1`, `agility_delay_fail` 3 ticks, lands (3002,3963) | `:105-127` (roll :114, fail :115, xp :125) |
| 4 | Log `wilderness_log_balance1` (3001,3945) | 9 (arrivedelay + 4 + 3 + 1 tiles) | 200 | `stat_random(200,250)` | `floor(HP*15/100)+1`, into the spike pit (2998,10346) | `:129-149` (roll :136, fail :137, xp :148) |
| 5 | Rocks `wilderness_rocks` (2993-2995,3936) | 5 (arrivedelay + 1 + 3 tiles), lands (2993,3933) | 0 | none | - | `:151-158` |
| lap | bonus when progress reaches 5 | - | 4,989 | - | - | `:170-178` (:176) |
| entry | Ridge gate `loc_2309` (2998,3917) north / gates `loc_2307/2308` (2997-2998,3931) south | ~15-16 | 150 each way | `stat_random(200,250)`; Agility 52 north | wolf pit, no damage | `:1-20, 22-46` |

- Lap XP 5,714 tenths = **14,285 game XP**; the measured lap (15,035 XP, 115 ticks: "gate 20, door 16, pipe 16+2,
  rope 6, stones 16+1, log 17+2, rocks 11 + level-up 3; ~13 idle", roadmap Agility row) also crosses the ridge both
  ways each lap (+300 tenths). **The ridge is not part of the lap**: the rocks landing (2993,3933) runs to the pipe
  start (3004,3937) in 6 ticks with no requirement (wayFinder). Walks between obstacles: rocks->pipe 6, pipe->rope 2,
  rope->stones 2, stones->log 8, log->rocks 4 (wayFinder; tile choices approximate).
- Rough floor at Agility 99, no fails: 39 obstacle ticks + 5 click ticks + 22 run ticks = **~66 ticks/lap, ~1.95M
  XP/h**; at 52 with fails (p 0.883 / 0.848 / 0.883, fail ticks + way back) ~77 ticks, ~1.67M/h. Measured
  1.00-1.16M/h, so a ~40% tick-perfect lever (drop the ridge, ~13 idle ticks).
- Course -> Edgeville bank (3094,3492): 260 run ticks, requires `skill:agility:52` (out through the ridge).
- Hazards outside the scripts: skeletons (lvl 22) hit 2-8 HP a lap at the rocks/log (roadmap); Wilderness level
  ~50-55; aggression is phase 4.

**Gnome Stronghold course** (`scripts/skill_agility/scripts/gnome_course.rs2`; map `m38_53`; no level, no fails)

| # | Obstacle | Own ticks | XP tenths | Source |
|---|---|---|---|---|
| 1 | Log `gnome_log_balance1` (2474,3435), forcemove 7 | 8 | 75 | `:1-8` |
| 2 | Net `obstical_net2` x3 (2471/2473/2475,3425) -> L1 | 2 | 75 | `:10-19` |
| 3 | Branch `gnome_tree_branch_1` L1 (2473,3422) -> L2 | 2 | 50 | `:21-27` |
| 4 | Rope `balancing_rope` L2 (2478,3420), forcemove 6 | 7 | 75 | `:29-35` |
| 5 | Tree `climbing_tree`/`climbing_tree2` L2 -> (2487,3420) L0 | 2 | 50 | `:37-45` |
| 6 | Net `obstical_net3` x3 (2483/2485/2487,3426) | 2 | 75 | `:47-56` |
| 7 | Pipe `loc_154` / `gnome_obstacle_pipe` (2484/2487,3431) | ~16 (forcewalk2 to start, exactmove md3, `p_delay(2)`, `p_delay(0)`, exactmove md3); 12-tick lock | 75 | `:58-96` |
| lap | bonus at 7 | - | 390 | `:103-110` |

- Lap XP 865 tenths = **2,162.5 game XP**; rough floor ~60 ticks -> ~320k/h. Measured lap-only ~254k (roadmap),
  whole plan runs 106k (gnome-agility, incl. travel from Varrock) and 130k (agility-52).

**Barbarian Outpost course** (not in a plan; measured 404k/h on w4): rope swing (200,280) 200, log (180,260) 125,
net 75, ledge (200,280) 200, crumbling walls 125 each, pipe 100 (Agility 35 one way), lap bonus 420 at progress 5.
`scripts/skill_agility/scripts/barbarian_course.rs2:5-156`. Measured clean lap 74-76 ticks / 3,487 XP.

**What world.json already has** (`crossings`, `gates`): every Gnome obstacle as a `scripted` crossing with its
landing; Wilderness stones and log with `roll` (low/high, fail ticks 10/8, fail landing, damage 22/15 = the most, at
HP 99, back 2/27); rocks; ridge gates. **Missing**: the Wilderness pipe is only a `gate` (Agility 49), with no landing;
the rope swing `obstical_ropeswing2` is absent. No crossing records its success ticks (distance.ts prices every
`scripted` crossing at `CROSSING_TICKS.scripted` = 2). Courses are areas (`wiki/world/areas.ts:198, 414, 925`) but
not a site kind.

### 1e. Runecraft (earth) and the essence mine

| Fact | Value | Source |
|---|---|---|
| Entry | talisman used on the ruins (`oplocu,_rc_ruins`): `p_delay(1)`, telejump to `enter_coord` (2 ticks + click). **No tiara in this revision** (no script mentions one) | `scripts/skill_runecraft/scripts/runecraft.rs2:19-45` |
| Craft | `oploc1` / `oplocu` on the altar: all essence at once, `p_delay(3)` (5 ticks incl. the next click) | `runecraft.rs2:11-17, 48-99` |
| Runes per essence | `level / multiplier + 1` (integer): earth multiplier 26 -> 1 at 9-25, 2 at 26-51, 3 at 52-77, 4 at 78-99 | `runecraft.rs2:80-84`, `scripts/skill_runecraft/configs/runecraft.dbrow:43-55` |
| XP | per essence, not per rune: earth 65 tenths (162.5 game XP) | `runecraft.rs2:95`, `runecraft.dbrow:48` |
| Level | earth 9 (air 1, mind 2, water 5, fire 14, body 20 ...) | `runecraft.dbrow:5-80` |
| Exit | temple portal `_rc_exit_portal`, no delay, telejump to `exit_coord` (earth (3303,3477)) | `runecraft.rs2:1-9`, `runecraft.dbrow:55` |
| Earth sites | ruins `rc-ruins:misthalin:0` (3305,3473); altar `rc-altar:earth-altar:0` (2657,4840), requires `carry Earth talisman` | `wiki/services/rc-ruins.md`, `wiki/services/rc-altar.md` |
| Mine entry | Aubury `opnpc4` (Teleport): `p_delay(4)` then a uniformly random landing of the 22 in `essence_mine_teleports`, `map_findsquare` radius 1; needs Rune Mysteries | `scripts/areas/area_varrock/scripts/aubury.rs2:32-33`, `scripts/skill_runecraft/scripts/essence_mine.rs2:1-25`, `scripts/skill_runecraft/configs/essence_mine_teleports.enum` |
| Mine exit | portal `p_delay(1)`, back to the wizard you came from (Aubury (3253,3401)) | `essence_mine.rs2:28-41`, `scripts/skill_runecraft/configs/runecraft.constant:15` |
| Mining essence | never fails or depletes; one per pickaxe `mining_rate` + 1 ticks (adamant 3 -> 4 ticks, rune 2 -> 3) | `wiki/world/model/families/mining.ts:83-90`, `scripts/skill_mining/configs/pickaxes.obj:128,198` |
| Load | talisman 1 slot + runes 1 slot (they stack and are never banked) -> 26 essence with the pickaxe wielded (measured "10 trips of 26") | roadmap Runecraft row |
| Run ticks | altar exit (3303,3477) -> Aubury 44; Aubury -> earth ruins 42 (wayFinder) | |
| Pricing gap | world.json prices the Aubury teleport at `CROSSING_TICKS.teleport` 3 (the script is `p_delay(4)`, 5-6 ticks) and each random landing at its worst spread (26-32 ticks): legs over it overstate travel by ~20 ticks a trip, enough to push a runecraft floor **below** the measured 139-153k/h | `wiki/world/distance.ts:13-19, 108-116`, world.json `crossings` (aubury op4) |

Rough floor at RC 55, adamant pickaxe: mine 26x4 = 104, rock->portal ~10, portal 2, Aubury->ruins 42, ruins 2,
temple walk ~5, craft 5, exit + Aubury walk 44, teleport ~6, landing->rock ~10 (mean) -> ~230 ticks/trip, 4,225 XP
-> **~165k/h** (measured trip ~252 ticks, 139-153k/h).

### 1f. Flax picking and spinning (Crafting)

| Fact | Value | Source |
|---|---|---|
| Pick | `oploc2,flax`: `p_delay(0)` -> 2 ticks a flax (`clickTicks(0)`), one per click, no auto-repeat, no XP | `scripts/general_use/scripts/pickables.rs2:54-74` (66) |
| Deplete | `random(16) < 3` after a pick (3/16), `loc_del(10)`: gone 10 ticks (not player-count scaled) | `pickables.rs2:71-73` |
| Field | Seers' flax field (2732-2755, 3433-3456) is an area (`wiki/world/areas.ts:282`); **flax is not a feature kind** (no site, no nearest bank) | `wiki/world/types.ts:21-44`, `classify.ts:41-54` |
| Spin (menu) | `oploc2` Spin: `skill_multi2_header` (Make 1/5/10/X), weakqueue 3, then 2 from inside the queue: **3 ticks a string**, first at +3 after the dialog | `scripts/skill_crafting/scripts/spinning/spinning.rs2:36-110`, `scripts/interface_chat/scripts/chat.rs2:769-796` |
| Spin (flax on wheel) | one string, `p_delay(2)`: 4 ticks a click | `spinning.rs2:1-34, 113-134` |
| XP / level | flax -> bow string 150 tenths (375 game XP), Crafting 10, members | `scripts/skill_crafting/configs/spinning/spinning.struct:1-7`, `spinning.rs2:11-16` |
| Seers wheel | `spinning-wheel:seers-village:0` (2711,3471) L1, bank 17 ticks | `wiki/services/spinning-wheel.md` |
| Run ticks | flax centre -> wheel 22, wheel -> Seers bank 17, bank -> flax 28 (wayFinder) | |
| Measured loop | per 28 flax: spin ~132 (47%), pick ~122 (43%), bank ~30 | roadmap Crafting row |

Rough floor: pick 28x2 = 56 + re-targets, spin 2+3+27x3 = 86, legs 67 -> ~215 ticks/28 strings, 10,500 XP ->
**~440k/h** (measured 290-322k).

### 1g. Pottery (Crafting)

| Fact | Value | Source |
|---|---|---|
| Soft clay | clay used on a water container: `p_delay(1)`, 3 ticks; the container returns empty | `scripts/skill_crafting/scripts/pottery/pottery.rs2:1-6, 44-57` |
| Wheel | Make-X menu, 3 ticks an item (`%action_delay` +2 and weakqueue) | `pottery.rs2:59-101` |
| Oven (menu) | 7 ticks an item (`process_fire_pottery` next tick, `fire_pottery` 5 later); `stat_random(crafting, 180, 800)`, p = 1 from about Crafting 12; a crack loses the item | `pottery.rs2:103-153` |
| XP (shape / fire) | pot 63/63 (lvl 1), pie dish 150/100 (7), bowl 180/150 (8) tenths | `scripts/skill_crafting/configs/pottery/pottery.struct` |
| Sites | Barbarian Village wheel (3087,3410) and oven (3084,3407); water sources; clay rocks | `wiki/services/pottery-wheel.md`, `pottery-oven.md` |

Five stops (clay, water, wheel, oven, bank) with containers that cycle; the plan ends at Crafting 30 and the account
is 70. Recommend leaving it out of 3b.

### 1h. Fletching

| Fact | Value | Source |
|---|---|---|
| Cut | knife on logs (`opheldu,_category_22`) -> Make 1/5/10/X menu; first item 2 ticks after the dialog, then **3 ticks a log** (weakqueue 2 from inside the queue) | `scripts/skill_fletching/scripts/cut_logs.rs2:1-104` (80-104) |
| Arrow shafts | `shafts` per log (normal logs 15), XP `shafts x 5` tenths (75 = 187.5 game XP a log), level 1; shafts stack | `cut_logs.rs2:56-72`, `scripts/skill_fletching/configs/cut_logs/cut_logs.dbrow:1-7` |
| Willow longbow (u) | level 40, 415 tenths | `cut_logs.dbrow:15-20` |
| String | unstrung bow + bow string (`opheldu`): one bow per use, **no delay**: up to `USER_EVENTS_PER_TICK` (5) a tick | `scripts/skill_fletching/scripts/bows.rs2:1-42` |
| Willow longbow string | level 40, 415 tenths | `scripts/skill_fletching/configs/stringing/bows.dbrow:36-41` |
| Per willow longbow | 830 tenths = 2,075 game XP | |
| Tools / supplies | knife (1 slot); bow strings withdrawn at the bank, a slot each | plan `willow-longbows` |
| Seers willows | -> Seers bank 16 run ticks (wayFinder) | |

Rough floor willow-longbows at WC/Fletching ~60: 13 logs chopped (~9 ticks/log measured) ~117, cut 2+12x3 = 38,
string 3, legs 32 -> ~190 ticks/13 bows -> **~1.28M Fletching/h** (measured 971k).

### 1i. Firemaking

| Fact | Value | Source |
|---|---|---|
| Light from inventory | tinderbox on logs: drops the log, `%action_delay` +3, then a `stat_random(firemaking, 64, 512)` roll every 4 ticks (`p_opobj(4)` re-runs); p = 1 from Firemaking 43 (64·56/98 + 512·42/98 + 1 = 36 + 219 + 1 = 256, floored) | `scripts/skill_firemaking/scripts/firemaking.rs2:13-28, 79-117` |
| Cadence | first log 3 ticks, then **4 ticks a log** (the next log's click lands while `%action_delay` is ahead) | `firemaking.rs2:98-115` |
| After a fire | pushed west, else east, south, north (`p_delay(0)`); a fire lasts 100+random(100) ticks, so a line burns westward and needs clear tiles | `firemaking.rs2:119-131, 145-174` |
| XP / level | logs 400 tenths (1,000 game XP), level 1; willow 900 (2,250), level 30 | `scripts/skill_firemaking/configs/firemaking.obj:88-105, 165-182` |
| No processor site | any open tile outside bank zones | `firemaking.rs2:133-143` |

## 2. What the index has and lacks

| Needed | In the index? |
|---|---|
| Furnaces, anvils, spinning wheels, pottery wheel/oven, rc-ruins, rc-altar, banks | yes, as service sites (`wiki/services/*.md`; `classify.ts:41-54`) |
| Essence rocks | yes, `rock:rune-essence-mine:0..3`, reached "via came from aubury + Rune Mysteries" (`wiki/resources/rock/rune-stones.md`) |
| Port Khazard iron | yes, `rock:kandarin:6` (2630,3143), 9 rocks; anvil `anvil:port-khazard:0`, 34 run ticks |
| Flax | **no** feature kind; an area only |
| Agility courses | **no** feature kind; areas only; obstacles are crossings/gates (see 1d) |
| Aubury teleport, mine portals, ruins entry, temple exit | yes, as crossings (`gates.ts:194-242`, `sources/npc-teleports.ts`) but priced by constants and worst landing |
| Firemaking spots | none (any tile) |

## 3. The duplicate `statRandomChance`

- `wiki/world/roll.ts:11` `statRandomChance(low, high, level)`: used by `distance.ts:132`,
  `conductor/test/lib/walk-graph.test.ts:7,326`, `test/roll.test.ts`; the file also holds `statRandomRule`,
  `lowestLevel`, `expectedTicks`.
- `wiki/world/model/roll.ts:12` `statRandomChance(level, low, high)`: used by the woodcutting, mining, fishing,
  pickpocket and cooking families and `test/model-core*.test.ts`.
- Same arithmetic. **Recommend one function in `wiki/world/roll.ts` in the engine's order `(level, low, high)`**
  (`stat_random(stat, low, high)`, `PlayerOps.ts:591`, the order every script call reads in), with the model file's
  fuller comment (53-bit uniform draw, the clamp, the per-term floors); delete `model/roll.ts`, repoint the five family
  imports, swap the arguments at `distance.ts:132` and the one conductor test line, merge the two test files. It keeps
  roll-related code in one place and lets agility and pottery (new users) call it once. The conductor test edit is a
  one-line call change, which the spec must allow (phase 3's "only Task 6 edits conductor/").

## 4. Proposed contract extension

What the cycle lacks today (`model/cycle.ts`, `model/method.ts`): (a) a process step that runs in place (no
processor site); (b) more than one step, each taking the previous step's product; (c) a step taking a supply beside
its input (nature runes, bow strings) and a batch input (5 bars a platebody); (d) ending without a bank (drop at the
anvil, keep a stackable product); (e) a cycle with no gather (banked ore); (f) damage that is not a failed roll's
(agility laps), and eating that costs no ticks; (g) a family that needs walks inside its site (an agility lap).

Smallest extension:

```ts
// family.ts
interface ActionModel {
    // ... as now
    /** Expected hitpoints lost per success besides failDamage's (an agility lap's falls, at the profile's HP). */
    damage?: number;
    /** Inputs one product takes (5 bars a platebody); default 1. The load rounds down to whole batches when the chain is deterministic. */
    batch?: number;
}
interface Family {
    // ... as now
    /** Optional: tile pairs the family needs walked inside its site (an agility lap's landing -> next obstacle, a
     *  fall's landing -> retry tile). method.ts prices them under the way's reach set and stores them on the way;
     *  model() receives their run ticks. */
    walks?(site: Site, params: unknown, world: ModelWorld): { from: Tile; to: Tile }[];
    model(site, params, profile, world, walks?: number[]): ActionModel;
}

// methods.ts
interface MethodDef {
    family: string;                      // 'withdraw' allowed: the load comes from the bank (params { obj })
    sink:
        | { mode: 'drop' }
        | { mode: 'bank'; bank?: Tile }
        | { mode: 'process'; steps: ProcessStepDef[]; then: 'bank' | 'drop' | 'keep'; bank?: Tile };
}
interface ProcessStepDef {
    family: string;
    /** 'here': at the gather's stand (superheat, cut, string, burn beside the trees); a Tile: a site of the family's
     *  kinds, or, for a family with no kinds (firemaking), that tile itself; omitted: the nearest site of its kind. */
    at?: Tile | 'here';
    params: unknown;                     // or a list, one per input kind (cooking trout + salmon)
}
// 'process-bank' becomes { mode: 'process', steps: [step], then: 'bank' } (WORLD_FORMAT bump; the one record migrates).
```

`cycle.ts`:

- **Steps chain.** Step i's `consumes[0]` is the gather's product or an earlier step's; any further `consumes` are
  supplies: stackable ones take one slot (natures), non-stackable ones take a slot per unit per success (bow strings),
  which lowers the load. The "a process step must take one input" rule becomes "one chained input plus supplies".
- **Tour.** gather stand -> each step site that is not 'here' (consecutive duplicates merged) -> bank when
  `then: 'bank'` -> gather stand. `then: 'drop'` drops the non-stackable end products with `dropTicks` at the last
  step; `then: 'keep'` keeps a stackable end product (runes) and never banks. Process ticks are the sum of each
  step's ticks x its inputs per trip, as today.
- **Withdraw source.** `family: 'withdraw'`: no gather ticks; the load is the free slots over the first step's input
  slots; the tour starts and ends at the bank (superheat-banked). A bank visit stays `BANK_TICKS` 0 (withdraws fit in
  the deposit tick's 5 events); closing the bank before an in-place cast is a CloseModal in the same tick.
- **Damage.** `foodPerSuccess = (failDamage x fails/success + damage) / heal`; eat ticks are `eatTicksPerFail` for
  `failDamage` (pickpocket stuns) and 0 for `damage` (eating has no `p_delay`, consume.rs2:115-131). HP regeneration
  stays out (a lower floor), noted.
- **Agility as a lap.** One `ActionModel` per lap: `ticksPerAttempt` = sum of obstacle success ticks + 1 click tick
  each + the lap's walks, plus each rolled obstacle's (1-p)/p x (fail ticks + walk back + 1); `success` 1;
  `xpTenths` the obstacles' plus the lap bonus; `damage` the expected fall damage at the profile's HP. With
  `food` + `bank` sink, the existing food branch gives laps per trip and the bank legs. No food (Gnome): the trip
  never ends, no travel.

Reuse of `process-bank` as is (once renamed): flax-spin (pick -> spin at the wheel -> bank), iron-smith (mine ->
smelt -> smith -> bank: two steps), superheat-mine (mine -> superheat 'here' -> smith -> bank). The cycle arithmetic
for steps, bank legs and process ticks carries over; only the step chain, supplies and `then` are new.

Primitives the families need first:

- **Crossing success ticks** from `sources/gate-scan.ts`'s bound runs (it already sums `p_delay`/`p_arrivedelay` for
  a failed path, gate-scan.ts:529-536, 1336-1344), counting a `~forcemove`/`~agility_force_move`/`~forcewalk` call
  as one tick per tile. The missing Wilderness pipe and rope swing crossings (or curated rows).
- **Fall damage as a function of HP**: world.json stores the most (at HP 99); the family needs
  `floor(HP x a / b) + c` (wilderness 15/100 and 216/1000).
- **Method legs over a random landing priced at the mean** of the landings' walks (essence mine teleport, uniform
  over 22 coords then radius 1), and the Aubury teleport at its script delay; else the runecraft floor sits under
  its measured figure.
- **New feature kinds**: `flax` (from `[oploc2,flax]`, `pickables.rs2:56`; optionally all pickables as
  `pickable:<subtype>`), and `agility-course` (the obstacle locs whose triggers call `~update_<course>_varp`, one site
  per course; the varp index orders the lap, the proc's `stat_advance` is the bonus).
- **Engine timing helpers** in `families/common.ts`: `queueTicks` for a weakqueue cadence (from a click d, from inside
  a queue d+1), beside `clickTicks` and `rollInterval`.

New families: `superheat` (process; params ore, staff), `smelting` (process; bar; RoF later), `smithing` (process;
product; hammer tool; batch), `spinning` (process), `fletching` (process; cut product or string), `firemaking`
(process; log; kinds []), `runecraft` (process at rc-altar; runes per essence by level), `pick` (gather on `flax`),
`agility` (gather on `agility-course`; uses `walks`), and the `withdraw` source.

## 5. Plans, proposed method records and measured seeds

Rule: a plan names a method only when its whole run IS the method's cycle.

| Plan | Method (proposed id) | family -> steps -> then | Name it? | Measured (stats.ts, read 2026-10-22) |
|---|---|---|---|---|
| khazard-superheat | `iron-khazard-superheat-platebody-drop` | mining iron @ `rock:kandarin:6` (2630,3143) -> superheat here (staff of fire) -> smith platebody @ `anvil:port-khazard:0` -> drop | yes | conductor2w2 2026-10-16, 0.167 h: Magic 771,141, Smithing 463,117, Mining 524,994 (`--task plan:khazard-superheat`); roadmap steady 514k/727k/480k |
| superheat-banked | `superheat-iron-varrock-east-platebody` | withdraw iron_ore @ Varrock East bank -> superheat here -> smith platebody @ `anvil:varrock:3` (3247,3404) -> bank | yes | conductor2w2 2026-10-16, 0.167 h: Magic 1,588,975, Smithing 1,124,275 |
| superheat-mine | `iron-se-varrock-superheat-platebody-bank` | mining iron SE Varrock (3285,3369) -> superheat here -> smith @ (3247,3404) -> bank Varrock East | yes | conductor2w2 2026-10-16, 0.167 h: Magic 596,244, Smithing 328,119, Mining 393,746 |
| iron-smith | `iron-se-varrock-smelt-lumbridge-kiteshield` | mining iron -> smelt @ Lumbridge furnace -> smith kiteshield @ Varrock West anvil -> bank Varrock West | yes at Smithing 27+ (below, it smiths warhammers/battleaxes); or retire it (superseded) - **ask** | conductor2 2026-10-11, 2 runs 0.085 h: Smithing 140,436 |
| iron-bulk | none | stages by bank counts (mine N, smelt all, smith all) | no (already noted on `iron-se-varrock-bank`) | - |
| agility-wilderness | `agility-wilderness-course` | agility @ course, food salmon, bank Edgeville | yes | conductor2w4 2026-10-16: 0.465 h 1,000,473 (minFood 2), 0.518 h 1,159,177 (minFood 4); both runs SIGTERM-ended, XP valid; no bank trip fired |
| gnome-agility | `agility-gnome-course` | agility @ course, no food, no sink | yes if a travel prologue is allowed - **ask** | conductor2 2026-10-11, 2 runs 0.138 h: 106,163 (whole run incl. the walk from Varrock; lap-only ~254k per roadmap) |
| agility-52 | none | bank swap, wield via combat, travel, then gnome laps | no (does more; superseded by gnome-agility) | conductor2 2026-10-16, 0.157 h: 130,425 |
| earth-runecraft | none | air trips < RC 9, talisman hunt by combat, bank errand | no | conductor2 2026-10-16: RC 73,197 |
| earth-runecraft-28 | `earth-runecraft-aubury-essence` | mining essence @ `rock:rune-essence-mine:N` -> runecraft @ `rc-altar:earth-altar:0` (via ruins) -> keep | yes if its setup prologue (bank, wield the pickaxe via combat, bank) is allowed - **ask** | conductor2 2026-10-16, 2 runs 0.276 h: RC 139,194, Mining 107,072; draft `earth-runecraft-v2` on conductor2w1 0.3 h: RC 141,324 (roadmap 153k = 42.4k XP in 1,080 s) |
| flax-spin | `flax-seers-spin-bank` | pick @ Seers flax -> spin @ `spinning-wheel:seers-village:0` -> bank Seers | yes (`to-seers` travel prologue) | conductor2w1 2026-10-16, 0.167 h: Crafting 305,797; main ran draft `flax-travel` 0.421 h: 290,125; roadmap main 322k (44->70, 111,750 XP in 1,247 s) |
| willow-longbows | `willow-seers-longbow-bank` | woodcutting willow @ Seers (2711,3509) -> cut longbow here -> string here (supply bow_string) -> bank Seers | yes | conductor2w3 2026-10-16, 0.25 h: Fletching 971,088, Woodcutting 830,238 |
| chop-fletch | `trees-lumbridge-arrow-shafts` (optional) | woodcutting tree @ Lumbridge -> cut shafts here -> keep | low value (ends at Fletching 30, account at 30 already); burn-oak guard phase - **ask** | conductor2 2026-10-11, 0.106 h: WC 235,132, Fletching 70,540, FM 28,216 |
| chop-burn | `trees-lumbridge-burn` | woodcutting tree @ (3195,3220) -> firemaking @ tile (3230,3240) -> keep (nothing left) | yes | none as a plan run (no `plan:chop-burn` in any bot's stats) |
| willow-burn | `willow-draynor-burn` | woodcutting willow @ Draynor (3086,3232) -> firemaking @ tile (3088,3247) | yes (its `fetch` bank phase is a restock guard) | conductor2 2026-10-11, 2 runs 0.214 h: WC 694,977, FM 831,867 |
| pottery-craft | none | 5 stops with cycling containers, shop prologue, ends Crafting 30 | no; out of 3b | conductor2 2026-10-11: Crafting 65,615 |

Seeding `measured`: the existing route is `stats.ts <bot> --methods` once the plans name the methods; it reads each
run's start levels and tool from the tick recordings and prints the paste-ready entry. The figures above are the
cross-check, not the entries (they lack start levels). Worker-run figures (w1-w4) count; the record's `bot` says which.

## 6. Open questions for the user

1. **Prologues.** Do one-time setup phases (flax-spin's `to-seers`, gnome-agility's bank-food + travel,
   earth-runecraft-28's bank / wield-by-combat / bank) stop a plan naming a method? Their whole-run XP/hr includes the
   prologue (gnome-agility 106k vs ~254k lap-only). Options: allow and seed `measured` from the cycle's phases
   (`--phases`, as `iron-se-varrock-bank` was), or move prologues out of the plans.
2. **Courses**: Wilderness and Gnome only, or Barbarian too (measured 404k/h, no plan)?
3. **Altars**: earth only (the one leg; `wiki/skills/runecraft.md` says no other altar pays), or every talisman altar
   as data so the training page shows them?
4. **Retire or leave unnamed**: iron-smith (140k, superseded by superheat), agility-52, chop-fletch, earth-runecraft,
   pottery-craft.
5. **The Wilderness lap floor excludes the ridge gates** (the agility task crosses them every lap: ~36 ticks for
   750 XP). Confirm; the page will then show agility-wilderness at ~60-70% of floor.
6. **Pricing fixes scope**: price random landings at the mean and teleports/scripted crossings at their script
   ticks only for method legs, or in `distance.ts` for every page (moves every nearest-bank figure)?
7. **Firemaking line resets**: model a line's length from collision (the walk back to a fresh line) or leave it out
   (a looser floor)?
8. **Worn items in the profile**: staff of fire (superheat runes), ring of forging (iron smelting), as a `worn` list
   on `Profile`, or as method params?
9. **HP regeneration** in food cycles (matters to agility at high level, where falls are rare): leave out as now?

## 7. Proposed sdd-loop task list (primitives first)

1. **Roll and timing primitives.** One `statRandomChance(level, low, high)` in `wiki/world/roll.ts`, `model/roll.ts`
   deleted, callers and the conductor test line updated, tests merged; `queueTicks` in `families/common.ts` with
   hand-worked tests (smelt 5 ticks a bar, spin 3, cut 3, pottery oven 7).
2. **Index data.** `flax` and `agility-course` feature kinds and sites (classify.ts rules from the triggers; the varp
   index and lap bonus read from the course scripts); gate-scan success ticks on scripted crossings (forced walks per
   tile); the Wilderness pipe and rope swing crossings; fall damage as an HP-linear form; method legs over random
   landings at the mean landing walk and the Aubury teleport at its delay. `WORLD_FORMAT` bump; build budget reported.
3. **Contract and cycle.** `ActionModel.damage` and `batch`; `Family.walks`; the `process` sink (steps, 'here',
   tile steps, supplies, `then: bank | drop | keep`); the `withdraw` source; `process-bank` migrated; method.ts tour
   legs; synthetic cycle tests worked by hand for each new shape (chain, drop at the processor, keep, withdraw,
   non-stackable supply, food with `damage`).
4. **Processing families**: superheat, smelting, smithing, spinning, fletching (cut + string), firemaking, runecraft;
   one hand-worked test each from its script (e.g. superheat iron with staff of fire: 3 ticks, 530 + 125 tenths, 1
   nature; earth at RC 55: 3 runes/essence, 65 tenths).
5. **Gather families**: `pick` (flax, 2 ticks, deplete 3/16 for 10 ticks) and `agility` (lap from crossings + walks;
   Wilderness at Agility 52 and 99, Gnome at 1, worked by hand).
6. **Method records and plan links**: the records of section 5 the user keeps, `plans` both ways, `measured` from
   `stats.ts --methods`; real-data tests that each floor is at or above its measured figure; training pages for
   Smithing, Magic, Agility, Runecraft, Crafting, Fletching, Firemaking.
7. **Docs**: README Methods (process steps, withdraw, laps), world-index.md "Phase 3b as built", the to-do list of
   plans with no method, roadmap note on the Wilderness-gate and runecraft-landing levers.
