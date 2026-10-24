# Waterfall Quest

| Detail | Info |
|---|---|
| Quest id (`conductor/lib/quests.ts`, plan `v.quest`) | `waterfall` |
| Varps | 65 `%waterfall_quest` (stage), 66 `%pillar_waterfall_quest` (runes placed); both `scope=perm` (`_unpack/225/all.varp:88`, `:91`; ids `pack/varp.pack:66-67`) |
| Complete at | stage 10 (`general/configs/quest.constant:60`) |
| Quest points | 1 (`general/configs/quest.constant:127`) |
| Members | yes (all quest objs `members=yes`, `configs/waterfall.obj`) |
| Skill or quest requirements | none |

Most of this page is from the server scripts, map files and the world index [server data]; the promoted plan
`conductor/plans/waterfall-quest.ts` finishes the quest from `lib:waterfall-start` in one run (Plan status below). Script paths are under `server/content/scripts/`; a bare
`quest_waterfall.rs2:N` (and `almera.rs2`, `hudon.rs2`, `golrie.rs2`, `baxtorian_book.rs2`, `waterfall_pillars.rs2`,
`waterfall_journal.rs2`) is in `quests/quest_waterfall/scripts/`. Tiles are (x, z, level) from the map files
(`server/content/maps/m39_53`, `m39_54`, `m39_149`, `m39_153`, `m40_154`).

## Rewards

Granted by `[queue,waterfall_quest_complete]` (`quest_waterfall.rs2:486-494`) once the urn is used on the chalice:

