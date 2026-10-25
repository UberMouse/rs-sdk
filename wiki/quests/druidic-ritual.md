# Druidic Ritual

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Medium     |
| Quest Points | 4 QP    |

## Requirements

- None

## Items Needed

- One each of raw beef, raw rat meat, raw bear meat and raw chicken (4 items; Sanfew asks for the enchanted versions of exactly these; `sanfew.rs2:56`). Hold them until Sanfew has been spoken to: the cauldron only works after that.

## Rewards

- 4 Quest Points
- 250 Herblore XP
- Not needed for Herblore in this revision: see [Herblore](../skills/herblore.md) [v 2026-10-23 conductor3w5 local]

## Walkthrough

1. Speak to **Kaqemeex** at the stone circle north of Taverley. He asks you to help the druids complete a ritual to purify the circle.
2. Go south into Taverley and visit **Sanfew** on the 2nd floor of the Herblore shop.
3. Sanfew tells you to have one each of four raw meats (beef, rat, bear, chicken) enchanted in the Cauldron of Thunder in **Taverley Dungeon**.
4. Enter Taverley Dungeon. Head to the prison door area where you will need to fight past animated suits of armour.
5. Use each of the 4 different raw meats on the **Cauldron of Thunder** to enchant them.
6. Return the enchanted meats to **Sanfew** on the 2nd floor of the Herblore shop.
7. Go back to **Kaqemeex** at the stone circle north of Taverley to complete the quest.

## Key NPCs & Locations

| NPC / Location         | Where to Find                          |
|------------------------|----------------------------------------|
| Kaqemeex               | Stone circle, north of Taverley        |
| Sanfew                 | 2nd floor, Herblore shop in Taverley   |
| Cauldron of Thunder    | Taverley Dungeon, past the prison door |

## Verified details

- Kaqemeex start dialog choices: 'search of a quest' then 'Ok, I will try' (`kaqemeex.rs2`). [v 2026-10-16 conductor2 local]
- Sanfew is npc 454 upstairs (level 1) at (2897, 3426) in the Taverley herb house. Spiral stairs up: loc 1738 at (2898, 3428) level 0, stand at (2897, 3428); down: loc 1740 (`stairs.rs2`, map m45_53). `walkTo`/talk reach Sanfew via the stairs (Taverley connectors, a4efe2376). Start choices: 'sent to assist|help purify|assist you' then 'do that then'; at the Sanfew stage he offers "What was I meant to be doing again?" / "I'll get on with it." (`sanfew.rs2`). [v 2026-10-16 conductor2 local]
- Cauldron of Thunder loc at (2893, 9831) (map m45_153), behind iron doors ~(2887, 9829); the first opens animate Suits of armour (level 19, HP 29; `prison_doors.rs2`). Taverley Dungeon ladder at (2884, 3397); walkTo reaches the dungeon via it. Opening the cauldron iron door animates a Suit of armour that attacks; the bot kills it by auto-retaliation, and the combat task refuses to start while already in combat, so a plan must not schedule a non-combat phase while suits still attack (gate a first-in-order fight phase on "underground and (in combat or a suit visible)"). Using all four raw meats on the cauldron worked in one `talk` run with `use`. Run times: meat hunts ~0.5-2 min each, start talks ~1 min, dungeon+turn-in ~2.2 min. Reward Herblore 1 -> 28 (6,250 XP). [v 2026-10-16 conductor2 local]
- The promoted plan needs 3+ food in the pack for the meat hunts; it banks swordfish first when it holds fewer. A run from the bank-food version took ~9 min: Herblore 1 -> 28 (6,250 XP), Strength +12k, HP +4.4k from the 4 hunts. [v 2026-10-24 conductor3 local]
- Whole quest completes as one plan (`conductor/plans/druidic-ritual.ts`) from lib:lumbridge-quests (Att 40 Str 47 Def 40 HP 48) in 8.2 min; the game showed "Quest complete!", Herblore 1 -> 28 (6,250 XP). [v 2026-10-23 questw1 local]
- The quest tab reads 'started' right after the Kaqemeex talk. Sanfew's turn-in with the four enchanted meats needs no dialog choices. [v 2026-10-23 questw1 local]
- Stand at (2892, 9830) to use the raw meats on the Cauldron of Thunder; all four go in one talk `use` run once Sanfew has been spoken to. [v 2026-10-23 questw1 local]
- At combat ~50-54 the Suit of armour needed no separate fight in this run (the combat phase for it found none), and no skeleton or poison spider attacked in Taverley Dungeon; HP ended 45/50. [v 2026-10-23 questw1 local]
- Meat hunts (combat task + loot + until-held phase, 30-120 s each): raw chicken at Lumbridge chickens (3231, 3295 r8); raw beef at Lumbridge cows (3253, 3290 r12); raw rat meat from giant rats (3208, 3178 r10); raw bear meat from bears (2965, 3470 r12, north of Falador on the Taverley road). Timings ~30 s chicken, ~30 s beef, ~80 s rat, then the walk to the bears. [v 2026-10-23 questw1 local]
