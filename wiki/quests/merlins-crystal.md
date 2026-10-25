# Merlin's Crystal

| Detail | Info |
|---|---|
| Quest id (`v.quest`, `conductor/lib/quests.ts:85`) | `arthur` |
| Varp | `%arthur` (varp 14, `quests/quest_arthur/configs/quest_arthur.varp:1`) |
| Side varp | `%excalibur_components_progress` (varp 15, bit flags, `quest_arthur.varp:4`) |
| Complete at | 7 (`general/configs/quest.constant:4`) |
| Quest points | 6 (`general/configs/quest.constant:73`) |
| Members | yes (Excalibur, black candle and bat bones are members objs) |

Everything on this page is read from the server scripts and game data on 2026-10-23 (paths are under
`server/content/scripts/`); the bot route (`plan:merlins-crystal`) ran start to finish on questw3 (phases under Plan status). Coordinates are `(x, z)` with ` L<n>` above
level 0.

## Requirements

- No quests, no skill levels. The journal asks for the ability to beat a level 39 enemy (Sir Mordred,
  `quests/quest_arthur/scripts/arthur_journal.rs2:10`).
- Excalibur needs Attack 20 to wield (`levelrequire/scripts/tier20.rs2:16`); this quest only uses it from the
  inventory.

## Rewards

- 6 quest points and the quest-complete scroll (`quests/quest_arthur/scripts/quest_arthur.rs2:273-276`). No XP:
  the quest has no `stat_advance`.
- Excalibur stays with the player. Completing Merlin's Crystal is what lets King Arthur start Holy Grail
  (`areas/area_camelot/scripts/king_arthur.rs2:43`).

## Stages

`quests/quest_arthur/configs/quest_arthur.constant:1-7`.

| Value | Constant | Set by |
|---|---|---|
| 0 | `^arthur_not_started` | - |
| 1 | `^arthur_started` | King Arthur, "I want to become a Knight of the Round Table!" (`king_arthur.rs2:81-92`) |
| 2 | `^arthur_spoken_gawain` | Sir Gawain, "Do you know how Merlin got trapped?" (`sir_gawain.rs2:16`, `:35-40`) |
| 3 | `^arthur_spoken_lancelot` | Sir Lancelot, "Any ideas on how to get into Morgan Le Faye's stronghold?", offered only at stage 2 (`sir_lancelot.rs2:15`, `:30-34`) |
| 4 | `^arthur_spoken_morgan_lefaye` | Morgan Le Faye after Sir Mordred is beaten, "Tell me how to untrap Merlin and I might." (`sir_mordred.rs2:28-41`) |
| 5 | `^arthur_excalibur_bound` | Thrantax bound with the right words at the magic symbol (`quest_arthur.rs2:181-193`) |
| 6 | `^arthur_freed_merlin` | Excalibur used on the Giant crystal at stage 5 (`quest_arthur.rs2:249-267`) |
| 7 | `^arthur_complete` | King Arthur at stage 6 (`king_arthur.rs2:48-51`, queue at `quest_arthur.rs2:273`) |

Bits of `%excalibur_components_progress` (`quest_arthur.constant:9-13`), none shown in the quest tab:

| Bit | Constant | Set by | Cleared by |
|---|---|---|---|
| 0 | `^chaosaltar_index` | Check on the Chaos altar at stage 4 (`quest_arthur.rs2:142-148`) | binding Thrantax (`:190`), Excalibur on the crystal (`:260`) |
| 1 | `^blackcandle_index` | Candle maker, "Have you got any black candles?" at stage 4; toggled again when he trades the candle (`areas/area_catherby/scripts/candle_maker.rs2:12`, `:36`) | binding Thrantax (`:190`) |
| 2 | `^excalibur_started` | The Lady of the Lake, "I seek the sword Excalibur." (`areas/area_taverly/scripts/lady_of_the_lake.rs2:42-43`) | the same talk again (reset), the crystal (`:260`) |
| 3 | `^excalibur_spoken_beggar` | refusing the beggar ("No I don't have any bread with me.", `quests/quest_arthur/scripts/beggar.rs2:48-51`) | as bit 2 |
| 4 | `^excalibur_rewarded` | giving the beggar bread (`beggar.rs2:35-46`) | as bit 2 |

The plan view sees only `none` / `started` / `done` from the quest tab (`conductor/docs/plans.md`), so a plan picks
its phase from the inventory and the previous phase, and ends on `v.questDone('arthur')`.

