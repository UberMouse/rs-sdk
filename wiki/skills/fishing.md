# Fishing

Fishing catches raw fish that can be cooked for food. Different fishing methods require different equipment and fishing spot types.

## Equipment

| Equipment | Used At | Bait Required |
|-----------|---------|--------------|
| Small fishing net | Net/Bait spots (sea) | None |
| Fishing rod | Net/Bait spots (sea/river) | Fishing bait |
| Fly fishing rod | Lure/Bait spots (river) | Feathers |
| Harpoon | Cage/Harpoon spots | None |
| Lobster pot | Cage/Harpoon spots | None |
| Big fishing net | Net/Harpoon spots (members) | None |

## Fish Table

| Level | Fish | XP | Equipment | Spot Type |
|-------|------|----|-----------|-----------|
| 1 | Shrimp | 10 | Small net | Net/Bait |
| 5 | Sardine | 20 | Bait | Net/Bait |
| 10 | Herring | 30 | Bait | Net/Bait |
| 15 | Anchovies | 40 | Small net | Net/Bait |
| 16 | Mackerel | 20 | Big net | Net/Harpoon |
| 20 | Trout | 50 | Fly rod | Lure/Bait |
| 23 | Cod | 45 | Big net | Net/Harpoon |
| 25 | Pike | 60 | Bait | Lure/Bait |
| 30 | Salmon | 70 | Fly rod | Lure/Bait |
| 35 | Tuna | 80 | Harpoon | Cage/Harpoon |
| 40 | Lobster | 90 | Lobster pot | Cage/Harpoon |
| 46 | Bass | 100 | Big net | Net/Harpoon |
| 50 | Swordfish | 100 | Harpoon | Cage/Harpoon |
| 76 | Shark | 110 | Harpoon | Net/Harpoon |
| 79 | Sea turtle | 57 | Trawler | Mini-game |
| 81 | Manta ray | 69 | Trawler | Mini-game |

Levels and XP checked against `server/content/scripts/skill_fishing/scripts/fishing_spots/*.rs2` (level gates, mackerel 16 / cod 23 / bass 46 and their XP inline in `memberfish.rs2`) and `configs/fishing.struct` (`productexp`, tenths); the Fishing Guild's 68 against `fishing_guild.rs2`. All rows match; equipment/spot-type columns and locations unchecked. [v 2026-10-09 conductor1 local]

## Fishing Locations

| Location | Spot Types | Members |
|----------|-----------|---------|
| Lumbridge (river) | Lure/Bait | No |
| Draynor Village | Net/Bait | No |
| Karamja (Musa Point) | Cage/Harpoon | No |
| Barbarian Village (river) | Lure/Bait | No |
| Catherby | All types | Yes |
| Fishing Guild | All types | Yes |

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Draynor south | (3086, 3227) r2 | 1 | Net/Bait, small net; dark wizards hit the northern tiles. More spots/map data: `learnings/fishing.md` | Fishing 1->13 in 1 min; 1->34 in ~4 min, 34->40 in 1 min (`fish-cook` plan trips, not stats.ts) | 2026-10-11 conductor2 local |
| Lumbridge river (lure) | (3239, 3248) r10 | 20 | Lure/Bait spots hop over z 3241..3255 at x 3238/3239; a small area (r6 at (3238,3252)) missed hopped spots and idled the task for its 700-tick no-spot wait. Mixed salmon + trout, ~13 fish/min (25 fish in 122 s), uses 1 feather per fish (inventoryDelta Feather -25 for 25 fish). Fishing 48->79 in the 3 plan runs (+147,000 xp in 18 min with cooking) | ~70k xp/hr observed in an 18-min plan (Fishing 147k) | 2026-10-11 conductor2 local |
| Catherby cage fishing (Lobster) | (2841, 3430) | 40 | Lobster pot (Harry's fishing shop sells it for 20 gp), bank (2809, 3443), range (2817, 3444). 19 lobsters in ~2 min; 0 burnt at Cooking 83. Walks: Lumbridge -> Catherby 143 s, Catherby -> Ardougne 53 s (no wolf attacks at combat 49) | not measured (one 2 min run) | 2026-10-16 conductor2w3 local |
| Catherby swordfish (Harpoon) | area radius 15 at (2848, 3427) | 50 | plan `conductor/plans/catherby-swordfish.ts` (fish, cook at the range, bank). Harpoon spots hop: a radius-5 area at (2841, 3430) failed (`area depleted`) after the spot moved to (2855, 3423); radius 15 at (2848, 3427) covers every Catherby spot tile and gave no failed or idle phases over 8 fishing loops (only 2 "waiting for a fish" and 1-2 "moved away" spot hops per phase). First loop ~4.4 min per 26 fish. With `method: harpoon, fallback: shark` the shark fallback never triggered: a Cage/Harpoon spot was always in view at r15. Once Cooking is 99 drop the range leg and bank the raw fish. Harry's Fishing Shop (2834, 3445) sells a harpoon for 5 gp. Spot tiles: [fishing-spot resource pages](../resources/fishing-spot/). Fishing 68->84 and Cooking 71->87 in 1872 s (one failed run); Fishing 84->91 and Cooking 87->93 in 1020 s; Fishing 91->99 (+413,500 XP) and Cooking 95->99 (+262,500) in 28.2 min (plan `catherby-shark-fallback`, 24 loops). Travel Ardougne sheep field -> Catherby via (2650,3295), (2725,3485), (2800,3440): 104 s | Fishing ~1.12M/h in fishing-phase time at 91-99 (413,500 XP in 1,327 s); earlier 1020 s run ~790k/h plan total | 2026-10-23 conductor3 local |

## Fishing Guild

- **Location:** North of Ardougne
- **Requirement:** 68 Fishing
- **Features:** Multiple fishing spots, nearby range, close bank

## Caskets

When using a big net, you occasionally catch a casket containing money, gems, talismans, or rare items like half keys.
