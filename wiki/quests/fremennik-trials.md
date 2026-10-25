# The Fremennik Trials

Everything below is read from the server scripts in `server/content/scripts/quests/quest_viking/`
and is [server data, unverified in game 2026-10-24]; no run has played this quest yet.

## Overview

- Start and finish: talk to Brundt in Rellekka. Dialog choices "Do you have any quests?", "Yes, I am interested.", "I want to become a Fremennik!" (final one only once the votes are in).
- `%viking` counts votes; Brundt's final dialog needs 7. Exactly 7 trials each add one vote (Swensen maze, Manni drinking, Sigli Draugen, Thorvald Koschei, Sigmund trading chain, Peer house, Olaf bard); Thorvald's two add sites are exclusive. So all 7 trials are required.
- Mid-quest levels apply to the lyre only: Woodcutting 40 (branch), Crafting 40 (unstrung lyre), Fletching 25 (string it).
- None of the progress values reach the client. Manni, Thorvald and Olaf print "Congratulations" game messages; Swensen, Sigli, Sigmund and Peer give chat dialog only.
- Rellekka has no bank; Seers' Village bank is the nearest.

## Trials

### Swensen (maze, via Hallifred)
- Talk to Hallifred, "Yes". Top ladder loc 4158 "Climb-down" at (2644,3657) inside his house; arrival (2631,10004).
- Maze world coords = (2624+lx, 9984+lz), level 0. All portals are named "Portal": target by tile.
- Correct chain, local portal tile -> arrival tile: P1 (7,18)->(18,34); P2 (15,31)->(26,20); P3 (32,20)->(44,31); P4 (41,34)->(6,45); P5 (6,39)->(29,50); P6 (32,53)->(45,42); P7 (42,45)->(41,54).
- Exit ladder loc 4160 "Climb-up" at local (41,53) = world (2665,10037); lands in Hallifred's house and completes the trial.

### Manni (drinking)
- Talk, "Yes". Keg of beer from the table at (2660,3676) (the take option exists only while his trial is started). Honest drinking always fails; use the cheat:
  1. Give Beer or a tankard to the council workmen (`vt_council_workmen`, bridge workmen near Seers / Rellekka bridge) for a Strange object (firecracker).
  2. Light it with a tinderbox (140-200 tick fuse; it explodes if held too long) and put it in the drain pipe `viking_pipe_end_longhall` (loc 4162, map square m41_57; tile not extracted).
  3. Low alcohol keg: Seers' Village poison salesman, "Talk about the Fremennik Trials", "Yes", 250 coins; only while Manni's trial is started.
  4. After the cracker is in the pipe, use the low-alcohol keg on the beer keg inside the longhall (x 2655-2662, z 3665-3681); talk to Manni, "Yes".

### Olaf (bard)
- Talk, "Yes". Chop the musical tree for a Branch (WC 40, axe, free slot); knife on branch -> unstrung lyre (Crafting 40).
- Golden wool: Lalli "Other human?"; Askeladden gives a Pet rock; Lalli again; put rock, cabbage, potato, onion into Lalli's Stew (cauldron, use-on-loc); Lalli again -> Golden fleece. Spin at a wheel: Rellekka's is Fremennik-only; the Seers' Village wheel (2711,3471) level 1 works via interact use. The conductor spinning task does not do fleece.
- Golden wool on the unstrung lyre (Fletching 25). A raw shark, manta ray or sea turtle on the Fossegrimen altar (`viking_lake_shrine_altar`, SW of Rellekka) -> Enchanted lyre.
- Pass the longhall backstage door (`viking_bard_backstage_door`); use the lyre in zone x 2655-2662, z 3680-3685.

### Thorvald (Koschei)
- Talk, "Yes". `viking_warrior_ladder` ("Climb-down", option 2) refuses entry with any weapon, armour, gloves, logs, runes, arrows etc. worn or held. Peer banks everything ("Ask about depositing your equipment"); withdraw at the Seers' Village bank.
- Koschei forms (attack/strength/defence-style stats, hp): 20/20/20 30 hp; 40/40/40 50 hp; 60/60/60 70 hp; final 255/255/5 255 hp. Beat the first three unarmed (food allowed); the final form's killing hit gives a fake death, teleports you out, and the trial counts. Form 3 drains prayer. Reward: the Fremennik blade.

### Sigli (Draugen)
- The talisman's "Locate" spawns a Butterfly NPC (`viking_draugen_safe`) at one of 4 forest spots (map squares 42_55, 42_56, 41_56, 42_57) within 20 tiles. Locate prints a compass message ("The talisman guides you north-west" etc.) until within 3 tiles, then "The Draugen is here! Beware!" and spawns "The Draugen" (level 69, 60 hp, stab/slash/crush defence 100, melee only). The butterfly wanders and may time out.

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
- The wheel logic is shared with the Tribal Totem door, see [tribal-totem.md](tribal-totem.md).

### Sigmund (merchant, trading chain for a rare flower)
- Chain: sailor (docks), Olaf (boots), Yrsa (clothes), Brundt (tax note), Sigli (hunters' map), Skulgrimen (bowstring), fisherman, Hallifred (map), Peer (forecast), Thorvald (contract), Manni (token), barkeep + Askeladden (5000 coins, written promise), then back to Sigmund. Each offers "Ask about the Merchant's trial".

## Catalog gaps
- Combination lock (Peer's riddle door): task being authored (first of the two).
- Draugen locate hunt (Sigli): queued.
- Koschei unarmed fight with fake death: not yet checked against the `combat` task.

## After the quest

- The Rellekka sailor (`viking_sailor`) takes a player who finished the quest to Miscellania after "Let's go!"
  (quests/quest_viking/scripts/viking_sailor.rs2:14, :24); the Miscellania sailor takes anyone back
  (areas/area_miscellania/scripts/misc_sailor.rs2:11).
