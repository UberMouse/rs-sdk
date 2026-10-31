# Prince Ali Rescue

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Long       |
| Quest Points | 3       |

## Requirements

No quest or skill requirement. Ned answers with Dragon Slayer dialogue, not the wig, while he is hired for that quest and the voyage has not happened (`ned.rs2:11-14`) [server data, unverified in game 2026-10-23]

## Items Needed

- 2 Onions
- Pot of flour
- Redberries
- Bucket of water
- Ashes
- 3 Balls of wool
- Pink skirt (handed to the prince with the wig, paste and key, `prince_ali.rs2:11`) [server data, unverified in game 2026-10-23]
- Soft clay
- Bronze bar
- Rope
- 3 Beers
- 58 gp for purchases (skirt 2, rope 15, 3 beers 6, plus the Al Kharid toll 10 each way: the quest does not exempt it until done) [v 2026-11-01 questw3 local]

## Rewards

- 700 gp
- Free passage through the Al Kharid toll gate permanently

## Walkthrough

### Getting the Quest

1. Speak to **Hassan** at the **Al Kharid Palace**. Prince Ali has been kidnapped and is being held in Draynor Village. Hassan directs you to **Osman** (also in the palace) to plan a rescue.

### Creating the Disguise

2. Speak to **Osman** for the plan. You need to create a disguise for the prince and a key to his cell.
3. Go to **Ned** in **Draynor Village**. Bring him **3 balls of wool** and he makes a **wig**.
4. Go to **Aggie** in **Draynor Village**:
   - Bring **2 onions** and 5 gp to make **yellow dye**. Use it on the wig to make a **blonde wig**.
   - Bring **redberries**, **pot of flour**, **bucket of water**, and **ashes** to make **skin paste**.

### Making the Key

5. Bring the **soft clay** and speak to **Osman**. He tells you to get an imprint of Lady Keli's key.
6. Go to the jail in **Draynor Village** and speak to **Lady Keli**. Ask to see her key, then to touch it: the soft clay becomes a **key imprint** through dialogue, not by using the clay on her (`lady_keli.rs2:90-101`). [server data, unverified in game 2026-10-23]
7. Bring the key imprint and a **bronze bar** to **Osman**. He has the key made; **Leela** hands it to you (15 coins for a replacement; `leela.rs2:11-27`). [server data, unverified in game 2026-10-23]

### The Rescue

8. Kill the four jail guards first (they interrupt dialogs), then bring **3 beers** (all in the pack at once) and give them to **Joe**, inside the jail compound. He becomes drunk and passes out. [v 2026-11-01 questw3 local]
9. Use the **rope** on **Lady Keli** to tie her up.
10. Use the key on the cell door (`quest_prince.rs2:35`). Give Prince Ali the **blonde wig**, **pink skirt**, **skin paste** and key as a disguise (all four at once, `prince_ali.rs2:11`). [server data, unverified in game 2026-10-23]
11. Prince Ali escapes. Return to **Hassan** at Al Kharid Palace to complete the quest.

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Hassan                 | Al Kharid Palace                             |
| Osman                  | Al Kharid Palace courtyard                   |
| Ned                    | House in Draynor Village                     |
| Aggie                  | House in Draynor Village                     |
| Lady Keli              | Jail in Draynor Village                      |
| Joe (guard)            | Outside the jail, Draynor Village            |
| Prince Ali             | Inside the jail cell, Draynor Village        |

## Verified route (plan `conductor/plans/prince-ali-rescue.ts`)

Fresh load of `lib:prince-ali-rescue-start` to quest done in 736 s, one run [v 2026-11-01 questw3 local]. The save: Al Kharid palace (3302, 3165) beside Hassan, Att/Str/Def 60, HP 65, 3 balls of wool, pot of flour, ashes, bucket of water, soft clay, bronze bar, rune scimitar, 12 swordfish, 250 coins. The plan gathers the rest for 58 gp overall: 2 onions (Lumbridge field), a redberry (south-east Varrock ground spawn), a pink skirt (Thessalia, 2 gp), rope (Ned, 15 gp), 3 beers (Rusty Anchor bartender, Port Sarim, 2 gp each). The plan gates some phases on its own run counts, so it is proven only from a fresh load; a mid-quest resume reruns Osman and the jail steps.

Phase seconds: hassan-start 6, osman1 23, onions 46, to-berries 41, berries 2, skirt 26, wig 14, rope 16, yellow 10, paste 81, blonde 1, keli-print 21, beers 44 (3 runs), to-osman 71, osman2 6, to-leela 54, leela 5, to-jail 57, guards 107 (2 fights), joe 14, rope-keli 10, door 13, prince 9, to-hassan 58, hassan-end 1.

Dialog choices and items [v 2026-11-01 questw3 local]:
- Hassan: "Can I help you?". Osman: "What is the first thing I must do?" then "Okay, I better go find some things" sets stage 2. Quest id `prince`, varp princequest.
- Ned: wig via "Ned, could you make other things from wool?", "How about some sort of wig?", "I have that now. Please, make me a wig."; rope via "Yes, I would like some rope." then "Okay, please sell me some rope.". Both wigs are named "Wig" (plain 2421, blonde 2419).
- Aggie: "Could you think of a way to make skin paste?" then "Yes please. Mix me some skin paste.". The result is named "Paste" (2424).
- Lady Keli: "famous in RuneScape", "latest plan", "not try to get him out", "see the key", "touch the key". The print needs stage 2 and soft clay held; the item is "Key print" (2423).
- Osman returns the key when Key print and a bronze bar are held (choice "Thank you"); the item is "Bronze key" (2418). Leela hands over the key and, with wig, skirt and paste held, sets prep_finished in the same conversation. (ids: `server/content/pack/obj.pack`, `quest_prince.obj`) [server data, unverified in game 2026-11-01]
- Joe needs all 3 beers in the pack at once: talk, then "I have some beer here, fancy one?", in one dialog.
- Rope used on Lady Keli, then the key on the "Prison Door" (loc alidoor, (3123, 3243)) teleports the bot inside the cell. Prince Ali takes the disguise and key with no choices, then Hassan pays.

Draynor jail [v 2026-11-01 questw3 local]:
- The walls, the door (3128, 3246) and the spear walls make the north-side tiles (3123, 3247-3248) unreachable. Joe, Keli and the cell door are reached from inside the compound at (3125, 3245), (3128, 3244) and (3123, 3244).
- Four level-26 jail guards (32 HP, hit about every 5 ticks, re-aggro about 60 ticks after a kill) patrol, two inside and two outside to the south-west. A hit closes an open dialog: Joe's beer dialog was cut after the first beer, leaving 2 (a rebuy was needed), and Keli's talk can be cut too. Kill the guards first with a rune scimitar plus food at Att/Str/Def 60 (see [hazards](../../learnings/hazards.md)).
- The combat task refuses a level-26 target with no food (the no-food cap is level 5).
- Combat `until`: count only guards reachable and within 12 tiles, area radius 10 around (3124, 3244). A radius of 25, or counting unreachable guards behind the fence, loops for 255+ s and burns food.

Al Kharid toll: the quest does not exempt it until done; 10 gp each way. The `talk` task's own `at` walk cannot cross the gate west to east (see [walking](../../learnings/walking.md#al-kharid-toll-gate-and-talk)), so put a `travel` phase before any Al Kharid talk.