- 1 Quest Point.
- `stat_advance(attack, 137500)` and `stat_advance(strength, 137500)`: 13,750 XP each, x25 on this server = 343,750
  Attack and 343,750 Strength XP (level 83 from level 1 on this server's table, `conductor/lib/xp.ts levelForXp`).
- 2 Diamond, 2 Gold bar, 40 Mithril seeds; the urn becomes an empty Glarial's urn (`:475-476`, `:488-490`).
- Needs 5 free inventory slots at the chalice, else "You do not have enough free space for the reward" and nothing
  happens (`:466-470`).

## Quest stages (varp 65)

| Stage | Name (`configs/quest_waterfall.constant`) | Set by | Source |
|---|---|---|---|
| 0 | not started | - | |
| 1 | started | Almera: choose "How can I help?" | `almera.rs2:6`, `:14` |
| 2 | spoken to Hudon | boarding the Log raft at stage 1 (forced Hudon dialog on landing), or Talk-to Hudon from the island | `quest_waterfall.rs2:168-178`, `hudon.rs2:5`, `:22` |
| 3 | opened book | Read the Book on baxtorian (any stage < 3) | `baxtorian_book.rs2:6-7` |
| 4 | entered Glarial's tomb | Glarial's pebble used on the Tombstone of glarial, only from stage 3 | `quest_waterfall.rs2:120` |
| 5 | entered waterfall | Open the Ledge door holding or wearing Glarial's amulet, only from stage 4 | `:269-270` |
| 6 | entered puzzle room | the key used on the puzzle-room Door (2566, 9901), only from stage 5 | `:396-398` |
| 8 | placed amulet | Glarial's amulet used on the Statue of Glarial at stage 6 with all 18 runes placed | `:414-425` |
| 10 | complete | Glarial's urn used on the Chalice of eternity | `:460-477`, `:487` |

Each step after 1 checks the exact previous stage, so the order is fixed. Plans see only none / started / done
(the quest tab, `conductor/docs/plans.md` "The view"); the stage in between is read from the inventory (book,
pebble, amulet, urn, key held) and the bot's position.

Varp 66 holds one bit per (pillar, rune): bit `(pillar - 1) * 3 + rune`, pillars 1-6 = SW, W, NW, SE, E, NE, runes
1 Air, 2 Earth, 3 Water (`waterfall_pillars.rs2:6`, `:22-39`). Placed bits persist across trips and deaths.

## Requirements and hazards

The quest journal at stage 0 says "I need to be able to fight Level 84 Giants" (`waterfall_journal.rs2:9`).

Every monster below is `huntmode=cowardly` unless marked: outside the Wilderness it attacks any player whose combat
level is at most twice its own (`server/engine/src/engine/entity/Npc.ts:1011`). Max hit is from
`skill_combat/scripts/npc/npc_combat_melee.rs2:2-8` (floor(((str + 9) * (strbonus + 64) + 320) / 640)) and the
`_unpack/225/all.npc` stats.

| Where | Monster (level, HP, max hit) | Hunts players up to combat | Spawns |
|---|---|---|---|
| Golrie's cellar | Hobgoblin (28, 29, 3) x9 | 56 | (2513-2533, 9555-9573); one on the ladder landing (2533, 9556), four at (2513-2515, 9568-9573) just south of Golrie's gate |
| Golrie's cellar | Zombie (24, 30, 3) x1, Zombie (13, 22, 2) x2 | 48 / 26 | (2539-2548, 9566-9569), beside Golrie's crate |
| Golrie's cellar | Giant bat (27, 32, 3) x3 | 54 | (2540-2543, 9557-9566) |
| Glarial's tomb | Moss giant (42, 60, 6) x3 | 84 | (2528, 9843) beside the chest, (2541, 9845), (2542, 9819) beside the tomb |
| Glarial's tomb | Skeleton (22 x5 / 25 x1, max 3), Zombie (24 x3 / 13 x3) | 44-50 / 26-48 | spread over (2529-2546, 9813-9847) |
| Waterfall dungeon | Shadow spider (52, 55, 5) x5; each attack drains half the current Prayer (`npc/scripts/shadow_spider.rs2:22-25`) | 104 | (2572-2580, 9875-9877), across the corridor north of the entry |
| Waterfall dungeon | Skeleton (`giantskeleton`, 45, 59, 5) x3 | 90 | (2586-2589, 9883-9886), beside the key crate |
| Waterfall dungeon | Fire giant (86, 111, 11) x10, huntrange 2 | every player (172) | (2562-2581, 9886-9897): the rooms between the key crate and Door (2568, 9893), three at (2562-2568, 9886-9889) by that door |
| Waterfall dungeon | Skeleton Mage (16), rats, a giant bat | Skeleton Mage and rats do not hunt | (2585-2592, 9878-9884) |

Glarial's tomb is entered with no weapon and no armour (the tomb rule below), so the bot cannot fight back there.

Traps (each lands the player at (2527, 3413), the river bank south of the falls, `^waterfall_fail_coord`):

| Action | Effect | Source |
|---|---|---|
| Swim to on the Rock from the island | washed downstream, no damage | `quest_waterfall.rs2:187-210` |
| Climb on the Dead tree (2512, 3465) | 8 damage | `:244-252` |
| Open the Ledge door without Glarial's amulet | 8 damage | `:275-285` |
| Get in the Barrel on the ledge | washed down, no damage (also the way off the ledge) | `:291-297` |
| Glarial's amulet on the Statue of Glarial with any of the 18 runes missing | 20 damage, amulet kept, stage unchanged | `:428-435` |
| Take treasure on the Chalice of eternity before stage 10 | flooded and washed down, no damage, no reward | `:441-458` |

Suggested minimum, from the max hits above (unverified): for the waterfall dungeon full melee armour, HP 60+ and
15+ food (lobster or better), since fire giants hunt every player and hit up to 11; for the tomb, 8+ food and HP 40+,
walked unarmoured past moss giants (combat 85+ is the level at which they stop hunting); for Golrie's cellar, a
weapon and a few food below combat 57.

### Glarial's tomb rule

The pebble opens the tomb only if `~waterfall_can_enter_glarials_tomb` passes (`quest_waterfall.rs2:44-100`); else
"But nothing happens." (`:113`). Refused, worn or carried: any armour (hands, helmet, body, legs, shield, cape, god
cape), any weapon (staff, slash, blunt, stab, crossbow, axe, pickaxe, javelin, 2h, spear, spiked, thrown, scythe,
bow, claws, polearm), arrows. Refused carried: runes (category 149), headless arrows, arrow shafts, bow string,
knife, ball of wool, needle, thread, all leathers, all logs, unstrung bows, clue scrolls and caskets, cannon parts.
Refused worn: flowers. Allowed: food, the rope, coins, boots, amulets, rings. The world index has the same list as
`loadoutRules.glarials_tomb` in `wiki/world.json`.

## Items

| Item | Qty | Use | Consumed | Get it |
|---|---|---|---|---|
| Rope | 1 | thrown on the Rock, tied to the Dead tree (each trip into the falls) | no (`:213-241`, `:254-262` delete nothing) | [Aemad's Adventuring Supplies](../shops/aemads-adventuring-supplies.md), East Ardougne (2614, 3293), 23 gp, stock 20; also [Khazard General Store](../shops/khazard-general-store.md), [Arhein Store](../shops/arhein-store.md) (Catherby, stock 2), [West Ardougne General Store](../shops/west-ardougne-general-store.md) (stock 3) |
| Air rune, Earth rune, Water rune | 6 each | one of each on each of the 6 pillars | yes, one per placement (`waterfall_pillars.rs2:15`) | 4 gp each at [Aubury's Rune Shop](../shops/auburys-rune-shop.md) (Varrock) or [Betty's Magic Emporium](../shops/bettys-magic-emporium.md) (Port Sarim); [Magic Guild Store](../shops/magic-guild-store.md) in Yanille needs Magic 66 |
| Food | 15+ dungeon, 8+ tomb | | | |
| Melee weapon and armour | | dungeon and cellar only; never into the tomb | | |
| Coins | ~100 | rope and runes | | |
| 5 free slots | | the reward | | |

Quest items (all `tradeable=no`, `configs/waterfall.obj`): Book on baxtorian, A key (Golrie's; same display name as
the dungeon key), Glarial's pebble, Glarial's amulet (wearable, neck), Glarial's urn (full), A key (the dungeon's).

Banks, in run ticks as the walker plans them (`conductor/lib/walk-graph.ts nearestWay`, quest started):
[Ardougne North](../places/ardougne-north-bank.md) (2617, 3331) is nearest to Almera's house (92), Hadley's house (71), the
tombstone (57), the wash-up point (2527, 3413) (58) and the ledge (60). The Fishing Guild bank (2585, 3420) is closer
but needs Fishing 68. From the Tree Gnome Village cellar ladder the nearest is Ardougne South (168).

## Walkthrough

Coordinates are where the loc or NPC is; "stand" is a walkable tile to act from (checked on the world index's
collision). Display names are the config `name=`.

1. **Start.** Talk-to **Almera** (`almera_waterfall_quest`) in her house (2522, 3498); stand (2522, 3496). Choose
   "How can I help?" (`almera.rs2:6`); stage 1. The other pages are continue only.
2. **Hudon.** Board the **Log raft** (`lograft_waterfall_quest`, 1x2 at (2509, 3493)) from the bank west of
   Almera's house; it refuses at stage 0 (`quest_waterfall.rs2:156`). It drops the player on the island at
   (2512, 3481) (`:163`). At stage 1 a forced dialog with **Hudon** (spawn (2511, 3484), wanders 1) opens on landing,
   continue pages only, and sets stage 2 (`:168-181`). The island is 8 tiles, x 2511-2512, z 3476-3481. Talking to
   Hudon also sets stage 2, but only from inside (2510-2514, 3476-3481) (`hudon.rs2:5`), and his tile is off the
   island's walkable tiles.
3. **Off the island.** Either swim: Swim to on the **Rock** (`crossing_rock_waterfall_quest`, (2512, 3468)) from the
   island, landing at (2527, 3413) unhurt (`quest_waterfall.rs2:187-210`); or rope: see step 9. Both are approach
   ops on a loc no route reaches: the script needs the player inside (2510-2514, 3476-3481) and north of the rock
   (`:189`, `:193`), and the engine fires an approach op within 10 tiles with line of sight
   (`server/engine/src/engine/entity/PathingEntity.ts:422-436`, `apRange` 10), so stand at (2512, 3476)-(2512, 3478).
4. **The book.** Hadley's house: **Hadley** (2516, 3428) is optional. Up the staircase (2517, 3429) to level 1;
   Search the **Bookcase** `bookcase_waterfall_quest` at (2520, 3426, 1) (1x2, approached from its west side; stand
   (2519, 3427, 1)). At stage 2+ it gives the **Book on baxtorian** ("You find a book named 'Book on Baxtorian'")
   (`quest_waterfall.rs2:300-312`); before stage 2 "You find nothing of interest." Three other Bookcases on that
   floor, (2517, 3424), (2519, 3424), (2520, 3430), give nothing.
5. **Read** the Book on baxtorian (inventory op): stage 3 (`baxtorian_book.rs2:1-8`). It opens a 5-page book
   interface; close it.
6. **Golrie's key.** Tree Gnome Village: the **Ladder** `ladder_cellar` (2533, 3155) Climb-down lands at
   (2533, 9556) (`ladders+stairs/scripts/ladders.rs2:83-85`). Search the **Crate** `golrie_crate_waterfall_quest`
   at (2548, 9565), reachable only from (2548, 9566): at stage 3+ it gives **A key** ("and find a large key")
   (`quest_waterfall.rs2:315-328`); before stage 3 nothing. The Crate `crate3_old` at (2549, 9566) is beside that
   stand tile and gives nothing.
7. **Golrie.** Use A key on the **Door** `golrie_gate_waterfall_quest` (2515, 9575) from its south side, standing on
   (2515, 9575): "The key fits the gate", and the player is walked through to (2515, 9576) (`:351-367`). The key is not
   used up here. Open on the gate from outside only says "The gate is locked." (`:344`). Talk-to **Golrie**
   (`golrie_waterfall_quest`, spawn (2515, 9581), wanders 3): no choices; he gives **Glarial's pebble** if none is
   held and takes A key (`golrie.rs2:10-27`). Leave with Open on the Door from inside (2515, 9576), which works without
   the key (`quest_waterfall.rs2:333-334`), and Climb-up the **Ladder** (2533, 9555) to (2533, 3156).
8. **Glarial's tomb.** Bank everything the tomb rule refuses (runes, weapons, armour). Use Glarial's pebble on the
   **Tombstone of glarial** (2x2 at (2558, 3444); stand (2560, 3444)): the player is moved to (2554, 9844), stage 4
   (`:102-122`). The pebble is kept. In the tomb:
   - Open the **Closed chest** (2530, 9844), approached from the north (stand (2530, 9845)), then Search the
     **Open chest**: **Glarial's amulet** if none held (`:140-151`).
   - Search the **Tomb of glarial** (2542, 9811; stand (2541, 9811), (2543, 9811) or (2542, 9810)): **Glarial's urn**
     if no full urn held (`:125-137`).
   - Climb-up the **Ladder** (2556, 9844) to (2557, 3444) (`ladders+stairs/scripts/ladders.rs2:98`).
9. **Into the falls.** Bank: take the rope, the 18 runes, food and gear; the amulet and urn stay in the inventory
   (the amulet may be worn for the door, but it must be in the inventory at the statue). Board the Log raft (stage 2+:
   no dialog) to (2512, 3481); walk to (2512, 3476). Use the **Rope** on the **Rock** (2512, 3468): the player is
   walked to (2512, 3476), throws, and is pulled across to (2513, 3468) on the islet (`quest_waterfall.rs2:213-241`;
   the islet is (2512-2513, 3466-3467) and (2513, 3468)). From (2512, 3466) use the Rope on the **Dead tree**
   `overhanging_tree1_waterfall_quest` (2512, 3465): the player lands on the one-tile ledge (2511, 3463) (`:254-262`).
   Open the **Ledge** `waterfall_ledge_door` (2511, 3464) with the amulet held or worn: the player is moved to
   (2575, 9861), stage 5 (`:264-273`). Its neighbours "Ledge" (2510, 3464) and (2512, 3464) have no script.
10. **The dungeon key.** Walk north past the shadow spiders to the **Crate** `baxtorian_crate_waterfall_quest`
    (2589, 9888; stand (2588, 9888)). Search: **A key** if none held, at any stage (`:369-378`). Plain Crates stand at
    (2586, 9887), (2590, 9887), (2593, 9881), (2594, 9884).
11. **Two locked doors.** Through the fire giants to the **Door** `baxtorian_door_2_waterfall_quest` (2568, 9893):
    use A key on it from the south (stand (2568, 9893)) to go through to (2568, 9894) (`:392-409`). Open there
    always says "The door is locked." on either side, as the player's z is below 9895 (`:382-384`). Up the corridor to
    the Door (2566, 9901): use A key from the south (stand (2566, 9901)): through to (2566, 9902), stage 6 (`:396-398`).
    The key is never used up.
12. **Pillars.** Use one **Air rune**, one **Earth rune** and one **Water rune** on each of the six **Pillar** locs
    `stonepillar_small_waterfall_quest` at (2562, 9910), (2562, 9912), (2562, 9914), (2569, 9910), (2569, 9912),
    (2569, 9914) (`waterfall_pillars.rs2:1-39`). Stand east of the west ones, (2563, z), and west of the east ones,
    (2568, z). Each placement: "You place the rune on the stand." and the rune is used. A rune type already on that
    pillar: "You remember putting that type of rune there.", nothing used (`:11-13`). Other runes and the pillars in
    the other two rooms (x 2536-2543 level 1, x 2600-2607) do nothing.
13. **Statue.** Use **Glarial's amulet** (from the inventory) on the **Statue of Glarial** (2565, 9916; stand
    (2565, 9915)), not the Statue of Baxtorian beside it: with all 18 runes placed the amulet is used up, the player
    is moved to (2603, 9914), stage 8 (`quest_waterfall.rs2:411-426`); else 20 damage (`:428-435`).
