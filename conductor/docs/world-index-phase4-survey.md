# World index phase 4 (combat): survey

Read-only research at main 3be5b410a. Paths: `S/` = `server/content/scripts/`, `E/` = `server/engine/src/`,
`W/` = `wiki/world/`. Every line number was read from the file. NPC configs for the seed monsters are all in
`S/_unpack/225/all.npc` (chicken :1025, mossgiant :2870, giant :2968, green_dragon :5430).

## 0. Headlines

- The combat formulas are short and fully scripted. There are three of them: effective level =
  `level*prayer/100 + 8 + style`; roll = `eff * (bonus + 64)`; max hit = `(eff_str * (str_bonus + 64) + 320) / 640`.
  A hit lands when `randominc(A) > randominc(D)`. The exact chance in closed form is
  `A > D ? 1 - (D+2)/(2(A+1)) : A/(2(D+1))`. NPCs use the same formulas with a fixed +9 (controlled style plus 8)
  and no prayer.
- **The melee XP per kill does not depend on accuracy.** Damage is capped at the NPC's remaining HP, so a kill pays
  exactly 4 XP per HP to the trained skill, and about 1.33 per HP (truncated on each hit) to Hitpoints. Accuracy and
  max hit only set the ticks per kill.
- **A combat "action" fits the ActionModel contract if a kill counts as a success.** `ticksPerAttempt` is the
  expected number of swings times the attack interval, and `success` is 1. `deplete` is `{chance: 1, respawnTicks}`
  and `features` is the number of spawns, so the existing `resourceCap` gives the respawn cap unchanged. The new
  parts are damage taken per success, a policy for loot and bones, and gear in the Profile.
- **The "melee model within ~10%" in the roadmap is not committed code.** It came from a research session on
  2026-10-16 (commit 2aa0aca8c only touched `conductor/roadmap.md` and `wiki/skills/attack.md`). No model, script
  or run note in the repo holds it. Phase 4 starts from the scripts.
- **The world index has gaps for combat:**
  - `npc` sites have no `nearest` bank, because `W/distance.ts:72-85` SINKS has no `npc`.
  - NPC sites cluster at radius 6 (`W/place.ts:39`). This splits the Edgeville hill giants into 3 sites (2+1+9) and
    the green dragons into 5 one-dragon sites.
  - Drop tables are imperative rs2 (`if ($random < N) obj_add(...)` chains), not dbrows, so they need a parser.
- **A first-cut check on damage taken does not match the measured food use.** The formulas give about 1,080
  HP/h from hill giants at Defence 40 with no armour. The roadmap's 28-55 fish/h is about 250-500 HP/h. Either the
  bot wore armour, or something reduces how often the NPCs swing. Calibrate this before trusting the food numbers
  (section 7).

## 1. Facts

### 1.1 Player hit roll and hit chance

| Fact | Value | file:line |
|---|---|---|
| Hit test (player on NPC) | `randominc(attack_roll) > randominc(defence_roll)` | `S/skill_combat/scripts/player/player_combat.rs2:52-68` (test :65) |
| `randominc(n)` | `JavaRandom.nextDouble() * (n+1)`, truncated: uniform on 0..n | `E/engine/script/handlers/NumberOps.ts:37-40` |
| `scale(a,b,c)` | `a*c/b` truncated by pushInt | `E/engine/script/handlers/NumberOps.ts:124-127` |
| Hit chance, closed form (derived) | A>D: `1-(D+2)/(2(A+1))`; else `A/(2(D+1))` | derived from the two lines above |
| Player attack roll by damage type | `%com_{stab,slash,crush,range,magic}attack` | `player_combat.rs2:71-79` |
| Attack/defence roll formula | `effective * (bonus + 64)` | `S/skill_combat/scripts/combat.rs2:11-12` |
| Melee rolls per type | `%com_*attack = combat_stat(eff_attack, <type>attack bonus)`; defence rolls use eff_defence | `player_combat_stat.rs2:83-92` |
| Ranged roll | `combat_stat(eff_ranged, rangeattack)` | `player_combat_stat.rs2:91` |
| Magic roll | `combat_stat(eff_magic, magicattack)` | `player_combat_stat.rs2:89` |
| Player magic defence level | `(7*eff_magic + 3*eff_defence)/10 + 8` | `player_combat_stat.rs2:67,76` |
| NPC defence roll | `(npc_stat(def) + 9) * (npc <type>defence param + 64)`; **Magic uses the NPC's magic stat** | `S/skill_combat/scripts/npc/npc_combat.rs2:325-334` (magic :327-328) |
| NPC defence bonus by type | npc params stabdefence/slashdefence/crushdefence/rangedefence/magicdefence | `npc_combat.rs2:345-353` |
| Weapon's damage type and style | weapon `category` -> `combat_style_table` dbrow, indexed by `%com_mode` | `combat.rs2:15-47`; `player_combat_stat.rs2` (`%com_mode` clamp, damagetype/style) |
| Special cases | crystalshard necklace on undead x7/6 roll; tbwt_beast; 6 dagannoth types take only one style | `player_combat.rs2:56-64`; `npc_combat.rs2:401-437` |

### 1.2 Max hit

