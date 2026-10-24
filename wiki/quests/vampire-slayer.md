# Vampire Slayer

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Medium     |
| Quest Points | 3       |

## Requirements

Ability to defeat a level 34 Vampire (Count Draynor).

## Items Needed

- Beer (purchased or found)
- Garlic (from Morgan's cupboard in Draynor Village)
- Stake (from Dr. Harlow)
- Hammer (bring one; Harlow only tells you a general store hammer will do, `harlow.rs2:50-53`; 1 gp at the Lumbridge General Store) [v 2026-10-24 questw1 local]

## Rewards

- 4,825 Attack XP base, 120,625 at the local 25x rate (`quest_vampire.rs2:42`) [v 2026-10-24 questw1 local]

## Walkthrough

1. Speak to **Morgan** in his house in **Draynor Village**. He tells you about the vampire terrorising the village.
2. Search the **cupboard** upstairs in Morgan's house to obtain **garlic**.
3. Travel to the **Jolly Boar Inn** northeast of Varrock. Buy or bring a **beer** and speak to **Dr. Harlow**. Give him the beer. He provides a **stake** only; buy the **hammer** at a general store.
4. With garlic, stake, and hammer in your inventory, enter **Draynor Manor** and go down to the basement.
5. Open the coffin to fight **Count Draynor** (level 34). Having garlic in your inventory weakens him.
6. When the Count's health is low enough, your character automatically uses the stake and hammer to finish him off. Silverlight or other weapons can be used for the fight itself.

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Morgan                 | House in Draynor Village                     |
| Dr. Harlow             | Jolly Boar Inn, northeast of Varrock         |
| Count Draynor          | Draynor Manor basement coffin                |
| Garlic                 | Cupboard, upstairs in Morgan's house         |

## Verified route and plan

`conductor/plans/vampire-slayer.ts` (promoted) took a fresh load of `lib:vampire-slayer-start` (Draynor square (3105,3250), Att 40 Str 54 Def 40 HP 47 Prayer 49, mithril scimitar worn, 10 swordfish, 200 coins) to quest done in 312 s, one run; restart-safe. Phase seconds: Morgan 16, garlic cupboard open + search ~28, house down ~4, hammer 37, Jolly Boar beer 83 (mostly the Lumbridge-Varrock walk), Harlow 10+22, travel to the manor 89, stairs down 22, coffin 2, Count fight 13. [v 2026-10-24 questw1 local]

- Morgan stands in his Draynor house at (3098,3268); the choice "up for an adventure" starts the quest. [v 2026-10-24 questw1 local]
- Garlic: the "Cupboard" is upstairs (level 1) at (3096,3268). Open first, then Search ("You find a clove of garlic that you take"); it re-shuts after ~300 ticks. The client's loc list shows the opened cupboard ~10 s late (see [walking](../../learnings/walking.md#a-loc-opened-by-an-interact-shows-its-new-options-late)): the first Search fails "offers: Open" and a second 10 s later succeeds. The plan carries a second search phase and gates on the "You open the cupboard." message. [v 2026-10-24 questw1 local]
- House stairs: `interact` Staircase "Climb-down" at (3100,3266) from (3099,3267), tolerance 2. A `shop` walk from level 1 fails "unreachable" until the bot is downstairs. [v 2026-10-24 questw1 local]
- Hammer: 1 gp, Lumbridge General Store Shop keeper (3212,3247). [v 2026-10-24 questw1 local]
- Beer: Jolly Boar Inn Bartender (3279,3490), choice "beer please", 2 coins. Dr Harlow is in the same inn at (3277,3492). [v 2026-10-24 questw1 local]
- Dr Harlow: the first talk ("Morgan needs your help") only sets the stage. The second, with a beer held and no choice page, takes the beer and gives the Stake. A `talk` expecting one choice "fails" harmlessly on that second talk (`onFail: 'continue'`). Keep the Stake, Hammer and Garlic for the finish. [v 2026-10-24 questw1 local]
- Draynor Manor stairs: the loc is "Stairs" (not "Staircase"), option "Walk-down", at (3115,3357), leading to the crypt (3077,9771). `interact` with `at` (3115,3359) walks in through the front door and down. [v 2026-10-24 questw1 local]
- Coffin (~3078,9774), option Open: spawns Count Draynor (level 34), who attacks at once. `combat` (target 'Count Draynor', food Swordfish, `stopOnDialog`, `respawnWaitTicks` 30) finished him with the stake and completed the quest in 13 s; HP 46/47 after. [v 2026-10-24 questw1 local]