14. **Chalice.** Use **Glarial's urn** on the **Chalice of eternity** (2x2 at (2603, 9910); stand (2603, 9912)) with
    5 free slots: stage 10, rewards (`:460-494`). Never Take treasure on it before stage 10.
15. **Out.** Open the Door (2604, 9900) from (2604, 9901): moved to (2566, 9901) (`:380-390`). Use A key on the Door
    (2568, 9893) from the north (stand (2568, 9894)) to get south of it. Walk to the entry (2575, 9861); Open the Door
    `baxtorian_door_waterfall_quest` there: moved to the ledge (2511, 3463) (`:287-289`); Get in the Barrel (2512,
    3463): (2527, 3413) (`:291-297`). Keep the A key until you are out: walks inside the dungeon failed "No connector from level 0 (2566,9901) to (2604,9901)" and "No path to (2575,9861) from (2511,3463)" (`grail-exit-prep`, 2 of 4 runs), so do these steps by `interact`. [v 2026-10-24 conductor3 local]

After stage 8, the key on the Door (2566, 9901) moves the player straight to the chalice room door (2604, 9901)
(`:399-401`).

## Lost items

| Item | Get it again | Source |
|---|---|---|
| Book on baxtorian | not needed after stage 3; before that, Search the bookcase again (stage 2+, none held) | `quest_waterfall.rs2:306` |
| Golrie's key (A key) | Search Golrie's crate again (stage 3+, none held) | `:319-327` |
| Glarial's pebble | key from the crate, gate, Talk-to Golrie again (gives one if none held) | `golrie.rs2:10-15` |
| Glarial's amulet | pebble on the tombstone (tomb rule applies), Search the open chest (none held; no stage check) | `quest_waterfall.rs2:146` |
| Glarial's urn | Search the Tomb of glarial (no full urn held) | `:128` |
| Dungeon key (A key) | Search the dungeon crate (none held) | `:373` |
| Rope, runes | buy again; runes already placed stay placed (varp 66) | `waterfall_pillars.rs2:11-20` |