| Fact | Value | file:line |
|---|---|---|
| Max hit formula | `(combat_stat + 320) / 640` | `combat.rs2:7-8` |
| Melee max | `combat_maxhit(eff_strength * (strengthbonus + 64))` | `player_combat_stat.rs2:94,99` |
| Ranged max | `combat_maxhit(eff_ranged * (rangebonus + 64))` | `player_combat_stat.rs2:95,100` |
| Ranged bonus source | Ammo in the quiver counts only with a matching launcher (arrows with a bow, bolts with a crossbow); thrown weapons in the right hand count | `S/player/scripts/equip.rs2:264-268` |
| Damage roll | `randominc(npc_max_dealt(maxhit))`: 0..max. **A hit can roll 0** | `player_melee.rs2:31`; `player_ranged.rs2:51` |
| `npc_max_dealt` | `min(maxhit, npc_param(max_dealt))`, default 1000; only antimacro and Yanille NPCs set it | `npc_combat.rs2:438`; `S/skill_combat/configs/combat.param:159-162` |
| Spell max hit | dbrow `maxhit` (Fire Blast 16, Wind Wave 17); +3 on bolt spells with chaos gauntlets | `S/skill_combat/configs/magic/magic_combat_spells.dbrow:210-219`; `S/skill_combat/scripts/pvp/pvp_magic.rs2:242-248` |
| Melee and ranged special cases | garlic +1 vs Count Draynor; silverlight or holy water x1.6 on demons; holy water 0 on non-demons | `player_melee.rs2:22-30`; `player_ranged.rs2:37-50` |

### 1.3 Effective-level terms

| Fact | Value | file:line |
|---|---|---|
| Effective stat | `scale(max(100, prayer), 100, level)` = `level*prayer/100` | `combat.rs2:4-5` |
| Levels read | **Current** (boosted) `stat()` for att/str/def/magic/ranged | `player_combat_stat.rs2:37-41` |
| +8 and style bonus | melee and ranged `+8+style`; magic `+8+1` always; NPCs `+9` | `player_combat_stat.rs2:71-76`; `npc_combat_melee.rs2:6,15` |
| Style bonuses (att, str, def, ranged) | accurate 3/0/0/0, aggressive 0/3/0/0, defensive 0/0/3/0, controlled 1/1/1/0, ranged accurate 0/0/0/3, longrange 0/0/3/0, rapid none | `combat.rs2:51-61` |
| Attack prayers | 105/110/115 (`%prayer2/5/11`) | `player_combat_stat.rs2:214-218` |
| Defence prayers | 105/110/115 (`%prayer0/3/9`) | `player_combat_stat.rs2:220-224` |
| Strength prayers | 105/110/115 (`%prayer1/4/10`) | `player_combat_stat.rs2:226-230` |
| Ranged and Magic prayers | none ("no ranged prayers", "no magic prayers") | `player_combat_stat.rs2:66,68` |
| Protect prayers | melee `%prayer14`, missiles 13, magic 12; protect from melee zeroes NPC melee damage | `player_combat_stat.rs2:232-236`; `npc_combat_melee.rs2:44-46` |
| Prayer drain | 5-tick timer; counter += effect*5; a point lost per `max(resistance, 60)` | `S/skill_prayer/scripts/prayer.rs2:30-43,163-179` |
| Potions (they exist) | attack, strength, defence +3+10%; super attack, strength, defence +5+15%; ranging +4+10%; no magic potion | `S/player/configs/consumption/consume_effects.dbrow:1-63` (stat_change rows :7,:15,:23,:31,:47,:55,:63) |
| Boost decay | 1 level per 100 ticks (`stat_boost_restore`) | `S/player/scripts/stat.rs2:45-56`; `S/login_logout/login.rs2:36` |
| HP regen | 1 HP per 100 ticks | `stat.rs2:59-60`; `login.rs2:38` |
| Void / Slayer | **neither exists** (no void set or slayer task in the scripts; crystalshard on undead is the only "slayer-like" multiplier) | `player_combat.rs2:62-64` |

### 1.4 Attack speed and timing

| Fact | Value | file:line |
|---|---|---|
| Melee interval | `%action_delay = clock + attackrate` (unarmed 4); next swing when `%action_delay <= clock` | `player_melee.rs2:8-11,55-60` |
| `attackrate` param default | 4 | `combat.param:76-79` |
| Distribution in objs | 3 x29, 4 x11, 5 x77, 6 x56, 7 x17 (plus default 4 for objs that set none, such as scimitars) | grep of `param=attackrate` over `S/**/*.obj` |
| Ranged interval | `attackrate`, -1 on rapid | `player_ranged.rs2:16-24` |
| Magic interval | 5 ticks per cast | `player_magic.rs2:188` |
| Melee hit delay | `npc_queue(2, damage, 0)` | `player_melee.rs2:50` |
| Ranged hit delay | `(projectile + 30)/30` ticks | `player_ranged.rs2:68-70` |
| Magic hit delay | `duration/30 + 1` ticks | `player_magic.rs2:227,231` |
| Overkill shot | The ranged and magic hit is queued, so the NPC's HP is still above 0 for the next shot's `npc_stat(hitpoints)=0` check. A wasted shot is possible when the delay exceeds the interval | `player_ranged.rs2:11-13` |
| Auto-retaliate flinch | When hit and idle, the player's `%action_delay = clock + attackrate/2` (rapid -1) | `S/skill_combat/scripts/player/auto_retaliate.rs2:7-22` |
| Eating | `%action_delay += 3` per normal food (it adds to the delay, it is not a max), so an eat mid-fight costs 3 ticks of swinging | `S/player/scripts/consumption/consume.rs2:115-131` |
| Bury | `p_stopaction` then `p_delay(0)`: it breaks the attack interaction (a re-click is needed) and holds 1 tick; `bone_exp` (bones 45, big 150, dragon 720 tenths) | `S/skill_prayer/scripts/bury_bone.rs2:1-16`; `S/skill_prayer/configs/bones.obj:12,56,82` |
| Pickup | `opobj3`: on the item's tile, `obj_takeitem` with no delay (the walk to the tile is the cost) | `S/player/scripts/pickup.rs2:1-16` |
| Ranged ammo | 4/5 fall under the NPC (`random(^dropammo_chance=5) != 0`, tile not blocked), 1/5 destroyed | `player_ranged.rs2:123-134`; `S/skill_combat/configs/combat.constant:4` |
| Attack range | weapon `attackrange` param, +2 on longrange, max 10; autocast 10 | `player_combat.rs2:159-170` |

