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