None of these checks the bank: a copy in the bank does not stop a new one. The amulet is used up at the statue, so
re-entering the falls after stage 8 (to reach the chalice) needs a new amulet from the chest.

## Movement connectors and the walker

What `travel` (actions/walk.ts over `conductor/lib/walk-graph.ts`, `conductor/lib/connectors.ts`) can cross on this
route, checked with `nearestWay` on the world index graph [2026-10-23]:

| Connector | Row in `wiki/world.json` | Walker crosses it | Why not |
|---|---|---|---|
| Log raft, bank (2509, 3493) to the island (2512, 3481) | gate, `oploc1`, `quest:waterfall>=1`, `quest_waterfall.rs2:155` | yes, once the quest tab shows the quest started (Almera to the island: 9 run ticks) | |
| Swim to on the Rock, island to (2527, 3413) | none | no | no row (`aploc1` swim), and the rock is unreachable on foot |
| Rope on the Rock, island to the islet | gate, `aplocu`, `item:rope:held`, `from: north`, no landing (`gate-list.ts:2510`) | no | `moveRefusal` refuses use-item triggers (`walk-graph.ts:108-114`); the row derives no landing (roadmap: approach-op gates used from range) |
| Rope on the Dead tree, islet to the ledge (2511, 3463) | gate, `oplocu`, `item:rope:held`, to (2511, 3463) | no | use-item trigger |
| Climb on the Dead tree, islet to (2527, 3413), 8 damage | crossing, `quest_waterfall.rs2:249` | yes | |
| Ledge door, ledge to the dungeon (2575, 9861) | gate, `oploc1`, amulet held or worn, `:267` | yes (ledge to dungeon entry: 2 run ticks with the amulet held) | |
| Door (2575, 9861), dungeon to the ledge | crossing, `:289` | yes | |
| Barrel, ledge to (2527, 3413) | crossing, `:297` | yes | |
| Tombstone of glarial, surface to the tomb | gate, `oplocu`, pebble held + `loadout:glarials_tomb` | no | use-item trigger |
| Tomb Ladder (2556, 9844) up to (2557, 3444) | connector | no | left out of `CONNECTORS`: "into an underground area planeOf does not name" (`connectors.ts:166-178`) |
| Tree Gnome Village Ladder (2533, 3155) down, cellar Ladder (2533, 9555) up | connectors | no | same: the cellar is in the lumped `0u` plane |
| Loose railing into Tree Gnome Village (2515, 3161) | crossing | yes (tombstone to the cellar ladder: 215 run ticks) | |
| Golrie's gate with the key; dungeon Doors (2566, 9901), (2568, 9893), (2604, 9900), (2606, 9892) with the key | gates, `oplocu` | no | use-item trigger |
| Golrie's gate Open from inside | `not-a-gate` (`gate-list.ts:2533`) | no | |
| Door (2604, 9900) Open from (2604, 9901) to (2566, 9901) | crossing, `:389` | yes | |
| Hadley's staircases (2516, 3424), (2517, 3429) | connectors | yes (Hadley to the bookcase stand: 6 run ticks) | |

