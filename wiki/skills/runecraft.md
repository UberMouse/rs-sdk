# Runecraft

Runecraft turns rune essence into runes at an altar. Sources: `server/content/scripts/skill_runecraft/configs/runecraft.dbrow`, `essence_mine.rs2`; run facts from workers conductor2w1 and conductor2.

## Mechanics

- XP is per essence crafted (air: 125 XP per essence at the local 25x rate). Level only adds runes per essence, not XP. [v 2026-10-16 conductor2w1 local]
- One craft action converts the whole stack of essence in the inventory. [v 2026-10-16 conductor2w1 local]
- No tiaras and no pure essence exist in this revision. A ruins is entered by using that altar's own talisman on the ruins (the talisman is not consumed); only rune essence is used. [v 2026-10-16 conductor2w1 local]
- Altar levels: air 1, mind 2, water 5, earth 9, fire 14, body 20.

## Rune essence

- Mine: Aubury (Varrock rune shop, stand at (3252, 3402)) has a Teleport option (op4, no dialog) once Rune Mysteries is done (see [rune-mysteries](../quests/rune-mysteries.md)). The portal in the mine returns you beside Aubury, (3252-3253, 3402-3403). A null exit defaults to Sedridor (untested live). [v 2026-10-16 conductor2w1 local]
- Essence rocks (loc 2491) stand in four clusters about 35 tiles apart, and the teleport can land out of view of every rock, so the task must walk to a cluster. The rock never depletes. Mining: [mining](mining.md); tasks `essence-mine` and `mining` with `rock: "essence"`. [v 2026-10-16 conductor2w1 local]
- Pickaxe swing ticks: bronze 7, iron 6, steel 5, mithril 4, adamant 3, rune 2. Essence swing period is the pickaxe value + 1 (bronze 7+1 = 8 ticks per essence, measured 8.00 with one Mine click and with a click per ore, 20 essence); a re-click right after an ore costs nothing (`mining.rs2` get_ore_essence re-queues the swing), so only a faster pickaxe speeds it up. [v 2026-10-16 conductor2w1 local]

## Talismans (drop sources, from drop tables, not run)

| Altar | Talisman source |
|---|---|
| Air | Duke Horacio after Rune Mysteries |
| Mind | imps 7/128 |
| Water | wizards 3/128 |
| Earth | men, women, farmers 2/128 |
| Fire | skeletons 2/128 |
| Body | guards 3/128 |

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Air altar, Falador ruins | (2983, 3291) | 1 | Aubury teleport, mine 20 essence (bronze pickaxe), portal back, walk to ruins, enter, craft, exit, walk back. About 635 ticks per trip (teleport 6, mine 166, portal 9, Aubury to ruins + craft + exit ~240, walk back ~215); 27 essence ~44k XP/hr. Runecraft 17 -> 33 and Mining +4750 in a 10 min `air-runecraft` plan (3 crafts) | ~35k Runecraft (20 essence, computed from tick budget; one plan, not stats.ts) | 2026-10-16 conductor2w1 local |
| Earth altar, ruins (3305, 3470) | (3305, 3470) | 9 | Loop with a worn adamant pickaxe (wield Attack 31; it mines essence unchanged) and 26-27 essence. The talisman holds a slot (no tiaras), so 27 is the cap on the first trip; after the first craft the earth runes take a second slot, so later trips carry 26 (28 is impossible; banking the runes each trip costs ~20 ticks, not worth it). Phases, 0.4 s ticks: enter-mine (walk to Aubury + teleport) ~64 ticks, mine 118-145 (4.5-5.4 per essence), portal out ~6, craft-earth (Aubury to ruins, enter, craft, exit) ~65-68. About 256 ticks per trip, ~4,280 XP per trip. Needs an earth talisman. Plan `earth-runecraft-28`: Runecraft 34 -> 45 in 339 s (Mining +9,875). The 25-essence layout (pickaxe in inventory) was ~230 ticks, ~3,656 XP/trip, ~143k/h | ~150k Runecraft (computed from trip time, not stats.ts) | 2026-10-16 conductor2 local |


The air altar loop also fits a first trip: one 25-essence air trip took Runecraft 1 -> 9+ (+3,125 XP; craft phase ~87 s including the Falador walk). [v 2026-10-16 conductor2 local]

Earth talisman source: one 172 s combat hunt on "Man" in Varrock (area (3238, 3404) radius 14, near Aubury and the Varrock East bank) dropped one; a single sample consistent with the 2/128 table above. [v 2026-10-16 conductor2 local]
