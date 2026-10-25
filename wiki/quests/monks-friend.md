# Monk's Friend

| Detail | Info |
|--------|------|
| Difficulty | Novice |
| Length | Short |
| Quest Points | 1 |

## Requirements

- None

## Items Needed

- Jug (or obtain during quest)
- Logs (normal wood)

## Rewards

- 2,000 Woodcutting XP
- 8 Law runes

## Walkthrough

1. **Start the quest.** Speak to Brother Omad at the monastery south of the Ardougne Zoo. He tells you that thieves have stolen the monks' child blanket and he cannot sleep.

2. **Retrieve the blanket.** Go NW of the monastery to find a ring of stones. Descend into the thieves' den below and search for the blanket.

3. **Return to Brother Omad.** Bring the blanket back to Omad. He will then ask you to help find Brother Cedric, who was supposed to be organizing the wine for the party.

4. **Find Brother Cedric.** Head north into the forest to find Brother Cedric. He is drunk and needs water to sober up.

5. **Get water.** Fill your jug with water from the Khazard guardhouse nearby.

6. **Help Brother Cedric.** Give the water and logs to Cedric so he can prepare the cart for the party supplies.

7. **Complete the quest.** Return to Brother Omad at the monastery to finish the quest.

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Brother Omad | Monastery, south of Ardougne Zoo |
| Brother Cedric | Forest, north of the monastery |
| Ring of stones | NW of the monastery |
| Thieves' den | Below the ring of stones |
| Khazard guardhouse | Near the forest area |

## Verified route and plan

`conductor/plans/monks-friend.ts` (promoted) took a fresh load of `lib:monks-friend-start` (East Ardougne, Att 40 Str 54 Def 40 HP 47, 10 swordfish, bronze axe, 500 coins) to quest done in 319 s, 1 coin spent. It buys the jug, fills it, chops a log itself. Phase seconds: buy-jug 41, fill 42, start 42, den 17+10, blanket 11, den-out 6, room-settle 10, hand-blanket 36, omad-cedric 14, cedric-ask 18, chop 13, cedric-help 8, cedric-wood 6, party 30, omad-door 5. [v 2026-10-24 questw3 local]

- Varp 80 stages (`quest_drunkmonk` scripts): 10 told by Omad, 20 blanket handed in, 30 looking for Cedric, 40 wants water, 50 water given, 60 wants wood, 70 cart fixed. The plan takes the stage from the highest of 7 marker lines in the dialog history; with an empty history a "probe" talk to Omad puts a line back. [v 2026-10-24 questw3 local]
- Water: a jug is 1 gp at the Khazard general store (Shop keeper 2641,3171); the East Ardougne fountain (2629,3311) fills it. Log: normal trees by the zoo (2608,3261). [v 2026-10-24 questw3 local]
- Brother Omad spawns (2604,3209), wander 3, in the chapel and sometimes west of the Door (2602,3209). The door swings to (2601,3209) (option Close) and shuts again, so `talk` can fail "unreachable": `interact` Door Open from (2603,3209) and retry. [v 2026-10-24 questw3 local]
- Thieves' den ladder: Omad's help talk sets a timer that spawns a hidden Ladder (Climb-down) at (2561,3222) once the player is within 2 tiles (about 200 ticks, re-added); it leads to (2561,9621), the way up is the Ladder at (2561,9622). A different ordinary Ladder at about (2566,3227) is nearer and a tile-less `interact` picks it, but it leads to a sealed ladder room (2565,9627), not the den. Use `tile:{x:2561,z:3222}`. After the climb add a settle phase (see [walking](../../learnings/walking.md#stairs-and-ladders-walkto-between-levels)). [v 2026-10-24 questw3 local]
- The Child's blanket is a ground item at (2570,9604) on a blocked table tile ("destination tile is blocked"); a pickup area centred (2570,9606) radius 4 works. [v 2026-10-24 questw3 local]
- Brother Cedric stands at about (2614,3259). From stage 30 with water and a log held, "Yes, I'd be happy to!" takes the water, asks for help, takes the log and sets 70 in one talk. The first log gives a Woodcutting level-up page to dismiss first ([dialogs](../../learnings/dialogs.md)). [v 2026-10-24 questw3 local]
- Reward: 8 law runes and Woodcutting `stat_advance` 20000 in tenths (`quest_drunkmonk.rs2:89`): 2,000 XP, 50,000 at x25. The plan RESULT `xpGained` misses the final reward (a known plan.ts total bug). [v 2026-10-24 questw3 local]
