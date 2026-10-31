# The Fremennik Trials

Script facts are read from `server/content/scripts/quests/quest_viking/`; lines tagged `[v ...]` were played
in game. The promoted plan `conductor/plans/fremennik-trials.ts` took a fresh load of `lib:fremennik-trials-start`
to quest done in 1873 s (one run, questw4). Start save: Rellekka (2631,3669), Att/Str/Def/HP/Prayer 99,
Woodcutting 40, Crafting 40, Fletching 25, pack 10 Big bones (the plan's stage ledger), bank with 6000 coins,
40 Bones, 30 Lobster, rune axe, knife, tinderbox, 2 raw shark, cabbage, potato, onion, 2 beer. Att/Str/Def/HP 70
with 16 lobsters died to Koschei's third form. [v 2026-10-31 questw4 local]

## Overview

- Start and finish: talk to Brundt in Rellekka. Dialog choices "Do you have any quests?", "Yes, I am interested.", "I want to become a Fremennik!" (final one only once the votes are in). [v 2026-10-31 questw4 local]
- `%viking` counts votes; Brundt's final dialog needs 7. Exactly 7 trials each add one vote (Swensen maze, Manni drinking, Sigli Draugen, Thorvald Koschei, Sigmund trading chain, Peer house, Olaf bard); Thorvald's two add sites are exclusive. So all 7 trials are required.
- Mid-quest levels apply to the lyre only: Woodcutting 40 (branch), Crafting 40 (unstrung lyre), Fletching 25 (string it).
- None of the progress values reach the client. Manni, Thorvald and Olaf print "Congratulations" game messages; Swensen, Sigli, Sigmund and Peer give chat dialog only.
- Rellekka has no bank; Seers' Village bank is the nearest.

## Trials

### Swensen (maze, via Hallifred)
- Talk to Hallifred, "Yes". Top ladder loc 4158 "Climb-down" at (2644,3657) inside his house; arrival (2631,10004).
- Maze world coords = (2624+lx, 9984+lz), level 0. All portals are named "Portal": target by tile.
- Correct chain, local portal tile -> arrival tile: P1 (7,18)->(18,34); P2 (15,31)->(26,20); P3 (32,20)->(44,31); P4 (41,34)->(6,45); P5 (6,39)->(29,50); P6 (32,53)->(45,42); P7 (42,45)->(41,54).
- Verified: Swensen's house door (2645,3663) is a custom door the walker does not open: `interact` it with its tile. Ladder down (2644,3657), arrive (2631,10004). Portals by interact tile in order: (2631,10002), (2639,10015), (2656,10004), (2665,10018), (2630,10023), (2656,10037), (2666,10029); exit ladder (2665,10037). The vote registers only if Swensen is within 5 tiles of the exit (2649,3661); redo the maze when his "finished my maze" line is absent. About 30 s. [v 2026-10-31 questw4 local]
- Exit ladder loc 4160 "Climb-up" at local (41,53) = world (2665,10037); lands in Hallifred's house and completes the trial.

### Manni (drinking)
- Talk, "Yes". Keg of beer from the table at (2660,3676) (the take option exists only while his trial is started). Honest drinking always fails; use the cheat:
  1. Give Beer or a tankard to the council workmen (`vt_council_workmen`, bridge workmen near Seers / Rellekka bridge) for a Strange object (firecracker).
  2. Light it with a tinderbox (140-200 tick fuse; it explodes if held too long) and put it in the drain pipe `viking_pipe_end_longhall` (loc 4162, map square m41_57; tile not extracted).
  3. Low alcohol keg: Seers' Village poison salesman, "Talk about the Fremennik Trials", "Yes", 250 coins; only while Manni's trial is started.
  Verified: buy the keg from the Seers poison salesman (choices "Fremennik Trials", "Yes"); the council workman is at (2655,3592); put the Lit strange object in the pipe at (2663,3674) with "Put-inside"; the keg table is (2660,3676). [v 2026-10-31 questw4 local]
  4. After the cracker is in the pipe, use the low-alcohol keg on the beer keg inside the longhall (x 2655-2662, z 3665-3681); talk to Manni, "Yes".

### Olaf (bard)
- Talk, "Yes". Chop the musical tree for a Branch (WC 40, axe, free slot); knife on branch -> unstrung lyre (Crafting 40).
- Golden wool: Lalli "Other human?"; Askeladden gives a Pet rock; Lalli again; put rock, cabbage, potato, onion into Lalli's Stew (cauldron, use-on-loc); Lalli again -> Golden fleece. Spin at a wheel: Rellekka's is Fremennik-only; the Seers' Village wheel (2711,3471) level 1 works via interact use. The conductor spinning task does not do fleece.
- Golden wool on the unstrung lyre (Fletching 25). A raw shark, manta ray or sea turtle on the Fossegrimen altar (`viking_lake_shrine_altar`, SW of Rellekka) -> Enchanted lyre.
- Verified tiles: musical tree (2738,3638); Lalli (2770,3622), choice "Other human?"; Lalli's Stew (2772,3623), use rock, onion, potato, cabbage in that order (vegetables first, rock last); Seers wheel (2712,3471) on level 1, and the walker cannot plan from level 1, so climb down the ladder (2715,3470) first; Strange altar (2626,3598); play the lyre at (2658,3683) and wait for the "Bard's Trial" message. [v 2026-10-31 questw4 local]
- Pass the longhall backstage door (`viking_bard_backstage_door`); use the lyre in zone x 2655-2662, z 3680-3685.

### Thorvald (Koschei)
- Talk, "Yes". `viking_warrior_ladder` ("Climb-down", option 2) refuses entry with any weapon, armour, gloves, logs, runes, arrows etc. worn or held. Peer banks everything ("Ask about depositing your equipment"); withdraw at the Seers' Village bank.
- Koschei forms (attack/strength/defence-style stats, hp): 20/20/20 30 hp; 40/40/40 50 hp; 60/60/60 70 hp; final 255/255/5 255 hp. Beat the first three unarmed (food allowed); the final form's killing hit gives a fake death, teleports you out, and the trial counts. Form 3 drains prayer. Reward: the Fremennik blade.

- Verified: ladder (2667,3694), Climb-down is op2; arena on level 2 around (2671,10098); the fake death teleports the bot to the roof (2667,3692) on level 1, healed, and the trial counts. Fight unarmed with Protect from Melee and no food: an eating guard stops the fake death. Forms 1-3 die; form 4 (255 hp) fake-kills. The fake death flashes hp 1 and trips the low-HP guard, so the next step needs retries. About 2 min. The `combat` target is the exact name `'Koschei the deathless'` (a regex like `'^Koschei the deathless$'` never matches; same for `'The Draugen'`). [v 2026-10-31 questw4 local]

### Sigli (Draugen)
- The talisman's "Locate" spawns a Butterfly NPC (`viking_draugen_safe`) at one of 4 forest spots (map squares 42_55, 42_56, 41_56, 42_57) within 20 tiles. Locate prints a compass message ("The talisman guides you north-west" etc.) until within 3 tiles, then "The Draugen is here! Beware!" and spawns "The Draugen" (level 69, 60 hp, stab/slash/crush defence 100, melee only). The butterfly wanders and may time out.

- Verified: the Draugen fights back only once attacked first; white wolves in the Draugen forest attack, and a fight with them stopped the plan at "in combat" until a wolf-fight phase was added. The `locate` task can hop toward its target across a cliff to a ledge such as (2675,3600) or (2689,3602) and fail "Route ... over the 120 allowed"; three such hops fail the run. The plan works round it with a reset travel to (2640,3640) and a 240 s wait so the target re-spawns elsewhere. [v 2026-10-31 questw4 local]

### Peer (house puzzle)
- Door `viking_seers_door1` ("Solve the riddle") opens interface `combolockdoor` (pack id 10051): up arrows com_48/50/52/54, down com_47/49/51/53, confirm com_57. Riddle chosen by random(6) and read from a mesbox ("Read the riddle"); answers by riddle id (wheel values 0-25 = A-Z, wrapping), `viking_peer.rs2:288-380`:

| id | Answer | Wheels |
|---|---|---|
| 0 | MIND | 12, 8, 13, 3 |
| 1 | TREE | 19, 17, 4, 4 |
| 2 | LIFE | 11, 8, 5, 4 |
| 3 | FIRE | 5, 8, 17, 4 |
| 4 | TIME | 19, 8, 12, 4 |
| 5 | WIND | 22, 8, 13, 3 |

- Riddle ids by text: 0 "most powerful tool you will possess" (MIND); 1 "wears more rings the older I get" (TREE); 2 "when stolen from you causes you death" (LIFE); 3 "cannot die as long as it has food" (FIRE); 4 "crushes mountains, drains rivers" (TIME); 5 "helps to make bread, let birds fly and boats sail" (WIND).
- The rest of the house (tap, buckets, jugs, vase, range, table, mural, key) is item/loc work; the final door needs the Seers' key (`viking_seers_door2`). Entering the house with items worn/held is checked at the door (`viking_peer.rs2`, peer_house_check).
- Verified: the combolock leaves the bot on the door tile (2631,3667). The house has two floors; level 0 west room (ladder up 2631,3663; door 1 at 2631,3667) and east room (ladder 2636,3663; door 2 at 2636,3667). The puzzle floor is level 2, which is also the Koschei arena's level, so gate on the house box x 2628-2639, z 3659-3666, not the level alone. The mural (2634,3663) is usable only from the east room, entered from the level-2 trapdoor (2636,3663): Open, then Climb-down. Puzzle chain: unicorn head -> Red disk; bull head -> Wooden disk; bookcase search -> Red herring; cook it on the range -> red goop; goop on the Wooden disk -> second Red disk; two disks on the mural -> Vase lid; cupboard (2629,3660) -> bucket; chest (2635,3660) -> jug; water: fill bucket at the tap, full bucket on the empty jug, empty the full jug in the drain, 2/5ths bucket on the empty jug, fill the bucket again, full bucket on the 2/3rds jug, the 4/5ths bucket on the scales chest (2632,3665) -> Vase; vase on the tap, lid on the vase -> Sealed vase; sealed vase on the Frozen table (2638,3665) -> Frozen key; key on the range -> Seers' key; door 2 with the key gives the vote and wipes the puzzle items (cooked herring stays). About 4 min. The loc list lags the game by one selection and a done phase picked twice in a row ends the plan, so Open/Search pairs need a cheap failing settle phase between them. [v 2026-10-31 questw4 local]
- The wheel logic is shared with the Tribal Totem door, see [tribal-totem.md](tribal-totem.md).

### Sigmund (merchant, trading chain for a rare flower)
- Chain: sailor (docks), Olaf (boots), Yrsa (clothes), Brundt (tax note), Sigli (hunters' map), Skulgrimen (bowstring), fisherman, Hallifred (map), Peer (forecast), Thorvald (contract), Manni (token), barkeep + Askeladden (5000 coins, written promise), then back to Sigmund. Each offers "Ask about the Merchant's trial".

- Verified: thirteen forward dialogs leave no item, so a ledger carries them. Thora's option is "Talk to" without a hyphen (option `'^talk[ -]?to$'`). Yrsa's shop door (2627,3675) must be opened first. Askeladden's step costs 5000 coins. The back chain is item-driven, one item at a time. About 35 s per dialog. Dialog history drops pages when the bot clicks quickly, so a marker must be an OR of several unique lines. [v 2026-10-31 questw4 local]

## Plan status

Promoted: `conductor/plans/fremennik-trials.ts`, all seven votes and Brundt's finish, proven on questw4 (1873 s from the start save). [v 2026-10-31 questw4 local]

## After the quest

- The Rellekka sailor (`viking_sailor`) takes a player who finished the quest to Miscellania after "Let's go!"
  (quests/quest_viking/scripts/viking_sailor.rs2:14, :24); the Miscellania sailor takes anyone back
  (areas/area_miscellania/scripts/misc_sailor.rs2:11).