## Catalog coverage

| Step | Task and params | Covered |
|---|---|---|
| Buy rope | `shop` `{"npc":"Aemad","at":{"x":2614,"z":3293},"buy":[{"item":"Rope","count":1}]}` | yes |
| Buy runes | `shop` `{"npc":"Aubury","at":{"x":3253,"z":3402},"buy":[{"item":"Air rune","count":6},{"item":"Earth rune","count":6},{"item":"Water rune","count":6}]}` | yes |
| Bank in/out | `bank` with `area` Ardougne North `{"x":2617,"z":3331,"radius":6}`, `deposit` / `depositAllExcept` / `withdraw` | yes, inventory only |
| 1 Almera | `talk` `{"npc":"^Almera$","at":{"x":2522,"z":3496},"choices":["How can I help"]}` | yes |
| 2 Raft + Hudon | `travel` `{"to":{"x":2512,"z":3480},"tolerance":1}` (takes the raft), then `talk` `{"npc":"^Hudon$"}` with no `at` to click through the forced dialog (`talk` continues an open dialog, `conductor/tasks/talk.ts:179-208`); or `interact` `{"target":"loc","name":"^Log raft$","option":"^Board$"}` | yes; if the dialog was already closed, `talk` may find Hudon unreachable (give it `onFail: 'continue'`) |
| 3 Off the island | none | **no** (gap 1) |
| 4 Bookcase | `interact` `{"target":"loc","name":"^Bookcase$","option":"^Search$","at":{"x":2519,"z":3427,"level":1,"tolerance":1},"expect":"Book on Baxtorian"}` | yes, with a tie risk (gap 3) |
| 5 Read | `interact` `{"target":"item","name":"^Book on baxtorian$","option":"^Read$"}` | yes; the book interface stays open |
| 6 Cellar | `travel` to (2533, 3157); `interact` `{"target":"loc","name":"^Ladder$","option":"^Climb-down$","at":{"x":2533,"z":3156}}` | yes (not `travel`: gap 5) |
| 6 Golrie's crate | `interact` `{"target":"loc","name":"^Crate$","option":"^Search$","at":{"x":2548,"z":9566,"tolerance":1},"expect":"large key"}` | yes, with a tie risk (gap 3) |
| 7 Key on gate | `talk` `use` `{"items":["^A key$"],"onLoc":"^Door$"}` at (2515, 9575) | yes (a teleporting use counts as its effect) |
| 7 Golrie | `talk` `{"npc":"^Golrie$"}` | yes |
| 7 Out of the cell | `interact` `{"target":"loc","name":"^Door$","option":"^Open$"}`; then `interact` Ladder `^Climb-up$` at (2533, 9556) | yes |
| 8 Strip for the tomb | `bank` deposits carried items | **no** for worn gear (gap 4) |
| 8 Pebble on tombstone | `talk` `use` `{"items":["^Glarial's pebble$"],"onLoc":"^Tombstone of glarial$"}` | yes (a teleporting use counts as its effect) |
| 8 Chest, tomb | `interact` `{"target":"loc","name":"^Closed chest$","option":"^Open$","at":{"x":2530,"z":9845}}`, `interact` `^Open chest$` `^Search$`, `interact` `{"target":"loc","name":"^Tomb of glarial$","option":"^Search$","at":{"x":2541,"z":9811}}` | yes |
| 8 Tomb ladder | `interact` `{"target":"loc","name":"^Ladder$","option":"^Climb-up$","at":{"x":2555,"z":9844}}` | yes (not `travel`: gap 5) |
| 9 Gear up | `interact` `{"target":"item","name":"...","option":"^(Wield|Wear)$"}` per piece | yes |
| 9 Raft to the island | `travel` `{"to":{"x":2512,"z":3476},"tolerance":1}` | yes |
| 9 Rope on Rock | none | **no** (gap 1) |
| 9 Rope on Dead tree | `talk` `use` `{"items":["^Rope$"],"onLoc":"^Dead tree$"}` at (2512, 3466) | yes (a move of the player counts as the effect; not run here) |
| 9 Ledge door | `travel` `{"to":{"x":2575,"z":9861}}` from the ledge, amulet held | yes (by tile, through `actions/cross.ts`) |
| 10 Dungeon crate | `interact` `{"target":"loc","name":"^Crate$","option":"^Search$","at":{"x":2588,"z":9888,"tolerance":1},"expect":"large key"}` | yes, with a tie risk (gap 3) |
| 11 Key on Doors | `talk` `use` key on `^Door$` at (2568, 9893), then at (2566, 9901) | yes (a move of the player counts as the effect; not run here) |
| 12 Pillars | `talk` `use` `{"items":["^Air rune$","^Earth rune$","^Water rune$"],"onLoc":"^Pillar$"}` at each stand tile, six runs | partly: the uses register (the rune leaves the inventory), but the nearest Pillar is picked by distance (gap 3) and a repeated rune times out |
| 13 Statue | `talk` `use` `{"items":["^Glarial's amulet$"],"onLoc":"^Statue of Glarial$"}` at (2565, 9915) | yes, but the boulder (runes missing) also reads as success (an animation); check the amulet is gone and the bot is at (2603, 9914) |
| 14 Chalice | `talk` `use` `{"items":["^Glarial's urn$"],"onLoc":"^Chalice of eternity$"}` at (2603, 9912) | yes |
| 15 Out | one `travel` from the chalice room or the pillar room to the mainland, A key held (`met: ["quest:waterfall>=8"]` for the key on the Door (2566, 9901), which the quest tab cannot show): Open Door (2604, 9900), key on Door (2568, 9893), entry Door, Barrel | yes [v 2026-10-24 conductor3w2 local: pillar room (2563, 9912) to Falador West bank, 178 s] |

