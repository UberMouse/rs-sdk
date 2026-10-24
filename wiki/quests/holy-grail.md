# Holy Grail

| Detail | Info |
|---|---|
| Quest id (`v.quest`, `conductor/lib/quests.ts:88`) | `grail` |
| Varp | `%grail` (varp 5, `quests/quest_grail/configs/quest_grail.varp:1`) |
| Complete at | 10 (`general/configs/quest.constant:27`) |
| Quest points | 2 (`general/configs/quest.constant:95`) |
| Members | yes (the whistle and the Entrana boat check `map_members`) |

Read from the server scripts and game data on 2026-10-23 (paths under `server/content/scripts/`) unless a line
carries a run tag. Coordinates are `(x, z)` with ` L<n>` above level 0.

## Requirements

- **Merlin's Crystal** complete: King Arthur offers this quest only at `%arthur = ^arthur_complete`
  (`areas/area_camelot/scripts/king_arthur.rs2:41-45`). See [merlins-crystal.md](merlins-crystal.md).
- **Attack 20** to wield Excalibur (`levelrequire/scripts/tier20.rs2:16`), which must be worn when the Black Knight
  Titan dies.
- No other quests, no quest points, no other skill checks in the scripts.
- Beating the Black Knight Titan (level 120) in melee: see Fights.

## Rewards

`quests/quest_grail/scripts/quest_grail.rs2:113-119`:

- `stat_advance(prayer, 110000)` and `stat_advance(defence, 153000)`: 11,000 Prayer and 15,300 Defence XP base, which
  the server's 25x makes **275,000 Prayer XP and 382,500 Defence XP** (`Player.addXp`, `server/engine/src/engine/entity/Player.ts:1889`).
  On this server's table that is level 80 Prayer and level 85 Defence from zero XP (`conductor/lib/xp.ts`).
- 2 quest points. The Holy grail is taken from the inventory.
- After the quest the Magic whistle travels between Karamja and the restored Fisher Realm (After the quest, below).

## Stages

`quests/quest_grail/configs/quest_grail.constant:1-7`. There is no stage 1, 5 or 6.

| Value | Constant | Set by |
|---|---|---|
| 0 | `^grail_not_started` | - |
| 2 | `^grail_started` | King Arthur, "Tell me of this quest." then "I'd enjoy trying that." (`king_arthur.rs2:53-68`) |
| 3 | `^grail_spoken_merlin` | Merlin in his workshop (`areas/area_camelot/scripts/merlin.rs2:6-30`) |
| 4 | `^grail_spoken_crone` | the Crone, reached by talking to the High Priest of Entrana at stage 3-7 (`areas/area_entrana/scripts/high_priest_of_entrana.rs2:3-12`, `quests/quest_grail/scripts/grail_crone.rs2:9-11`) |
| 7 | `^grail_failed_defeat_titan` | the Titan "dies" at stage 4 while the player does not wear Excalibur (`quests/quest_grail/scripts/black_knight_titan.rs2:30-33`) |
| 8 | `^grail_finding_percival` | the Fisher King, "You don't look too well." from any stage below 8 (`quests/quest_grail/scripts/fisher_king.rs2:22-33`) |
| 9 | `^grail_given_whistle` | Sir Percival takes a Magic whistle (`quests/quest_grail/scripts/sir_percival.rs2:39-48`) |
| 10 | `^grail_complete` | King Arthur with the Holy grail at stage 9 (`king_arthur.rs2:26-33`, queue `quest_grail.rs2:113`) |

The plan view sees only `none` / `started` / `done`, so phases choose from the inventory (napkin, whistles, grail)
and the previous phase, and the plan ends on `v.questDone('grail')`.

## Walkthrough (bot route)

1. **King Arthur** (2764, 3515), Camelot. Choices: "Tell me of this quest.", "I'd enjoy trying that.". Stage 0 -> 2.
2. **Merlin**: open the **Door** (`merlinworkshop`) at (2764, 3503) L1 (Camelot first floor, staircase (2750, 3510)).
   Entering through it at stage 2+ spawns **Merlin** (`merlin2`) at (2767, 3500) L1 for 500 ticks
   (`quest_grail.rs2:1-14`); at stage 0 "The door won't open." Talk: one choice at the end, "Thank you for the
   advice." (or "Where can I find Sir Galahad?"). Stage 2 -> 3.
