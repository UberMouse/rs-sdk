# Quests

Every quest in the quest tab (68, 145 QP in total), for choosing which quest plan to build next. The id is the
`QUESTS` key in `conductor/lib/quests.ts` (plans name it in `quest:<id>` tokens); the per-quest pages hold the
walkthroughs.

Everything here comes from the server content [server data, unverified in game 2026-10-23]. Script references are
file names under `server/content/scripts/` with a line number (`find server/content/scripts -name <file>`).

- **QP**: `general/configs/quest.constant:72-139`. **M/F**: the quest list's MEMBERS / FREE sections
  (`player/interfaces/questlist.if`); bots run on members worlds, so the column only says what F2P content a quest
  needs.
- **Requires**: what the scripts actually check. Most skill checks use `stat()` (boostable); **base** marks a
  `stat_base()` check. "Mid" checks bite partway through, not at the start. Journal (`*_journal.rs2`) text enforces
  nothing. The per-quest pages state base XP (the same tenths/10 figure, before x25) and carry only requirements the
  scripts check or are marked unverified.
- **XP (x25)**: the completion grants as the scripts give them. `stat_advance` takes tenths and the engine multiplies
  by `xpRate` 25 (`learnings/local-server.md`), so XP = base/10 x 25. "-> N" is the level that lump alone reaches from
  level 1 (Hitpoints from 10) on this server's curve (`conductor/lib/xp.ts`; 50 = 32,619, 70 = 133,230, 90 = 534,888,
  99 = 998,458). Small obstacle and step grants are left out. A few grants sit in area scripts, not `quest_*.rs2`:
  Sea Slug (`caroline.rs2`, area_ardougne_east) and the Tai Bwo Wannai sons (`tbwt_*_final.rs2`, area_karamja).
- **Fights**: kills the quest forces (NPC level is `vislevel` from the npc config). **Wild** marks a Wilderness step.
- **Stage visibility**: the server transmits a quest's progress varp to the client only for Tai Bwo Wannai Trio (`tbwt_main`, 320) and Throne of Miscellania (`misc_quest`, 359) (`transmit=yes` in their `.varp` configs; default false, `VarPlayerType.ts:86`). For every other quest the client sees only the quest tab colour, so plans gate on the tab, held items, position and dialog/message history, not on stage numbers. [server data + live state on questw1, 2026-10-24]
- **Plan**: `promoted` when `conductor/plans/<name>.ts` runs the quest; `in progress` while a draft is being proven.

