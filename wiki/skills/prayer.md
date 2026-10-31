# Prayer

Prayer grants access to combat-enhancing abilities. Prayers drain prayer points over time; more prayers active and higher-level prayers drain faster.

## Recharging

Pray at any church altar to fully restore prayer points.

## Prayers

| Level | Prayer | Effect |
|-------|--------|--------|
| 1 | Thick Skin | +5% Defence |
| 4 | Burst of Strength | +5% Strength |
| 7 | Clarity of Thought | +5% Attack |
| 10 | Rock Skin | +10% Defence |
| 13 | Superhuman Strength | +10% Strength |
| 16 | Improved Reflexes | +10% Attack |
| 19 | Rapid Restore | 2x stat recovery (not prayer/hitpoints) |
| 22 | Rapid Heal | 2x hitpoints recovery |
| 25 | Protect Item | Keep 1 extra item on death |
| 28 | Steel Skin | +15% Defence |
| 31 | Ultimate Strength | +15% Strength |
| 34 | Incredible Reflexes | +15% Attack |
| 37 | Protect from Magic | Blocks magical attacks |
| 40 | Protect from Missiles | Blocks ranged attacks |
| 43 | Protect from Melee | Blocks melee attacks |

## Bone Types

| Bone | XP | Source |
|------|-----|--------|
| Regular bones | 4.5 | Most small monsters |
| Burnt bones | 4.5 | Greater Demon hut (wilderness) |
| Bat bones | 4.5 | Giant Bats (Taverley Dungeon, Keep LeFaye) |
| Wolf bones | 4.5 | Wolves (White Mountain, Al Kharid) |
| Big bones | 15 | Hill Giants, Moss Giants, Ice Giants, Fire Giants |
| Babydragon bones | 30 | Baby dragons (Taverley Dungeon, Brimhaven Dungeon) |
| Dragon bones | 72 | Adult dragons (Green, Blue, Red, Black, KBD) |

## Bones, quests and dragons (server data, research 2026-10-16)

