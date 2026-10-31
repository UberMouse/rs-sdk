# Sheep Shearer

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Short      |
| Quest Points | 1       |

## Requirements

None.

## Items Needed

- Shears (available from general stores)

## Rewards

- 150 Crafting XP
- 60 gp

## Walkthrough

1. Speak to **Fred the Farmer** at his farm northwest of Lumbridge. He needs 20 balls of wool.
2. Use shears on sheep in the nearby pen to obtain **wool**. Shear 20 sheep total.
3. Take the wool to the **spinning wheel** on the 2nd floor of Lumbridge Castle. Use each piece of wool on the spinning wheel to create **balls of wool**.
4. Return all 20 balls of wool to Fred the Farmer.

### Verified route

Run by `conductor/plans/sheep-shearer.ts`: a fresh load of `lib:sheep-shearer-start` (Lumbridge courtyard, level 1, a pair of Shears) to quest done in 359 s: Fred 32 s, shear 20 wool 180 s, spin 91 s (incl. the walk up the castle), hand-in 55 s. [v 2026-11-01 questw4 local]

- Fred the Farmer (3190, 3273): "I'm looking for a quest." then "Yes okay. I can do that." He takes one ball per tick after the dialog (`fred_the_farmer.rs2`), so a second hand-in talk finishes the last balls. [v 2026-11-01 questw4 local]
- The woolly sheep graze in Fred's pen (3193-3210, 3261-3272). A shear sometimes ends `no-effect`; give the shear phase a `-b` duplicate. [v 2026-11-01 questw4 local]
- The Lumbridge Castle spinning wheel (3209, 3212) is on level 1 and usable only from its stand tile (3209, 3213); pass that tile (with `level: 1`) and `material: 'wool'` to the `spinning` task. Given the wheel's own tile it walks forever without failing. [v 2026-11-01 questw4 local]

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Fred the Farmer        | Farm northwest of Lumbridge                  |
| Sheep pen              | Adjacent to Fred's farm                      |
| Spinning wheel         | Lumbridge Castle, 2nd floor                  |