### 1.5 NPCs

| Fact | Value | file:line |
|---|---|---|
| Stats | npc config `attack= defence= strength= hitpoints= ranged= magic=`, default 1 each | `E/cache/config/NpcType.ts:106,180-190` |
| Bonuses | npc `param=attackbonus, strengthbonus, <type>defence`, default 0 | `combat.param:1-69` |
| Damage type | `param=damagetype`, default 2 | `S/skill_combat/configs/npc_combat.param:1-3` |
| Attack speed | `param=attackrate`, default 4 (hill and moss giants 6) | `combat.param:76-79`; `all.npc` giant/mossgiant |
| NPC melee attack roll | `(npc_attack + 9) * (attackbonus + 64)` | `S/skill_combat/scripts/npc/npc_combat_melee.rs2:12-17` |
| NPC melee max hit | `combat_maxhit((npc_str + 9) * (strengthbonus + 64))` | `npc_combat_melee.rs2:2-8` |
| NPC swing | rolls against the player's defence roll for the NPC's damagetype; damage `randominc(max)`; `%npc_action_delay = clock + attackrate` | `npc_combat_melee.rs2:20-48` |
| Default NPC AI | `ai_opplayer2` -> `npc_default_attack`; **198 `ai_opplayer2/ai_applayer2` triggers: 184 keyed by NPC, 13 by category (`_witch`, `_snail`, ...), 1 the global default `[ai_opplayer2,_]`; the engine looks up NPC, then category, then global (`E/engine/script/ScriptProvider.ts:124-134`): 178 NPCs have an override** (dragons: 1/4 dragonfire) | `npc_combat.rs2:1-4,57-75`; `S/npc/scripts/dragon.rs2:17-20,60-65` |
| Dragonfire | max 30 (+20 when the magic roll wins), 5 with the anti-dragon shield, 10 with protect from magic, -15 with antifire | `dragon.rs2:99-133` |
| Retaliation | a hit queues `ai_queue1`: if ready, `%npc_action_delay = clock + attackrate/2` and the NPC moves to opplayer2. Retreat at `retreat` HP | `npc_combat.rs2:7-28,318-322,367-370` |
| Respawn | `npc_del` -> `removeNpc(npc, respawnrate)`, scaled `trunc((4000-min(players,2000))*rate/4000)` (60 -> 59 for one player) | `E/engine/script/handlers/NpcOps.ts:117`; `E/engine/World.ts:1507-1513,2042-2046` |
| respawnrate default | 100 ticks (chicken 50; giants and dragons 60) | `NpcType.ts:105`; `all.npc` |
| Death delay | `npc_arrivedelay` (up to 2 ticks) + `npc_delay(1)` before `npc_del` | `S/skill_combat/scripts/npc/npc_death.rs2:10-24` |
| Kill ledger | the engine records every 0-HP `npc_del` (tick, killer, damage split) to `KILL_LEDGER_FILE`: a ready calibration source | `NpcOps.ts:96-116` |
| Aggression range | `huntrange` tiles, `check_vis=lineofsight`; giants 2, moss 2, green dragon 4, chicken none | `E/engine/entity/Npc.ts:996`; `all.npc` |
| Hunt modes | config `huntmode=`: cowardly 163 NPCs, aggressive_melee 19, aggressive_ranged 17, ...; `S/_unpack/225/all.hunt` | `all.hunt:36-45,70-78` |
| Level cutoff | `check_nottoostrong=outside_wilderness`: skip a player whose combat level > `vislevel*2` unless they are in the Wilderness (giant 28 -> 56, moss 42 -> 84) | `Npc.ts:1011`; `all.hunt:40` |
| Combat level | `(10*(def+hp+prayer/2) + max(13*(att+str), 13*(3*ranged/2), 13*(3*magic/2))) / 40` (each `/` truncates: `scale(3, 2, ...)`) | `S/player/scripts/combat_level.rs2:1-10` |
| Tolerance timer | **none in this engine** (no tolerance code). An NPC that found a target stops hunting until `resetDefaults`/respawn (`find_keephunting=off`) | `Npc.ts:985-989,429-438` |
| Single-way lockout | an NPC skips a player hit in the last 8 ticks by another (`check_notcombat`) | `Npc.ts:1014-1021`; `npc_combat.rs2:382-399` |
| XP multiplier | `param=combat_xp_multiplier` (default 1000); only quest and antimacro NPCs change it | `combat.param:164-167`; `S/npc/scripts/ai_spawn.rs2:2` |