### Gaps, most important first

These were task gaps found when the catalog was audited; the promoted plan (Plan status) completes the quest
regardless, using `interact` with `unreachable` / `use`, `onFail: continue` and banking worn gear before the tomb
[v 2026-10-24 questw2 local]. Read them as why a plan is shaped that way, not as blockers.

1. **Approach ops on an unreachable loc.** `interact` and `talk` `use` take only locs whose `reachable` is not false
   (`conductor/tasks/interact.ts` `candidates`, `talk.ts:90-96` `findLoc`), and nothing on the island is reachable
   except the island. So no task gets the bot off the island (swim or rope), and the quest stops at stage 2 whatever
   the plan does; the rope throw blocks the falls again at step 9. The client already sends these ops unrouted
   (`server/webclient/src/bot/ActionExecutor.ts:433-438`, `routed: false`; tests with this rock:
   `ClientInteraction.test.ts:682-728`). Needed: an `interact` param that names the loc by tile (gap 3) and sends the
   op even when unrouted, from a stand tile the plan gives ((2512, 3476)); its effect is the player moving
   (swim: to (2527, 3413)) or an animation (rope: `human_throwrope`), then a landing at (2513, 3468).
2. **Fixed: use an item on a loc whose effect is a move.** `talk` `use` used to wait for an inventory change, a dialog or
   interface, an animation or a refusal, and now also for the game to move the player (`conductor/actions/use.ts` `used`, `movement.ts`). The pebble on the tombstone, the rope on
   the Dead tree, the key on Golrie's gate and on the dungeon Doors only move the player and print messages (nothing
   is used up), so each timed out after 10 s and was retried; on a key door the retry runs from the far side and walks
   the bot back through (`quest_waterfall.rs2:357-367`, `:392-407`), and after the rope the retry finds the other
   Dead tree (2510, 3463) beside the ledge. `interact` also takes an item on a loc (`use`), sent once.