3. **Entrana**: no weapon or armour carried or worn (Excalibur, axes and pickaxes included;
   `areas/area_port_sarim/scripts/monk_of_entrana.rs2:26-53`). Bank them first.
   - **Monk of Entrana** at Port Sarim (3045-3049, 3234-3236): "Yes, okay, I'm ready to go." Lands on the ship
     deck (2834, 3331) L1; cross the **Gangplank** (2834, 3333) L1 to (2834, 3335).
   - **High Priest** (2851, 3349), Entrana church. No choice of his own: at stage 3-7 he spawns the **Crone** at
     (2851, 3342) for 500 ticks and her dialog runs on (`high_priest_of_entrana.rs2:3-12`). Choice: "Ok, I will go
     searching." (`grail_crone.rs2:12`, `:31-33`). Stage 3 -> 4.
   - Back: **Monk of Entrana** on Entrana (2830-2839, 3335): "Yes, I'm ready to go." -> Port Sarim deck (3048,
     3231) L1, **Gangplank** (3048, 3232) L1 to (3048, 3234) (`areas/area_entrana/scripts/monk_of_entrana.rs2:1-10`).
4. **Galahad** (`brother_galahad`) at (2612, 3474), the house west of McGrubor's Wood (a few rats outside). At stage 4
   with no napkin in the inventory: "I seek an item from the realm of the Fisher King." -> **Holy table napkin**
   (`areas/area_seers/scripts/brother_galahad.rs2:33-34`, `:52-55`, `:95-98`).
5. **Draynor Manor**, top floor: open the **Door** (`whistledoor`) at (3106, 3361) L2 while holding the napkin and
   fewer than 2 whistles: two **Magic whistle** drop at (3107, 3359) L2 for half the usual ground-item time
   (`quest_grail.rs2:30-35`; each open drops two more). Stairs: (3108, 3363) Walk-up to (3108, 3366) L1, (3104, 3362)
   Climb-up to (3105, 3364) L2. The front door only opens from outside (`sdk/pathfinding.ts:73-79`); the planner walks
   in and out without it (probe: Lumbridge -> whistle tile 130 run ticks, manor L2 -> Draynor 93). Ghosts (level 19)
   on L1. Take both whistles: one for the player, one for Percival.
6. **The six heads**, Karamja: blow a **Magic whistle** ("Blow") standing in x 2740-2743, z 3234-3237 (NW of
   Brimhaven; poison scorpions, level 20, cowardly, at (2731, 3225)). Below stage 9 it lands at (2806, 4715) in the
   **blighted Fisher Realm** (`quest_grail.rs2:37-45`). Getting to Karamja (no bank there):
   - **Captain Barnaby** at Ardougne (2679, 3275), 30 coins, "Yes please." -> Brimhaven deck (2775, 3234) L1,
     **Gangplank** (2774, 3234) L1 to (2772, 3234), then about 49 run ticks to the heads.
   - or **Captain Tobias** / **Seaman Lorris** / **Seaman Thresnor** at Port Sarim (3026-3028, 3216-3221), 30 coins,
     "Yes please." -> Musa Point deck (2956, 3143) L1, **Gangplank** (2956, 3144) L1 to (2956, 3146), then about 137
     run ticks (one door).
7. **Black Knight Titan** (2791, 4722) blocks the only way west from the landing (planner: its east side is reachable,
   its west side is not). Talk-to ("Ok, have at ye oh evil knight!") or Attack. **Wear Excalibur** when it dies:
   then the player is moved to the far side of it, (2790, 4722) from the east, and it drops its loot
   (`black_knight_titan.rs2:27-46`). Without Excalibur worn it heals to full, says "...I...Am...INVINCIBLE!!!", and
   stage 4 becomes 7 (`black_knight_titan.rs2:30-37`). It respawns in 10 ticks. A Magic whistle also lies at (2806,
   4710) by the landing (more at (2755, 4728), (2761, 4689), (2762, 4677) L1).
8. **Fisherman** (`grail_fisherman`) at (2802, 4706), reachable from both sides of the Titan. Choice: "Any idea how to
   get into the castle?": a **Grail bell** appears at (2762, 4694) for 500 ticks (`grail_fisherman.rs2:1-13`). Pick it
   up (west of the Titan).
9. Ring the **Grail bell** ("Ring") within 4 tiles of a **Grail Maiden** (at (2760, 4688), (2763, 4690), (2766, 4680),
   (2769, 4686)) inside the blighted realm: the player is moved into the castle at (2761, 4692)
   (`quest_grail.rs2:52-62`). The castle is not walkable from outside or back out (planner probe); leave by whistle.
10. **The Fisher King** (2762, 4688) L1: staircase (2761, 4680) Climb-up to (2762, 4682) L1. First menu: "You don't look
    too well." (`fisher_king.rs2:3`, `:22-33`); the rest has no choices. Stage -> 8.