Seed NPCs (`all.npc`):

| NPC | att/def/str/hp | bonuses | attackrate | dmg type | respawn | hunt | vislevel | death_drop |
|---|---|---|---|---|---|---|---|---|
| chicken | 1/1/1/3 | att -47, str -42, all def -42 | 4 | stab | 50 | none | 1 | bones |
| giant (hill) | 18/26/22/35 | att 18, str 16, def 0 | 6 | crush | 60 | cowardly r2 | 28 | big_bones |
| mossgiant | 30/30/30/60 | att 33, str 31, def 0 | 6 | crush | 60 | cowardly r2 | 42 | big_bones |
| green_dragon | 68/68/68/75, magic 68 | stab 20, slash 40, crush 40, magic 30, range 20 | 4 | slash | 60 | cowardly r4 (always in the Wilderness) | 79 | dragon_bones (+ green hide) |

### 1.6 Damage to the player

| Fact | Value | file:line |
|---|---|---|
| Player defence roll | `(def*prayer/100 + 8 + defstyle) * (<type>defence bonus + 64)` | `player_combat_stat.rs2:65,84-92`; `player_combat.rs2:82-90` |
| NPC hit test | `randominc(npc_attack_roll) > randominc(player_defence_roll)` | `npc_combat.rs2:103-110`; `npc_combat_melee.rs2:27` |
| Damage | `queue(combat_damage_player, 0, randominc(max))`; ring of recoil reflects 10%+1 | `npc_combat_melee.rs2:28,47`; `npc_combat.rs2:356-365` |
| Food heal | consume_table `stat_heal` (W/model/items.ts readFoods) | `S/player/configs/consumption/consume_normal.dbrow` |

Worked example (scratch arithmetic, not a model): a hill giant against a player at Defence 40 with no armour.
The NPC attack roll is 27*82 = 2214 and the player's defence roll is 48*64 = 3072, so p = 0.36. The max hit is 4,
which gives 0.12 HP/tick, about 1,080 HP/h at 9,000 ticks/h. At Defence 70 the figure is about 670 HP/h. Measured
food use was "28-55 fish/h", about 250-500 HP/h (`conductor/roadmap.md:177`). Section 7 covers the gap.

### 1.7 XP per damage

The XP is `base = damage*10` in tenths, then `scale(mult,1000, scale(k,100,base))`, then `stat_advance`. Each value
is multiplied by XP_RATE (25, `E/util/WorldConfig.ts:102`; read by `W/model/server.ts`).

| Style | XP | file:line |
|---|---|---|
| Accurate / aggressive / defensive | 4 per damage to att / str / def | `combat.rs2:145-150` |
| Controlled | trunc(13.3*d) tenths each to att, str, def | `combat.rs2:151-154` |
| Ranged accurate / rapid | 4 per damage to Ranged | `combat.rs2:155-156` |
| Ranged longrange | 2 Ranged + 2 Defence | `combat.rs2:157-159` |
| Magic | spell `experience` on every cast, splashes included (`pvm_spell_cast` before the roll), + 2 per damage | `player_magic.rs2:77,168-170`; `S/skill_magic/scripts/magic.rs2:108-109`; `combat.rs2:160-161` |
| Magic, defensive | with `%damagestyle = style_melee_defensive` left set, a cast pays 1.33 Magic + 1 Defence per damage. This explains the "+32k Defence" from magic-blast-giants (`conductor/roadmap.md:171`) | `player_magic.rs2:205-208`; `combat.rs2:162-164` |
| Hitpoints | trunc(13.3*d) tenths per hit, every style | `combat.rs2:167` |
| Cap | damage capped at the NPC's remaining HP before XP | `player_melee.rs2:32-33`; `player_ranged.rs2:52-53`; `player_magic.rs2:239-240` |
| Prayer | bury: `bone_exp` | `bury_bone.rs2:15` |
| Cannon | `stat_advance(ranged, ...)` 2 per damage *10 | `S/quests/quest_mcannon/scripts/cannon_fire.rs2:119` |

So melee XP per kill is exactly `40*HP` tenths to the trained skill. HP XP per kill is the sum over hits of
trunc(13.3*d), which is slightly under 13.3*HP. The exact expectation follows from the per-swing damage distribution.

### 1.8 Loot

| Fact | Value | file:line |
|---|---|---|
| Format | one `[ai_queue3,<npc>]` script per NPC (234 `ai_queue3` triggers, 78 files in `S/drop tables/scripts/`): `gosub(npc_death)`, `obj_add(npc_param(death_drop))`, then a `random(128)` if/else-if chain of `obj_add(obj, count)` | `S/drop tables/scripts/giant.rs2:1-59`; `moss_giant.rs2:1-70`; `chicken.rs2:1-22`; `green_dragon.rs2:1-56` |
| Shared procs | `~randomherb` (random(128) chain; coins 10 when not members), `~randomjewel` (random(128); ring of wealth -> random(65)) | `S/drop tables/scripts/shared_droptables.rs2:2,37-60` |
| dbrow tables | `drop_table` (total, drop LIST), `~roll_on_drop_table`: used by no NPC, only mining's gem rocks (`S/skill_mining/scripts/mining.rs2:257`); NPC drops are `random` chains | `S/drop tables/configs/drop_table.dbtable:1-3`; `S/drop tables/scripts/drop_table.rs2:1-20` |
| Branches | `map_members` branches (members worlds only, per memory) and tertiary clue procs (`trail_*`) | `moss_giant.rs2:20-25`; `green_dragon.rs2:12` |
| Default drop | `death_drop` param default `bones` | `npc_combat.param:29-31`; `npc_combat.rs2:96-101` |
| Ground duration | 200 ticks | `S/drop tables/configs/lootdrop.constant:1` |
| Value | obj `cost` (W/model/items.ts readItems), the same as gp/hr today | `W/model/items.ts:1003-1014` |
| Loot goes to the hero | `npc_findhero` (the most damage); irrelevant for a single bot | `giant.rs2:3-5` |

