# Witch's Potion

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Short      |
| Quest Points | 1       |

## Requirements

None.

## Items Needed

- Onion
- Burnt meat
- Eye of newt (3 gp from Betty's Magic Emporium in Port Sarim)
- Rat's tail (dropped by rats)

## Rewards

- 325 Magic XP

## Walkthrough

1. Speak to **Hetty** in her house in **Rimmington**. She offers to increase your magic power if you bring her four ingredients.
2. Collect the following:
   - **Eye of newt**: Purchase from **Betty's Magic Emporium** in Port Sarim for 3 gp.
   - **Onion**: Pick from the onion field near Rimmington or other fields.
   - **Burnt meat**: Cook meat on a fire or range until it burns. Raw meat is dropped by cows, chickens, and other animals.
   - **Rat's tail**: Kill a rat and pick up the tail drop.
3. Return all four ingredients to Hetty.
4. Hetty prepares the potion in her **cauldron**. Drink from the cauldron to complete the quest.

### Verified route

Run by `conductor/plans/witchs-potion.ts`: a fresh load of `lib:witchs-potion-start` to quest done in 110 s (Hetty 20 s, rat 24 s, onion 17 s, Betty 20 s, hand-in 28 s, cauldron 2 s). The save holds the burnt meat: at Cooking 1, four raw beef on the Rimmington range all came out cooked, so burning is too unreliable to plan around. [v 2026-11-01 questw6 local]

- Hetty's start choices: "I am in search of a quest." then "Yes help me become one with my darker side." Varp `%hetty` goes 0 -> 1 on starting, 2 when the four ingredients are handed over, 3 after drinking. [v 2026-11-01 questw6 local]
- A rat drops a rat's tail only while the quest is started and none is held (`drop tables/scripts/rat.rs2`), so talk to Hetty before the kill. Rats around the start tile (2957, 3204) in Rimmington serve. [v 2026-11-01 questw6 local]
- An onion field lies within 14 tiles of (2951, 3250), north of Rimmington (`pick` with loc and item "Onion"). [v 2026-11-01 questw6 local]
- Betty (3012, 3259) sells an eye of newt for 3 gp; the `shop` task's `npc` is a plain name (`Betty`), not a regex. [v 2026-11-01 questw6 local]
- The cauldron loc is "Cauldron", option "Drink From". [v 2026-11-01 questw6 local]

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Hetty                  | House in Rimmington                          |
| Betty's Magic Emporium | Port Sarim                                  |
| Rats                   | Various locations; common in Lumbridge       |
| Onion field            | Near Rimmington                              |
