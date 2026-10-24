# Plague City

| Detail     | Info     |
|------------|----------|
| Difficulty | Novice   |
| Length     | Medium   |
| Quest Points | 1 QP  |

## Requirements

- No skill requirements
- Biohazard must not have been started: Elena's mud patch is "filled in and packed hard" once it has (`mud_patch.rs2:15`) [server data, unverified in game 2026-10-23]

## Items Needed

- Dwellberries
- 4 buckets of water
- Spade
- Rope

## Rewards

- 1 Quest Point
- 2,425 Mining XP
- Ardougne Teleport spell (a magic scroll, learned on reading; casting needs 51 Magic)

## Walkthrough

1. Speak to **Edmond** in the northwest area of **East Ardougne**. He asks you to help find his daughter Elena, who went missing in plague-stricken West Ardougne.
2. Talk to **Alrena**, Edmond's wife, to obtain a **gas mask**. You will need this to enter West Ardougne.
3. Help Edmond dig through to the sewers using the **spade** and **buckets of water** to soften the soil.
4. Use the **rope** to descend into the sewers and travel through to **West Ardougne**.
5. Search West Ardougne to find information about **Elena's** whereabouts.
6. Craft a **hangover cure** and give it to **Bravek**, the city warder, to convince him to help you.
7. Bravek gives you a **warrant** to access the quarantined building.
8. Sneak past the **Mourner** guarding the building.
9. Enter the basement and **rescue Elena** to complete the quest.

## Key NPCs & Locations

| NPC / Location     | Where to Find                          |
|--------------------|----------------------------------------|
| Edmond             | Northwest East Ardougne                |
| Alrena             | Edmond's house, northwest East Ardougne |
| Bravek             | Civic office in West Ardougne          |
| Elena              | Basement of quarantined house, West Ardougne |
| Sewers entrance    | Behind Edmond's house                  |

## Verified route and plan

`conductor/plans/plague-city.ts` (promoted) took a fresh load of `lib:plague-city-start` to quest done in 658 s, one run, 41 phase runs. Start save: East Ardougne market (2655,3300), Att 40 Str 47 Def 40 HP 48 Prayer 15, steel scimitar, 6 salmon, 100 coins; pack rope, 4 empty buckets, 1 bucket of milk, 1 chocolate dust, 1 snape grass (milk and chocolate dust are sold at Funch's and Grand Tree Groceries; snape grass has no cheap source). The plan collects the spade, picture and dwellberries itself. Slowest phases: enter-house to barrel 102 s, bravek-cure 75 s, Elena and the cell door ~37-40 s each. Reward seen: Mining 2425 base (x25 locally) and a magic scroll (Ardougne Teleport, learned on reading). [v 2026-10-24 questw7 local]

- Dwellberries (4 gp at the Grand Tree shops) also spawn on the ground at (2633,3496), (2638,3479), (2645,3498), (2664,3476), (2667,3494) in McGrubor's Wood; `pickup` at area (2666,3488) r9 took one. The wood is fenced: see [walking](../../learnings/walking.md) (Loose Railing (2662,3500), not the locked south gate). [v 2026-10-24 questw7 local]
- Edmond's house: Spade spawn (2574,3331); Picture (2576,3334) on a blocked tile, so pickup works from an adjacent tile. Edmond (2568,3334), Alrena (2573,3333). [v 2026-10-24 questw7 local]
- Mud patches (2566,3331-3333): four Buckets of water, then the spade, drop you to the sewer mud pile (2561,9738). The East Ardougne fountain (2629,3311) fills the buckets. Biohazard was not started, so the dig worked. The pour's mesbox is not matched by an `expect` (see [dialogs](../../learnings/dialogs.md)). [v 2026-10-24 questw7 local]
- Sewer pipe (2530,9701): use the rope on it, talk to Edmond at (2535,9719), then Search the pipe with the Gas mask worn; you land at the West Ardougne manhole (2529,3304). Way back: manhole (2529,3303), Open if closed, then Climb-down, landing near the pipe (2530,9703); the Mud pile Climb (2561,9738) leads to the garden. [v 2026-10-24 questw7 local]
- West Ardougne NPCs: Jethick (2540,3305); Ted Rehnison (2531,3331); "Milli Rehnison" (exact name) (2531,3330) level 1; Clerk (2528,3317); Bravek spawns (2536,3314) and wanders; Elena (2541,9672). [v 2026-10-24 questw7 local]
- Rehnison house: the door (2531,3328) takes the picture/book route. Stairs (2527,3332) offer "Walk-up", and "Walk-down" from level 1; the walker does not plan down from level 1. [v 2026-10-24 questw7 local]
- Clerk's urgent step needs Bravek within 7 tiles of the player. Bravek wanders behind a wall (seen 2537-2538,3312-3313), so from lobby tile (2529,3315) it works ~40% of tries; retry from other lobby tiles (x 2529, z 3313-3317). (2536,3307) and (2536,3321) are near Bravek but too far from the Clerk. The plan needs a `travel` phase first, since `talk` does not walk when the Clerk is in reach. [v 2026-10-24 questw7 local]
- Hangover cure: Bucket of milk + Chocolate dust, then + Snape grass; no levels needed. The `items` combine task makes "Chocolaty milk" then "Hangover cure". [v 2026-10-24 questw7 local]
- Plague house door `loc_2535` (2533,3272), approached from the north (z 3274). Without clearance, choices "kidnap victim" then "check anyway" set the clearance stage; with the warrant it sneaks you in. Inside: Barrel (2534,3268) gives "A small key"; "Spooky stairs" Walk-Down (2536,3268) to the basement (2537,9670); cell door (2539,9672); Elena (2541,9672) frees on "Hi, you're free to go"; Walk-Up stairs (2536,9671) return to (2536,3271). [v 2026-10-24 questw7 local]
- Plan design: see [plans](../../conductor/docs/plans.md) (a done-at-once phase twice in a row ends the plan, so the manhole, cell door and clerk retries are split or varied) and [dialogs](../../learnings/dialogs.md) (history ~20 entries; mesbox text often missing). [v 2026-10-24 questw7 local]