### 1.9 Multi-combat and the Wilderness

| Fact | Value | file:line |
|---|---|---|
| Multiway zones | `server/content/maps/multiway.csv` (8x8 zones), loaded by the engine and by the world index | `E/engine/GameMap.ts:58-59,102`; `W/sources/zones.ts:39,46` |
| Site flags | `Site.multiway`, `Site.wildernessLevel` | `W/types.ts:84-85`; `W/place.ts:401-402` |
| Wilderness level | `floor((z - box.z)/8) + 1` | `W/sources/zones.ts:74-77` |
| Single-way rule | the player can't attack another NPC while one other than the target hit them in the last 8 ticks; an NPC another is fighting is refused | `player_combat.rs2:101-132` |
| Kill resets lockout | `npc_death` clears `%lastcombat` | `npc_death.rs2:20` |
| In multi | the lockouts are skipped, so several aggressive NPCs can hit at once; `npc_forcemulti` param forces it | `player_combat.rs2:106`; `combat.param:187-189` |
| Wilderness aggression | `check_nottoostrong` is off in the Wilderness: cowardly NPCs hunt every level | `Npc.ts:1011`; `E/engine/entity/Player.ts:2211-2215` |

What this means for one bot not using multi-target attacks: multi changes only the **damage taken** (several
aggressive NPCs at once) and lets other NPCs pile in mid-kill. It never adds XP. In single-way areas at most one NPC
attacks at a time.

### 1.10 Equipment

| Fact | Value | file:line |
|---|---|---|
| Bonuses | obj `param=`: stab/slash/crush/magic/range attack, stab/slash/crush/magic/range defence, strengthbonus, prayerbonus, rangebonus; summed over `worn` | `S/player/scripts/equip.rs2:244-284` |
| Weapon fields | `category` (style table), `attackrate`, `attackrange`, `levelrequire` (ranged ammo-tier check), `wearpos` | `S/skill_combat/configs/melee/scimitars.obj:175-202`; `S/skill_combat/configs/ranged/bows.obj:315-344`; `player_ranged.rs2:97` |
| Wield levels | `[opheld2,<obj>] @levelrequire_attack(N, last_slot)` per obj, in `S/levelrequire/scripts/tier{1..70}.rs2` (base level) | `S/levelrequire/scripts/levelrequire.rs2:6-28`; `tier10.rs2:2-17` |
| Staves | `magic_staff_table` maps staff -> rune(s) it provides | `S/skill_magic/scripts/magic.rs2:53-88` |
| Example | rune scimitar: slash 45, str 44, attackrate default 4; mithril scimitar slash 21, str 20; magic shortbow range 69, attackrange 7 | `scimitars.obj:175-197,135-139`; `bows.obj:315-337` |

### 1.11 Existing conductor combat knowledge

| Item | Where | Notes |
|---|---|---|
| Task | `conductor/tasks/combat.ts` (593 lines) | params target, skill (Att/Str/Def/Ranged/Magic), area, weapon, shield, ammo, spell, food, eatBelow, buryBones, loot, maxLevelGap (:91-120); manual casts (`CAST_DELAY_TICKS = 5`, `conductor/actions/cast.ts:20`) |
| Plans | `conductor/plans/hill-giants.ts` (Str, Mithril scimitar, giants (3107,9834) r12, bury, Edgeville bank); `giants-att-def.ts` (Att then Def); `magic-blast-giants.ts` (Wind Blast + Staff of air, same giants); `ranged-magic-chickens.ts` (Wind Strike, then Shortbow + bronze arrows, chickens (3231,3295) r8) | none sets `method:`; `plans.test.ts` lists them as unlinked |
| Measured, hill giants | Str 54->70 541k/h (598 s), Att 40->68 582k/h (654 s), Def 40->70 635k/h (664 s); Prayer ~60k/h, HP ~180k/h alongside; ~48 ticks/kill; food 28-55 fish/h | `conductor/roadmap.md:177` |
| Measured, hill giants (skill page) | ~619k Str/h Mithril (51 ticks/kill, 83% swinging), Steel 429k/h (73 ticks/kill) | `wiki/skills/strength.md:15` |
| Measured, Magic | Wind Blast on giants, 41->66 in 641 s, ~673k/h, 10.9 ticks/cast incl. kill/loot/bury, ~4 casts/kill | `conductor/roadmap.md:171` |
| Measured, Ranged | Shortbow, chickens 13->40, ~86k/h | `conductor/roadmap.md:172` |
| Measured, chickens and cows | chickens Def 108k, Str 83k, Att 55k (early); cows Att 173k, Str 201k / 329k (22 ticks/kill after the idle fix) | `conductor/roadmap.md:203`; `wiki/skills/attack.md:36`; `strength.md:14` |
| Model claims (uncommitted) | "model fits measured within ~10%"; moss giants +28%; rune scimitar ~2.5 h for 70->99; green dragons ~170k Prayer/h; Ranged on giants 0.75-1.4 h | `conductor/roadmap.md:23-25,50,177-178`; `wiki/skills/attack.md:27-29`; `wiki/skills/prayer.md:45`; `wiki/skills/ranged.md:57` |
| World sites | giants `npc:edgeville-dungeon:5/7/8` (2+1+9, single-way); moss `npc:edgeville-dungeon:20/21` (2+2, **multiway**); green dragons `npc:wilderness:39/44/49/55/61` (1 each, Wilderness 37-38); chickens `npc:misthalin:38` (9) | `wiki/world.json` (jq) |
| No `nearest` on npc sites | SINKS has no `npc` entry | `W/distance.ts:72-85` |

