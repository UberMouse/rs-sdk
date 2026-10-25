# Ernest the Chicken

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Medium     |
| Quest Points | 4       |

## Requirements

None.

## Items Needed

A spade (the other items are found during the quest).

## Rewards

- 300 gp

## Walkthrough

1. Speak to **Veronica** outside **Draynor Manor**. Her fiance Ernest went inside and hasn't returned.
2. Enter the manor and climb to the top floor. Speak to **Professor Oddenstein**. He accidentally turned Ernest into a chicken and needs three parts to fix his machine: an oil can, a pressure gauge, and rubber tubing.

### Oil Can (Basement Lever Maze)

3. Go to the basement of Draynor Manor. Navigate the lever puzzle to reach the room containing the **oil can**. Pull the levers in the correct sequence to open the doors leading to it.

### Pressure Gauge (Fountain)

4. Pick up the **poison** from the ground floor of the manor. Pick up the **fish food** as well.
5. Use the poison on the fish food to create **poisoned fish food**.
6. Use the poisoned fish food on the **fountain** in the manor garden. The piranhas die, allowing you to search the fountain for the **pressure gauge**.

### Rubber Tubing (Compost Heap)

7. Search the **compost heap** in the manor grounds to find a **key** (a spade is required: use it on the heap, `quest_haunted.rs2:13-20`) [server data, unverified in game 2026-10-23].
8. Use the key on the locked door behind the staircase on the ground floor.
9. Pick up the **rubber tubing** inside the room.

### Completion

10. Return all three items to Professor Oddenstein on the top floor. He restores Ernest to human form.

## Key NPCs & Locations

| NPC / Location         | Where                                       |
|------------------------|----------------------------------------------|
| Veronica               | Outside Draynor Manor entrance                |
| Professor Oddenstein   | Draynor Manor, top floor                      |
| Lever maze             | Draynor Manor basement                        |
| Fountain               | Draynor Manor garden                          |
| Compost heap           | Draynor Manor grounds                         |

## Verified run (plan `ernest-the-chicken`)

`conductor/plans/ernest-the-chicken.ts` ran the whole quest on worker questw1 in 343 s: Veronica 48, spade 18, poison 15, fish food 8, fountain ~41, basement steps 1.5-5 s each. The plan needs a weapon and 10 Salmon (dropped as step markers in the lever basement). [v 2026-10-23 questw1 local]

Item and NPC tiles (Draynor Manor map and the door/lever notes: `learnings/draynor-manor.md`):

| Thing | Tile | Notes |
|---|---|---|
| Veronica | (3110, 3330) | outside the manor |
| Spade | (3120, 3359) | ground floor |
| Poison | (3097, 3366) | ground floor |
| Fish food | (3108, 3356) | level 1 |
| Fountain | (3087, 3334) | pour poisoned fish food, then Search for the Pressure gauge |
| Compost heap | (3084, 3360) | outside; spade on it gives the key |
| Closet door / Rubber tube | door (3107, 3367), tube (3111, 3367) | key opens the closet; use the key again to get out |
| Oil can | (3092, 9755) | basement room behind the 8-9 door |
| Professor Oddenstein | (3110, 3367), level 2 | stage 1 asks for the parts, stage 2 takes them |

[v 2026-10-23 questw1 local] for every row.

- Fountain Search: the `interact` task returns on the animation before the dialog opens. Pass `expect: 'pressure gauge'`, then a `talk {continue:true}` gated on the dialog being open. [v 2026-10-23 questw1 local]
- Stairs: ground-floor Staircase (3108, 3363) "Walk-up" lands (3108, 3366); level-1 Staircase (3108, 3364) "Walk-down"; level-1 Staircase (3104, 3362) "Climb-up" to the top floor. [v 2026-10-23 questw1 local]
- Basement ladder (3092, 3362) in the west garden leads to (3116, 9754); the ladder up is at (3117, 9754). [v 2026-10-23 questw1 local]
