# Romeo & Juliet

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Short      |
| Quest Points | 5       |

## Requirements

None.

## Items Needed

- Cadava berries (picked from bushes south of Varrock)

## Rewards

- 5 Quest Points

## Walkthrough

1. Speak to **Juliet** on the 2nd floor of the house west of Varrock. She gives you a message for Romeo. Choosing "I guess I could find him" (juliet.rs2 p_choice4) goes from stage 0 straight to stage 2 with the Message in hand, so asking Romeo first (stage 1) is optional. [v 2026-10-23 questw3 local]
2. Deliver the message to **Romeo** in **Varrock Square**.
3. Romeo directs you to **Father Lawrence** at the chapel northeast of Varrock. Speak with him about a plan.
4. Father Lawrence sends you to the **Apothecary** south of Varrock Square. Bring him cadava berries and he gives you the **cadaver potion**.
5. Return the cadaver potion to **Juliet**.
6. Speak to **Romeo** in Varrock Square to complete the quest.

## Stages (varp)

| Stage | Meaning |
|---|---|
| 1 | Romeo asked (optional) |
| 2 | Message held |
| 3 | Message delivered |
| 4 | Father Lawrence done |
| 5 | Apothecary done (needs cadava berries) |
| 6 | Potion given to Juliet |
| 100 | Romeo "it's all set" completes the quest |

Every NPC conversation is a no-op outside its stage, so the quest is restartable from any state. [server data, unverified in game 2026-10-23]

## Run notes

- Cadava berries are ground spawns (m51_52) at (3266,3361), (3273,3375), (3277,3370), south-east of Varrock. Picking them near (3272,3369) did no harm; the "poisonous" line is flavour text. [v 2026-10-23 questw3 local]
- Whole quest from Lumbridge took 294 s: approach walk 66 s, Juliet start 47 s, each other talk 20-30 s. Plan `conductor/plans/romeo-juliet.ts`. [v 2026-10-23 questw3 local]
- Lumbridge to Varrock east via waypoint (3260,3335) is safe; see `learnings/hazards.md` (dark wizards).

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Juliet                 | 2nd floor, house west of Varrock             |
| Romeo                  | Varrock Square                               |
| Father Lawrence        | Chapel, northeast Varrock                    |
| Apothecary             | South of Varrock Square                      |
| Cadava bushes          | South of Varrock, near the mine              |
