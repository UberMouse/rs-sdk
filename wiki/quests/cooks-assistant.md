# Cook's Assistant

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Short      |
| Quest Points | 1       |

## Requirements

None.

## Items Needed

- Pot
- Bucket

## Rewards

- 300 Cooking XP
- Access to the Cook's range in Lumbridge Castle kitchen

## Walkthrough

1. Speak to the **Cook** in the kitchen of **Lumbridge Castle**. He needs a cake for the Duke's birthday but is missing ingredients: an egg, a pot of flour, and a bucket of milk.
2. **Pot of flour**: Pick up grain from the wheat field north of Lumbridge. Take it to the windmill further north. Use the grain on the hopper (top floor), operate the controls, then collect the flour from the bin on the ground floor using a pot.
3. **Egg**: Head to the chicken farm northeast of Lumbridge, across the river. Pick up an egg from the ground inside the chicken pen.
4. **Bucket of milk**: there is no dairy-cow loc. Use the empty bucket on a **Cow** NPC (`[opnpcu,cow]` in npc/scripts/cow_milking.rs2), in the pasture around (3253,3270). It is a use-item-on-NPC. [v 2026-10-23 questw3 local]
5. Return all three items to the Cook to complete the quest.

## Details from the scripts

[server data, unverified in game 2026-10-23]

- Start: talk to the Cook, "What's wrong?" then "Yes, I'll help you." The hand-in is a plain talk with the three items held (quest_cook.rs2 stages 0, 1, 2).
- Egg ground spawns: (3226,3301), (3229,3299). Empty bucket: (3225,3294). Empty pot: (3210,3212).
- Wheat (`pick`) in the field x 3153-3164, z 3291-3306.
- Mill: hopper (3166,3307) level 2, controls (3166,3305) level 2, flour bin (3166,3307) level 0. The bin keeps a per-player flour count (varp %flour, max 30) and must be non-empty to take flour.

## Verified by the plan run

`conductor/plans/cooks-assistant.ts` (promoted) completed the quest from a fresh load in 198 s. [v 2026-10-23 questw3 local]

- The pot spawn (3210,3212, on the kitchen counter row; ground item named "Pot") and the bucket spawn (3225,3294) are on blocked tiles. `pickup` takes the pot from (3210,3213) inside the kitchen [v 2026-10-24 questw7 local]; the bucket from an adjacent tile is untested. The eggs at (3229,3299) and (3226,3301) are reachable. The promoted plan still buys the pot (1 gp) and bucket (2 gp) at the Lumbridge General Store (see `learnings/shops.md`), selling 3 Salmon (55 gp) to pay: a start needs Salmon or 10+ coins. [v 2026-10-23 questw3 local]
- Milk: `interact` npc `^cow$` with `use` `^bucket$`, `expect: 'you milk the cow'`. [v 2026-10-23 questw3 local]
- Mill: operating the Hopper controls with an empty hopper says "Nothing interesting happens." and plays an animation that `interact` counts as a change, so give `expect: 'slides down the chute'`. A second grain is refused: "There is already grain in the hopper." The Flour bin with nothing stored says "The flour bin is already empty." [v 2026-10-23 questw3 local]
- A `shop` walk starting on mill level 2 failed "No path": descend first. An `at` step with level 0 on the flour step walks down by itself. [v 2026-10-23 questw3 local]

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Cook                   | Lumbridge Castle, ground floor kitchen       |
| Wheat field            | North of Lumbridge                           |
| Windmill               | North of the wheat field                     |
| Chicken farm           | Northeast of Lumbridge, east side of river   |
| Cow (milk)             | Pasture around (3253,3270)                   |
