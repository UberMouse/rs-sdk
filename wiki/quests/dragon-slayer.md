# Dragon Slayer

| Detail     | Info          |
|------------|---------------|
| Difficulty | Experienced   |
| Length     | Long          |
| Quest Points | 2          |

## Requirements

- 32 Quest Points: the Champions' Guild door refuses under 32 (`champions_guild.rs2:2`) [server data, unverified in game 2026-10-23]
- Ability to defeat Elvarg (level 83 dragon)

## Items Needed

- Silk
- Wizard's Mind Bomb (the Oracle's door takes all four items, `magic_door.rs2:10`) [server data, unverified in game 2026-10-23]
- Unfired bowl
- Lobster pot
- 3 Planks
- 12 Nails (steel recommended)
- Hammer
- 2,000+ gp (for ship purchase and other costs)
- Anti-dragon shield (obtained during quest)
- Food and combat equipment for final fight

## Rewards

- 18,650 Strength XP
- 18,650 Defence XP
- Ability to equip Rune Platebody
- Ability to equip Green Dragonhide Body

## Walkthrough

### Starting the Quest

1. Speak to the **Guildmaster** at the **Champions' Guild** south of Varrock (requires 32 Quest Points to enter). He tells you to slay the dragon Elvarg on Crandor and directs you to find a map.

### Map Piece 1 - Oracle / Dwarven Mines

2. Speak to the **Oracle** on Ice Mountain. She gives a riddle whose answer requires an unfired bowl, a lobster pot, silk, and a wizard's mind bomb.
3. Enter the **Dwarven Mines** and use the four items on the sealed door in the northeastern section to obtain the first **map piece**.

### Map Piece 2 - Wormbrain

4. Go to **Port Sarim Jail**. Speak to **Wormbrain** the goblin in his cell. He has the second map piece. Kill him (the piece drops, `wormbrain.rs2:9-10`) or pay him 10,000 gp (`wormbrain.rs2:60-71`). No Magic level is needed. [server data, unverified in game 2026-10-23]

### Map Piece 3 - Melzar's Maze

5. Travel to **Melzar's Maze** south of the Crafting Guild. Use the **maze key** to enter; Oziach in Edgeville hands it over when asked about the first map piece (`oziach.rs2:122-125`). [server data, unverified in game 2026-10-23] Navigate the maze by killing the correct monsters on each floor to obtain keys that open the corresponding doors. Defeat **Melzar the Mad** and the **lesser demon** at the end to obtain the third **map piece**.

### Preparing the Ship

6. Buy the ship **Lady Lumbridge** from **Klarense** at Port Sarim docks for 2,000 gp.
7. Use **3 planks**, **12 nails**, and a **hammer** to repair the hull of the ship.
8. Recruit **Captain Ned** (from Draynor Village) to sail the ship by speaking to him with the complete map.

### Anti-Dragon Shield

9. Speak to the **Duke of Lumbridge** on the 2nd floor of Lumbridge Castle. He gives you the **anti-dragon shield** once Oziach has told you about it (`duke_horacio.rs2:4`) [server data, unverified in game 2026-10-23], and it is essential for surviving Elvarg's fire breath.

### Sailing to Crandor

10. Board the Lady Lumbridge at Port Sarim with Ned, the anti-dragon shield, the assembled map, and full combat gear. The ship sails to Crandor but crashes on arrival.

### Defeating Elvarg

11. Navigate through Crandor to the volcano entrance. Climb down and proceed to **Elvarg's lair**.
12. Fight **Elvarg** (level 83). Equip the anti-dragon shield at all times to reduce fire damage. Defeat her to complete the quest.

## Key NPCs & Locations

| NPC / Location         | Where                                       |
|------------------------|----------------------------------------------|
| Guildmaster            | Champions' Guild, south of Varrock            |
| Oracle                 | Ice Mountain                                  |
| Wormbrain              | Port Sarim Jail                               |
| Melzar's Maze          | South of Crafting Guild                       |
| Klarense               | Port Sarim docks                              |
| Captain Ned            | Draynor Village                               |
| Duke of Lumbridge      | Lumbridge Castle, 2nd floor                   |
| Elvarg (level 83)      | Crandor volcano, underground lair             |