11. Blow the whistle anywhere in the realm: back at (2741, 3235) on Karamja (`quest_grail.rs2:46-47`). Return to the
    mainland: **Customs officer** at Brimhaven (2772, 3225) / (2772, 3231): "Can I journey on this ship?", "Search
    away, I have nothing to hide.", "Ok." (30 coins) -> Ardougne deck (2683, 3268) L1, **Gangplank** (2683, 3269) L1 to
    (2683, 3271) (`areas/area_karamja/scripts/customs_officer.rs2:1-84`).
12. **Sacks** (`percy_sacks`, op "Open") at (2960, 3507), Goblin Village (goblins level 5, Generals Bentnoze and
    Wartface; not aggressive at combat 40+). At stage 8 **Sir Percival** appears at (2959, 3506) and his dialog opens
    (`quest_grail.rs2:20-27`). Choice: "Your father wishes to speak to you." With a Magic whistle held he takes it:
    stage 8 -> 9. Without one: "I will just go and get you one." (talk to him again with a whistle; he stays 500
    ticks). King Arthur's Magic gold feather only points at these sacks; it is not needed.
13. Blow a whistle at the six heads again: at stage 9 it lands at (2678, 4715) in the **restored realm**, inside an oak,
    and the player steps out of it [v 2026-10-19 itest-fixture local]. The **Holy grail** lies at (2649, 4684) L2:
    staircase (2648, 4683) Climb-up to (2649, 4685) L1, ladder (2651, 4684) Climb-up to (2650, 4684) L2 (planner: 44
    run ticks from the landing). Take it (`quest_grail.rs2:64-73`): refused below stage 9, and refused if one is
    already held, banked or worn.
14. Blow the whistle in the realm -> Karamja, ship back as in step 11, walk to Camelot (Ardougne -> Camelot about 121
    run ticks).
15. **King Arthur** with the Holy grail at stage 9: no choices (`king_arthur.rs2:26-33`). Quest complete.

## Fights

| NPC (config) | Where | Level | HP | Att / Str / Def | Bonuses | Max hit | Notes |
|---|---|---|---|---|---|---|---|
| Black Knight Titan (`black_knight_titan`) | (2791, 4722), blighted realm | 120 | 142 | 91 / 100 / 91 | att +27, str +22; def stab 18, slash 27, crush 18; **magic and ranged def 1000** | 15 crush | attack rate 7 ticks, not aggressive, stationary, respawn 10 ticks (`quests/quest_grail/configs/fisher_realm.npc:268-312`) |

Special rules:

- Only melee hurts it in practice (magic and ranged defence 1000), and only a death while **Excalibur is worn**
  counts (`black_knight_titan.rs2:30`). Use Excalibur as the weapon throughout (slash +29, str +25, speed 5).
- **Protect from Melee** (Prayer 43, `skill_prayer/configs/prayers.dbrow:121-128`) makes its hits 0
  (`skill_combat/scripts/npc/npc_combat_melee.rs2:44-46`).
- A death far away (over 11 tiles) skips the reward (`black_knight_titan.rs2:18-25`).

Safe minimum without prayer, from the engine's melee formulas (`npc_combat_melee.rs2`, `skill_combat/scripts/combat.rs2`;
modelled, not run): **Attack, Strength and Defence 70, Hitpoints 70, full rune armour (crush defence about +190) and
15-20 lobsters or swordfish**: about 125 s to kill, about 80 damage taken on average. At 60 with half the armour it is
about 160 s and 170 damage; at 50 without armour it is not winnable on food. Combat level is then about 85, so the
`combat` task needs `maxLevelGap` 40 or more. With Protect from Melee on, any bot that can wield Excalibur wins
slowly.

Losing to the Titan: a normal death (3 items kept). Its stage effect is only 4 -> 7, which changes nothing later.
Galahad's stage-7 dialog advises Excalibur and replaces a lost napkin (`brother_galahad.rs2:9-29`).

## Items

| Item | Get it | Notes |
|---|---|---|
| Excalibur | from Merlin's Crystal; The Lady of the Lake sells it back for 500 coins if lost (`areas/area_taverly/scripts/lady_of_the_lake.rs2:20-35`) | worn for the Titan; banked for Entrana |
| Holy table napkin | Galahad (step 4) | needed only to make the Draynor door drop whistles |
| Magic whistle x2 | Draynor Manor door (step 5), or ground spawns in either realm | one is given to Percival; the other is not used up |
| Grail bell | the Fisherman (step 8) | 500-tick ground item |
| Holy grail | restored realm L2 (step 13) | taken by Arthur |
| Coins | about 120 (four 30-coin ship fares) | |
| Food, rune armour | for the Titan | banked for Entrana |

