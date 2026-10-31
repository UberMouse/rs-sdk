# Lost City

| Detail     | Info         |
|------------|--------------|
| Difficulty | Experienced  |
| Length     | Long         |
| Quest Points | 3 QP      |

## Requirements

- 31 Crafting
- 36 Woodcutting
- Ability to defeat the level 101 Tree Spirit

## Items Needed

- Food and combat equipment (cannot bring weapons or armour to Entrana)
- Knife (to carve the Dramen branch)

## Rewards

- 3 Quest Points
- Access to Zanaris
- Ability to wield Dragon Longsword
- Ability to wield Dragon Dagger

## Walkthrough

1. Speak to the group of **Adventurers** camped in **Lumbridge Swamp**. They are searching for a lost city.
2. Find the unusual tree to the west of the camp. Attempt to chop it and **Shamus** the leprechaun will appear.
3. Talk to Shamus. He tells you that you need a **Dramen staff** to enter Zanaris.
4. Travel to **Entrana** via the monks at Port Sarim (members world only). The monk refuses you if you carry or wear any item in a weapon or armour category, axes and pickaxes included; an item with no category (Ice gloves) passes. Source: `[proc,has_entrana_restricted_items]` in `server/content/scripts/areas/area_port_sarim/scripts/monk_of_entrana.rs2`. Phase recipe: [ships](../../learnings/ships.md).
5. On Entrana, find the ladder to the northeast and descend into the dungeon.
6. Kill **zombies** in the dungeon to obtain a **bronze axe**.
7. Navigate past the **Greater Demons** deeper in the dungeon. Do not engage them unless necessary.
8. Chop the **Dramen tree**. The **Tree Spirit** (level 101) will spawn and attack you. It can be safespotted behind surrounding mushrooms.
9. Defeat the Tree Spirit and chop the Dramen tree to obtain a **Dramen branch**.
10. Use a knife on the Dramen branch to carve it into a **Dramen staff**.
11. Equip the Dramen staff and enter the small shed in Lumbridge Swamp to access **Zanaris**. The shed door checks only a worn Dramen staff on a members world; the first entry completes the quest (`[oploc1,zanarisdoor]` in `server/content/scripts/quests/quest_zanaris/scripts/quest_zanaris.rs2`).

## Key NPCs & Locations

| NPC / Location      | Where to Find                                  |
|----------------------|------------------------------------------------|
| Adventurers          | Camp in Lumbridge Swamp                        |
| Shamus               | Unusual tree, west of adventurer camp          |
| Entrana              | Sail from Port Sarim (no weapons/armour)       |
| Dramen tree          | Entrana dungeon, past the Greater Demons       |
| Tree Spirit          | Spawns when chopping the Dramen tree (level 101) |
| Zanaris entrance     | Shed in Lumbridge Swamp (requires Dramen staff)  |

## Verified route (plan `conductor/plans/lost-city.ts`)

Proven on questw5 from a fresh load (Att/Str/Def 70, HP 80, Woodcutting 36, Crafting 31, Magic 31, 16 swordfish, bronze axe, knife, runes for Lumbridge Teleport): quest done in 332 s. [v 2026-10-31 questw5 local]

- The swamp camp NPC "Warrior" starts the quest; choices "What are you camped here for", "Who's Zanaris", "If it's hidden...", "Looks like you don't know...". [v 2026-10-31 questw5 local]
- The leprechaun tree is the loc "Tree" with option "Chop" (normal trees show "Chop down") at (3138,3212). Shamus spawns at (3139,3211); the single choice "How does it fit" is enough. The chop reports `no-effect` because Shamus appearing is not a chop effect; treat it as non-fatal or `expect` Shamus. [v 2026-10-31 questw5 local]
- Drop the axe at the swamp after Shamus: the Entrana boat refuses axes. A knife passes the check. [v 2026-10-31 questw5 local]
- Port Sarim boat lands at (2834,3331). The cave monk at (2822,3374) with the choice "risk" sends you down a one-way ladder to about (2822,9774); it drains Prayer by 95%. [v 2026-10-31 questw5 local; the Prayer drain from `cave_monk.rs2:14`]
- Entrana zombies (level 25) roam around (2845,9761); a bronze axe dropped after about 40-120 s of fighting. The greater demons at (2862,9749) did not interfere. [v 2026-10-31 questw5 local]
- Dramen tree at (2860,9737): the first chop spawns the Tree Spirit, killed unarmed at Att/Str/Def 70 with food in about 50 s (11-13 swordfish eaten, ending about 50/80 HP; a 12-fish pack ended 44/80, so 12 is marginal). The second chop gives the branch. [v 2026-10-31 questw5 local]
- Knife on the branch carves the staff. Lumbridge Teleport cast in the dungeon lands near (3222,3218) and costs 3 air, 1 earth, 1 law; a cast sent right after the carve was dropped once with nothing spent, so retry it. [v 2026-10-31 questw5 local]
- With the staff worn, opening the shed door at (3202,3169) from (3202,3171) teleports to Zanaris (3220,9592) and completes the quest. [v 2026-10-31 questw5 local]
