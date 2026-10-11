# Mining

Mining is used to extract ores and metals from rocks. Requires a pickaxe (available from Bob's Axes or the Dwarven Mine shop).

## Pickaxes

| Pickaxe | Mining to use | Attack to wield | `mining_rate` | Ticks between rolls | Nurmof's price |
|---------|-------|-----|-----|-----|-----------|
| Bronze | 1 | 1 | 7 | 8 | 1 gp (also Bob's, Lumbridge; free spawns at Barbarian Village, Lumbridge 3F) |
| Iron | 1 | 1 | 6 | 7 | 140 gp |
| Steel | 6 | 5 | 5 | 6 | 500 gp |
| Mithril | 21 | 20 | 4 | 5 | 1,300 gp |
| Adamant | 31 | 30 | 3 | 4 | 3,200 gp |
| Rune | 41 | 40 | 2 | 3 | 32,000 gp |

- A pickaxe works from the inventory or the weapon slot; `~pickaxe_checker`
  (`skill_mining/scripts/pickaxe_checker.rs2`) takes the best one the Mining level allows
  (`levelrequire` in `configs/pickaxes.obj`). Wielding needs Attack (`levelrequire/scripts/tier*.rs2`).
  There is no black or dragon pickaxe, and pickaxes cannot be smithed (no pickaxe row in
  `skill_smithing/configs/smithing/smithing.dbrow`). [v 2026-10-10 conductor2 local; read from content]
- Nurmof's Pickaxe Shop, Dwarven Mine under Falador, (2998, 9844), is the only shop above bronze;
  stock 5 iron / 4 steel / 3 mithril / 2 adamant / 1 rune (`wiki/shops/nurmofs-pickaxe-shop.md`, generated). Visited 2026-10-11: Iron pickaxe 140 gp, Bronze pickaxe 1 gp (conductor2w1 local).

## Mining speed

From `skill_mining/scripts/mining.rs2` and the engine's `STAT_RANDOM`
(`server/engine/src/engine/script/handlers/PlayerOps.ts`): [v 2026-10-10 conductor2 local; read from content]

- The pickaxe sets only the interval: the first roll lands `mining_rate` ticks after the first
  swing, then one roll every `mining_rate + 1` ticks (table above).
- The rock sets the chance, the same for every pickaxe:
  `min(256, floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1) / 256`, L = current Mining level,
  `low,high` = `rock_successchance` in `configs/mine.dbrow` (copper/tin 128,400; iron 96,350;
  coal 16,100; silver 25,200; gold 7,75; mithril 5,50; adamantite 2,25; runite 1,18). Iron
  succeeds on every roll at level 99.
- Each success gives one ore and empties the rock, so the bot moves to another rock after every
  ore. Rocks in the `mining_rock_normal` category (copper, tin, coal, gold, ...) add a 1-tick
  `p_delay` on success; iron (`mining_rock_fast`) does not. One roll in 256 is a gem instead of an ore.
- Respawn (`rock_respawnrate`, ticks): copper/tin 10, iron 20, coal 100, silver/gold 200,
  mithril 400, adamantite 800, runite 2400, scaled down slightly by player count.

## Ores

| Level | Ore | XP | Notable Locations |
|-------|-----|----|-------------------|
| 1 | Rune essence | 5 | Varrock, Yanille rune essence mines |
| 1 | Clay | 5 | |
| 1 | Tin | 17.5 | SW Varrock, SE Varrock, Rimmington |
| 1 | Copper | 17.5 | SW Varrock, SE Varrock, Rimmington |
| 10 | Blurite | 17.5 | |
| 10 | Limestone | 26.5 | |
| 15 | Iron | 35 | Asgarnian Ice Dungeon, Al Kharid |
| 20 | Silver | 40 | SE Varrock, Fight Arena, Al Kharid |
| 30 | Coal | 50 | Al Kharid, SW Varrock, Crafting Guild |
| 40 | Gold | 65 | Dwarven Mine, Coal Trucks, Barbarian Village, Mining Guild |
| 40 | Gems | 65 | Shilo Village (requires Shilo Village quest) |
| 55 | Mithril | 80 | North Brimhaven, Crafting Guild |
| 70 | Adamantite | 95 | Al Kharid mine, Lumbridge Swamp mine (the east swamp, (3240, 3164)), Dwarven Mine, Edgeville Dungeon, Heroes' Guild mine, Grand Tree tunnels, Desert Mining Camp, Crandor, Karamja (2848, 3033), Haunted Mine, Tirannwn, Wilderness |
| 85 | Runite | 125 | Heroes' Guild mine (2939, 9891), Lava Maze dungeon (3046, 10265), Wilderness (3060, 3885) |

Levels and XP (`rock_level`, `rock_exp` in tenths) from `server/content/scripts/skill_mining/configs/mine.dbrow`; pickaxe levels from `pickaxes.obj` (`levelrequire`, iron is 0 = no requirement). [v 2026-10-09 conductor1 local] The adamantite and runite locations are every rock site of those ores in `wiki/world.json` (map data): the swamp has no rocks in its west and no runite. The other rows' locations are unverified.

## Mining Guild

- **Location:** Falador (inside Dwarven Mines)
- **Requirement:** 60 Mining
- **Features:** Coal and mithril rocks, access to main Dwarven Mines

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| SE Varrock mine, copper | (3285, 3365) | 1-31 | bronze pickaxe (Bob's, 1 gp), drop ores; radius 10; copper+tin together also took Mining 1-30 in ~141s at combat 20 | ~164k (local) | 2026-10-10 conductor2 local |
| SE Varrock mine, copper+tin | (3285, 3365) | 31-44 | bronze pickaxe, drop ores, ~10 ores/min | ~267k (local) | 2026-10-09 conductor1 local |
| SE Varrock mine, iron | (3285, 3365) | 15+ (run covered 30-50) | bronze pickaxe, drop when full, radius 10; Mining 30->50 in 3 min at combat 20, nothing attacked | ~541k (local) | 2026-10-10 conductor2 local |
| SE Varrock mine, iron, adamant pickaxe | (3285, 3365) | 51-99 | adamant pickaxe, radius 10; Mining 69->99 in 61 min (873,250 XP, mining phase 3,576 s), no attackers, gems drop as a byproduct. drop when full (before 02b861cd5) | ~879k (local; 873,250 XP / 3,576 s) | 2026-10-11 conductor2 local |
| Al Kharid mine, iron, adamant pickaxe | (3299, 3308) r6 | 92-97 | [Al Kharid mine](../places/al-kharid-mine.md) north site: 5 iron rocks in reach in two clusters, 42 of 110 cycles were 9-tick switches between them. A/B, 5 min each: drop when full (before 02b861cd5) 77,000 XP (~924k/h); drop each ore as mined (02b861cd5) 96,250 XP (~1.155M/h) | ~1.155M (local, drop each ore) | 2026-10-11 conductor2w1 local |

Every row's rate used drop-when-full except the Al Kharid drop-each-ore figure; since 02b861cd5 the miner drops each ore as mined (about +25% at Al Kharid).

Copper, tin and iron rocks all lie within 1-4 tiles of the centre; no attackers at the mine. Do not walk in from Falador along z ~3376: the Varrock stone circle (~3223, 3373) has dark wizards (`learnings/hazards.md`); approach via (3260, 3335). See `learnings/mining.md` for identifying rocks.

## Tips

- You can prospect rocks (right-click) to see what ore they contain.
- A better pickaxe shortens the time between rolls (see Mining speed); it does not raise the chance.