3. **Pick a loc by tile.** Both tasks pick the nearest loc of that name; a tie goes to the one scanned first, smaller
   x then smaller z (`server/webclient/src/bot/StateCollector.ts:1117-1124`, stable sort at `:1272`), and `at` only
   gets the bot within its tolerance (min 1). Wrong picks within one tile of a stand tile: the six Pillars (each must
   get all three runes), Golrie's crate vs `crate3_old` (2549, 9566) from any tile but (2548, 9566) (from that tile the
tie goes to Golrie's), the dungeon key Crate vs `crate` (2586, 9887) from (2587, 9887), the Bookcase vs
   (2517, 3424) from (2518, z), the three Ledge locs. Needed: a `tile` {x, z, level} param on `interact` and
   `talk` `use`.
4. **Remove worn equipment.** No task unequips: `bank` deposits carried items only (`conductor/tasks/bank.ts:34`)
   and `interact` item targets are inventory items. The tomb refuses worn armour and weapons. Until a task does it,
   the bot must reach the tombstone never having worn gear on that trip. Needed: a `bank` `depositWorn` or an
   `interact` target for worn items (Remove).
5. **Walker into the cellar and out of the tomb.** The ladders at (2533, 3155), (2533, 9555) and (2556, 9844) are left
   out of `CONNECTORS` because the cellar and tomb are not named underground areas (`connectors.ts`
   `UNDERGROUND_AREAS`, `leftOut`). `interact` climbs them; adding the cellar (m39_149) and the tomb (m39_153) as
   areas would let `travel` route through.
6. **Walker moves for use-item gates.** `moveRefusal` refuses every `oplocu`/`aplocu` trigger
   (`walk-graph.ts:108-114`). With gap 2 fixed, `actions/cross.ts` could make the rope, pebble and key moves, and one
   `travel` would go from Almera's bank to the dungeon entry; the rock's row also needs its landing (2513, 3468)
   derived (roadmap: "approach-op gates used from range").

## Suggested library saves

Format as `conductor/saves/*.json` (`source.spec`: `position`, `skills`, `inventory`, `equipment` with slots, `bank`,
`varps`; build with `bun conductor/tools/library.ts generate`). Obj ids from `server/content/pack/obj.pack`.

