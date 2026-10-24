# Nature Spirit

| Detail     | Info     |
|------------|----------|
| Difficulty | Novice   |
| Length     | Medium   |
| Quest Points | 2 QP  |

## Requirements

- Priest in Peril at stage 61 (one more talk with Drezel after completion) and the Wolfbane dagger held (`drezel.rs2:14-18`). A fresh save at Paterdomus with varps priestperil = 61 started the quest. [v 2026-10-24 questw1 local]
- Ghostspeak amulet worn; The Restless Ghost only needs to be started, its completion is never checked (`father_urhney.rs2:5,50`). [server data, unverified in game 2026-10-23]
- 18 Crafting for the sickle (`jewellery.rs2:307`); the sickle cast at Crafting 18 worked. [v 2026-10-24 questw1 local]
- Melee: three Ghasts to kill; the proof run (Att 40, Str 54, Def 40, HP 47, mithril scimitar) used under 1 swordfish per kill (6 of 12 in all). [v 2026-10-24 questw1 local]
- Walk tokens for a plan: `quest:priestperil>=4/5/6/8` (temple) plus `quest:druidspirit>=1` (Mort Myre gate, open once started: gate locs 3506/3507 at (3443,3458)/(3444,3458), `quest_druidspirit.rs2:5`).

## Items Needed

- Ghostspeak amulet (worn), Wolfbane dagger, Silver bar, ~10 gp, melee gear and food.
- Silver bar: no placed shop sells one; otherwise silver ore (Mining 20, e.g. Edgeville dungeon (3138,9874)) and a furnace.
- Sickle mould: Dommik, Al Kharid (3322,3194), 10 gp.

## Rewards

- 2 Quest Points; Defence 2,000, Hitpoints 2,000, Crafting 3,000 base XP (plus the sickle craft XP) [v 2026-10-24 questw1 local]
- Silver sickle(b) (blessed), Druid pouch

## Walkthrough (proven route, fresh load of `lib:nature-spirit-start` to done in 730 s, plan `conductor/plans/nature-spirit.ts`) [v 2026-10-24 questw1 local]

1. **Sickle errand (Al Kharid, ~110 s):** buy the Sickle mould from Dommik (3322,3194); `use` the Silver bar on the Al Kharid furnace (3274,3184) with choice `Silver sickle`.
2. **Start:** talk to Drezel (Paterdomus dungeon), choose the "anything else interesting" line (stage 5), then the holy barrier (2 s).
3. **To the swamp:** through the Mort Myre gate (3443,3458) to the south bank (3441,3328).
4. **Stepping stones:** loc "Bridge", op "Jump". From (3441,3328) Jump lands on (3440,3331); from the island Jump goes south. Roll is `stat_random(agility,60,252)`: a failure drops you in the water for 2-7 damage, back on the bank. At Agility 1 about 1 jump in 3-4 succeeded (3 jump-ins and 2 jump-outs in the proof). Island interior is x 3434-3446, z 3330-3343; it is reached only this way.
5. **Island items:** take the Washing bowl (3437,3337), a Mirror appears under it; Search "Grotto tree" (3439,3338) for the Journal. Door "Grotto" (3440,3337) op Enter summons Filliman for 100 ticks.
6. **Filliman talks:** ghost talk (choices "I'm wearing an amulet..." then "Ok, thanks") stage 20; use the Mirror on him, 25; use the Journal on him, 30, choosing "How can I help" gives the Druidic spell.
7. **Blessing:** jump out and walk to Drezel (received_spell talk, no choices) to bless the spell (~58 s).
8. **Fungus:** cast the spell beside the rotting logs (3439,3348); "Fungi on log" appears ~3 ticks later and lasts 25 ticks; Pick it. Do not recast while waiting.
9. **Stones (back on the island, ~17 s):** fungus onto the nature Stone (3439,3336), "A used spell" onto the spirit Stone (3441,3336). The unblessed spell scroll put on a stone is consumed and lost, so gate on holding "A used spell". The faith Stone is (3440,3335).
10. **Puzzle:** STAND on the faith stone (talk coord 0_53_52_48_7; `at` tolerance 1 was enough), show Filliman the fungus and choose "I think I've solved the puzzle" (stage 60).
11. **Grotto:** door Enter teleports to the grotto copy (3442,9734), grotto loc (3441,9740). The first talk ends in a menu; the second takes the Silver sickle, blesses it and gives the Druid pouch (~17 s).
12. **Fill the pouch:** back out to the logs. Silver sickle(b) "Cast Bloom" (op3, 1-7 Prayer per cast) blooms rotting logs (Fungi on log, "Pick"), branches (Budding branch, "Take-cutting") and small bushes (A golden pear bush, "Pick"). Pouch Fill needs 3 items: 3 fungi gave 3 charges, plus a pear gave 5.
13. **Ghasts (~98 s):** Ghasts are invisible but listed in nearby NPCs by name with no level or Attack option. Use the filled pouch on one (`interact` use): it turns visible and the player auto-retaliates (18-42 s per kill). Messages "That's one Ghast", "two Ghasts", "all three Ghasts". Ghasts rot food (Rotten food, Pie dish) which fills slots.
14. **Finish:** the last Nature Spirit talk in the grotto finishes the quest.

## Key NPCs & Locations

| NPC / Location                | Where to Find                                         |
|-------------------------------|-------------------------------------------------------|
| Drezel                        | Underground Saradomin Temple, east of Varrock         |
| Filliman Tarlock              | Circular island in Mort Myre Swamp                    |
| Grotto                        | Circular island in Mort Myre Swamp                    |
| Nature Spirit                 | Inside the grotto after completing the ritual          |
| Silver sickle mould shop      | Crafting shop in Al Kharid                            |
| Ghasts                        | Roaming Mort Myre Swamp                               |