- Burying is the only bone-to-Prayer path: no altar multiplier (`skill_prayer/scripts/altar.rs2` only recharges) and no Ectofuntus. No shop sells bones. XP at 25x: regular 112.5, big 375, baby dragon 750, dragon 1,800 (`skill_prayer/configs/bones.obj`). A bury holds the player 1 tick (`p_delay(0)`), so at most one bone per 2 ticks. [server data, unverified in game 2026-10-16]
- Quest lumps (x25): Priest in Peril 35,150 (King Roald starts it, no requirements in the script), Holy Grail 275,000 (+382,500 Defence; needs Merlin's Crystal, whose Sir Mordred is level 39). Both implemented. Together ~1/3 of the Prayer left from 60 on this server's XP curve. [server data, unverified in game 2026-10-16]
- Green dragons (Wilderness (3078-3118, 3810-3821), 5 spawns, 75 HP) pay 24 Prayer XP per HP killed vs 10.7 for hill giants; modelled ~170k Prayer/h alongside melee. Dragonfire hits up to 50 unprotected; the anti-dragon shield (free: Oziach, Edgeville, then Duke Horacio, Lumbridge; `oziach.rs2`, `duke_horacio.rs2:59-64`) caps it at 5 (`npc/scripts/dragon.rs2:110-117`). Dragon melee hits and food use are unmeasured. [model, research 2026-10-16]

## Monastery

- **Location:** West of Edgeville
- **Requirement:** 31 Prayer
- **Features:** Altar with temporary prayer boost, Brother Jered (blesses holy symbols, gives priest robes)

## Training Tips

- Big bones from Hill Giants (Edgeville Dungeon) are the most accessible F2P training method.
- Babydragon bones are the best cost-effective members option.
- Regular bones from Khazard battlefield are easy to collect in bulk.

## Verified training spots

- Lumbridge chickens (3231, 3295) train Prayer as a by-product of melee and bone burying: about a third of the melee XP; details in [strength](strength.md#verified-training-spots). [v 2026-10-09 conductor1 local]
- Edgeville Dungeon hill giants (3100-3114, 9827-9840): burying their Big bones (always dropped; 375 XP each at the local 25x rate) while training Mithril-scimitar Strength gave 57k Prayer/h (+9,525, Prayer 1->33 in 10 min), at ~7 ticks per bury and 575k Strength/h, against 619k/h without burying. Hazard below combat 56: [hazards](../../learnings/hazards.md). [v 2026-10-16 conductor2w3 local]
- Taverley Dungeon baby blue dragons (room ~(2898, 9766), behind the Dusty-key gate (2924, 9803)): `combat` with `buryBones` gave ~112k Prayer/h at Prayer 83-85, plus ~253k HP xp/h and ~764k/h melee; ~19 food/h; details and the key recipe in the section below. Hazard: [hazards](../../learnings/hazards.md). [v 2026-10-31 conductor3 local]

## Dusty key and baby blue dragons (Taverley Dungeon)

Dusty key (dusty-key plan draft, conductor3): the Jailer is combat 47, so the plan requires that level.
- Velrak's cell Door is at (2931, 9690). `travel` to (2932, 9700) has no connector; (2925, 9700) works (~52 s from Port Sarim).
- Recipe: `combat` Jailer (area (2932, 9696) radius 6, `loot: ['Jail key']`; killed in 30-40 s at Att/Str/Def 70), `interact` use Jail key on Door (2931, 9690) from (2931, 9691), then `talk` Velrak (choices "know anywhere good", "Yes please") gives the Dusty key. The Jailer respawns and is aggressive. The plan's `talk` phase with `use:` walked to (2931, 9685) and failed "No path ... no waypoints" on the closed door, so the door step is its own `interact`. [v 2026-10-31 conductor3 local]
- Baby blue dragons (room ~(2898, 9766)) are behind the Gate (2924, 9803): `interact` use Dusty key on Gate from (2924, 9802) opens it (server: `jail_doors.rs2`, `deepdungeondoor` accepts `dusty_key`); the log reports "the loc is gone" on success. The walker now uses the key itself (commit 0643ee05b), so a plan needs no separate gate step. [v 2026-10-31 conductor3 local]
- Baby blue dragons are level 48. Measured over 25.3 min at Prayer 83-85 (Def 96, HP ~80, Excalibur, Dragonfire shield, mithril body and legs, adamant full helm): ~112k Prayer xp/h, ~253k HP xp/h, ~764k xp/h in the trained melee skill; 8 Swordfish in 25 min (~19 food/h, ~4.8 HP damage/min), so one 18-food trip lasts about an hour. [v 2026-10-31 conductor3 local]
- Plan `baby-blues-prayer` (promoted 1d6bfbe0f) took Prayer 83 -> 90, Attack 95 -> 99 and Defence 96 -> 99 in ~107 min of fighting: Prayer 104-112k/h (70-77% of the method floor), Attack ~734k/h, Defence ~747k/h, HP ~240-250k/h; a Babydragon bone buries for 750 XP, ~139 bones/h. Restock cycle ~227 s: leave the dungeon 110 s, Falador West bank 6 s, back through the gate 111 s; 18 food lasted ~40 min at Defence 96-99. `bank` refuses while in combat ("in combat at ..."), so the plan's `travel` `flee: true` leave phase runs before it. [v 2026-10-31 conductor3 local]
- The bone is "Babydragon bones". `combat` with `buryBones: true` and `maxLevelGap: 60` buries them continuously; no `loot` param is needed. Prayer points fell to 2 with no effect when no protection prayer is used. [v 2026-10-31 conductor3 local]
- Set the combat `skill` to an unmaxed melee skill (Attack/Defence) once Strength is 99: melee xp here is ~7x the Prayer xp, and the 764k/h run trained maxed Strength, wasted. [v 2026-10-31 conductor3 local]
- Banking for this trip: 12 Swordfish + 12 Tuna + Salmon filled all 28 slots; a deposit keeping only Dusty key and Coins also banks the Hammer and Maze key (re-take them if a later quest needs them). [v 2026-10-31 conductor3 local]
- Ranged at the same room (plan `ranged-dragons`: Oak shortbow, Steel then Iron arrows, arrows in `loot`, `buryBones`) gave about 480k Ranged/h, ~71k Prayer/h and ~160k HP/h at Ranged 45-95: Prayer/h is below melee's 104-112k/h because kills are slower. Ranged: [ranged](ranged.md#verified-training-spots). [v 2026-10-31 conductor3 local]
- Lesser demons attack at the gate: see `learnings/hazards.md` (Taverley Dungeon dragon gate).