Banks: Seers' Village (2726, 3495) or Catherby (2809, 3443) for Camelot; Draynor / Falador East around Port Sarim and
Draynor Manor; Ardougne for the Karamja trips. Karamja and Entrana have none.

## Recovery

- Lost napkin: at stage 4-9, Galahad, "I'm on a quest to find the Holy Grail!" then "Why did you leave?" gives another
  when none is in the inventory (`brother_galahad.rs2:51`, `:70-76`); at stage 7 also "I have lost the holy table
  napkin" (only if none in inventory or bank, `:14-24`). Not after the quest (he only makes tea, `:2-8`).
- Lost whistles: the Draynor door again (napkin held, fewer than 2 whistles), or the realm ground spawns.
- Bell gone (500 ticks): ask the Fisherman again.
- Titan beaten without Excalibur worn: wear it and fight again (it healed).
- Percival gone: open the Sacks again at stage 8.
- Lost Excalibur: the Lady of the Lake, 500 coins.

## Movement

| Crossing | Bot can route it? |
|---|---|
| Camelot stairs; Merlin's workshop door (gate `quest:grail>=1`, `wiki/world/gate-list.ts:1435`) | yes (probe 18 run ticks; the account reads "started" from the quest tab) |
| Entrana boat, both ways | **no walk**, a `talk` (`travels:true`) plus gangplank `interact` phase pair does it: see [ships](../../learnings/ships.md). The loadout rule `entrana` is in world.json. |
| Karamja / Brimhaven ships, both ways | as Entrana: [ships](../../learnings/ships.md) |
| Draynor Manor stairs, whistle door | yes (probe above) |
| Whistle, six heads -> blighted realm (stage < 9) | by `interact` Blow, not `travel` (the index has the blighted realm as expected unreached, `wiki/world/areas.ts:1340-1357`) |
| Whistle, blighted realm -> Karamja | by `interact` Blow, not `travel` |
| Whistle, six heads -> restored realm (stage 9) | by `interact` Blow; `travel` cannot during the quest: the crossing requires `quest:grail` done (`wiki/world/gates.ts:424-436`) |
| Whistle, restored realm -> Karamja | yes (requires only a whistle held and members; probe: grail tile -> six heads 8 run ticks) |
| Titan choke, Grail castle | **no**: the Titan's kill teleport and the bell's teleport are the only ways (probe) |
| Fisher Realm castle stairs, restored castle stairs and ladder | yes |

## Plan (promoted)

`conductor/plans/holy-grail.ts` runs the whole quest: fresh load of `lib:holy-grail-start` to quest done in 23.5 min, one run, no mid-run edits. [v 2026-10-24 questw5 local]

Phase times: Camelot -> Port Sarim -> Entrana round trip -> Galahad about 7 min (long walks); Seers' bank, Draynor Manor and whistles about 3 min; Titan about 100 s plus a short melee finish; each ship voyage 15-30 s. Steps 6-15 from the realm save take 7.8 min. [v 2026-10-24 questw5 local]

Recipes the run settled (the other steps are plain `talk` / `travel` / `pickup` with the choices listed in the walkthrough):

