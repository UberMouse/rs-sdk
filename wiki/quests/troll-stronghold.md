# Troll Stronghold

## Overview

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Medium |
| Quest Points | 1 |

## Requirements

- Completion of **Death Plateau**
- Agility 15 for the rocks on the way (`quest_troll.rs2:7`; boostable) [server data, unverified in game 2026-10-23]
- Ability to survive combat against trolls (max hit 42)

## Items Needed

- Climbing boots (12 gp from shop)

### Recommended

- 43 Prayer (Protection Prayers)
- Food and armour

## Rewards

- 1 Quest Point
- Law Talisman

## Walkthrough

1. Speak to **Denulth** in Burthorpe to start the quest.
2. Traverse Death Plateau using the path established in the prerequisite quest.
3. At the Arena Gate, fight **Dad** (a troll). He hits hard but is manageable with Protect from Melee. Dad (level 101) is beaten down to under 20 HP, not killed (`quest_troll.npc:548`). [server data, unverified in game 2026-10-23]
4. After defeating Dad, navigate through the cave system past several aggressive trolls.
5. Cross the troll marketplace area. The trolls here are named after items they have eaten.
6. Defeat the **Troll General**. He can be safespotted from behind rocks in the room.
7. Obtain the **prison key** from the general's drop.
8. Use the key to unlock the prison area.
9. Obtain the **cell keys** from the trolls **Berry** and **Twig**.
10. Use the cell keys to free **Godric** and **Mad Eadgar** from their cells.
11. Return to **Dunstan** in Burthorpe to complete the quest.

## Key NPCs & Locations

| NPC / Location | Role | Location |
|----------------|------|----------|
| Denulth | Quest start | Burthorpe |
| Dad | Boss fight at Arena Gate | Death Plateau |
| Troll General | Boss fight (safespottable) | Troll Stronghold |
| Berry | Holds cell key | Troll Stronghold prison |
| Twig | Holds cell key | Troll Stronghold prison |
| Godric | Prisoner to rescue | Troll Stronghold prison |
| Mad Eadgar | Prisoner to rescue | Troll Stronghold prison |
| Dunstan | Quest completion | Burthorpe |

## Route and verified notes (promoted: `conductor/plans/troll-stronghold.ts`)

Proof run 2026-10-31 questw2: fresh load of `lib:troll-stronghold-start` to quest done in about 460 s, one run, no death. Start save: Burthorpe (2897,3531) beside Denulth, Att/Str/Def/HP 85, Prayer 99, Agility 30, Thieving 60, rune scimitar, full helm, platebody, platelegs, kiteshield, Climbing boots, 24 swordfish one per slot. [v 2026-10-31 questw2 local]

Start save: Tenzing's hut door opens only when varp 315 (death_map) is at stage 2 or more, otherwise "No milk today!". A start save after Death Plateau needs 314 (death_equiproom) = 80 and 315 = 201326600 (stage 8 plus the map and combination bits), both. [v 2026-10-31 questw2 local]

Stage varp troll_quest (317): 10 started, 20 Dad beaten, 30 prison entered, 40 Godric freed, 50 done. [server data, unverified in game 2026-10-31]

- Burthorpe to the arena: hut front door (2822,3555), back door, stile (2817,3562), secret path, rocks (2856-2857,3612). A plain `travel` to (2897,3617) climbs the rocks itself (Agility XP) and arrives at (2896,3619) beside the arena gate; `interact` on the gate (2897,3618) lets you in. [v 2026-10-31 questw2 local]
- Dad (level 101) is beaten without prayer at Att/Str/Def 85 in rune armour: `combat` with `stopOnDialog` in two runs (about 4 s to the opening dialog, then 44 s), eating at 60%, about 6 swordfish. His flyback knocks the bot to about (2901,3613). His "I'll be going now." dialog needs `talk` with the choice 'going now'; a continue-only talk fails. [v 2026-10-31 questw2 local]
- The arena exit (2916,3629) needs `at` (2916,3627). Pass cave: enter at (2903,3644) to land at (2907,10019); `interact` the Cave Exit at (2906,10036) to come out at (2908,3654), about 20 s. [v 2026-10-31 questw2 local]
- From (2908,3654), `travel` to (2846,3688) takes 30 s with no fight. The Stronghold door (2839,3689) puts you on level 2 at (2837,10090). [v 2026-10-31 questw2 local]
- Generals' room (level 2, x 2828-2838, z 10073-10106): `travel` to (2831,10088) enters it although the NPC list marks the Generals UNREACHABLE. Generals at (2832,10088), (2829,10102) and about (2822,10073), with aggressive Mountain Trolls. Kill one General with Protect from Melee kept on (`combat` `keepPrayersOn`, 25-54 s); the Prison key drops where it dies. Keep prayer on through the key pickup and the stairs down, then turn it off (prayer 99 fell to 54-65). Hazard row in [hazards](../../learnings/hazards.md). [v 2026-10-31 questw2 local]
- Prison: stairs level 2 to 1 at (2843,10108) land at (2841,10108); prison door (2848,10107) on level 1; stairs level 1 to 0 at (2852,10107) land at (2852,10105). Cells on level 0: Godric's Cell Door (2832,10078), Eadgar's (2832,10082); guards Twig (2832,10079) and Berry (2832,10083). Twig pickpocketed at Thieving 60 first try gives Cell key 1, which opens Godric's door; Godric freed. [v 2026-10-31 questw2 local]
- Exit (2823,10048) puts you at (2827,3646). `travel` cannot cross the rocks (2833-2834,3628) southward from there ("No path"): `interact` them, then walk to (2857,3613) and climb the rocks (2857,3612) south to the secret path, stile, hut and Burthorpe; Dunstan (2919,3573) completes the quest. Rock climbs at Agility 30 fail about 22% and are retried. [v 2026-10-31 questw2 local]

- The promoted plan frees only Godric (varp 318 = 62, troll_quest 50 after Dunstan). [Eadgar's Ruse](eadgars-ruse.md) needs Mad Eadgar freed first (bit 0 of 318, Berry's Cell key 2, cell (2832,10082)). [v 2026-10-31 questw2 local]

### Gotchas

- `combat`'s return-to-area walked the bot back out through the Exit loc when the defend area was outside the room; keep the defend area inside. [v 2026-10-31 questw2 local]
- A `combat` run with `stopOnDialog` leaves prayers on after it ends unless `keepPrayersOn` is meant; turn them off with a `prayer` phase placed first in phase order. Plan-writing lessons are in [plans](../../conductor/docs/plans.md). [v 2026-10-31 questw2 local]