## 2. Worked example (scratch arithmetic, to size the model)

Hill giant (def 26, HP 35, all defence bonuses 0) against a Mithril scimitar (slash 21, str 20, 4 ticks).
E[swings] comes from a DP over remaining HP with P(0) = 1-p+p/(m+1) and P(k) = p/(m+1).

| Profile | p | max | E[swings] | ticks/kill | XP/kill (x25) | XP/h, swings only | +8 ticks/kill |
|---|---|---|---|---|---|---|---|
| Str 62, Att 40, aggressive | 0.725 | 10 | 10.5 | 41.9 | 3,500 | 752k | 631k |
| Att 54, Str 70, accurate | 0.797 | 10 | 9.5 | 38.1 | 3,500 | 826k | 683k |

The measured 541-619k Str at ~48-51 ticks/kill sits about 10-25% under the swings-only floor. That fits the
roadmap's ~10% claim once the per-kill overhead is counted. Respawn never binds for one bot at 12 giants:
12/(42+59+3) is about 0.115 kills/tick, against about 0.024 for the player.

## 3. Proposed design

### 3.1 What an action is

One **kill** of the method's target NPC with one style. A `combat` family (kinds `['npc']`) returns an ActionModel
built as follows:

| ActionModel field | Combat value | Source |
|---|---|---|
| `ticksPerAttempt` | `E[attacks to kill] x interval + retarget` (retarget = run ticks to the next spawn beyond the cooldown, 0 when it fits inside it) | 1.1-1.4 |
| `success` | 1 | |
| `xpTenths` | trained skill(s) `k x HP` (40 melee and ranged, 20+20 longrange, 13.3x3 controlled), HP `E[sum trunc(13.3d)]`, Magic `casts x spell_xp + 20 x HP`, Prayer `bone_exp` when bones are buried | 1.7 |
| `products` | `death_drop` + expected drop table (parsed), at members | 1.8 |
| `consumes` | runes per kill (casts x the spell's runes less the staff's), ammo per kill (shots x 1/5 when the fallen 4/5 are picked up, else 1) | 1.4, 1.10 |
| `successTicks` | death-delay overhead, if not covered by retarget | `npc_death.rs2:15,23` |
| **new** `damagePerSuccess` | E[NPC hits during the kill] x P(npc hit) x max/2 (+ dragonfire mix for dragons) | 1.5-1.6 |
| `deplete` | `{chance: 1, respawnTicks: scaled respawnrate + death delay}` | 1.5 |
| `features` | spawns of the target in the method's area | world.json |
| `tools` | the worn weapon (wieldable, so it takes no slot) | |

`rate.ts resourceCap` already gives `k/(ticksPerKill + R)`, the respawn cap, unchanged.

### 3.2 Cycle changes (`W/model/cycle.ts`)

1. **Damage per success.** Food per success = `(damagePerSuccess + failDamage x fails/success) / heal`, with
   HP regen at 1/100 ticks subtracted (optional). Eat ticks = `EAT_DELAY` per food (the eat adds to `%action_delay`,
   consume.rs2:129-131). There is no p/p^2 window as in pickpocket: a combat eat always lands inside a cooldown.
2. **Loot policy, so food and loot can share a trip.** Today `cycle.ts:221-223` refuses food with a
   non-stackable product. A combat method needs a `keep` policy: stackables kept (coins, runes); bones `bury` (an
   in-place process step: 1 tick + a re-click, Prayer XP) or `bank` or `leave`; other non-stackables `leave` (or a
   list). A left product drops out of gp/hr. Food fills the free slots, and the trip ends when the food runs out
   (the existing food branch).
3. **Supplies.** Runes and arrows are stackable supplies (one slot each), which already fits `consumes`.

### 3.3 Profile

The Profile gains:

- `worn: Partial<Record<WearPos, string>>`. Bonuses are summed from obj params, with the weapon's attackrate,
  category and attackrange.
- `style` is **not** in the Profile. It is chosen per queried skill (see 3.4).
- `prayers?: { attack?: 105|110|115; strength?; defence? }` and `boosts?: Partial<Record<Skill, number>>` (current
  minus base), both default none. The levels stay current levels, as today.
- `combatLevel` is derived from the levels (combat_level.rs2) and used for aggression.
- A wield-level check (levelrequire scripts) raises a ProfileError when a worn item needs more than the profile has.

### 3.4 Methods, query and pages