| Quest (id) | QP | M/F | Requires (scripts) | XP (x25) -> level from 1 | Other rewards and unlocks | Fights, Wilderness | Plan |
|---|---|---|---|---|---|---|---|
| [Big Chompy Bird Hunting](big-chompy-bird-hunting.md) (`chompybird`) | 2 | M | Mid: Fletching 5 + Crafting 5 for ogre arrows (`ogre_arrows.rs2:29,56`); Ranged 30 base to wield the ogre bow (`tier30.rs2:63`); Cooking 30 (`raw_chompy.rs2:15`) | Fletching 6,550 -> 28; Cooking 36,750 -> 51; Ranged 18,375 -> 42 (`quest_chompybird.rs2:46-48`). After the quest, 4,000 chompy kills give Ranged 750,000 (`chompy_bird.rs2:212`) | Ogre bow kept; chompy hunting | Chompy bird 6 | |
| [Biohazard](biohazard.md) (`biohazard`) | 3 | M | Plague City in effect: Elena's door opens only at its completion (`doors.rs2:1-5`, area_ardougne_east) | Thieving 31,250 -> 49 (`quest_biohazard.rs2:159`) | Combat Training Camp; West Ardougne doors; Underground Pass start (`king_lathas.rs2:73`) | Sick mourner 13 (the key) | |
| [Black Knights' Fortress](black-knights-fortress.md) (`fortress`) | 3 | F | 12 QP at start (`sir_amik_varze.rs2:15`); bronze med helm + iron chainbody worn (`quest_blackknight.rs2:16`) | none | 2,500 coins | none forced; Black Knights 33 aggro at doors | |
| [Clock Tower](clock-tower.md) (`cog`) | 1 | M | none | none | 500 coins | none | |
| [Cook's Assistant](cooks-assistant.md) (`cook`) | 1 | F | none | Cooking 7,500 -> 30 (`quest_cook.rs2:89`) | Lumbridge castle range (`quest_cook.rs2:93-101`) | none | promoted |
| [Death Plateau](death-plateau.md) (`death`) | 1 | M | none | Attack 75,000 -> 61 (`quest_death.rs2:221`) | Steel claws; climbing boots wearable; Troll Stronghold and Eadgar's Ruse starts | none | in progress |
| [Demon Slayer](demon-slayer.md) (`demon`) | 3 | F | 1 coin to the gypsy; 25 bones; Silverlight wielded for Delrith (`npc_combat.rs2:174-186`) | none | Silverlight | Delrith 27 | |
| [Digsite](digsite.md) (`itexam`) | 2 | M | Mid: Thieving 25 (`digsite_workman.rs2:62`, the only source of the rock sample and brush); Agility 10 (`area_digsite.rs2:617`); Herblore 10 (`itexam_chemistry.rs2:21`) | Mining 382,500 -> 85; Herblore 50,000 -> 56 (`quest_itexam.rs2:41-42`) | 2 gold bars | promoted |
| [Doric's Quest](dorics-quest.md) (`doric`) | 1 | F | none (6 clay, 4 copper, 2 iron) | Mining 32,500 -> 49 (`quest_doric.rs2:99`) | 180 coins; Doric's anvils (`smithing.rs2:53-63`) | none | |
| [Dragon Slayer](dragon-slayer.md) (`dragon`) | 2 | F | 32 QP: the Champions' Guild door (`champions_guild.rs2:2`) holds the Guildmaster who starts it; no Magic or Telegrab (Wormbrain drops the map piece or sells it for 10,000 coins, `wormbrain.rs2:9-10,60-71`) | Strength 466,250 -> 88; Defence 466,250 -> 88 (`quest_dragon.rs2:33-34`) | Wear rune platebody and green d'hide body (`tier40.rs2:26,65`); Oziach's shop; Hero's Quest prerequisite | Elvarg 83 (anti-dragon shield worn: max hit 10, not 70, `elvarg.rs2:110-114`); Melzar's Maze up to a lesser demon 82; Wormbrain 2 (or 10,000 coins) | promoted |
| [Druidic Ritual](druidic-ritual.md) (`druid`) | 4 | M | none | Herblore 6,250 -> 28 (`quest_druid.rs2:3`) | Jungle Potion start (`trufitus.rs2:280`); Herblore on XP lamps | none (raw meat from cow, chicken, rat, bear) | promoted |
| [Dwarf Cannon](dwarf-cannon.md) (`mcannon`) | 1 | M | none | Crafting 18,750 -> 42 (`quest_mcannon.rs2:25`) | Cannon setup (`cannon_setup.rs2:52-57`); Nulodion's shop with the ammo mould (the quest takes its own mould back, `lawgof2.rs2:201`) | none | promoted |
| Eadgar's Ruse (`eadgar`) | 1 | M | Herblore 31 **base**, Death Plateau and Troll Stronghold done (`sanfew.rs2:102-103`); Druidic Ritual only to stage 3 (`sanfew.rs2:27-34`); Mad Eadgar freed during Troll Stronghold (`quest_troll.rs2:129-131`) | Herblore 275,000 -> 80 (`quest_eadgar.rs2:595`) | Trollheim Teleport (`teleport.rs2:30`) | none | |
| [Elemental Workshop](elemental-workshop.md) (`elemental_workshop`) | 1 | M | Mid: Crafting 20, Mining 20, Smithing 20 (`quest_elemental_workshop.rs2:172,186,252`) | Crafting 125,000 -> 69; Smithing 125,000 -> 69 (`:274-275`) | Elemental shield | Earth elemental 35 | promoted |
| [Ernest the Chicken](ernest-the-chicken.md) (`haunted`) | 4 | F | none | none | 300 coins | none | promoted |
| [Family Crest](family-crest.md) (`crest`) | 1 | M | Members (`crest_dimintheis.rs2:2`); through the skill scripts: Mining 40, Smithing 40 (`smelting.rs2:120`), Crafting 40 (`jewellery.rs2:228`), Magic 59 (all four blasts must land, `crest_chronozon.rs2:21-42`) | none | Steel gauntlets, made into cooking, goldsmith (2.5x gold bar XP, `smelting.rs2:216`) or chaos gauntlets; Legends prerequisite | Chronozon 170, **Wild** (Edgeville dungeon about level 3) | |
| [Fight Arena](fight-arena.md) (`arena`) | 2 | M | none | Attack 304,375 -> 81; Thieving 54,375 -> 57 (`quest_arena.rs2:270-271`) | 1,000 coins | Khazard ogre 63, scorpion 44, Bouncer 137 (General Khazard 112 optional) | promoted |
| [Fishing Contest](fishing-contest.md) (`fishingcompo`) | 1 | M | Mid: Fishing 10 (`hemenster_fishing.rs2:70`) | Fishing 60,925 -> 58 (`quest_fishingcompo.rs2:112`) | White Wolf Mountain tunnel (`quest_fishingcompo.rs2:7-14`) | none | |
| [The Fremennik Trials](fremennik-trials.md) (`viking`) | 3 | M | Mid: Woodcutting 40, Crafting 40, Fletching 25 (`viking_olaf.rs2:148,175,230`) | 70,310 each -> 60 in Attack, Defence, Strength, Hitpoints (61), Woodcutting, Fletching, Fishing, Crafting, Agility, Thieving (`quest_viking.rs2:135-144`) | Rellekka (gate `quest_viking.rs2:1-8`: shops, stalls, furnaces, anvil); Fremennik helms (`tier45.rs2:1-4`); longship to Miscellania; lyre teleport | Draugen 69; Koschei, 4 forms | in progress |
| [Gertrude's Cat](gertudes-cat.md) (`fluffs`) | 1 | M | none (100 coins) | Cooking 38,125 -> 52 (`quest_fluffs.rs2:316`) | Kitten, chocolate cake, stew | none | |
| [Goblin Diplomacy](goblin-diplomacy.md) (`gobdip`) | 5 | F | none | Crafting 5,000 -> 25 (`quest_gobdip.rs2:62`) | Gold bar | Goblins 2-5: goblin mail only drops (5/128, 10/128 in Goblin Village) | promoted |
| [The Grand Tree](grand-tree.md) (`grandtree`) | 5 | M | Mid: Agility 25 (`quest_grandtree.rs2:25`) | Agility 197,500 -> 75; Attack 460,000 -> 87; Magic 53,750 -> 57 (`:199-201`) | Stronghold spirit tree; gnome gliders (`gnome_glider.rs2:116`); half the Monkey Madness gate | Black demon 172 | in progress |
| Haunted Mine (`hauntedmine`) | 2 | M | Morytania (Priest in Peril stage 61); the journal's Agility 15 and Crafting 35 are unchecked | Strength 550,000 -> 90 (`hauntedmine_crystals.rs2:54`) | Crystal shard necklace, strung into the salve amulet | Treus Dayth 95 | |
| [Hazeel Cult](hazeel-cult.md) (`hazeelcult`) | 1 | M | none | Thieving 37,500 -> 51 (`quest_hazeelcult.rs2:172`) | 2,000 coins | Good side: Alomone 13; evil side: none | |
| [Hero's Quest](heros-quest.md) (`hero`) | 1 | M | 55 QP, Lost City, Merlin's Crystal, Dragon Slayer, Shield of Arrav (`quest_hero.rs2:2-4`); mid: Herblore 25, Fishing 53 (`lavafish.rs2:84`), Cooking 53, Mining 50 (`white_wolf_mountain.rs2:20`); **two accounts**, one per gang, trading a candlestick (`brimhaven_restaurant.rs2:2`, `brimhaven_blackarm_hq.rs2:2`) | Attack, Defence, Strength, Hitpoints 76,875 -> 62; Ranged 51,875 -> 56; Fishing 68,125 -> 60; Cooking 70,625 -> 60; Woodcutting, Firemaking 39,375 -> 52; Smithing 56,875 -> 57; Mining 64,375 -> 59; Herblore 33,125 -> 50 (`quest_hero.rs2:29-40`) | Heroes' Guild; dragon battleaxe and mace shop and wield (`tier60.rs2:4,6`); glory recharge; Miscellania and Legends prerequisite | Ice Queen 111 (ice gloves), fire bird 2, Grip 22; lava eels in the Lava Maze (**Wild**) or Brimhaven Dungeon (875 coins) | |
| [Holy Grail](holy-grail.md) (`grail`) | 2 | M | Merlin's Crystal (`king_arthur.rs2:43`); Excalibur worn for the Titan (Attack 20 base) | Prayer 275,000 -> 80; Defence 382,500 -> 85 (`quest_grail.rs2:116-117`) | none | Black Knight Titan 120 | promoted |
| Horror from the Deep (`horror`) | 2 | M | none enforced (journal Agility 35 unchecked); Barcrawl probably, since Gunnjorn is inside the outpost gate (`outpost_gate.rs2:2-5`; inferred from map data) | Magic, Strength, Ranged 116,550 each -> 68 (`quest_horror.rs2:491-493`) | Rusty casket, made into a god book | Dagannoth 100; Dagannoth mother 100, whose forms each take one style (four elemental spells, melee, ranged) | |
| [Imp Catcher](imp-catcher.md) (`imp`) | 1 | F | none | Magic 21,875 -> 44 (`quest_imp.rs2:4`) | Amulet of accuracy | Imps 2: 4 beads at 5/128 each | promoted |
| In Search of the Myreque (`routequest`) | 2 | M | Start check `%druidspirit < ^druid_complete` (`routequest_vanstorm.rs2:46`) compares Nature Spirit with Druidic Ritual's constant, so Nature Spirit merely started passes; the druid pouch (5 charges) still needs Nature Spirit stage 85; Agility 25 (`routequest_myreque.rs2:125`) | Attack, Defence, Strength, Crafting 15,000 each -> 39; Hitpoints -> 40 (`quest_routequest.rs2:26-30`) | Canifis hideout and the Mort'ton boat (mid-quest) | Skeleton hellhound 97 | |
| [Jungle Potion](jungle-potion.md) (`junglepotion`) | 1 | M | Druidic Ritual (`trufitus.rs2:280`); Herblore 3 to identify herbs (`identify.rs2:66`) | Herblore 19,375 -> 42 (`quest_junglepotion.rs2:74`) | Shilo Village and Tai Bwo Wannai Trio starts | none | promoted |
| [The Knight's Sword](knights-sword.md) (`squire`) | 1 | F | Mining 10 for blurite (`mining.rs2:58`) | Smithing 318,125 -> 82 (`quest_squire.rs2:223`) | none (the sword is taken back) | none (ice warriors 57 on the route) | promoted |
| [Legends Quest](legends-quest.md) (`legends`) | 4 | M | 107 QP + Family Crest, Hero's, Shilo Village, Underground Pass, Waterfall (`legends_guard.rs2:50-53`); mid: Crafting 50, Agility 50, Thieving 50, Strength 50, Mining 52 (`quest_legends.rs2:524`), Magic 56, Prayer 42, Smithing 50, Herblore 45, Woodcutting 50 | 4 picks of 191,250 -> 75 from 12 skills, repeats allowed (`radimus_erkle.rs2:87-122`) | Legends' Guild (doors open at stage 50, `legends_door.rs2:5`) and its shop; dragon sq shield wear (`tier60.rs2:13`) | Nezikchened 187 (three times); San Tojalon 106, Irvig Senay 100, Ranalph Devere 92 | |
| [Lost City](lost-city.md) (`zanaris`) | 3 | M | Mid: Woodcutting 36, Crafting 31 (`quest_zanaris.rs2:37,78`); Entrana bans weapons and armour | none | Zanaris via the Dramen staff; dragon dagger and longsword wield (`tier60.rs2:2,5`); Hero's prerequisite | Tree spirit 101; an Entrana zombie 25 for the axe | |
| [Merlin's Crystal](merlins-crystal.md) (`arthur`) | 6 | M | none | none | Excalibur; Holy Grail start; Hero's prerequisite | Sir Mordred 39; giant bat 27 (bat bones); **Wild**: the Thrantax altar inscription at (3239, 3608), level 12 (`quest_arthur.rs2:142-153`) | promoted |
| [Monk's Friend](monks-friend.md) (`drunkmonk`) | 1 | M | none | Woodcutting 50,000 -> 56 (`quest_drunkmonk.rs2:89`) | 8 law runes | none | promoted |
| [Monkey Madness](monkey-madness.md) (`mm`) | 3 | M | The Grand Tree + Tree Gnome Village (`king_narnode.rs2:6-9`); no skill checks | One-time Daero training after completion, needed to leave Ape Atoll: Strength + Hitpoints 875,000 -> 97 and Attack + Defence 500,000 -> 89, or the reverse (`mm_daero.rs2:295-307`) | 10,000 coins, 3 diamonds (`mm_narnode.rs2:96-97`); Ape Atoll | Jungle demon 195 (`quest_mm.npc:1478`); a monkey 3 | |
| [Murder Mystery](murder-mystery.md) (`murder`) | 3 | M | none (bring a pot) | Crafting 35,150 -> 51 (`quest_murder.rs2:428`) | 2,000 coins | none | |
| [Nature Spirit](nature-spirit.md) (`druidspirit`) | 2 | M | Priest in Peril at stage 61 (one more Drezel talk after completion) and Wolfbane held (`drezel.rs2:14-18`); ghostspeak amulet worn (Restless Ghost started; its completion is not checked); Crafting 18 for the sickle | Crafting 75,000 -> 61; Hitpoints, Defence 50,000 -> 56 (`quest_druidspirit.rs2:423-425`) | Blessed sickle; druid pouch; nature grotto altar | 3 ghasts 30 | promoted |
| [Observatory Quest](observatory.md) (`itgronigen`) | 2 | M | none | Crafting 56,250 -> 57 (`quest_itgronigen.rs2:261`), plus one random constellation of 12: four give 21,875 Attack, Strength, Defence or Hitpoints XP, the rest items | Uncut sapphire; unholy symbol mould (Spirit of Scorpius) | none | promoted |
| [Pirate's Treasure](pirates-treasure.md) (`hunt`) | 2 | F | none (rum smuggled past customs, white apron) | none | 450 coins, gold ring, emerald | none (the gardener 3 interrupts digging) | |
| [Plague City](plague-city.md) (`elena`) | 1 | M | none; starting Biohazard first blocks the dig (`mud_patch.rs2:15`) | Mining 60,625 -> 58 (`quest_elena.rs2:12`) | Ardougne Teleport (scroll read, Magic 51); Biohazard | none | promoted |
| [Priest in Peril](priest-in-peril.md) (`priestperil`) | 1 | M | none; 50 unnoted rune essence (the mine needs Rune Mysteries, `essence_mine.rs2:2`) | Prayer 35,150 -> 51 (`priestperil.rs2:9`) | Wolfbane; Morytania through the holy barrier at stage 61 (`holy_barrier.rs2:1-9`) | Temple guardian 30; Monk of Zamorak 30 |  promoted |
| [Prince Ali Rescue](prince-ali-rescue.md) (`prince`) | 3 | F | none; Ned won't help while hired for Dragon Slayer (`ned.rs2:11-14`) | none | 700 coins; free Al Kharid toll gate | none | |
| Regicide (`regicide`) | 3 | M | Underground Pass (`regicide_kings_messenger.rs2:2`: the messenger appears after a relog); mid: Agility 56 (`quest_regicide.rs2:404`), Crafting 10 | Agility 343,750 -> 83 (`quest_regicide.rs2:852`) | 15,000 coins; dragon halberd wear (`tier60.rs2:10`) and shop | Tyras guard 110 | |
| [The Restless Ghost](restless-ghost.md) (`priest`) | 1 | F | none; ghostspeak amulet worn | Prayer 28,125 -> 47 (`quest_priest.rs2:98`) | Ghostspeak amulet | none (skeleton 13 optional) | promoted |
| [Romeo & Juliet](romeo-and-juliet.md) (`romeojuliet`) | 5 | F | none | none | none | none | promoted |
| [Rune Mysteries](rune-mysteries.md) (`runemysteries`) | 1 | F | none | none | Air talisman; essence mine teleports (`essence_mine.rs2:2`) | none | promoted |
| [Scorpion Catcher](scorpion-catcher.md) (`scorpcatcher`) | 1 | M | Mid: Prayer 31 **base** for the Edgeville monastery (`prayer_guild.rs2:28`); Barcrawl to pass the outpost gate (`outpost_gate.rs2:2`); the start check is commented out (`thormac.rs2:9-17`) | Strength 165,625 -> 73 (`quest_scorpcatcher.rs2:60`) | Thormac makes mystic staves | none | |
| [Sea Slug](sea-slug.md) (`seaslug`) | 1 | M | Mid: Firemaking 30 (`quest_seaslug.rs2:43`) | Fishing 179,375 -> 74 (`caroline.rs2:45`) | Oyster pearls; Fishing Platform trips | none | |
| Shades of Mort'ton (`mortton`) | 3 | M | Morytania, and the Mort Myre gate (Nature Spirit started); mid: Herblore 15, Crafting 20 (`flamtaer_temple.rs2:11`), Firemaking 5 | Crafting 50,000 -> 56; Herblore 50,000 + 8,375 for the diary -> 58 (`quest_mortton.rs2:55,65-66`) | Razmire's stores | Loar shades 40 | |
| [Sheep Herder](sheep-herder.md) (`sheepherder`) | 4 | M | none (100 coins for the plague suit) | none | 3,100 coins | none | |
| [Sheep Shearer](sheep-shearer.md) (`sheep`) | 1 | F | none | Crafting 3,750 -> 22 (`quest_sheep.rs2:5`) | 60 coins | none | |
| [Shield of Arrav](shield-of-arrav.md) (`blackarmgang`) | 1 | F | **Two accounts**: each shield half is behind a door only its gang opens (`quest_blackarmgang.rs2:17,101`) and the Curator wants both (`curator.rs2:7-8`) | none | 600 coins; Hero's prerequisite | Jonny the Beard 2 (Phoenix route) | |
| [Shilo Village](shilo-village.md) (`zombiequeen`) | 2 | M | Jungle Potion (`mosol_rei.rs2:2`; Druidic Ritual only through it); mid: Agility 32 (`quest_zombiequeen.rs2:390`), Agility 15, Crafting 15/16/20 | Crafting 96,875 -> 65 (`:1632`) | Shilo (bank, furnace, gates); cart to Brimhaven; Captain Shanks' ship; Legends prerequisite | Nazastarool 91, 68, 93 | |
| Tai Bwo Wannai Trio (`tbwt`) | 2 | M | Jungle Potion (`tbwt_timfraku.rs2:51-56`); mid: Fishing 5 and 20, Cooking 30, Firemaking 30 (or a furnace), 4 doses of agility potion (Herblore 34; no shop); journal Agility 15 unchecked | Fishing 37,500 (`tbwt_lubufu.rs2:365`); after completion the sons give Attack, Strength 62,500 -> 59 (`tbwt_tamayu_final.rs2:22-23`), Fishing 125,000 (`tbwt_tiadeche_final.rs2:21`; 162,500 in all -> 72), Cooking 125,000 -> 69 (`tbwt_tinsay_final.rs2:16`) | Karambwan fishing (Fishing 65) and cooking; Tamayu and Tiadeche shops | A monkey 3 and a jogre 53 for item drops | |
| [Temple of Ikov](temple-of-ikov.md) (`ikov`) | 1 | M | Mid: Thieving 42 (`ikov_dungeon.rs2:158`); Ranged 40 **base** for a yew bow, since the Fire Warrior takes only ice arrows (`npc_combat.rs2:169`); 20 limpwurt roots | Ranged 262,500 -> 79; Fletching 200,000 -> 75 (`quest_ikov.rs2:62-63`, either ending) | none | Fire Warrior of Lesarkus 84; then Lucien 14 (Armadyl ending) or guardians 45/43 (Lucien ending) | in progress |
| Throne of Miscellania (`misc`) | 1 | M | Hero's Quest (`misc_door_guard.rs2:10`); Fremennik Trials for the longship (`viking_sailor.rs2:14-24`); 75% approval (`king_vargas.rs2:137`) | none | Kingdom management (`managing_miscellania.rs2:146`) | none | |
| [The Tourist Trap](tourist-trap.md) (`desertrescue`) | 2 | M | Mid: Smithing 20 (`quest_desertrescue.rs2:603`), Fletching 10 (`:655`) | Two picks of 116,250 from Fletching, Agility, Smithing, Thieving: -> 68 each, or 232,500 -> 77 in one (`irena.rs2:77-100`) | Dart tip smithing (`smithing.rs2:109`) | Mercenary captain 47 | |
| [Tree Gnome Village](tree-gnome-village.md) (`tree`) | 2 | M | none | Attack 286,250 -> 80 (`quest_tree.rs2:98`) | Gnome amulet; spirit trees (`spirit_tree.rs2:26`); half the Monkey Madness gate | Khazard warlord 112 | promoted |
| [Tribal Totem](tribal-totem.md) (`totem`) | 1 | M | Mid: Thieving 21 (`quest_totem.rs2:125`) | Thieving 44,375 -> 54 (`:163`) | 5 swordfish | none | |
| Troll Romance (`troll_love`) | 2 | M | Troll Stronghold (`ug.rs2:30`); Agility 28 (`quest_troll_love.rs2:2`) | Strength 100,000 -> 65; Agility 200,000 -> 75 (`:304-305`) | Uncut diamond, 2 rubies, 4 emeralds | Arrg 113 | |
| [Troll Stronghold](troll-stronghold.md) (`troll`) | 1 | M | Death Plateau (`death_ig_commander.rs2:7-9`); mid: Agility 15 (`quest_troll.rs2:7`), climbing boots worn | none | Law talisman; Troll Romance and Eadgar's Ruse starts | Dad 101 (down to 20 HP); Troll General 113 (prison key) | |
| [Underground Pass](underground-pass.md) (`upass`) | 5 | M | Biohazard (`king_lathas.rs2:73`); Ranged 25 **base** (`king_lathas.rs2:95`); mid: Thieving 50 at the cages (`quest_upass.rs2:248`; whether they are on the required path is unverified); Agility and Prayer are not checked (ledges only roll Agility for a fall) | Agility 75,000 -> 61; Attack 75,000 -> 61 (`quest_upass.rs2:800-801`) | Iban's staff (Magic 50, Attack 50), 15 death and 30 fire runes; Regicide and Legends prerequisite | 3 paladins 62, Kalrag 89, Othainian, Doomion, Holthion 91 | |
| [Vampire Slayer](vampire-slayer.md) (`vampire`) | 3 | F | none (stake and hammer for the kill) | Attack 120,625 -> 68 (`quest_vampire.rs2:42`) | none | Count Draynor 34 | promoted |
| [Watch Tower](watchtower.md) (`itwatchtower`) | 4 | M | Start: Agility 18 for the wall (`quest_itwatchtower.rs2:2`); mid: Agility 25, Thieving 15, Herblore 14, Magic 14, Mining 40 (`:393,483`) | Magic 382,500 -> 85 (`:533`) | 5,000 coins; Watchtower Teleport (scroll read, Magic 58) | Gorad 68; 6 ogre shamans 113 are killed with the potion, not fought | |
| [Waterfall Quest](waterfall-quest.md) (`waterfall`) | 1 | M | none | Attack 343,750 -> 83; Strength 343,750 -> 83 (`quest_waterfall.rs2:491-492`) | 2 diamonds, 2 gold bars, 40 mithril seeds; Legends prerequisite | none | promoted |
| [Witch's House](witchs-house.md) (`ball`) | 4 | M | none | Hitpoints 158,125 -> 72 (`quest_ball.rs2:202`) | none | Witch's experiment 19, 30, 42, 53 | |
| [Witch's Potion](witchs-potion.md) (`hetty`) | 1 | F | none | Magic 8,125 -> 31 (`quest_hetty.rs2:11`) | none | A rat 1 for its tail | |

Two accounts: Shield of Arrav needs one player in each gang, so a solo bot can't finish it, or the quests behind it:
Hero's Quest, Throne of Miscellania and Legends Quest.

## Quest points to 32

Dragon Slayer starts with the Guildmaster inside the Champions' Guild, whose door refuses under 32 QP
(`champions_guild.rs2:2`; the journal repeats it at `dragon_journal.rs2:7`). Oziach's script has no QP check. The quests
already planned give 17: Restless Ghost 1, Rune Mysteries 1, Imp Catcher 1, Waterfall 1, Priest in Peril 1, Druidic
Ritual 4, Merlin's Crystal 6, Holy Grail 2. The cheapest 15 more:

| Quest | QP | Why it is cheap |
|---|---|---|
| Romeo & Juliet | 5 | No checks, no fight; Varrock only, one cadava berry |
| Goblin Diplomacy | 5 | No checks; goblins of level 2-5 drop the mail (best rate 10/128 in Goblin Village); three dyes from Aggie |
| Ernest the Chicken | 4 | No checks, no fight; Draynor Manor only (spade on the compost heap, a lever puzzle) |
| Cook's Assistant | 1 | No checks, no fight; egg, milk and flour around Lumbridge |

That lands on exactly 32, so a failed quest leaves the total short. Spares in order of burden: Sheep Shearer 1, Doric's
Quest 1, Sheep Herder 4 (no fight, but herding with a prod), Murder Mystery 3 (no fight, random murderer),
Vampire Slayer 3 (Count Draynor 34; also Attack 120,625), Witch's House 4 (experiment up to 53; also Hitpoints 158,125).
Black Knights' Fortress (3) starts only at 12 QP. Shield of Arrav doesn't count: it needs two accounts.

## By value

Quests ranked by the training they skip after the planned route. The route quests (Waterfall, Holy Grail, Priest in
Peril, Restless Ghost, Imp Catcher, Druidic Ritual) already take Attack and Strength to 83, Defence to 85 and Prayer to
83. So a further lump in those skills skips only the top bands, and the lumps can overlap past 99. Value is the XP
that lands below 99 on top of that baseline (shown as levels from it), weighed by how slow the skill trains and by the
unlock, against the burden in the table. Excluded: Shield of Arrav and the quests that need it (two accounts).

1. **Dragon Slayer**: Strength 83 -> 95 and Defence 85 -> 96 (932,500 XP lands); rune platebody and green d'hide body;
   the 32-QP set above opens it. The burden is Elvarg 83 with the anti-dragon shield and Melzar's Maze.
2. **The Knight's Sword**: Smithing 1 -> 82 (318,125) for a short F2P quest with no fight; needs only Mining 10.
3. **Digsite**: Mining 1 -> 85 (382,500) and Herblore 28 -> 57; no fight; boostable Thieving 25, Agility 10, Herblore 10.
4. **The Fremennik Trials**: ten skills to 60 (703,100 XP), and Rellekka (stalls, furnaces, shops, the longship to
   Miscellania); Woodcutting 40, Crafting 40, Fletching 25; Draugen 69 and Koschei.
5. **Temple of Ikov**: Ranged 1 -> 79 and Fletching 1 -> 75 (462,500); Thieving 42 and Ranged 40 base (yew bow and ice
   arrows for the Fire Warrior 84).
6. **Eadgar's Ruse**, with Death Plateau and Troll Stronghold on the way: Herblore 28 -> 80 (275,000), the skill
   costliest to buy, plus the Trollheim Teleport; Herblore 31 base, Agility 15, Troll General 113.
7. **The Grand Tree**: Agility 1 -> 75 (197,500), Attack 83 -> 95, Magic 44 -> 61; spirit tree and gliders. The burden is a
   Black demon 172. It is half the Monkey Madness gate.
8. **Watch Tower**: Magic 44 -> 85 (382,500) and the Watchtower Teleport; many small boostable gates (Agility 18 at the
   start, Mining 40); Gorad 68.
9. **Elemental Workshop**: Crafting and Smithing 1 -> 69 (250,000) for a short quest; three level-20 checks and an earth
   elemental 35.
10. **Monkey Madness**, after Tree Gnome Village and The Grand Tree: the largest lump, with 2.5M XP landing (Attack,
    Defence, Strength, Hitpoints to 96-99). The burden is Tree Gnome Village's warlord 112, the Grand Tree's demon 172 and
    the Jungle demon 195.

Next: Regicide (Agility 1 -> 83 and the dragon halberd, but behind Plague City, Biohazard and Underground Pass), Troll
Romance (Agility 1 -> 75), The Tourist Trap (two skills to 68), Sea Slug (Fishing 1 -> 74), Tai Bwo Wannai Trio,
Horror from the Deep (needs all four elemental spells, probably Barcrawl). Haunted Mine's 550,000 Strength mostly
overflows once Dragon Slayer is done; its value is then the salve amulet. Fight Arena, Tree Gnome Village, Vampire
Slayer and Scorpion Catcher add only top bands to Attack or Strength.
