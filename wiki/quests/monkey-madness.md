# Monkey Madness

Travel to Ape Atoll after the quest (the world index's rows: `CURATED_CROSSINGS` in `wiki/world/gates.ts`).

## After the quest

- Daero (Grand Tree bar) takes a player to the glider hangar only once the post-quest training is done (`%mm_main =
  ^mm_complete_training`, quests/quest_mm/scripts/mm_daero.rs2:8); before it he offers the training instead (:15).
- In the hangar, Waydar: "Yes" to fly to Crash Island (mm_waydar.rs2:13, :116); the hangar's teleporter goes back to
  the Gnomeball pitch (quest_mm.rs2:656).
- On Crash Island, Lumdo rows to Ape Atoll with no choice (mm_lumdo.rs2:24), and on the atoll's beach back (:11);
  Waydar on Crash Island flies back to the Gnomeball pitch after "I need to return to your kingdom." (mm_waydar.rs2:47).
  [v 2026-10-19 itest-fixture local]
- Ape Atoll's town is behind gates that ask a monkey greegree worn (quest_mm.rs2:1114).
