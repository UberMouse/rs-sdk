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

## Fishing Guild

- **Location:** North of Ardougne
- **Requirement:** 68 Fishing
- **Features:** Multiple fishing spots, nearby range, close bank

## Caskets

When using a big net, you occasionally catch a casket containing money, gems, talismans, or rare items like half keys.
