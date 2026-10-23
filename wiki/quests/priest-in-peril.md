# Priest in Peril

| Detail | Info |
|---|---|
| Difficulty | Novice |
| Quest points | 1 (`general/configs/quest.constant:114`) |
| Quest id (plans, `v.quest('priestperil')`) | `priestperil` |
| Reward | Wolfbane dagger, 1,406 Prayer XP base = **35,150 Prayer XP** at 25x (Prayer 1 -> 51 on this server's level table); after one more talk to Drezel, the holy barrier into Morytania |

Script paths below are under `server/content/scripts/`. Steps 1-4 (Roald, knock, dog) ran on conductor2w5
[v 2026-10-16 conductor2w5 local] and again on questw5 (plan run 2026-10-23T09-18-02Z: Roald, knock, dog; a second run:
Roald, monks, Golden key, cell door, "Tell me anyway", "Yes" [v 2026-10-23 questw5 local]); the whole quest to stage 61 then ran end to end in plan `priest-in-peril` (section "Verified run"); anything not named there comes from the server scripts and map data [server data, unverified in game 2026-10-23].

## Requirements

- No quest requirement and no members check to start (`areas/area_varrock/scripts/king_roald.rs2:37-40`). The journal
  asks for the ability to defeat a level 30 enemy (`quests/quest_priestperil/scripts/priestperil_journal.rs2:7`).
- The 50 rune essence come only from the Rune Essence Mine, which needs **Rune Mysteries** complete
  (`essence-mine` task; essence is in no shop stock). So Rune Mysteries is required in practice.
- Combat: the `combat` task refuses NPCs more than 5 levels above the bot (`maxLevelGap`), so combat **25+** to fight
  the level-30 dog and the level-30 monks; 30+ with 5-10 cooked fish is comfortable.
- The dog takes melee or ranged only: spells are refused with "Your spells do not seem to affect it."
  (`skill_combat/scripts/npc/npc_combat.rs2:227-232`).

## Hazards

| NPC (config name) | Level, HP | Where | Behaviour |
|---|---|---|---|
| Temple guardian (`priestperilguarddog`) | 30, 45 HP; att/str/def 20, stab | dungeon (3405, 9902), wander 5 | not aggressive; attackable only at stage 2 (`areas/area_mausoleum/scripts/temple_guardian.rs2:14-22`) |
| Monk of Zamorak (`priestperilevilmonk1`) | 22, 20 HP | temple level 0 (3410,3484) (3410,3493); level 1 (3412,3489) (3414,3487) | not aggressive; 1 in 4 attacks cast weaken/confuse/curse (`quests/quest_priestperil/scripts/evil_monks.rs2:1-18`) |
| Monk of Zamorak (`priestperilevilmonk2`) | 17, 10 HP | level 0 (3415,3489); level 1 (3411,3485) (3415,3489) | as above (`evil_monks.rs2:20-36`) |
| Monk of Zamorak (`priestperilevilmonk3`) | 30, 25 HP | level 0 (3411,3489) (3415,3485); level 1 (3416,3491) | 1 in 4 attacks a magic zap, max 8 (`evil_monks.rs2:38-45`); **drops the Golden key** |
| Ghoul | 42, 50 HP, `huntmode=cowardly` range 3 | 11 at (3412-3420, 3509-3518), north-east of the trapdoor | behind the Salve: the SDK pathfinder finds no route from the trapdoor (3405, 3506) to them [server data: collision probe 2026-10-23] |

Monk configs: `quests/quest_priestperil/configs/priestperil.npc:1-81`; dog `:83-111`; spawns `maps/m53_54.jm2:5744-5777`,
`maps/m53_154.jm2:6138`. Monks wander 12 tiles.

## Quest state

Varp `%priestperil` (id 302, `pack/varp.pack:303`; `quests/quest_priestperil/configs/priestperil.varp:1`), and
`%priestperilvar` (id 303) holds the monument layout (below). Neither is sent to the client: a plan sees the quest
tab colour (`v.quest('priestperil')`), the inventory and the bot's position, so it orders steps by `v.runs` and by
the items each step leaves.

| Value | Constant (`configs/priestperil.constant`) | Set by | Plan sees |
|---|---|---|---|
| 0 | `not_started` | - | tab red |
| 1 | `started` | King Roald, "Sure." (`quests/quest_priestperil/scripts/priestperil.rs2:2`) | tab yellow |
| 2 | `agree_to_kill_dog` | knock dialog, "Sure." (`temple_doors.rs2:79`) | - |
| 3 | `killed_dog` | the dog dies with the bot as top damage (`temple_guardian.rs2:1-12`) | - |
| 4 | `return_to_drezel` | King Roald (`king_roald.rs2:79`) | the temple's Large door opens |
| 5 | `find_drezel_key` | Drezel through the cell door, "Tell me anyway." then "Yes." (`trapped_drezel.rs2:137`) | dungeon Gate (3405, 9895) opens |
| 6 | `unlocked_drezel` | Iron key used on the Cell door (`trapped_drezel.rs2:47-48`) | Iron key gone |
| 7 | `poured_blessed_water` | blessed water used on the Coffin (`vampire_coffin.rs2:8-17`) | a Bucket back in the inventory |
| 8 | `meet_in_mausoleum` | Drezel in the cell (`trapped_drezel.rs2:16-20`) | dungeon Gate (3431, 9897) opens |
| 10 | `begin_bring_essence` | Drezel in the dungeon (`areas/area_mausoleum/scripts/drezel.rs2:30-48`) | - |
| 11-59 | - | +1 per rune essence handed over (`drezel.rs2:90-97`) | essence leaves the inventory |
| 60 | `priestperil_complete` (`general/configs/quest.constant:47`) | the 50th essence (`drezel.rs2:103-104`, reward queue `priestperil.rs2:7-11`) | tab green, `v.questDone('priestperil')`, Wolfbane in the inventory |
| 61 | `access_holy_barrier` | talking to Drezel in the dungeon once more (`drezel.rs2:8-13`, `:138-147`) | the Holy barrier lets the bot through |

## Places

| Thing (config display name) | Tile (x, z, level) | Ops | Source |
|---|---|---|---|
| King Roald | spawn (3222, 3476) level 0, Varrock Palace | Talk-to | `maps/m50_54.jm2:11752` |
| Large door (temple, double) | (3408, 3488) and (3408, 3489) level 0; stand west, e.g. (3405, 3489) | Open, Knock-at | `maps/m53_54.jm2:4452-4453` |
| Trapdoor (mausoleum, north of the temple) | (3405, 3507); stand (3405, 3506); lands (3405, 9906) | Open, then Climb-down | world index `connector:morytania:0` |
| Ladder (dungeon, back up) | (3405, 9907) | Climb-up | `wiki/world.json` (`ladder_from_cellar`) |
| Gate (dog room to monument hall) | (3405, 9895) | Open, stage >= 5 | `areas/area_mausoleum/scripts/gates.rs2:1-2,7-13` |
| Monument x7 | (3416,9890) (3423,9895) (3428,9890) (3423,9884) (3427,9894) (3427,9885) (3418,9894) = grave 1..7 | Study, Take-from; use an item | `maps/m53_154.jm2:4276-4340`, `configs/priestperil.enum:1-10` |
| Well | (3423, 9890) | use a Bucket | `areas/area_mausoleum/scripts/well.rs2:8-17` |
| Gate (monument hall to Drezel's room) | (3431, 9897) | Open, stage >= 8 | `gates.rs2:4-5` |
| Drezel (dungeon, `priestperiltrappedmonk2`) | spawn (3440, 9895), wander 5 | Talk-to | `maps/m53_154.jm2:6139` |
| Holy barrier | (3440, 9886) | Pass-through, stage 61; lands (3423, 3485) on the Morytania side | `holy_barrier.rs2:1-9` |
| Trapdoor (east, Morytania side, `pipeastsidetrapdoor`) | (3422, 3485) | Open, then Climb-down; lands (3440, 9887) by Drezel | `holy_barrier.rs2:11-25`, `maps/m53_54.jm2:4732` |
| Staircase (temple) | (3417, 3484) level 0 -> (3416, 3485) level 1; (3417, 3492) -> (3416, 3493) level 1; down from (3417, 3485) / (3417, 3493) level 1 | Climb-up, Climb-down | `wiki/places/temple.md` |
| Ladder (temple) | (3410, 3485) level 1 -> (3409, 3485) level 2, and back | Climb-up, Climb-down | `wiki/places/temple.md` |
| Cell door | (3415, 3489) level 2; stand west (3414, 3489) | Open (stage >= 6), Talk-through | `maps/m53_54.jm2:5526`, `trapped_drezel.rs2:32-93` |
| Drezel (in the cell, `priestperiltrappedmonk`) | spawn (3417, 3489) level 2 | Talk-to | `maps/m53_54.jm2:5777` |
| Coffin | (3413, 3486) level 2, 2 tiles long; stand e.g. (3414, 3487) | Open; use an item | `maps/m53_54.jm2:5498` |

The dungeon is one area: the ladder landing (3405, 9906) reaches the monument hall and Drezel's room through the two
Gates (SDK pathfinder routes through both). [server data: collision probe 2026-10-23]

## Steps

| # | Who / what | Choices (in order) | Items | Stage |
|---|---|---|---|---|
| 1 | King Roald, Talk-to | `Sure.` (the other is "No, that sounds boring.") (`king_roald.rs2:55`) | - | 0 -> 1 |
| 2 | Large door, **Knock-at**, from outside (west); a dialog opens with no NPC | `Roald sent me to check on Drezel.`, then `Sure.` (`temple_doors.rs2:26-29`, `:60`) | - | 1 -> 2 |
| 3 | Trapdoor: Open, Climb-down; kill the **Temple guardian** (melee or ranged); Ladder Climb-up | - | food | 2 -> 3 |
| 4 | King Roald, Talk-to | none | - | 3 -> 4 |
| 5 | Kill a level-30 **Monk of Zamorak** (`priestperilevilmonk3`, temple level 0 or 1) until a **Golden key** drops; it drops on every such kill while stage < 6 (`evil_monks.rs2:47-49`) | - | loot Golden key | none |
| 6 | Temple: Staircase up, Ladder up; **Cell door, Talk-through** | `Tell me anyway.`, then `Yes.` (`trapped_drezel.rs2:69`, `:120`) | - | 4 -> 5 |
| 7 | Down to the dungeon (Trapdoor); **use Bucket on Well** -> bucket of murky water | - | Bucket consumed, Bucket of water (murky, obj 2953) added | none |
| 8 | **Use Golden key on the Monument that holds the Iron key** -> "You swap the Golden key for the Iron key." | - | Golden key consumed, Iron key added (`monuments.rs2:59-77`) | none |
| 9 | Back up to the temple top floor; **use Iron key on the Cell door** | none | Iron key consumed | 5 -> 6 |
| 10 | Cell door Open (or let the walk open it); **talk to Drezel** holding the murky water: he blesses it | none | murky water -> blessed water (obj 2954) (`trapped_drezel.rs2:10-12`, `:147-153`) | none |
| 11 | **Use the blessed Bucket of water on the Coffin** | none | blessed water -> Bucket (`vampire_coffin.rs2:9-17`) | 6 -> 7 |
| 12 | Talk to Drezel (cell) | none | - | 7 -> 8 |
| 13 | Down to the dungeon, through both Gates; talk to **Drezel** (3440, 9895) | none | - | 8 -> 10 |
| 14 | Talk to Drezel holding **unnoted Rune essence**; repeat until 50 handed over (28 a trip at most) | none | each essence consumed, +1 stage | 10 -> 60 |
| 15 | Talk to Drezel once more | none (continue pages) | - | 60 -> 61 |

Dialog notes:
- Step 2: knocking at stage 2 or 3 gives a reminder, at 4+ a choice of three joke lines; none moves the varp
  (`temple_doors.rs2:30-48`). "Nope." at the last knock choice ends it at stage 1.
- Step 6: in a run the `interact` phase (Talk-through) followed by a `talk` with `continue:true` kept the dialog open
  across the two phases and made both choices [v 2026-10-23 questw5 local]. "You're right, we don't." or "No." ends it at stage 4; talk through the door again.
- Step 14: each talk gives min(essence held, 60 - stage) and closes the dialog (`drezel.rs2:83-107`). Noted essence
  is refused ("How is that supposed to help me?", `drezel.rs2:75-81`): only unnoted rune essence counts.
- Step 14: the first Drezel talk at stage 8 is the meet dialog and takes no essence; later talks take it. [v 2026-10-23 questw5 local]
- Step 15: the stage-60 Drezel talk sets 61. A further talk opens the Nature Spirit dialog, a choice ("Well, I'm going to look around a bit more." / "Is there anything else interesting to do around here?"), which makes a `talk` with no choices end `failed` after the stage is already set (`onFail: 'continue'`). [v 2026-10-23 questw5 local]
- Roald talks about the Shield of Arrav instead when the bot carries the certificate or both shield halves
  (`king_roald.rs2:11-36`): bank them first.

## The monument key

Each of the 7 monuments shows one golden item; the layout is
`content = ((layout seed + 17 x grave) mod 7) + 1` (`monuments.rs2:23-24`), and content 3 is the Iron key
(`configs/priestperil.enum:23-32`). The seed is 0 until the player first **Studies** a monument, which rolls a random
seed (`monuments.rs2:18-21`, `:40-42`). With seed 0 the Iron key is in **grave 3, the Monument at (3428, 9890)**
(stand (3430, 9890), east of it; the nearest Monument from there). After a Study it can be any of the seven: then try
the Golden key on each (a wrong one answers "Nothing interesting happens.", `monuments.rs2:129`). Never use
**Take-from**: it hurts for 1-5 (`monuments.rs2:170-172`). Once Drezel is free (stage 8+) the monuments refuse
everything (`monuments.rs2:45-48`).

## Items to bring, where to get them

| Item | Need | Where |
|---|---|---|
| Bucket (empty) | 1 | Varrock General Store (3218, 3413), Shop keeper, 2 gp; Lumbridge General Store; the Coffin step gives it back |
| Weapon, armour | melee or ranged (the dog ignores magic) | bank, or any weapon shop |
| Food | 5-10 cooked fish | the account's bank |
| Rune essence (unnoted) | 50, at most 28 a trip | Rune Essence Mine via Aubury, Varrock (3252, 3402): `essence-mine` + `mining` rock "essence" |

Banks: **Varrock East** (3254, 3418) is the nearest, 89 run ticks from the temple area (3410, 3472)
(`wiki/world.json`). Canifis bank is behind the holy barrier (stage 61). Carry no other "Bucket of water": the murky,
blessed and plain buckets of water share that name (`configs/priestperil.obj:174-198`).

Timing: Roald, knock, bucket shop and the dog fight took about 3.5 min in total, the dog fight alone about 30 s
(combat level ~35; Strength +4500 XP on the kill) [v 2026-10-23 questw5 local].

## Recovery

| Lost | Recover |
|---|---|
| Golden key (stage < 6) | kill a level-30 monk again (`evil_monks.rs2:49`) |
| Iron key, before using it | a new Golden key, used on the same Monument: the swapped iron-key grave accepts it again (`monuments.rs2:59-77`) |
| Murky or blessed water | refill a Bucket at the Well (any stage, `well.rs2:8-15`); Drezel blesses it at stage 6 (talk) or at any stage when the murky bucket is used on him (`trapped_drezel.rs2:26-29`) |
| Rune essence handed over | kept: the varp counts it, more can follow on any later talk (`drezel.rs2:62-73`) |
| Wolfbane dagger (not in inventory, bank or worn) | talk to Drezel in the dungeon: he gives another (`drezel.rs2:9-10`, `:151-158`) |

## Movement: what a walk can route

- **Temple, stage 4-59**: the world index gates entering by the Large door (`quest:priestperil>=4`, from outside
  only, `wiki/world/gate-list.ts`), and the bot's account knows only "started" (`conductor/lib/account.ts:69-74`), so the
  walk graph walls the way in. A walk to a level-0 tile inside falls back to the SDK pathfinder, which opens the door
  (`conductor/actions/walk.ts` walkRoute, same-plane fallback). A walk from outside to level 1 or 2 fails
  `no-connector`. Walk to a level-0 tile inside first (or use the stairs and ladder with `interact`); from inside, an
  `at` on level 1 or 2 plans through the temple stairs and ladder. The way out is ungated.
- **Gate tokens (walk `met`)**: the dungeon gates in `wiki/world/gate-list.ts` (:299-300, :2084) are
  `quest:priestperil>=5` (Gate (3405, 9895)), `>=8` (Gate (3431, 9897)) and `>=6` (the cell door). A walk with only
  `met:["quest:priestperil>=4"]` into the dungeon failed `No connector from level 0 (3406, 3503) to (3422, 9889)`, and
  the same walk from temple level 2 (3415, 3489) failed `No connector from level 2 (3415, 3489) to (3422, 9889)`
  [v 2026-10-23 questw5 local]. With the tokens `quest:priestperil>=5` (Gate 1), `>=6` (cell door) and `>=8` (Gate 2)
  the dungeon walks route [v 2026-10-23 questw5 local]. The walk from temple level 2 into the dungeon with the right
  token was not tested: the plan climbs down by hand (Ladder, Staircase) and walks from the ground floor. [unconfirmed]
- **Dungeon**: the mausoleum dungeon is not one of `UNDERGROUND_AREAS` in `conductor/lib/connectors.ts`, so it is the
  lumped plane `0u` and its Trapdoor and Ladder are left out of the connector table. No walk goes down or up: use
  `interact` (Trapdoor Open, then Climb-down; Ladder Climb-up). Inside, walks fall back to the SDK pathfinder, which
  opens the two Gates at their stages.
- **Morytania**: the only way in is the Holy barrier (stage 61; there is no separate River Salve gate in this
  revision's world index). The walk graph cannot reach it (dungeon not routable), and `account.ts` counts a quest done
  as meeting every stage, so it would also take stage 60 for 61. Use `interact` Pass-through on the Holy barrier after
  step 15.

## Catalog coverage

| Step | Task | Params (sketch) | Notes |
|---|---|---|---|
| 1 | `talk` | `{npc:"^King Roald$", at:{x:3222,z:3476,tolerance:2}, choices:["^Sure"]}` | verified [v 2026-10-16 conductor2w5 local] |
| 2 | `interact` + `talk` | `{target:"loc", name:"^Large door$", option:"^Knock-at$", at:{x:3405,z:3489,tolerance:2}}`, then `{npc:"Drezel", choices:["Roald sent me","^Sure"]}` (no `at`) | interact leaves the dialog open; the talk with no `at` continues it [v 2026-10-16 conductor2w5 local] |
| 3 | `interact` x2, `combat`, `interact` | Trapdoor `{option:"^Open$", at:{x:3405,z:3506,tolerance:1}}` (`onFail:"continue"`: it may be open), `{option:"^Climb-down$"}`; `{target:"Temple guardian", skill:"Strength", area:{x:3405,z:9902,radius:8}, food:[...]}`; Ladder `{option:"^Climb-up$", at:{x:3405,z:9905,tolerance:2}}` | verified [v 2026-10-16 conductor2w5 local]. The `combat` task's own walk to the dog descends the trapdoor [v 2026-10-23 questw5 local]. The dog may be out of view at the landing; a phase `until` that tests "no dog in view" can hold before the fight. |
| 4 | `talk` | Roald, no choices | |
| 5 | `combat` | `{target:"Monk of Zamorak", area:{x:3413,z:3488,radius:6}, loot:["Golden key"], food:[...]}`, phase `until: v => v.inv('Golden key') > 0` | kills the level 17 and 22 monks too unless `level: 30` is set: `level:30` with `maxLevelGap` 20 killed only the key-dropping monk and looted the Golden key [v 2026-10-23 questw5 local]. Its walk to the area is the level-0 fallback through the Large door. |
| 6 | `interact` x2 + `interact` + `talk` | Staircase Climb-up `at:{x:3415,z:3485}`; Ladder Climb-up `at:{x:3411,z:3485,level:1,tolerance:1}`; `{target:"loc", name:"^Cell door$", option:"^Talk-through$", at:{x:3414,z:3489,level:2,tolerance:1}}`; then `{npc:"Drezel", choices:["^Tell me anyway","^Yes"]}` | |
| 7 | `talk` (use only) | `{use:{items:["^Bucket$"], onLoc:"^Well$"}, at:{x:3422,z:9889,tolerance:2}}` | after the trapdoor `interact`s; the walk opens the first Gate |
| 8 | `talk` (use only) | `{use:{items:["^Golden key$"], onLoc:"^Monument$"}, at:{x:3430,z:9890,tolerance:0}}` | grave 3 with the unstudied layout; `use` takes the nearest Monument by name, so the stand tile picks it |
| 9 | `talk` (use only) | `{use:{items:["^Iron key$"], onLoc:"^Cell door$"}, at:{x:3414,z:3489,level:2,tolerance:1}}` | |
| 10 | `interact` + `talk` | Cell door Open (`onFail:"continue"`); `{npc:"^Drezel$", at:{x:3416,z:3489,level:2,tolerance:2}}` | |
| 11 | `talk` (use only) | `{use:{items:["^Bucket of water$"], onLoc:"^Coffin$"}, at:{x:3414,z:3487,level:2,tolerance:2}}` | only the blessed bucket may be held |
| 12 | `talk` | Drezel in the cell, no choices | |
| 13 | `talk` | `{npc:"^Drezel$", at:{x:3438,z:9895,tolerance:3}}` | after the trapdoor; the walk opens both Gates |
| 14 | `essence-mine`, `mining`, `travel`, `interact`, `talk` | enter; `{rock:"essence", onFull:"stop"}`; leave; travel to (3405, 3504); trapdoor; talk to Drezel | loop on `v.full` (not "28 essence": pickaxe, coins and food take slots); plan `until: v => v.questDone('priestperil')` |
| 15 | `talk` | Drezel in the dungeon, no choices | needed before the barrier |
| barrier | `interact` | `{target:"loc", name:"^Holy barrier$", option:"^Pass-through$"}` | lands (3423, 3485), Morytania side |

**No task can do today** (gaps, most important first):

1. **Reading the quest stage.** The varps are never sent, so a plan cannot tell stage 1 from 4 or resume mid-quest;
   a restarted plan replays from its first phase, and step 1's `choices:["^Sure"]` then fails (no choice at stage 1+).
   Needs a server-to-client signal for quest varps, or a stage inferred from what each step leaves (the "Plan sees"
   column). Until then, test each leg from a library save at a known stage.
2. **Walking into the temple's upper floors mid-quest** in one walk. Needs a `met` param on `travel`, `talk`,
   `interact` and `combat` passed to the walk (`WalkOptions.met` in `conductor/actions/walk.ts` exists; no task
   exposes it), e.g. `met:["quest:priestperil>=4"]`.
3. **Routing in and out of the dungeon and into Morytania.** Needs a `paterdomus` box (about x 3392-3455,
   z 9856-9919, level 0) in `UNDERGROUND_AREAS` (`conductor/lib/connectors.ts`) so the mausoleum Trapdoor and Ladder
   become connectors, the east Trapdoor (3422, 3485) as a connector row (`wiki/world/sources/connectors.ts`), and
   `account.ts` not counting a done quest as stage 61.
4. **Targeting one loc or one item exactly.** `talk.use` takes the nearest loc matching a name and the first item
   matching a name: a loc tile param (`use.at`) would pick the monument without relying on the stand tile, and an item
   id would tell the three "Bucket of water" objs apart.
5. **Quest stage as plan evidence.** A predicate can test the dialog text a step leaves in `state.recentDialogs`
   (`learnings/dialogs.md`): "Find the key to your cell" after the cell talk (stage 5), Drezel's stage-60 line "Okay, I will
   keep it equipped whenever I fight werewolves" (`drezel.rs2` `drezel_access_holy_barrier`). The cell line
   ("find the key to your cell") worked as plan evidence; Drezel's stage-60 line did not appear in `recentDialogs` in the
   proof run, so do not rely on it [v 2026-10-23 questw5 local].

## Verified run (plan priest-in-peril)

`conductor/plans/priest-in-peril.ts`, promoted: done in 20.0 min from `lib:priest-in-peril-start` on questw5 (log `conductor/runs/questw5/2026-10-23T09-55-06-043Z-plan-priest-in-peril.ndjson`), ending with the Holy barrier Pass-through landing at (3423, 3485). [v 2026-10-23 questw5 local]

- Start save `lib:priest-in-peril-start`: Varrock east bank (3254, 3420), Rune Mysteries done, Attack 40 Strength 47 Defence 40 Hitpoints 48, Mining 1, rune mace and adamant full helm, platebody, platelegs, kiteshield, 100 coins, Pot, bronze pickaxe, 8 lobsters. Not shrunk further.
- Gains: Prayer 35,150, Mining 6,750, Strength 7,200, Hitpoints 2,370; combat level 50 to 57.
- Essence: 18 per trip with a pickaxe and 8 lobsters held, 3 trips for 50. Each talk hands over min(held, 60 - stage). Mine entry and exit gotchas: `learnings/mining.md`.
- Two phases (`fill`, `pour`) ran twice, the repeat failing on a stale inventory view: `learnings/dialogs.md`.
- Phase seconds: roald-start 34, knock 62, knock-talk 11, dog 54, bucket 57, to-palace 17, roald-dog 27, monks 85, cell-door 17, cell-choices 24, fill 34, swap 3, enter-temple 25, up-stairs 4, up-ladder 4, unlock 6, bless 8, pour 14, cell-7 8, drop-marker 2, down-ladder 15, down-stairs 6, mine 219, leave-mine 10, enter-mine 156, leave-dungeon 50, give 231, drezel-61 18, pass-try 2.
- Holy barrier: stand (3440, 9889), Pass-through lands (3423, 3485). The plan's `pass` phase fails before stage 61 and continues.

## Library saves for testing

None exists. Suggested (generated with `bun conductor/tools/library.ts generate`; `varps` sets the stage; obj ids from
`pack/obj.pack`): all with Attack/Strength/Defence 35, Hitpoints 35, a steel scimitar worn, 8 trout (333), varp 63
(Rune Mysteries) = 6, varp 303 = 0 (unstudied monuments).

- `pip-start`: varp 302 = 0, a Bucket (1925), 100 coins, in Varrock Palace by King Roald (3220, 3473). The whole
  quest up to the essence.
- `pip-temple-stage4`: varp 302 = 4, a Bucket, outside the Large door (3405, 3489). Steps 5-13 (monks, cell door,
  dungeon, coffin).
- `pip-dungeon-stage5`: varp 302 = 5, Golden key (2944) and a Bucket, at the dungeon ladder landing (3405, 9906).
  Steps 7-8 and the walk through the first Gate.
- `pip-essence-stage10`: varp 302 = 10, 28 Rune essence (1436) in the inventory and 22 in the bank, by the mausoleum
  Trapdoor (3405, 3506). Steps 14-15 and the barrier.
