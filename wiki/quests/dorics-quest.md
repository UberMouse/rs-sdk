# Doric's Quest

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Short      |
| Quest Points | 1       |

## Requirements

None.

Recommended: 15 Mining.

## Items Needed

- Pickaxe
- 6 Clay
- 4 Copper ore
- 2 Iron ore

## Rewards

- 1,300 Mining XP
- 180 gp
- Use of Doric's anvils

## Walkthrough

1. Speak to **Doric** at his house north of Falador, just east of the road leading to Taverley. He asks you to bring him some ores.
2. Collect the following ores:
   - 6 **Clay**
   - 4 **Copper ore**
   - 2 **Iron ore**
3. These can be mined at the **Dwarven Mines** south of Falador (entrance at the base of Ice Mountain), or at various other mining sites.
4. Return all ores to Doric to complete the quest.

### Verified route

Run by `conductor/plans/dorics-quest.ts`: a fresh load of `lib:dorics-quest-start` (Mining 15, a bronze pickaxe, at the Rimmington mine) to quest done in 162 s: mine 6 clay (40 s), 4 copper (28 s) and 2 iron (16 s), walk to Doric and open his door (52 s), start and hand over (23 s). [v 2026-11-01 questw1 local]

- The Rimmington mine (x 2968-2987, z 3233-3248) has clay, copper and iron within one area, all minable at Mining 15. [v 2026-11-01 questw1 local]
- Doric (2951, 3451) stands inside his house behind a closed south Door (2949, 3450); with it shut `talk` finds him unreachable. Open it with `interact` first (from (2949, 3448)). [v 2026-11-01 questw1 local]
- Start: "I wanted to use your anvils", then "Yes, I will get you materials". The hand-over needs no choices, counts the ores with `inv_total` (extras are fine) and pays 180 coins (`quest_doric.rs2`). The quest state lags the start dialog: wait a phase before the hand-over talk. [v 2026-11-01 questw1 local]

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Doric                  | North of Falador, east of the road to Taverley |
| Dwarven Mines          | South of Ice Mountain, north of Falador      |
| Mining sites           | Various; Dwarven Mines contain all three ore types |