- `MethodDef` gains `gear` (a worn set, like `food` today), `params: { npc, spell?, ammo? }` and an `area`
  (a radius around `at`) that collects the target's spawns across sites. The giants span 3 sites and the dragons 5.
  `sink` stays `bank` (food restock). `loot` is the keep policy.
- **Style is picked by the skill being ranked.**
  - `bestMethods('strength')` rates each melee method on aggressive.
  - `'attack'` rates it on accurate and `'defence'` on defensive. A shared-XP method could also be ranked on
    controlled.
  - `'ranged'` rates bow methods on rapid, and `'magic'` rates spell methods.
  - `'hitpoints'` takes the best of a method's styles.
  - `'prayer'` rates methods that bury.
  - `ResolvedMethod.skill` and `levels` then come from the styles the gear allows, not from `Family.skills[0]`.
    `trains()` reads `levels`, so it needs no change.
- **Hazard gains** `aggressive` (the target or another hunting config at the site, at the profile's combat level:
  `huntmode` set, `huntrange > 0`, `combat <= vislevel*2` or Wilderness), plus `maxHit` (the largest NPC max hit at
  the site). `bestMethods` options: `aggressive?: false`, `maxWilderness`, and `multiway` (as today).
- **Pages.** `wiki/training/{attack,strength,defence,hitpoints,ranged,magic,prayer}.md` have the same table shape, a
  level column per trained skill, every other skill at the same level (profileAt), the method's gear, and Food/hr in
  Supplies. A gear-tier note goes in the row's details. One extra column: **kills/hr**.
- **Measured.** `Measured.tool` becomes `worn?: string[]`. `conductor/lib/methods.ts runStart` already reads the
  held items (inventory and equipment), so it can record worn gear and combat levels.

### 3.5 What stays out of the floor (proposed)

Cannon, multi-target spells and specials, PvP, poison (weapon poison 1/4 is small), and NPC overrides other than
dragons. An NPC with an `ai_opplayer2` override not modelled gets a ModelError naming the script, until it is
modelled.

## 4. Decisions for the user

1. **Styles in scope.** Melee only first (Att/Str/Def/HP), then Ranged and Magic? Or all three in one family from the
   start? (Recommend: one family, built in the task order below with melee first, Ranged and Magic in task 6.)
2. **Prayers and potions in the floor.** Boost-free floor by default, with optional Profile `prayers`/`boosts` that
   the query can pass? Or ignore them entirely? Potion decay (1 level/100 ticks) and prayer drain would be supplies.
   (Recommend: optional Profile fields, default off; no drain or decay model in phase 4.)
3. **Gear.** One gear set per method record (curated, like `food`)? Or the best gear the profile holds (needs an
   inventory of owned gear and a best-in-slot search)? (Recommend: the record names its gear; the query's Profile
   `worn` overrides it.)
4. **Cannon and multi-target.** Exclude both? (Recommend: yes. Multiway stays a hazard flag only.)
5. **Drops and gp/hr.** Parse the drop-table scripts now (gp/hr and Herblore herb supply, which the roadmap flags as
   the long pole)? Or ship bones-only first? (Recommend: parse; the 4 seed tables are regular. Unparsable tables
   fail with a ModelError naming the script.)
6. **Bones.** Should the floor bury in place (Prayer XP, a tick plus a re-click per bone) or leave them? Is burying a
   method-level choice? (Recommend: a `loot` policy on the record; green dragons bury.)
7. **Aggression in `bestMethods`.** Is it a filter only (`aggressive?: false`, like `multiway`)? Or should it add
   modelled damage from other hunters in multi? (Recommend: filter plus a hazard field; no extra damage.)
8. **Overhead per kill.** A geometric retarget (run ticks between spawns over the site) or a stated constant?
   (Recommend: geometric, using the mean nearest-spawn distance in run ticks.)
9. **Damage-model calibration.** Accept a first-cut damage/food model, flagged as unvalidated, until a worker run
   reads hitsplats and the kill ledger? Or block the food numbers until then?
10. **Column semantics for combat pages.** Should "every other skill at the column's level" apply, so Defence and HP
    rise with Attack? That matches profileAt. The alternative is a fixed defence/HP floor.

## 5. Seed methods

| id (proposed) | Target / where | Gear | Food / loot | Plans | Measured figures to start from | Notes |
|---|---|---|---|---|---|---|
| `hill-giants-edgeville` | `giant`, at (3113, 9840), area r12 (the 12 spawns of sites :5/:7/:8), single-way | mithril scimitar (+ armour unknown) | salmon/trout; bury big bones | hill-giants, giants-att-def, magic-blast-giants | Str 541k (54->70, main, 598 s) and 619k (w3, 10 min); Att 582k (40->68); Def 635k (40->70); Magic 673k (41->66, Wind Blast + Staff of air) | re-derive each as a `stats.ts --methods` entry once the family resolves; the Magic figure has the defensive-style Defence split |
| `moss-giants-edgeville` | `mossgiant`, (3158, 9903)/(3165, 9879), 4 spawns, **multiway**, hunts combat <= 84 | rune or mithril scimitar | food; bury big bones | none yet (the first plan failed on a path) | none | roadmap: +28% over hill giants at equal overhead |
| `green-dragons-wilderness` | `green_dragon`, 5 sites (3078-3118, 3810-3821), Wilderness 37-38, aggressive (Wilderness) | scimitar + anti-dragon shield | food; bury dragon bones (72 each) | none | none | roadmap Prayer leg: ~170k Prayer/h modelled; dragonfire model needed |
| `chickens-lumbridge` | `chicken`, (3230, 3299), 9 spawns, no aggression | shortbow + bronze arrows; Wind Strike; melee | none; feathers, arrows picked up | ranged-magic-chickens | Ranged ~86k (13->40); early melee Att 55k, Str 83k, Def 108k | low levels; tests the no-food branch |