## Walkthrough (bot route)

Each step: who or what (config display name), where, the exact dialog choices, items, stage change.

1. **King Arthur** (2764, 3515), Camelot ground floor, wanders. Choices: "I want to become a Knight of the Round
   Table!". Stage 0 -> 1.
2. **Sir Gawain** (2763, 3506), Camelot ground floor. Choices: "Do you know how Merlin got trapped?", then "Thank you
   for the information." (or "Any idea how to get into Morgan Le Faye's stronghold?", which only says he is
   stumped). Stage 1 -> 2. Gawain can wander into the garden behind the Door (2766,3504), where `talk` fails "no reachable Sir Gawain" (2 runs); an `interact` Open on that Door from (2766,3505) with `tile` (2766,3504) also failed "no reachable loc", so the way in is not established. [v 2026-10-24 conductor3 local]
3. **Sir Lancelot** (2759, 3515) L1, Camelot first floor; staircase (2750, 3510) up to (2750, 3513) L1. Choices: "Any
   ideas on how to get into Morgan Le Faye's stronghold?" (option 3 of 3). Stage 2 -> 3.
4. **Crate** (`merlincrate_empty`, op "Hide-in") at (2801, 3442), Catherby, south-west of the bank. Works from stage
   3 (`quest_arthur.rs2:3`); before that "You have no reason to do that...". Dialog: a message box, then
   "Yes." (hide), about 20 message boxes of the voyage, then "Yes." (get out) (`quest_arthur.rs2:2-34`, `:68-77`).
   Lands at (2778, 3401) on the Keep Le Faye jetty. The keep's Large door (2763, 3401/3402) is locked from
   outside (`quest_arthur.rs2:94-97`); the crate is the only way in.
5. **Sir Mordred** (2769, 3403) L2, top floor of Keep Le Faye. From the jetty: staircase (2769, 3404) up to (2769,
   3407) L1, then staircase (2769, 3398) up to (2769, 3401) L2. Talk-to or Attack starts the fight
   (`sir_mordred.rs2:1-5`). At stage 3 his death is caught (`sir_mordred.rs2:7-13`): he is healed, the fight
   stops and **Morgan Le Faye** appears at (2770, 3403) L2. Choices: "Tell me how to untrap Merlin and I
   might." (stage 3 -> 4), then any of "So where can I find Excalibur?", "What are the magic words?", "OK I will go
   do all that." (the last ends it; Morgan vanishes, `sir_mordred.rs2:73-77`). Do not pick "No. He deserves to
   die." (kills Mordred, no stage change) or "Ok then." (Morgan leaves, no stage change). Leave the keep by
   walking out of the front **Large door** (2763, 3401/3402) from inside, which opens west
   (`quest_arthur.rs2:94-116`): `travel` from the keep to (2802, 3440) level 0 succeeded. The exit **Crate**
   (`merlincrate_empty2`, "Hide-in", "Yes." then "Yes.", puts the player at (2802, 3441); `quest_arthur.rs2:38-66`) is a
   level-1 map loc at (2779, 3401) on a bridge-flag tile; the server lowers it to level 0 and the lite client does
   too (SceneLite), so `interact {name:"^Crate$", option:"^Hide-in$", at:{x:2778,z:3401,level:0}}` opens its dialog
   [v 2026-10-24 questw1 local]. The Morgan dialog opens on level 2, the crate-in dialog on
   level 0. [v 2026-10-23 questw3 local]
6. **Chaos altar** (`thrantaxaltar`, op "Check") at (3239, 3608), the small Chaos Temple in Wilderness level 12.
   Only at exactly stage 4 (`quest_arthur.rs2:143`); sets bit 0 and shows the words "Snarthon Candtrick
   Termanto". No NPCs spawn within 12 tiles of it (world index). PvP Wilderness: carry nothing of value.