- Ships: `talk` with `travels:true` plus a gangplank `interact`, as in [ships](../../learnings/ships.md). The ~20-page dialog history is too short to carry progress across ships, so the plan uses the coin fare as a durable counter (start 290-300 coins, fare 30). The pack holds only coins (Entrana refuses gear). [v 2026-10-24 questw5 local]
- Start the plan with 290-300 coins in the pack: `firstTrip` is `coins >= 260`, so with more (714 coins) it never flips after the Fisher King and the plan loops ships to Karamja and back (two extra round trips, about 4 min) before Percival. [v 2026-10-24 conductor3 local]
- Observed walker failure on a 28-min run: the `ring` phase (walk to the bell at (2762, 4694)) failed "walk: No path to (2762,4694) from (2794,4713)" in the blighted realm; the one-off plan `percival-finish` then finished Percival. Cause not diagnosed. [v 2026-10-24 conductor3 local]
- Titan at Prayer 49: Protect from Melee ran out ("out of prayer points", 49 -> 13); plain melee with swordfish and Excalibur finished it at Defence 40, Attack 84, Strength 87, no death. [v 2026-10-24 conductor3 local]
- Completed again: Holy Grail 282 s from the realm stage (Defence 40 -> 85, Prayer 49 -> 81, 2 QP, +382,500 / +275,000 XP). [v 2026-10-24 conductor3 local]
- Merlin's workshop: a `talk` or `interact` walk carries `met` tokens only through its `at.met` (`at: {x, z, met: ["quest:grail>=1"]}`); without it, after Merlin a `travel` with `met:["quest:grail>=1"]` to (2760, 3512) is needed before any long walk, otherwise "No path ... ends 541 tiles away at (2768, 3498)". [v 2026-10-24 questw5 local]
- Draynor Manor whistle door is at (3106, 3361) L2 (not 3362); the whistles lie at (3107, 3359) on a table and `pickup` works from an adjacent tile. The whistle room is south of the door; from it or the upper floors the walker has no way out, so hand steps: `interact` Door Open (tile 3106, 3361) swings the player north; Staircase Climb-down (3105, 3363) L2 -> L1; Staircase Walk-down (3108, 3364) L1 -> ground; then `travel`/`talk` walks reach Port Sarim. [v 2026-10-24 questw5 local]
- Whistle Blow: `interact` on the item confirms it by effect (the player moved to (2806, 4715), (2678, 4715) or (2741, 3235)). [v 2026-10-24 questw5 local]
- Grail bell Ring (2762, 4694): the dialog guard takes the message box and `interact` reports no-effect although the bot is teleported to (2761, 4692); `interact` now counts the teleport as the effect (any move of the player, for an inventory-item option), so no `expect` is needed (smoke `interact counts the bell teleport`, bot stands within 4 tiles of a maiden, e.g. (2764, 4689); from (2762, 4694) no maiden is in range and the bell does nothing). [v 2026-10-24 questw5 local] [v 2026-10-24 itest-fixture local]
- Titan: Excalibur worn, lobsters, `combat` with `until` on x < 2791. Protect from Melee at 43 Prayer points lasts about 100 s and ran out with the Titan at 7/142 HP: finish with plain melee and lobsters (Prayer 70 would cover the whole fight). After the kill the player is at (2790, 4722); the Fisherman (2802, 4706) is reachable from the west side, the bell (2762, 4694) is reachable again, and the walk back through the choke works. [v 2026-10-24 questw5 local]
- Armour: the rune platebody needs Dragon Slayer ("You need to complete the Dragon Slayer quest first"); rune full helm, chainbody, platelegs and kiteshield wear fine at Defence 40. [v 2026-10-24 questw5 local]
- The Holy grail at (2649, 4684) L2 is reached by a restored-realm blow-in as written in step 13. [v 2026-10-24 questw5 local]
- Rewards seen: Prayer 275,000 and Defence 382,500 XP (Defence 89, Prayer 81 afterwards). [v 2026-10-24 questw5 local]

## Suggested library saves

Members world; generated saves (`conductor/tools/library.ts generate`).

- `holy-grail-start`: Attack/Strength/Defence 70, Hitpoints 70, Prayer 43; varps `{"14":7,"5":0}` (Merlin's Crystal
  done, Holy Grail not started); inventory 300 coins only (Entrana-safe); bank Excalibur (35), rune full helm (1163),
  rune chainbody, rune platelegs (1079), rune kiteshield (1201), leather boots (1061), 20 lobsters (379); at
  Camelot (2758, 3505). Seers' Village bank is the nearest. Runs the whole quest (300 coins: the plan counts fares off it). [v 2026-10-24 questw5 local]
- `holy-grail-realm`: the same stats; varps `{"14":7,"5":4}`; worn Excalibur and the rune set; inventory holy table
  napkin (15), 2 magic whistles (16), 15 lobsters, 270 coins; at the six heads (2741, 3235). Runs steps 6-15 (castle through Arthur) without the outbound ships. [v 2026-10-24 questw5 local]

## After the quest

- The Magic whistle (`magic_whistle`, members) still travels after the quest, and is not used up: blown on the
  six-heads spot on Karamja it takes the player to the restored Fisher Realm, and blown in the realm back to the heads.
  [v 2026-10-19 itest-fixture local]
- The script's side of it (`quest_grail.rs2:36-49`): the spot is x 2740-2743, z 3234-3237; a player past `%grail >=
  ^grail_given_whistle` lands at (2678, 4715), inside an oak, and steps out of it; blown anywhere in the realm it lands
  at (2741, 3235).
- More whistles come from the Draynor Manor door only while carrying Galahad's napkin, which he hands out only before
  the quest is done: after the quest a lost whistle and napkin are gone for good, unless a napkin was kept (then the
  door still drops whistles, `quest_grail.rs2:31`).
