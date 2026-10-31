# Pirate's Treasure

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Medium     |
| Quest Points | 2       |

## Requirements

None.

## Items Needed

- White apron
- Spade
- 60 gp (30 gp for rum, 30 gp for Karamja fare)

## Rewards

- 450 gp
- Cut Emerald
- Gold Ring

## Walkthrough

1. Speak to **Redbeard Frank** at the pub in **Port Sarim**. He will tell you about buried pirate treasure in exchange for some Karamja rum.
2. Travel to **Karamja** via the ship from Port Sarim (30 gp fare). Buy **Karamja rum** from the Karamja Wines, Spirits and Beers shop, not the general store (`karamja.inv:1-10`). [server data, unverified in game 2026-10-23] Phase recipe: [ships](../../learnings/ships.md).
3. Speak to **Luthas** at the banana plantation on Karamja. He asks you to fill a crate with bananas. Use the rum on the banana crate to hide it inside, then fill the rest with bananas and talk to Luthas to send the crate.
4. Return to Port Sarim. Go to **Wyndin's food store** near the docks. Equip a **white apron** before entering. Search the back crate to retrieve the rum.
5. Bring the rum to Redbeard Frank. He gives you a **key** and tells you the treasure is in Varrock.
6. Travel to **Varrock**. Go to the **Blue Moon Inn** and climb to the 2nd floor. Use the key on the chest to find a note revealing the treasure's location.
7. Go to **Falador Park** with a **spade**. Dig at the location indicated by the note (near the statue) to uncover the treasure.

### Verified route

Run by `conductor/plans/pirates-treasure.ts`: a fresh load of `lib:pirates-treasure-start` (Port Sarim (3047, 3236), Att/Str/Def 30, HP 30, 100 coins, white apron, spade, 6 swordfish) to quest done in 416 s: Frank, apron and Wydin's job, boat out (about 90 s); Luthas, rum, bananas and crate (about 120 s); boat back, Wydin's crate and Frank (about 60 s); the chest (about 90 s); the gardener and the dig. [v 2026-11-01 questw6 local]

- The shop item is "Karamjan rum" (30 gp, Zambo). Carry none aboard: customs confiscates only rum carried. [v 2026-11-01 questw6 local]
- The rum goes in the banana crate (2943, 3151) only after Luthas has employed you, and is retrievable only after he pays (30 gp) for the full 10-banana crate. Banana trees (2909-2912, 3158-3164) have only "Search" (the `pick` task cannot take them; use `interact` with `tile`), give 5 bananas each and stay empty for a few minutes. [v 2026-11-01 questw6 local]
- Wydin's job needs the quest started and a white apron; his back door needs it worn. The right crate is (3009, 3207) among several "Crate" locs: give `interact` its `tile`. [v 2026-11-01 questw6 local]
- The Blue Moon Inn chest (3218, 3396) level 1 is usable only from (3219, 3396): a wall edge separates it from (3219, 3397), and the walk goes round (about 25 tiles). Use `at` with `tolerance: 0` and `unreachable: true`. [v 2026-11-01 questw6 local]
- Read the Pirate message (the task reports no effect because a scroll opens, but it sets `hunt` 3). The dig at (2999, 3383) gives the treasure only when no Falador gardener is within 10 tiles; otherwise the gardener attacks instead (`quest_hunt/scripts/dig.rs2:7-9`). Kill him and dig before he respawns. Reward: 450 coins, gold ring, emerald. [v 2026-11-01 questw6 local]

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Redbeard Frank         | Pub in Port Sarim                            |
| Luthas                 | Banana plantation, Karamja                   |
| Wyndin's food store    | Port Sarim, near the docks                   |
| Blue Moon Inn          | Varrock, south side                          |
| Treasure location      | Falador Park                                 |