7. **Black candle** (`unlit_black_candle`):
   - **Candle maker** (2800, 3439), Catherby candle shop. At stage 4 choose "Have you got any black candles?"
     (sets bit 1, `candle_maker.rs2:17-36`).
   - Wax: pick up the **Insect repellent** ground spawn at (2807, 3450) (Catherby house; not sold anywhere,
     wiki/items/insect-repellent.md). Use it on a **Beehive** (nine `merlin_beehive` at x 2755-2762, z 3440-3447,
     west Catherby): "You see bees leaving the hive." The repellent is not used up (`areas/area_seers/scripts/bees.rs2:16-22`).
     Then use an empty **Bucket** on the hive (or "Take-from" with a bucket held) for a **Bucket of wax**
     (`bees.rs2:24-36`). The next take needs the repellent again; without it the bees sting for 2.
     Buckets: Arhein's store (2803, 3430), 2 gp, or a ground spawn at (2766, 3441) by the hives.
   - Talk to the Candle maker again with the wax: no choices; Bucket of wax -> Black candle (`candle_maker.rs2:1-14`).
8. **Light it**: use a Tinderbox on the Black candle (`skill_firemaking/scripts/firemaking.rs2:13-27`,
   `light_source.rs2:1-11`) -> **Lit black candle**. It stays lit while carried (only a few quest areas put
   candles out).
9. **Bat bones**: always dropped by **Giant bat** (level 27, 32 HP, max hit 3; wiki/npcs/giant-bat.md). Nearest:
   (2752, 3409) and (2753, 3396) just west of Keep Le Faye on the Catherby side, one more in the keep courtyard
   (2759, 3401); five around (2571-2594, 3473-3481) east of the Coal Trucks.
10. **Excalibur**:
    - **The Lady of the Lake** (2924, 3405), south of Taverley. At stage 4+ with no Excalibur in inventory, bank
      or worn, choose "I seek the sword Excalibur." (sets bit 2; `lady_of_the_lake.rs2:4-5`, `:37-43`).
    - Port Sarim jeweller's **Door** (`jewellersdoor`, "Open") at (3016, 3246). With bit 2 set, opening it puts a
      **Beggar** at (3016, 3247) and starts his dialog (`quest_arthur.rs2:210-223`). Hold one **Bread** and choose
      "Yes certainly.": the bread is taken, he turns into the Lady and gives **Excalibur** (bit 4,
      `beggar.rs2:18-46`). The Ladder (3013, 3244) inside only gets "I don't think you are worthy enough"
      (`quest_arthur.rs2:225-237`).
11. **Summon Thrantax** at the magic symbol (2780, 3515), Camelot (`^camelot_magic_symbol`,
    `quest_arthur.constant:18`). Stand within one tile of it (x 2779-2781, z 3514-3516) at exactly stage 4, with
    bit 0 set and a Lit black candle held, and **Drop** the Bat bones (`opheld5`, `quest_arthur.rs2:150-206`). The
    bones are not used up and the drop does not happen inside that square. The player is forced 2 tiles west,
    **Thrantax The Mighty** appears, and a choice of three phrases opens in random order. Choose "Snarthon
    Candtrick Termanto": stage 4 -> 5, bits 0-1 cleared. Either wrong phrase deletes the lit candle and Thrantax
    attacks (level 92, 80 HP; `_unpack/225/all.npc:4789`). Without bit 0: "I think I'd better learn the words of
    binding..."; without the candle or at another stage: "You can sense a powerful presence here...".
12. **Giant crystal** (`merlins_crystal`, 2x2) at (2767, 3493) L2, Camelot's south-east tower: ladder (2769, 3493)
    up to (2768, 3493) L1, ladder (2767, 3491) up to (2766, 3491) L2. Use **Excalibur** (from the inventory, not
    worn) on it at stage 5: stage 5 -> 6, the side varp is reset to 0 (`quest_arthur.rs2:239-267`). Before stage 5:
    "... but it seems to be protected by a dark force."
13. **King Arthur** at stage 6: no choices (`king_arthur.rs2:42`, `:48-51`). Stage 6 -> 7, quest complete.

Steps 6-10 can be done in any order once stage 4 is reached; step 11 needs 6, 7-8 and 9 done; step 12 needs 10 and 11.

## Fights

| NPC (config) | Where | Level | HP | Att / Str / Def | Bonuses | Max hit | Notes |
|---|---|---|---|---|---|---|---|
| Sir Mordred (`sir_mordred`) | (2769, 3403) L2 | 39 | 38 | 33 / 33 / 33 | att +20, str +16; def stab 99, slash 82, **crush 45** | 5 | slash attacks, attack rate 4 (default); respawn 50 ticks (`keep_le_faye.npc:45-91`) |
| Renegade Knight (`renegade_knight`) | 3 on L0 near (2769, 3398), 5 on L1 near (2770, 3402) | 37 | 48 | 28 / 28 / 28 | as Mordred, crush def 62 | 5 | `huntmode=cowardly` (`keep_le_faye.npc:1-43`) but they do attack: a combat-~50 bot idling on the jetty fell from HP 47 to 23 and had to kill one with `combat` [v 2026-10-23 questw3 local]; see `learnings/hazards.md` |
| Thrantax The Mighty (`thrantax`) | the magic symbol | 92 | 80 | 80 / 80 / 80 | crush | ~9 | only after a wrong phrase; avoid |
| Giant bat | see step 9 | 27 | 32 | 22 / 22 / 22 | none | 3 | flees when attacked |