Cows (`plan-melee40`, Att 173k, Str 201k/329k) are measured, but `plan-melee40` is not a promoted plan. Add the method
only if the user wants a low-level melee row.

## 6. Proposed sdd-loop task list (primitives first)

1. **Combat formulas** (`W/model/combat.ts`). Effective levels (prayer, style, +8 and +9), attack and defence
   rolls, exact hit chance, max hits (melee, ranged, spell), the per-swing damage distribution with the HP cap,
   E[attacks to kill] by DP, expected HP XP with per-hit truncation, combat level. Each function cites its script.
   Tests worked by hand (the hill giant and chicken numbers above).
2. **Game-data readers.**
   - NPC combat records (config stats and params with combat.param and npc_combat.param defaults; attackrate,
     damagetype, huntmode/huntrange/vislevel, respawnrate, death_drop, max_dealt, combat_xp_multiplier).
   - Equipment: bonuses, attackrate, attackrange, category -> style table from `combat.dbrow`, wield levels parsed
     from `S/levelrequire/scripts/*.rs2`.
   - Spells (`magic_combat_spells.dbrow`), staves (`magic_staff_table`), bones (`bone_exp`).
   - Tests on the seed NPCs and items.
3. **Profile and gear.**
   - `Profile.worn`, optional `prayers`/`boosts`, and gear bonus sums.
   - A wield-level ProfileError.
   - `profileOf`/`profileAt` with gear, and `measuredProfile` reading `worn`.
   - The ripple: woodcutting and mining keep `axe`/`pickaxe` (or derive them from `worn.weapon`; decide in the spec).
4. **Drop-table parser** (`W/sources/droptables.ts`).
   - Parses `[ai_queue3,<npc>]` scripts: fixed `obj_add`, `random(N)` if/else-if chains, `~randomherb`,
     `~randomjewel`, `~roll_on_drop_table` and the `drop_table` dbrows, `map_members` taken as true, tertiary
     `trail_*` dropped.
   - Gives the expected products per kill.
   - An unsupported shape gives a ModelError naming file:line.
   - Tests on giant, moss_giant, chicken, green_dragon and one dbrow table.
5. **Cycle extensions** (`W/model/cycle.ts`, `family.ts`): `damagePerSuccess`, food with a loot policy (keep, bury
   in place, leave), eat ticks as `EAT_DELAY` per food, and a bury step's ticks and Prayer XP. Unit tests on
   hand-built ActionModels; the existing family tests stay green.
6. **Combat family** (`W/model/families/combat.ts`).
   - Melee (style from the queried skill), Ranged (rapid, ammo recovery) and Magic (5-tick casts, spell XP per cast,
     runes less the staff).
   - Retarget ticks from spawn geometry; deplete/features from the spawns in the area.
   - Damage taken from the NPC's default melee AI, plus the dragon override (dragon.rs2). Other overrides get a
     ModelError.
   - Tests worked by hand per style on the seed NPCs.
7. **Methods, query and world.**
   - `MethodDef` gear, area and loot.
   - A skill -> style resolution, so `levels`/`skill` come from the styles.
   - npc sites get `nearest.bank` (SINKS `npc: ['bank']`), with a world.json rebuild.
   - Hazard `aggressive`/`maxHit` and the `bestMethods({ aggressive })` option.
   - `stats.ts --methods` and `lib/methods.ts` record worn gear and combat levels.
   - Tests, including `plans.test.ts` links.
8. **Pages, seeds and docs.**
   - Combat training pages (kills/hr column, Food/hr).
   - The four seed records with plans linked (`method:` on hill-giants, giants-att-def, magic-blast-giants,
     ranged-magic-chickens) and the measured figures.
   - "Phase 4 as built" in `conductor/docs/world-index.md` and the Methods section of `W/README.md`.

## 7. Open questions and risks

- **Damage taken against food measured.** The formulas give about 1,080 HP/h at Def 40 with no armour. Measured
  food is about 250-500 HP/h. Before task 6, check against the kill ledger (`NpcOps.ts:96-116`) and a run's
  hitsplats on a worker. Candidates: the bot's armour, NPC swing cadence (flinch, mode changes, `npc_check_notcombat`
  gaps between kills), and the time between kills when no NPC is attacking.
- **The player's first swing on arrival** happens on the op tick when `%action_delay` has passed. Walking during the
  cooldown is free, so retarget costs only beyond the interval. This needs a unit test against a replay
  (`conductor/tools/replay.ts`).
- **Overkill shots at Ranged and Magic** (queued damage) waste up to one attack per kill when the projectile delay
  exceeds the interval. Model it or bound it.
- **198 NPC AI overrides.** Phase 4 models the default AI and dragons only. Each new target checks for an override.
- **Site clustering.** A method area that spans sites (giants, dragons) needs its reach and legs taken from one
  stand. Use the site that holds `at`, and count the spawns within the area.
- **`Family.skills` is static today.** Combat needs per-params skills, which changes `resolveMethod`'s `skill` and
  `methodSkills` (`W/model/method.ts:565,613-616`).
