# Shilo Village

| Detail | Info |
|--------|------|
| Difficulty | Experienced |
| Length | Long |
| Quest Points | 2 |

## Requirements

- Jungle Potion quest complete (`mosol_rei.rs2:2`, `trufitus.rs2`); Druidic Ritual is needed only through it [server data, unverified in game 2026-10-23]
- 32 Agility mid-quest (`quest_zombiequeen.rs2:390,619`), 15 Agility at a crossing (`:527`) [server data, unverified in game 2026-10-23]
- Crafting 15, 16 and 20 for the beads (`quest_zombiequeen.rs2:1254,1270,1285`) [server data, unverified in game 2026-10-23]

## Items Needed

- Chisel (for crafting bone beads)
- Needle and thread (for crafting)
- Bronze wire (for crafting beads)
- Antipoison recommended

## Rewards

- 3,875 Crafting XP
- Access to Shilo Village
- Access to gem rock mining
- Access to cart travel from Brimhaven

## Walkthrough

1. **Get the Wampum Belt.** Mosol Rei, near the walled village deep in the Karamja jungle, warns you about the undead and gives the belt (needs Jungle Potion, `mosol_rei.rs2:2`). [server data, unverified in game 2026-10-23]

2. **Start the quest.** Show the belt to Trufitus; the quest starts with him (`trufitus.rs2:86`). [server data, unverified in game 2026-10-23]

3. **Explore the temple.** Travel east to find an ancient temple. Search the mound near the temple entrance and navigate the underground passages.

4. **Collect quest items.** Gather the following from the underground area:
   - Ancient scrolls (containing lore about the curse)
   - Zadimus's corpse

5. **Bury the corpse.** Bury Zadimus's remains at the Tribal Statue to receive a Bone Shard.

6. **Explore the tomb.** Find the tomb to the SW. Inside, collect:
   - Sword pommel
   - Bervirius crystal
   - Notes containing important information

7. **Craft the Beads of the Dead.** Using the bone items and your crafting supplies, create the Beads of the Dead required to enter the final area.

8. **Fight the undead.** Defeat 3 undead opponents in succession:
   - Nazastarool, three forms: levels 91, 68 and 93 (`quest_zombiequeen.npc:234,272,310`) [server data, unverified in game 2026-10-23]

   Each defeated form is saved in the quest varp; the next form spawns when you try to take the corpse, and nothing resets on leaving (`quest_zombiequeen.rs2:1545-1573`). [server data, unverified in game 2026-10-23]

9. **Retrieve the corpse.** After defeating all three undead, retrieve Rashiliyia's corpse.

10. **Complete the quest.** Return the corpse to the tomb to lay the spirit to rest and lift the curse on Shilo Village.

## Verified route

Plan `conductor/plans/shilo-village.ts` from save `shilo-village-start` (Tai Bwo Wannai (2806,3088), Jungle Potion done, Att/Str/Def 80, HP 85, Prayer 55, Agility 70, Crafting 25, rune scimitar/platebody/platelegs/full helm/kiteshield, amulet of power; pack: Wampum belt, spade, rope, lit candle, chisel, bronze wire, 3 bones, 17 swordfish): done in one fresh-load run of about 20 min. [v 2026-11-01 questw5 local]

Stages (varp `zombiequeen` 0-15, `zq_map_mechanisms` bits 0-11; `quest_zombiequeen.rs2`, `trufitus.rs2`). Seconds are from the clean run. [v 2026-11-01 questw5 local]

1. Trufitus: use the Wampum belt on him; choices "legend", "Why was it called", "going to search", "seriously" (19 s).
2. Stage 4: dig the Mound of earth (2921,2999) with the spade (46 s).
3. Stage 5: lit candle on the fissure (15 s). Stage 6: rope on it (2 s). Stage 7: crawl in, Agility 32 (4 s).
4. Temple of Ah Za Rhoon (underground x 2880-2960, z 9280-9410). The z >= 9344 half (plane 146) holds the Cave-in rubble (2887,9373), which leads to the z < 9344 half (145): loose rocks (2885,9317) for the Tattered scroll (17 s), sacks (2939,9285) for the Crumpled scroll (52 s), gallows (2934,9325) for the Zadimus corpse (11 s). Back via (2886,9283) and the rubble (33 s). The smashed table (raft) is never used: one failed Crafting roll kills it for good.
5. Stage 8: leave by the waterfall rocks (2940,9349) (24 s); pass or fall you come out at (2928,2947). 7+ Undead Ones fight you here (317 s; see [hazards](../../learnings/hazards.md)). That bank is disconnected for the walker: travel to (2921,2997) first (99 s to leave).
6. Read the scrolls (8 s). The Crumpled scroll must be read before the bronze wire joins the Bone beads.
7. Stage 9: Cairn Isle rocks (2762,2990), only after the Tattered scroll was READ (Agility 32). Cross the climbing rocks (2792-2794, 2978-2980) west, then the log bridge x 2776-2781 at z 2979 (194 s with retries on falls). The "Well stacked rocks" crawl is searched from (2762,2988); (2762,2992) is blocked and the walker can't reach it from the north bank (10 s to isle, 11 s crawl, 10 s dolmen). Crossings fail at random; a fall leaves a river bank with no route to the isle.
8. Bervirius' tomb (2766,9364): crafting 6 s; the Climbing rocks out (2765,9376) fail about half the time at Agility 40, 1-10 HP a fall (32 s out).
9. Zadimus' corpse: inventory option 1 Bury at x 2794-2798, z 3087-3090 (49 s); a ghost dialog follows, `talk continue` clears it.
10. Stage 10: hidden doors. Search the palm trees (2915,3092); the "Carved doors" show for about 50 ticks as "Hillside entrance", option Enter (not Open) (40 s). Search the doors once after the Bervirius tomb to set the lock bit; only then does a Chisel on the Bone shard make the Bone key (Crafting 20) (3 s + 2 s). Unlock and enter (8 s).
11. Stage 11: Rashiliyia's tomb, entrance (2929,9525). The gate (2928,9516) needs the Beads of the Dead worn; the rocks (2928,9515) Climb down to (2928,9511) (15 s).
12. Stage 12: use a Bone on the tomb doors (2892,9480) three times (43 s).
13. Dolmen (2892,9487): Search once (50 s); Nazastarool's forms 1-3 follow automatically (55 s, all three died in about a minute to Att/Str/Def 80 with Protect from Melee). After the third, Search again for the corpse (stage 14).
14. Back up the rocks (20 s), gate (3 s), exit door (2928,9527) with the Bone key (6 s), corpse crawl (11 s).
15. Stage 15: lay the corpse on the dolmen in Bervirius' tomb (2766,9364) (9 s).

Script facts: Rashiliyia only appears when the beads are NOT worn; fake coins at (2915,9503) spawn undead. [server data, unverified in game 2026-11-01]

## Key NPCs & Locations

| NPC / Location | Where |
|----------------|-------|
| Mosol Rei | Near the walled village, deep Karamja jungle |
| Trufitus | North of Mosol Rei's location |
| Ancient temple | East of starting area |
| Tribal Statue | Karamja jungle |
| Tomb | SW of the temple area |
| Nazastarool (levels 91, 68, 93) | Underground tomb area |
| Shilo Village | Southern Karamja (accessible after quest) |
| Gem rocks | Inside Shilo Village |