Max hits from the engine formula (`skill_combat/scripts/npc/npc_combat_melee.rs2:2-8`: (str + 9) x (str bonus + 64)
/ 640, rounded). Safe minimum for Mordred: **Attack, Strength and Defence 40, Hitpoints 40**, a crush weapon (his
crush defence is lowest) and 5 or more lobsters. From the same formulas such a bot kills him in about 60 s and
takes about 30-55 damage (more without armour). The combat task's default `maxLevelGap` (5) needs combat level
34 or more for a level 39 target.

Losing to Mordred: a normal death; he respawns in 50 ticks and the stage is unchanged. Come back with the crate.

## Items

| Item | Get it | Used / consumed |
|---|---|---|
| Bread | Ardougne Baker's Stall (Baker, (2654, 3311) / (2669, 3310)), 12 gp, stock 10; West Ardougne general store (2464, 3287), 14 gp. Wydin's Port Sarim Food Store lists bread with stock 0. The tutorial-skip starter kit has one. | consumed by the beggar |
| Bucket | Arhein (2803, 3430) 2 gp, or ground spawn (2766, 3441) | becomes the wax |
| Insect repellent | ground spawn (2807, 3450) only | reusable |
| Tinderbox | Arhein 1 gp | reusable |
| Bat bones | Giant bat drop | not consumed by the summon |
| Black candle -> Lit black candle | Candle maker, for one Bucket of wax | lost on a wrong phrase |
| Excalibur | the beggar (step 10) | kept |
| Food, crush weapon, armour | for Mordred | - |
| Coins | 500 only if Excalibur must be bought back (below) | - |

Banks: Catherby (2809, 3443), stand (2809, 3441), for the Catherby and Keep Le Faye steps; Seers' Village (2726, 3495)
for Camelot; Falador East / Draynor for Port Sarim; Edgeville for the Chaos Temple.

## Recovery

- Lost bread before the beggar: open the jeweller's Door again with bread held; the Beggar respawns (bit 3 set:
  he asks "Have you got any bread for me yet?", choose "Yes, here you go.", `beggar.rs2:1-13`, `quest_arthur.rs2:212-215`).
