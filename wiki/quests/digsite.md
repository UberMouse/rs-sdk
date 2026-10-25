# Digsite Quest

## Overview

| Detail       | Info    |
|--------------|---------|
| Difficulty   | Novice  |
| Length       | Long    |
| Quest Points | 2       |

## Requirements

### Skill Requirements

- Mid-quest: 25 Thieving, the only source of the rock sample and brush (`digsite_workman.rs2:62`); 10 Agility (`area_digsite.rs2:617`); 10 Herblore to mix the compound (`itexam_chemistry.rs2:21`) [server data, unverified in game 2026-10-23]

## Items Needed

- Cup of tea (for an examiner)
- Pestle and mortar
- Vial
- Tinderbox (to ignite the compound on the bricks, not an ingredient)
- Charcoal (ground with the pestle and mortar)

## Rewards

- 15,300 Mining XP
- 2,000 Herblore XP
- 2 Gold bars

## Walkthrough

Plan `conductor/plans/digsite.ts` (promoted) runs from a fresh load of `lib:digsite-start` to quest done in 23.3 min (one run, questw7, 2026-10-24); it buys the tinderbox, chisel, vial, pestle and mortar and cup of tea itself and takes the Panning tray from its table. Most of the time goes to the panning loop and the random workman steals. Start save `digsite-start`: Lumbridge (3222,3218), Att 40 Str 47 Def 40 HP 48 Prayer 15 Thieving 25 Agility 10 Herblore 10, 8 Salmon, steel scimitar, 100 coins. Combat was not needed (skeletons did not attack at combat 52). [v 2026-10-23 questw1 local]

### Shopping (about 20 coins)

Tinderbox and chisel (Falador general store), vial and pestle and mortar (Jatix, Taverley), cup of tea (Varrock tea seller). [v 2026-10-23 questw1 local]

### Getting started and the exams

1. Speak to an Examiner at the Digsite Examination Centre; they want a letter stamped by the Curator of Varrock's museum. Handing in the stamped letter starts exam 1 at once; failing it is harmless (retry by talking again). [v 2026-10-23 questw1 local]
2. Students all share the name "Student"; tell them apart by spawn spot (they wander 2 tiles): Student 1 (3363,3397) wants Rock sample 1; Student 3 (3349,3410) wants Rock sample 2; Student 2 (3348,3424) wants Rock sample 3. They give the answers. [v 2026-10-23 questw1 local]
3. Exam answers (the choice text to click; wording checked against `examiner.rs2:183-486`). [v 2026-10-23 questw1 local]

| Exam | Q1 | Q2 | Q3 |
|---|---|---|---|
| 1 | The study of the earth, its contents, and history. | All that have passed the appropriate Earth Sciences exam. | Gloves and boots to be worn at all times; proper tools must be used. |
| 2 | Samples taken in rough form; kept only in sealed containers. | Finds must be carefully handled, and gloves worn. | Always handle with care; strike cleanly on its cleaving point. |
| 3 | Samples cleaned, and carried only in specimen jars. | Brush carefully and slowly using short strokes. | Handle bones very carefully and keep them away from other samples. |

4. Exams 2 and 3: talking to each Student sets their errand done; exam 3 also needs an Opal for Student 2 on a second talk. [v 2026-10-23 questw1 local]

### Collecting samples

- Rock sample 1: pickpocket a Digsite workman (op "Steal-from", 25 Thieving); 3 in 11 per success, only during exam 1. The same steal also gives brush, rope, spade, gloves, bucket, coins (`digsite_workman.rs2:87-111`). [v 2026-10-23 questw1 local]
- Rock sample 3: the Bush at (3357,3372). [v 2026-10-23 questw1 local]
- Rock sample 2: panning, 3 in 40 per search of the full tray, exam 1 only. [v 2026-10-23 questw1 local]
- Panning: hold a Panning tray (single ground spawn on the Table at (3369,3378), see Gotchas), give a cup of tea to the Panning guide (3376,3377), then use the panning point with option "Look" (`interact` needs `expect: 'lift the full tray'`, else it ends on the first message). Searching the full tray gives Rock sample 2, uncut opal, uncut jade, oyster, nuggets, coins. Cutting an uncut opal at Crafting 1 can give "Crushed gemstone". [v 2026-10-23 questw1 local]
- Specimen jar: search the Sacks (3359,3398). Level 3 soil (3350-3357, 3404-3412): trowel on "Soil", needs jar and brush; digs add junk (belt buckle, helm, bones) and give the Talisman of Zaros about 1 in 20 (`area_digsite.rs2:442-450`). [v 2026-10-23 questw1 local]

