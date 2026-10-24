# Fight Arena

| Detail | Info |
|--------|------|
| Difficulty | Experienced |
| Length | Medium |
| Quest Points | 2 |

## Requirements

- Ability to defeat enemies of levels 44, 63 and 137 (all safespottable) [server data, unverified in game 2026-10-23] (`quest_arena.npc:488,518,463`)

## Items Needed

- None required (all items obtained during quest)

## Rewards

- 2,175 Thieving XP (`quest_arena.rs2:271`) [server data, unverified in game 2026-10-23]
- 12,175 Attack XP
- 1,000 gp

## Walkthrough

Proven by plan `conductor/plans/fight-arena.ts` (promoted): fresh load of `lib:fight-arena-start` (East Ardougne; Att 70 Str 70 Def 60 HP 70 Prayer 70, rune scimitar, 20 swordfish, 500 coins) to quest done in 544 s, HP ended 54/71, no swordfish eaten in the prayer-covered fights. [v 2026-10-24 questw3 local]

Minimum stats: a profile of Att 40 Str 54 Def 40 HP 47 Prayer 49 with a mithril scimitar died to Bouncer (after spending prayer on the ogre and scorpion and eating 13 swordfish). Bouncer has defence 120 and 116 HP (about 26% hit chance at Att 40). Lower than the Att 70 profile was not tried; Att 60+, Prayer 60+ and a rune scimitar is an untested estimate. [v 2026-10-24 questw3 local]

Phase seconds are in brackets.

1. **Start** (46). Lady Servil (2566,3199); start option "Can I help you?". [v 2026-10-24 questw3 local]
2. **Khazard armour** (chest-open 14, search 12, wear 2). Chest (2613,3189), stand at (2613,3190): Open ("You open the chest."), then Search; the Search option shows a few ticks after the open, so retry a failed Search. Gives Khazard armour and helmet; wear both. [v 2026-10-24 questw3 local]
3. **Drunk guard** (14). `arena_guard2` near (2615,3141): talking to him in armour sets stage 3 ("decent drink"). [v 2026-10-24 questw3 local]
4. **Khali brew** (25). Barman at the Khazard tavern (2566,3140): "I'd like a Khali brew", 5 gp. [v 2026-10-24 questw3 local]
5. **Block the cell-block door** (41, 4 runs). West door (2585,3141) (`fightarena_door1`): the walk cannot open it ("out of reach"); interact Open from (2584,3141) with the armour worn and guard 1 outside; the script opens it and the player walks in. [v 2026-10-24 questw3 local]
6. **Give the brew to the guard** (20) for the Khazard cell keys. [v 2026-10-24 questw3 local]
7. **Free Jeremy** (21). Use the keys on the Prison Door (2617,3167) from (2615,3167): the script teleports the player into the arena at (2607,3152) and the ogre cutscene starts. [v 2026-10-24 questw3 local]
8. **Ogre** (71 incl. dismissing dialogs and the cutscene). If the ogre does not come out (seen once), talk to the arena Jeremy near (2602,3154): `jeremy_servil_arena` re-runs the release cutscene. [v 2026-10-24 questw3 local]
9. **Hengrad** (16, then a 40 s settle). Justin/General dialogs send the player to the cells; talk to Hengrad (2598,3142) and the guard walks you to the arena (~10 ticks). The talk ends before the cutscene finishes, so wait with a settle phase. [v 2026-10-24 questw3 local]
10. **Scorpion** (25, about 22 s of fighting). [v 2026-10-24 questw3 local]
11. **Bouncer** (58 with Protect from Melee on, Att 70). Before a beast is released its cage NPC shows as unreachable, but the map-spawn "Bouncer" may show reachable early: gate on stage markers, not reachability. [v 2026-10-24 questw3 local]
12. **General Khazard** (dismiss 58 incl. the General attacking, fight 49). Killing him is optional: the quest varp `arenaquest` finishes at 14, the reward needs state 12 or 13, and state 12 is set when Bouncer dies (`quest_arena/scripts/*.rs2`). Leaving by the arena door (2606,3152), opened from (2604,3153), also works, only out of combat (arena-exit 2). [v 2026-10-24 questw3 local]
13. **Finish** (30). Walk to Lady Servil (2566,3199) and talk. [v 2026-10-24 questw3 local]

Dialog markers usable in plans (the quest varp is not visible to a plan): "decent drink", "saved my life", "liking to you", "tougher challenge", "only friend|Nooooo". [v 2026-10-24 questw3 local]

Protect from Melee drain: see [combat](../../learnings/combat.md) (70 Prayer points covered the ogre, scorpion and Bouncer here).

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Lady Servil | (2566,3199) |
| Khazard armour chest | (2613,3189), stand (2613,3190) |
| Drunk guard (`arena_guard2`) | near (2615,3141) |
| Barman, Khazard tavern | (2566,3140) |
| Cell block west door | (2585,3141), open from (2584,3141) |
| Prison Door (keys) | (2617,3167), use from (2615,3167); lands in the arena (2607,3152) |
| Hengrad | (2598,3142) |
| Arena door | (2606,3152), open from (2604,3153) |
| Khazard Ogre (level 63), Khazard Scorpion (level 44), Bouncer (level 137; defence 120, 116 HP) | Fight Arena |