- Refused the beggar ("No I don't have any bread with me.", which the dialog guard's decline would pick): bit 3 is set;
  as above.
- Catalog recipe for the beggar door: `interact {target:"loc", name:"^Door$", option:"^Open$", tile:{x:3016,z:3246}, choices:["Yes certainly"]}` from (3015,3246) answers the dialog the Door opens (without `choices` the guard would pick the decline). The Chaos altar `interact` Check ends done on its inscription page. [v 2026-10-24 questw3 local]
- Lost Excalibur at stage 4-5: talk to the Lady again ("I seek the sword Excalibur."), which resets bits 2-4, and redo
  the beggar. At stage 6 or later (and after the quest) she sells it back for 500 coins (`lady_of_the_lake.rs2:20-35`).
- Lost or burned the candle (a wrong phrase) at stage 4: ask the Candle maker "Have you got any black candles?"
  again and bring another Bucket of wax (the bit toggles, `candle_maker.rs2:12`, `:36`).
- Lost the bat bones: kill another Giant bat.
- Morgan dialog closed or answered wrong (stage still 3): fight Mordred again (respawn 50 ticks).

## Movement

| Crossing | Bot can route it? |
|---|---|
| Camelot stairs (2750, 3510) and tower ladders (2769, 3493), (2767, 3491) | yes: `travel`/`at` climb them (walk-graph probe, 16-18 run ticks from the courtyard) |
| Catherby crate to Keep Le Faye | **no**: a scripted ride the world index leaves out as a quest transport (`wiki/world/gate-list.ts:961-963`); do it with `interact` + `talk` (Catherby coverage below) |
| Keep Le Faye front door (2763, 3401/3402) | **planner wrong from outside**: the SDK masks it as an ordinary door (not in `ONE_WAY_DOORS`, `sdk/pathfinding.ts:73-79`), so a walk from Catherby plans straight through it (probe: Catherby -> Mordred 45 run ticks, no hop) and is refused in game ("The door is securely locked"). From inside it opens west and `travel` from the keep to Catherby (2802, 3440) works. [v 2026-10-23 questw3 local] |
| Keep crate back to Catherby (`merlincrate_empty2`) | `interact` finds it (the lite client lowers bridge-tile locs to the server level, step 5); the world index has it only as far as the crate interior (2778, 9839) |
| Walks planned from Camelot L1 (Lancelot's floor) to Catherby | fail ("stops 54 tiles short at (2767,3497)"); `travel` to the level-0 courtyard (2762, 3508) first. [v 2026-10-23 questw3 local] |
| Keep stairs (2769, 3404), (2769, 3398) | yes (probe: jetty -> Mordred 14 run ticks) |
| Port Sarim jeweller's ladder | yes (a scripted crossing), but not needed |
| Chaos Temple (Wilderness 12) | `travel` with `wilderness: true` (probe: Edgeville -> altar ~100 run ticks); `interact` refuses a target there |

## Catalog coverage

| Step | Task | Params / notes |
|---|---|---|
| 1-3 Arthur, Gawain, Lancelot | `talk` | `{npc:"^King Arthur$", at:{x:2764,z:3515}, choices:["Knight of the Round Table"]}`; `{npc:"^Sir Gawain$", choices:["how Merlin got trapped","Thank you for the information"]}`; `{npc:"^Sir Lancelot$", at:{x:2759,z:3515,level:1}, choices:["get into Morgan Le Faye's stronghold"]}` |
| 4 crate in | `interact` then `talk` | `{target:"loc", name:"^Crate$", option:"^Hide-in$", at:{x:2801,z:3443}}` (done on "a dialog opened"), then `talk {continue:true, choices:["^Yes\\.$","^Yes\\.$"]}`, which answers the open dialog and lands the player at (2778, 3401). [v 2026-10-23 questw3 local] |
| 5 Mordred | `combat` (`stopOnDialog`, `eatBelow` 0.85) + `talk` | Verified from `merlins-crystal-start`: Arthur, Gawain, Lancelot, travel to (2762, 3508) L0, crate in, `combat` on Mordred with `stopOnDialog`, then `talk {continue:true}` for the Morgan dialog (stage 4). `stopOnDialog` settles ~100 ticks with Mordred still hitting; a low-HP eat during the settle closes Morgan's choice dialog and leaves the quest at stage 3 (hit by a combat-45 start; with combat 70 no lobster was eaten). `talk` (continue) and `interact` need `level` in `at` or they plan to level 0 even from the keep's L2. [v 2026-10-24 questw3 local]. |
| 5 leave the keep | `travel` | `travel {to:{x:2802,z:3440,level:0}}` from inside the keep (out of the front door). Verified. [v 2026-10-23 questw3 local] |
| 6 Chaos altar | `travel` + `interact` | `travel {to:{x:3239,z:3606}, wilderness:true}`, then `interact` Check on the altar with `wilderness:true` and `minFood` (opt-in per task), then `travel` out. The quest stage must be exactly 4. Check ends done on the inscription page (`interact` counts an op-opened page as the effect). Phases altar-go, altar-check, altar-leave. [v 2026-10-24 questw3 local] |
| 7 candle maker, wax | `talk`, `pickup`, `talk` (use) | `talk {npc:"^Candle maker$", choices:["black candles"]}`; `pickup {area:{x:2807,z:3450,radius:1}, items:[{item:"Insect repellent",count:1}]}` (the key is `item`, not `name`; works on the table tile since the adjacent-stand pickup change) [v 2026-10-23 questw3 local]; `talk {use:{items:["^Insect repellent$"], onLoc:"^Beehive$"}, at:{x:2758,z:3444}}`; `talk {use:{items:["^Bucket$"], onLoc:"^Beehive$"}}`; `talk {npc:"^Candle maker$"}`. The "Black candle" option appears only at stage 4. Asking again once the bit is set shows "Have you got any wax yet?" with no choices, so a talk that waits for choices fails. The Insect repellent is never used up. [v 2026-10-24 questw3 local] |
| 8 light candle | `items` | `combine {use:"^Tinderbox$", on:"^Black candle$", product:"^Lit black candle$"}`. Verified (phase light). [v 2026-10-24 questw3 local] |
| 9 bat bones | `combat` | `{target:"Giant bat", area:{x:2752,z:3405,radius:8}, loot:["Bat bones"]}` with `until: v => v.inv("Bat bones") >= 1`. Verified (phase bats). [v 2026-10-24 questw3 local] |
| 10 Lady, beggar | `talk`, `interact`, `talk` | `talk {npc:"Lady of the Lake", at:{x:2924,z:3405}, choices:["I seek the sword Excalibur"]}`; `interact {target:"loc", name:"^Door$", option:"^Open$", tile:{x:3016,z:3246}, choices:["Yes certainly"], onFail: continue}` from (3015,3246), then a dialog phase `talk {npc:"^Beggar$", choices:["Yes certainly"]}` near the door. The `choices` are required or the guard declines the bread choice; when the dialog opens mid-walk the `interact` can still report no-effect, hence `onFail` continue plus the beggar-talk phase. Re-talking to the Lady resets the declined flags. [v 2026-10-24 questw3 local] |
| 11 summon | `items` drop with `choices` | The Thrantax chant is answered by the `items` drop itself, with `choices:["^Snarthon Candtrick Termanto$"]` (phase summon), then bones-away and crystal. [v 2026-10-24 questw3 local] |
| 12 crystal | `talk` (use) | `{use:{items:["^Excalibur$"], onLoc:"^Giant crystal$"}, at:{x:2766,z:3491,level:2}}` |
| 13 Arthur | `talk` | `{npc:"^King Arthur$"}` |
| banking, shops | `bank`, `shop` | Arhein (bucket, tinderbox), Baker (bread) |

Plan status: **promoted** (`conductor/plans/merlins-crystal.ts`). A fresh load of `merlins-crystal-start` ran to quest done in 18.6 min on questw3 with no mid-run edits. Phase order: Arthur, Gawain, Lancelot, leave-floor, crate-in + crate-dialog, Mordred (combat `stopOnDialog`, `eatBelow` 0.85), Morgan (talk continue), keep-flee (`travel` `flee:true` when attacked), keep-out (front door), repellent (pickup adjacent take), candle-ask, Chaos altar (altar-go, altar-check, altar-leave), hive + hive-dialog, candle-wax, light, bats, Lady, beggar-door then beggar-talk, summon, bones-away, crystal, arthur-finish. [v 2026-10-24 questw3 local]

Observed in that run:
- Renegade Knights and Sir Mordred keep attacking in the keep after Morgan's scene; `travel` `flee:true` leaves.
- Camelot upper floors (Lancelot L1, the tower): walks planned from there fail ("stops 54 tiles short"); travel to the level-0 courtyard first, and give `at` level 0 for Arthur's final walk.
- Step 7 beehive: using the repellent then the bucket opens mesbox pages; a following `talk {continue:true}` with no choices finishes it and the wax arrives.
- Dialog history keeps one entry per page with wrapped lines: match short phrases (see `learnings/dialogs.md`); a phrase on a page that never appeared isn't recorded. The `items` task's drop `at` needs tolerance >= 1.

## Suggested library saves

Members world. Generated saves (`conductor/tools/library.ts generate`, spec keys `position`, `skills`, `inventory`,
`equipment`, `bank`, `varps`).

- `merlins-crystal-start`: Attack/Strength/Defence/Hitpoints 70; worn mithril mace, rune full helm, platebody, platelegs and kiteshield; inventory 10 lobsters (379), 1 bread (2309), 1 tinderbox (590), 1 bucket
  (1925), 600 coins; bank empty; varps `{"14":0}`; at Camelot (2758, 3505). Runs the whole quest (18.6 min on questw3). Combat 70 matters: at combat ~50 a low-HP eat during the Mordred settle closed Morgan's dialog. [v 2026-10-24 questw3 local]
- `merlins-crystal-summon`: the same stats; varps `{"14":4,"15":1}` (stage 4, altar words read); inventory lit black
  candle (32), bat bones (530), Excalibur (35), 5 lobsters; at (2780, 3512) in the library save (the symbol is (2780, 3515)); exists, untested. Tests steps 11-13 (the
  drop-and-chant gap) without the Wilderness. A wrong phrase there costs the only candle.
