# Witch's House

| Detail     | Info          |
|------------|---------------|
| Difficulty | Intermediate  |
| Length     | Medium        |
| Quest Points | 4 QP       |

## Requirements

- No skill requirements
- Ability to defeat a 4-phase boss (levels 19, 30, 42, and 53)

## Items Needed

- Leather gloves
- Cheese
- Food
- Weapon and armour

## Rewards

- 4 Quest Points
- 6,325 Hitpoints XP

## Walkthrough

1. Speak to the **boy** standing south of the witch's house in **Taverley**. He has lost his ball in the witch's yard.
2. Go to the front door of the witch's house. Look under the **potted plants** near the door to find the **door key**.
3. Enter the house. The witch's **diary** is a floor item upstairs (level 1, (2900, 3473)); pick it up and read it after the mouse step. [v 2026-11-01 questw4 local]
4. Go to the basement (ladder (2907, 3476)). Wear your **leather gloves** before the iron gate (2902, 9873); bare hands take a shock (`quest_ball.rs2:34-37`). Open then Search the cupboard (2898, 9873) for a **magnet**. [v 2026-11-01 questw4 local]
5. Back on the ground floor, use the **cheese** on the **mouse hole** (2903, 3466): the mouse appears for 50 ticks.
6. Use the **magnet** on the mouse: this unlocks the back door (2901, 3465) to the garden. [v 2026-11-01 questw4 local]
7. Go out to the yard. Be careful to avoid the **witch** who patrols the garden -- if she sees you, she curses you and teleports you out, and if the mouse-door stage is done it resets to started, deleting the shed key and ball (`witch.rs2:24-29`). Time your movements to stay out of her path. [server data, unverified in game 2026-10-23]
8. **Check** the **fountain** (2909, 3470) in the yard (op2, not Search): the compartment holds the shed key. There is no combination to enter (`quest_ball.rs2:162-168`). [v 2026-11-01 questw4 local]
9. Use the key to open the **shed** in the backyard.
10. Inside the shed, the **Witch's Experiment** attacks. It has 4 phases, each a different form with increasing combat level:
    - Phase 1: Level 19
    - Phase 2: Level 30
    - Phase 3: Level 42
    - Phase 4: Level 53
11. Defeat all four phases of the experiment. Pick up the **ball** from the shed.
12. Return the ball to the **boy** outside to complete the quest.

## Key NPCs & Locations

| NPC / Location        | Where to Find                              |
|-----------------------|--------------------------------------------|
| Boy                   | South of the witch's house, Taverley       |
| Witch's house         | Taverley, near the southern entrance       |
| Witch                 | Patrols the garden of her house            |
| Witch's Experiment    | Inside the garden shed (4-phase boss)      |
| Fountain              | Witch's yard                               |

## Verified route (plan `conductor/plans/witchs-house.ts`, fresh load of `lib:witchs-house-start`, done in 428 s)

Save: Taverley (2929, 3445), Att 40 Str 54 Def 40 HP 47, mithril scimitar; pack order 15 swordfish first, then leather gloves, 2 cheese, 100 coins (the low-HP eat picks the first edible slot, and with cheese first it tried Cheese and failed). Won with food to spare; the minimum is untested. [v 2026-11-01 questw4 local]

- Boy (2929, 3447): Talk-to, "What's the matter?", "Ok, I'll see what I can do". [v 2026-11-01 questw4 local]
- Door key under the Potted plant (2900, 3474) (Look-under); front door (2901, 3473). Ladder (2907, 3476) Climb-down to the basement (2907, 9875); the house staircase (2906, 3469) is Walk-up/Walk-down. [v 2026-11-01 questw4 local]
- Basement: iron gate (2902, 9873) needs the gloves worn; cupboard (2898, 9873) Open then Search gives the magnet. [v 2026-11-01 questw4 local]
- Mouse: cheese on the Mouse hole (2903, 3466) spawns the Mouse for 50 ticks; the magnet on the mouse unlocks the back door (2901, 3465). [v 2026-11-01 questw4 local]
- Diary: floor item on level 1 at (2900, 3473). Reading it after the mouse step sets ballquest 5, so a witch catch no longer resets to started (`quest_ball.rs2`, script). In game Read showed no client effect, but later catches did not reset the quest. [v 2026-11-01 questw4 local]
- A witch catch deletes the shed key and ball and teleports to (2929, 3456). Hazard details and safe pockets: `learnings/hazards.md` (Nora T. Hagg).
- Fountain yard (2909-2912, 3469-3475) is a dead end from strip z 3466. The Fountain (2909, 3470) op2 is "Check" (not Search) and gives "Key". The yard does not connect to the house: go strip z 3466, the corridor x 2933 (z 3461-3466), then strip z 3460. House front to the boy: down column x 2899, east along z 3458 (out of her range). [v 2026-11-01 questw4 local]
- Shed door (2934, 3463) opens with that Key from corridor x 2933; ball on the shed floor about (2935, 3460). Opening the door spawns the experiment. [v 2026-11-01 questw4 local]
- Experiment forms: Witches experiment, second form, third form, fourth form (19/30/42/53); each turns into the next on death within seconds. Fights took 51/42/46/70 s. [v 2026-11-01 questw4 local]
- The quest completes on talking to the boy with the ball. [v 2026-11-01 questw4 local]

Plan gotchas: `wear` falsely reports done if the bot only moved (gate on the gloves leaving the pack); the cheese-on-hole interact reports no-effect because the message is a mesbox, but the mouse appears; `combat` reports failed after each form dies (it waits for the same name) but the fight is won, so use `onFail: 'continue'`; Climb-up from the basement ends "done" at the animation start while still underground, and an immediate walk fails "No connector from level 0 (2907,9875)" (retry through another phase).
