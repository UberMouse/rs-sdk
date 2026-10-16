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
