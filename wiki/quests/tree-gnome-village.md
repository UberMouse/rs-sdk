# Tree Gnome Village

| Detail | Info |
|--------|------|
| Difficulty | Intermediate |
| Length | Long |
| Quest Points | 2 |

## Requirements

- Ability to defeat the Khazard Warlord (level 112)

## Items Needed

- 6 logs (normal logs)

## Rewards

- 11,450 Attack XP (`quest_tree.rs2:98`) [server data, unverified in game 2026-10-23]
- Gnome amulet of protection
- Access to spirit trees for teleportation

## Walkthrough

1. **Start the quest.** Speak to Elkoy at the NW corner of the Tree Gnome Maze. He will lead you through the maze to the gnome village.

2. **Meet King Bolren.** He is located in the center of the village. He will explain that the gnomes are at war with General Khazard and need your help defending the village.

3. **Deliver logs to Commander Montai.** Bring 6 logs to Commander Montai at the gnome battlefield to the north. He needs them to repair the ballista.

4. **Find the coordinates.** Locate the 3 gnome trackers scattered across the battlefield to obtain the ballista firing coordinates:
   - Tracker 1: Y coordinate = **5**
   - Tracker 2: Height coordinate = **4**
   - Tracker 3: X coordinate = **3**

5. **Fire the ballista.** Return to Commander Montai and use the coordinates to fire the ballista at the Khazard stronghold.

6. **Retrieve the first orb.** Enter the NW building of the Khazard stronghold and search the chest to obtain the Orb of Protection. You will need to defeat 2 Khazard Commanders (level 48) guarding the area.

7. **Return to King Bolren.** Bring the orb back to the village and speak with King Bolren. He will tell you the Khazard Warlord has stolen the other orbs.

8. **Defeat the Khazard Warlord.** Travel north from the village to find the Khazard Warlord (level 112). Defeat him to recover the remaining orbs.

9. **Complete the quest.** Return both orbs to King Bolren in the village.

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Elkoy | NW corner of Tree Gnome Maze |
| King Bolren | Center of Tree Gnome Village |
| Commander Montai | Gnome battlefield, north of village |
| Gnome Trackers (3) | Scattered across the battlefield |
| Khazard Commanders (level 48) | NW building, Khazard stronghold |
| Khazard Warlord (level 112) | North of Tree Gnome Village |

## After the quest

- The village's spirit tree (`stronghold_ent`) and the young trees (north of Varrock, Battlefield of Khazard) talk only
  to a player who finished the quest (areas/area_gnome/scripts/spirit_tree.rs2:26, :50), on a members world (:65).
  The village tree's menu, after "Where can I go?": "Battlefield of Khazard.", "Forest north of Varrock.", "Gnome
  stronghold." (:42); a young tree's "Yes please." goes to the village only (:56).
- The village tree's "Forest north of Varrock." takes the player to the young tree north of Varrock.
  [v 2026-10-19 itest-fixture local]