- **`waterfall-start`**, the whole quest: position (2522, 3494) outside Almera's house; Attack 60, Strength 60,
  Defence 60, Hitpoints 70 (combat 71, so the tomb's moss giants hunt it); nothing worn (gap 4); inventory Rope (954) and
  10 Lobster (379) in separate slots, 200 coins (995); bank 6 each Air (556), Earth (557), Water (555) rune, 20
  Lobster, Rune scimitar (1333), Adamant full helm (1161), platebody (1123), platelegs (1073), kiteshield (1199).
  Varps 65 and 66 at 0.
- **`waterfall-dungeon`**, the falls only (steps 9-15): position (2510, 3494) beside the Log raft; same levels; worn
  Adamant full helm (slot 0), Rune scimitar (3), Adamant platebody (4), Adamant kiteshield (5), Adamant platelegs (7);
  inventory Rope, Glarial's amulet (295), Glarial's urn (296), 6 each Air, Earth, Water rune, 15 Lobster; varp 65 = 4
  (the ledge door moves the stage only from 4), varp 66 = 0.

## Plan status

Promoted: `conductor/plans/waterfall-quest.ts`. A fresh load of `lib:waterfall-start` to quest done in one run, 1223 s
(run `2026-10-24T01-56-32-174Z-plan-waterfall-quest`, questw2). [v 2026-10-24 questw2 local]

- Start save `waterfall-start`: stage 0, Catherby bank (2809, 3441), Att/Str/Def 45, HP 50, Prayer 43, Agility 52,
  Fishing 79, Cooking 81, Thieving 72; inventory 20 swordfish + 500 coins; bank 30 swordfish, 10 tuna, rune scimitar,
  adamant full helm, platebody, platelegs, kiteshield; nothing worn. `waterfall-tomb`: stage 3, at the tombstone
  (2560, 3445), pebble + rope + 20 swordfish. (The "Suggested library saves" above are the original sketches.)
- Minimum proven: no harpoon, rope or runes owned at the start. The plan buys the rope at Arhein (Catherby, 23 gp)
  and the 18 runes at Betty (Port Sarim, 72 gp), so 100+ coins and 20+ food suffice. Combat below 45 is untested.
- Stage comes from held items (book, pebble, amulet, urn, key), position regions and the quest tab. `v.last` only
  rotates the settle phases after a search or climb, because the view is one tick stale.
- Phase seconds: buy-runes (Port Sarim) 111; bank-runes walk Catherby -> Ardougne North 161 (no loop); Almera 57;
  to-cellar 106; tomb about 150 (tombstone 108 with fights, chest 53, flee 42, urn 11, exit 1); bank-gear 40;
  to-island-2 59; key-crate + dungeon fight/wait 160; door1 54; door2 42; pillars 6 x 3; statue 13; chalice 2.
  Idle time: waiting out Skeleton fights at the key crate (~100 s) and door use-items timeouts (~100 s).
- Hudon: Talk-to works from the island with `interact` `unreachable` at (2512, 3478); the bookcase gives the book
  only after that talk. The forced dialog on landing does not set stage 2.

Gotchas the plan works around [v 2026-10-24 questw2 local]:

- Pebble on the tombstone: `talk` `use` walks back to its `at` tile after the teleport, i.e. out of the tomb via the
  ladder (earlier successes depended on that use timing out). The plan uses `interact` with `use` {item pebble} on
  the Tombstone instead. Re-entering works at any stage.
- Pack slots: the chalice refuses the reward with fewer than 5 free slots (the plan drops 6 swordfish first,
  make-room); the key crate search fails silently with a full pack (bank-gear takes 14 swordfish and bank-food 5, 19
  in all, so the key fits).
- Fights: no task starts under attack, so the dungeon waits fights out with `travel` flee to the crate or door 1,
  eating held food, auto-retaliating with rune scimitar + adamant. Two alternating phases per fight, so a failed wait
  never ends the plan. Skeletons (45) x3 and Skeleton Mages attack at the key crate; Fire giants (86) are by door 1;
  survivable at Attack 60 with rune scimitar + adamant by waiting the fight out.
- Door 1, door 2 and the key crate use `onFail` continue / maxFails 10-12, because use-items reports a Timeout
  although the key works.
- Tomb: no combat phase; flee to the ladder (2555, 9844) whenever attacked, eat on the surface and inside. Only the
  tomb forbids gear: bank weapon and armour before the tombstone, withdraw them at Ardougne North after, wear them
  for the dungeon with 20+ food. Going into the dungeon geared-light with little food died at the key crate (three
  Skeletons held the bot in a 286 s fight until the food ran out).
- Not done: Protect from Melee (combat `prayers` only toggles during a combat run, which cannot start in the tomb).
- Searching the crate in Golrie's cellar draws Zombies and Giant bats. Hadley's house -> Tree Gnome Village ladder has
  no path: see `learnings/walking.md`.
- A combat-35 account (HP 33, little food) died on the tomb chest -> urn leg (auto-retaliation about 25 HP/min).

## Plan status: waterfall-armour

Promoted: `conductor/plans/waterfall-armour.ts` (waterfall-quest with a Defence-40 armour prep). Run `2026-10-24T02-45-31-672Z-plan-waterfall-armour`, one run, 1628 s, no deaths: Attack 40 -> 84, Strength 62 -> 87 (343,750 XP each from the reward plus ~23.8k Strength from fights), HP 52 -> 54. [v 2026-10-24 conductor3 local]

- Safe at Defence 40 / combat 62 in Mithril platebody + Mithril platelegs + Adamant full helm with a Mithril scimitar and 20 Swordfish: dungeon fights waited out with `travel` flee (5 fight and 5 wait phases, ~78 s each), HP lowest 37/54, 3 Swordfish eaten. This extends the proven range below Attack 60 / rune; below combat 45 stays untested.
- Armour bought with the `shop` task by NPC name: Peksa (Adamant full helm 3,520), Horvik (Mithril platebody 5,200), Louie Legs (Mithril platelegs 2,600); see `learnings/equipment.md`.
- Phase seconds: prep-bank 73, buy-helm 38, buy-body 41, buy-legs 75, bank-start 197, buy-runes 117, buy-rope 5, almera 60, to-island-1 11, hudon-talk 9, swim 5, bookcase 14, to-cellar 106, cell-key 61 (one of two runs failed on 3 key-on-door timeouts, retried), tombstone 109 (2 runs), bank-runes 163, tomb-flee 42, tomb-urn 12, tomb-chest 14, to-island-2 60, bank-gear 40, key-crate 13, door1 53, door2 42, statue 14, pillars 3-4 each, chalice 2. The long phases are walks: bank-start, bank-runes, tombstone (100-200 s each).
- The statue phase's second run failing "no connector from (2603,9914) to (2565,9915)" after the chalice is harmless.
- The run ends with interface 297 (quest-complete scroll) open in the chalice room (2603, 9912).
- Loot kept: Glarial's urn, 2 Diamond, 2 Gold bar, 40 Mithril seeds.