### The discovery

1. Give the Talisman to Terry (Archaeological expert, (3355,3333)) by use-on-NPC (needs a talk continue after); he gives the Invitation letter, which goes to any Digsite workman. [v 2026-10-23 questw1 local]
2. Winches need a rope each. Winch 1 (3352,3417) lands in the east cave (3370,9828), cave ladder "Rope" (3370,9827) leads back to (3354,3417); winch 2 (3370,3428) lands in the west cave (3353,9818). The two cave parts are not connected before the blast. Using a rope on winch 2 after it is tied teleports to the east cave (script quirk); after tying, use Operate. [v 2026-10-23 questw1 local]
3. The cave workman (3352,9821) gives the chest key by begging; choices in order: invited to research / chest key / I don't suppose I could use it? / Please? / Aww... go on. / Pretty please! / Pretty please with sugar on top! [v 2026-10-23 questw1 local]
4. Surface chest (3374,3378): use the key, then Search gives the powder. Barrels (3363-3365,3378-3379): trowel opens one, vial takes the liquid; Terry identifies both. Arcenia roots lie on the cave floor at (3348,9819), (3351,9824), (3365,9829), (3369,9835). [v 2026-10-23 questw1 local]
5. Mix per the server script: ammonium nitrate + nitroglycerin, then ground charcoal, then Arcenia root (`itexam_chemistry.rs2:32-67`). [server data, unverified in game 2026-10-23]
6. The Brick that matters is (3379,9825), option Search (other Bricks are decoration): use the compound on it, then the tinderbox. The script wants the player on (3379,9826); (3378,9826) worked. [v 2026-10-23 questw1 local]
7. After the blast the cave is the same layout 64 tiles south in z (m52_152, z 9728+; before: m52_153). The Stone tablet is a ground spawn at (3374,9747) among skeletons (3369-3384,9744-9758). Give it to Terry (not the Examiners); he pays 2 gold bars and completes the quest (`arcaeological_expert.rs2:88-102`). [v 2026-10-23 questw1 local]

## Gotchas

- Chiselling an uncut opal at Crafting 4-5 often smashes it ("Nothing interesting happens", Crushed gemstone): pan again until an Opal is held, so the cut phase needs a high `maxFails` (15). [v 2026-10-24 questw7 local]
- The Specimen tray (3367,3386) "Search" needs a Specimen jar, takes about 3 ticks and finds nothing, bones, a coin, a dagger, charcoal (about 1 in 11), a broken arrow, broken glass, pottery or a cracked rock (5 Mining XP); `interact` ends on "an animation started" unless `expect` is `^\s*You find`. [v 2026-10-24 questw7 local]
- Workman steals pile up spare Specimen brushes (7 at once), which block steal phases needing 4 free slots: drop the extras. The Panning tray can be dropped once certificate 3 is held. [v 2026-10-24 questw7 local]
- Panning tray: the only source is a ground spawn on a Table at (3369,3378) (map m52_52, obj 677); the state lists it `[UNREACHABLE]` (blocked tile). `pickup {area:{x:3369,z:3379,radius:4}, items:[{item:"Panning tray",count:1}]}` takes it from the adjacent (3369,3379) (items on blocked tiles: `learnings/walking.md`). [v 2026-10-24 questw7 local]
- The `thieving` task refuses "Digsite workman" ("no pickpocket config"); the draft steals with `interact` "Steal-from". A failed or empty steal leaves the state unchanged, so the plan idle rail ends the plan "nothing left to do"; the draft alternates two steal phases at east and west anchors. [v 2026-10-23 questw1 local]
- The `grind` phase can end "combine: Nothing interesting happens." although the Ground charcoal was made; a rerun resumes from the held item and passes (plan:digsite failed at 17.6 min, rerun done in 3.1 min). [v 2026-10-24 conductor3 local]

## Key NPCs & Locations

| NPC/Location | Role |
|---|---|
| Examiners | Quest start, exams, Digsite Examination Centre |
| Students (3 spawn spots) | Exam answers, want rock samples |
| Workmen | Pickpocket for sample 1, brush, rope; take the Invitation letter |
| Panning guide (3376,3377) | Tea, then panning |
| Terry (3355,3333) | Identifies chemicals, Talisman, tablet hand-in; jar cupboard (3354,3332), rock pick cupboard (3355,3337) |
| Varrock Museum | Curator stamps the letter |