## Verified route (bot, questw1 local)

Coordinates `(x, z)`, ` L<n>` above level 0. Everything here was run live unless marked. [v 2026-10-24 questw1 local]

- **Start save**: `dragon-slayer-start` needs real quest varps for 32 QP (see `learnings/local-server.md`, Accounts and saves). Later saves: `dragon-slayer-ship-repair` (deck, stage 3), `dragon-slayer-ned` (Draynor, stage 7), `dragon-slayer-ship-deck` (stage 8), `dragon-slayer-crandor` (stage 9 at the wreck).
- **Guildmaster**: the Champions' Guild door is on the north side (3191, 3363); walking in triggers an automatic "Greetings bold adventurer" Guild master dialog that can break the first talk. Guild master at (3191, 3362); choice "Rune Plate mail" starts the quest.
- **Oziach** (3069, 3517): from stage 1 the 10-choice chain "sell me some Rune plate / guildmaster of the Champions / how am I meant to prove / dragon, that sounds / antidragon shield / where can I find this dragon / first piece / second piece / third piece / get everything together" gives the Maze key and sets the shield, oracle and goblin flags. From stage 2 on the chain starts differently. Chain ~32 s.
- **Oracle** (3015, 3504): "piece of the map". Dwarven mine magic Door (3051, 9840) opens from (3050, 9840) with Silk, Unfired bowl, Lobster pot and Wizard's mind bomb (the bomb is consumed). Chest (3057, 9841): Open then Search from (3057, 9842) gives Map part id 1537. The room behind the door has no walk route out; open the Door again from (3052, 9840). Oracle step ~55 s.
- **Wormbrain** (3014, 3186) behind cell bars: `talk` finds him unreachable. `interact` npc `^Talk-to$` with `unreachable:true` at (3011, 3188) and choices ["piece of map", "could pay", "10,000 it is"] works: 10,000 coins gives Map part id 1536. ~12 s.
- **Melzar's Maze**: enter by the front Door (2941, 3248) with the Maze key from (2942, 3248) (not consumed). Funnel Ladder (2932, 3240), stand (2933, 3240). Giant rats (combat target is the plain name `Giant rat`) around (2930, 3252); killing them eventually drops the red Key. Red, orange and yellow keys are all needed (the item "Key" covers all six coloured keys). The dungeon strip is reached only from the SE room (x 2932-2940, z 3238-3242) via the L1 ladder (2937, 3240); the chest is approached from the south; Ladder (2939, 9657) climb-up lands (2938, 3257); leave by the front Door with the Maze key from (2940, 3248). Map part id 1535 (maze chest). Segment times: rat to red key 11-29 s, ghost 39 s, skeleton 52 s, zombie 24 s, Melzar 30 s, lesser demon 37 s; door 3-5 s; ladder ~3.2 s; whole maze ~4 min.
- **Duke** (3212, 3220) L1: choice "shield that will protect" gives the Dragonfire shield (id 1540). Walk 97 s.
- **Ned**: hire in Draynor (3100, 3258), choice "sailor", works at stage 3. ~52 s.
- **Klarense** (3047, 3204): choices ["could buy it", "sounds good"], 2,000 coins buys the ship. The ship's 'on' Gangplank (3047, 3205) is a level-1 bridge loc the client does not list, so `plan:dragon-slayer` failed at board-repair ("no reachable loc /^Gangplank$/ at (3047,3205) in sight"); a client fix is being authored. The 'off' gangplank (3047, 3206) and deck ladder (3049, 3208) are level 1; hold Hole (3047, 9639) L1, ladder up (3048, 9640); Ned on the ship (3046, 9640) L3 (not exercised).
- **Plan status**: `plan:dragon-probe-maze` (Map x3, Crandor map, Dragonfire shield worn, Ned hired) ran to done in 201 s. The full plan is proven in segments up to Crandor; the gangplank and Elvarg target-picking gaps are being fixed.
- **Crandor**: Rock opening Climb-down (2833, 3255) from the wreck (2851, 3235) lands (2833, 9658) (~39 s). Lair: Gate (2847, 9636/7), Elvarg (2851, 9639) past the Gate, rope (2833, 9657). Skeleton and demon placement and the death: `learnings/hazards.md`.
