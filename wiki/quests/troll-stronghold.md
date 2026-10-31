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

## Route and verified notes (partial draft, not promoted; goal not reached)

Run 2026-10-31: Att/Str/Def/HP/Prayer 70, full rune, 22 swordfish; reached the generals' room, died twice there.

Start save: Tenzing's hut door opens only when varp 315 (death_map) is at stage 2 or more, otherwise "No milk today!". A start save after Death Plateau needs 314 (death_equiproom) = 80 and 315 = 201326600 (stage 8 plus the map and combination bits). [v 2026-10-31 questw2 local]

Stage varp troll_quest (317): 10 started, 20 Dad beaten, 30 prison entered, 40 Godric freed, 50 done. [server data, unverified in game 2026-10-31]

- Burthorpe to the arena: hut front door (2822,3555), back door, stile (2817,3562), secret path, rocks (2856-2857,3612). A plain `travel` to (2897,3617) climbs the rocks itself (Agility XP) and arrives at (2896,3619) beside the arena gate; `interact` on the gate (2897,3618) lets you in. [v 2026-10-31 questw2 local]
- Dad (level 101): `combat` with `stopOnDialog` beat him in two runs (about 4 s to the opening dialog, then 44 s), no prayer, rune armour, eating at 60%, about 25 damage taken. His flyback knocks the bot to (2901,3613). His "I'll be going now." dialog needs `talk` with the choice 'going now'; a continue-only talk fails. [v 2026-10-31 questw2 local]
- The arena exit (2916,3629) needs `at` (2916,3627). Pass cave: enter at (2903,3644) to land at (2907,10019); `interact` the Cave Exit at (2906,10036) to come out at (2908,3654), about 20 s. [v 2026-10-31 questw2 local]
- From (2908,3654), `travel` to (2846,3688) takes 30 s with no fight. The Stronghold door (2839,3689) puts you on level 2 at (2837,10090). [v 2026-10-31 questw2 local]
- Generals' room (level 2, x 2828-2838, z 10073-10106): Generals at (2832,10088), (2829,10102) and about (2822,10073), with aggressive Mountain Trolls. The first General died in 41 s with Protect from Melee on; the Prison key and Big bones drop where it dies. Protect from Melee drains 70 prayer points in about 155 s (about 2.2 s per point). Food: Dad about 6 swordfish, first General about 11, Mountain Trolls more; 22 swordfish was not enough. Hazard row in [hazards](../../learnings/hazards.md). [v 2026-10-31 questw2 local]
- Prison: door on level 1 at (2848,10107); level 1 stairs (2842,10108) up and (2852,10107) down. Cells on level 0: Godric's door (2832,10078), Eadgar's (2832,10082); guards Twig (2832,10079) and Berry (2832,10083) sleep until woken. Pickpocketing a guard needs Thieving 30; Twig has Cell key 1. The exit at (2823,10048) on level 0 puts you at (2827,3646); Dunstan then completes the quest. [server data, unverified in game 2026-10-31]

### Gotchas

- `combat`'s return-to-area walked the bot back out through the Exit loc when the defend area was outside the room; keep the defend area inside. [v 2026-10-31 questw2 local]
- A `combat` run with `stopOnDialog` leaves prayers on after it ends (they drained to 0 within about 4 min); a run that ends on its own turns them off. Task behaviour as of this run, a prayer task change is being authored. [v 2026-10-31 questw2 local]
