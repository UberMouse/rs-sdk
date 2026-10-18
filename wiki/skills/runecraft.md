# Runecraft

Runecraft turns rune essence into runes at an altar. Sources: `server/content/scripts/skill_runecraft/configs/runecraft.dbrow`, `essence_mine.rs2`; run facts from workers conductor2w1 and conductor2.

## Mechanics

- XP is per essence crafted (air: 125 XP per essence at the local 25x rate). Level only adds runes per essence, not XP. [v 2026-10-16 conductor2w1 local]
- One craft action converts the whole stack of essence in the inventory. [v 2026-10-16 conductor2w1 local]
- No tiaras and no pure essence exist in this revision. A ruins is entered by using that altar's own talisman on the ruins (the talisman is not consumed); only rune essence is used. [v 2026-10-16 conductor2w1 local]
- Altar levels and XP per essence at 25x: air 1 (125), mind 2, water 5, earth 9 (162.5), fire 14 (175), body 20 (187.5), cosmic 27 (200), chaos 35 (212.5), nature 44 (225), law 54 (237.5), death 65 (250, but the death ruins have no `rune_type` and are never placed, so no talisman enters the death temple: unusable) (`runecraft.dbrow`, `runecraft.loc:284-289`). Runes per essence (`level/multiplier + 1`) do not change XP. No combination runes exist in this revision, and essence cannot be noted (`blankrune` is not stackable; `cert_blankrune` is only used in Drezel's dialogue). [server data, unverified in game 2026-10-16]
- Most ruins and exit portals land on one fixed tile; a few land at random: the cosmic ruins at one of the temple's four entrances, the body ruins and the body portal on any open tile within 2 of their coord, the chaos portals on one of eight tiles round the chaos ruins (`runecraft.dbrow` enter_coord / exit_coord). The world index has every landing tile (the teleport and scripted rows in `wiki/world.json` crossings). [server data, unverified in game 2026-10-19]
- Faster loops ranked from server data (research 2026-10-16, not run): fire with a Ring of dueling out (Duel Arena landing (3315, 3235), ~19 tiles from the fire ruins) and Varrock Teleport back is ~186k/h, but each ring is 8 trips and needs an emerald (gem trader stock 1, Herquin 0) plus a cosmic rune to enchant (only Lundail, Mage Arena, stock 20), so ~29 rings for 55 -> 99 is not practical. Without the ring fire is ~141k/h, no better than earth. Body via Falador Teleport in is ~150k/h for 2 law runes a trip. Earth with the rune stack dropped each trip (27 essence) and the nearest essence cluster is ~153k/h for no unlock (~171k/h with a rune pickaxe). Chaos (Wilderness), cosmic (Lost City + Zanaris) and law (Troll Stronghold, Entrana bans pickaxes) all come out below earth. [server data, unverified in game 2026-10-16]

## Rune essence

- Mine: Aubury (Varrock rune shop, stand at (3252, 3402)) has a Teleport option (op4, no dialog) once Rune Mysteries is done (see [rune-mysteries](../quests/rune-mysteries.md)). After an Aubury teleport, the portal in the mine landed the bot beside Aubury, on (3252-3253, 3402-3403). [v 2026-10-16 conductor2w1 local]
- Four more wizards teleport to the mine on op3 (Teleport), also once Rune Mysteries is done: Sedridor (Wizards' Tower basement), Wizard Cromperty (East Ardougne), Wizard Distentor (inside the Magic Guild, so 66 Magic to reach him) and Brimstail (Gnome Stronghold cave). The landing is one of 22 coords of the `essence_mine_teleports` enum, then any open tile within 1 of it with a line of sight to it. A portal returns you to an open tile within 2 of the exit coord of the wizard you came by, with a line of walk to it (Aubury's is (3253, 3401), `^essence_mine_to_aubury` in `skill_runecraft/configs/runecraft.constant:15`), kept in the perm varp `%exit_essence_mine_coord`; it is null, and the portal sends you to Sedridor, only if you never came in by a wizard (`essence_mine.rs2:1-41`). A few landing tiles are nooks walled in by the cave walls and dead trees that no walk leaves ((2895, 4838), (2911, 4839) and (2920-2922, 4857)). [server data, unverified in game 2026-10-19]
- Essence rocks (loc 2491) stand in four clusters about 35 tiles apart ((2891, 4847), (2893, 4812), (2925, 4848), (2927, 4814); `ESSENCE_ROCK_SPOTS` in `conductor/lib/runecraft.ts`). The teleport lands on a random tile in the mine (seen (2935,4847) x2, (2924,4847), (2909,4836), (2898,4858), (2911,4823)), often out of view of every rock, so the task must walk to a cluster; the walk from the landing to the (2891, 4846) cluster took 10-39 ticks (mean ~25), so pinning one cluster costs ticks and a nearest-cluster choice is untested. The rock never depletes. Mining: [mining](mining.md); tasks `essence-mine` and `mining` with `rock: "essence"`. [v 2026-10-16 conductor2w1 local]
- Pickaxe swing ticks: bronze 7, iron 6, steel 5, mithril 4, adamant 3, rune 2. Essence swing period is the pickaxe value + 1 (bronze 7+1 = 8 ticks per essence, measured 8.00 with one Mine click and with a click per ore, 20 essence); a re-click right after an ore costs nothing (`mining.rs2` get_ore_essence re-queues the swing), so only a faster pickaxe speeds it up. With an adamant pickaxe and Mining 99 the first essence comes 5 ticks after reaching the rocks, then exactly 4 ticks per essence (3 + 1, the floor, every gap). [v 2026-10-16 conductor2 local]

## Talismans (drop sources, from drop tables, not run)

| Altar | Talisman source |
|---|---|
| Air | Duke Horacio after Rune Mysteries |
| Mind | imps 7/128 |
| Water | wizards 3/128 |
| Earth | men, women, farmers 2/128 |
| Fire | skeletons 2/128, dark wizards 2/128 |
| Body | guards 3/128, hill giants 2/128 |
| Cosmic | fishing casket 8/128 of caskets (caskets are very rare) |
| Chaos / Nature | the gem-table talisman roll (4/128 of a ~3/128 table hit): chaos underground only, nature on the surface only |
| Law | Troll Stronghold reward; Dunstan gives a spare |

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Air altar, Falador ruins | (2983, 3291) | 1 | Aubury teleport, mine 20 essence (bronze pickaxe), portal back, walk to ruins, enter, craft, exit, walk back. About 635 ticks per trip (teleport 6, mine 166, portal 9, Aubury to ruins + craft + exit ~240, walk back ~215); 27 essence ~44k XP/hr. Runecraft 17 -> 33 and Mining +4750 in a 10 min `air-runecraft` plan (3 crafts) | ~35k Runecraft (20 essence, computed from tick budget; one plan, not stats.ts) | 2026-10-16 conductor2w1 local |
| Earth altar, ruins (3305, 3470) | (3305, 3470) | 9 | Loop with a worn adamant pickaxe (wield Attack 31; it mines essence unchanged) and 26-27 essence. The talisman holds a slot (no tiaras), so 27 is the cap on the first trip; after the first craft the earth runes take a second slot, so later trips carry 26 (28 is impossible; banking the runes each trip costs ~20 ticks, not worth it). Phases, 0.4 s ticks: enter-mine (walk to Aubury + teleport) ~64 ticks, mine ~115-148 (measured: 4 ticks per essence at the floor, plus the landing walk 10-39 and 5 to the first essence), portal out ~6 (portal plus a dialog continue), craft-earth (Aubury to ruins, enter, craft, exit) ~69. enter-mine from the ruins is ~58 ticks walking to Aubury (a door at (3273, 3417) opens on the way) + ~6 teleport; from Varrock East bank ~34. About 270 ticks per trip for 26 essence, ~4,250 XP per trip. Needs an earth talisman. Plan `earth-runecraft-28`: Runecraft 34 -> 45 in 339 s (Mining +9,875); 45 -> 55 in 653 s (6 trips, Runecraft +25,512, Mining +19,625, ~140k/h). The 25-essence layout (pickaxe in inventory) was ~230 ticks, ~3,656 XP/trip, ~143k/h | ~140k Runecraft (653 s plan run, RC 45 -> 55; not stats.ts) | 2026-10-16 conductor2 local |

The air altar loop also fits a first trip: one 25-essence air trip took Runecraft 1 -> 9+ (+3,125 XP; craft phase ~87 s including the Falador walk). [v 2026-10-16 conductor2 local]

Earth talisman source: one 172 s combat hunt on "Man" in Varrock (area (3238, 3404) radius 14, near Aubury and the Varrock East bank) dropped one; a single sample consistent with the 2/128 table above. [v 2026-10-16 conductor2 local]
