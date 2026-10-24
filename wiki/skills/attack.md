# Attack

The Attack skill determines how frequently you hit an opponent in melee combat. Higher attack also unlocks stronger weapons.


## Training

Use the **Accurate** fighting style to gain Attack XP. Grants 4 XP per damage dealt.

## Weapon Tiers

| Level | Metal     |
|-------|-----------|
| 1     | Bronze    |
| 1     | Iron      |
| 5     | Steel     |
| 10    | Black     |
| 20    | Mithril   |
| 30    | Adamant   |
| 40    | Rune      |
| 60    | Dragon    |

## Notes

- Attack level affects only accuracy, higher damage requires training Strength.
- See the Items Database for detailed weapon stats.
- Swing speed comes from the weapon's `attackrate` (default 4 ticks): scimitars, swords, daggers and claws 4; longswords and maces 5; battleaxes 6; 2h swords and halberds 7 (`skill_combat/configs/melee/*.obj`, `player_melee.rs2:59`). A kill pays exactly NPC HP x 100 XP at 25x to the trained skill (damage is capped at the NPC's remaining HP, `player_melee.rs2:32`), so the scimitar's speed beats every slower weapon on XP/h. [server data, unverified in game 2026-10-16]
- Adamant and Rune scimitars are sold by no shop (Zeke's stops at Mithril): smith them (adamant: Smithing 75, 2 bars; rune: Smithing 90, 2 runite bars, `smithing.dbrow:177-198`). No dragon scimitar exists in this revision. A rune longsword (Scavvo, 32,000 gp) needs the Champions' Guild (32 quest points); a dragon longsword (Jakut, Zanaris, 100,000 gp) needs Lost City and is only ~1-2% faster than a rune scimitar. [server data, unverified in game 2026-10-16]
- Melee training targets by model (HP / defence): hill giant 35/26 (12 spawns, Edgeville Dungeon), moss giant 60/30 (4 spawns at (3158, 9903) and (3165, 9879), Varrock Sewers west pocket x 3153..3221, z 9874..9908, multi-combat; not reachable from the hill giants: the Edgeville Dungeon network ends at a wall at x 3152 [v 2026-10-22 itndsk295sn7 local]; reached from Varrock East bank down the manhole (3237, 3458), west through a slashable Web (loc 733 `bigweb_slashable`, (3210, 9898), the pocket's only opening; wield a slash weapon, 50% per try, regrows after 100 ticks, `general_use/scripts/web.rs2`): a mithril scimitar bot walked bank to (3158, 9895) in 73203 ms, web slashed in 2 attempts [v 2026-10-22 itndsk295sn7 local]), ice giant 70/40 (3, Asgarnian Ice Dungeon). The world index floor ([strength](../training/strength.md)) has moss giants 5-8% over hill giants at Attack/Strength/Defence 70 with the same scimitar (mithril, rune), food trips left out of both. [model 2026-10-23 wiki/world]

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge chickens | (3231, 3295), radius 8 | 1-4+ | `combat` task with Attack style; same spot and gear as [strength](strength.md#verified-training-spots) | ~18k Attack (local, 1 min run, not stats.ts) | 2026-10-10 conductor2 local (rev 289; Attack 6->15 in 92 s, 16 kills, 4 bones buried: Prayer 1->5) |
| Lumbridge cows | (3253, 3290) | 18-40 | `combat` task, Attack style; Steel scimitar (400 gp at Zeke's, Al Kharid) + Iron kiteshield, Trout as food; pen described in [combat](../../learnings/combat.md#cow-field-details-proven-from-200-kills), area [lumbridge](../places/lumbridge.md). Also gives Hitpoints (+4,317 in this run). `plan-melee40` phase, 275 s: Attack 18->40 (+13,200) | ~173k Attack (local, one run) | 2026-10-11 conductor2 local |
| Falador farm cows | (3027, 3307), radius 22 | 28-40 | `combat` with `targetRange: "visible"`, Mithril scimitar (Zeke, Al Kharid) + Wooden shield, no food; cows were not thin, first fight settled in 17 ticks, no idle waits. Plan `melee40` (bank, descend Stronghold, buy scimitar, walk to farm, fight Attack then Defence): Attack 28->40 (+9,700) in 79.2 s of fighting; whole plan 578 s (Zeke shop leg 270 s from the Stronghold, to-farm 82 s, bank 20 s, descend 11.6 s), 1,040 coins. Also +7,442 HP (42->47) with Defence | ~441k Attack (local, one run) | 2026-10-24 conductor3 local |
| Edgeville Dungeon hill giants | (3100-3114, 9827-9840) | 44-77 | same spot and gear as [strength](strength.md#verified-training-spots) (runs trained Strength; Attack rate not measured) | not measured | 2026-10-16 conductor2w3 local |
