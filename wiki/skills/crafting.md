# Crafting

Crafting covers a wide range of item creation: pottery, leather armour, jewelry, glass items, bowstrings, holy symbols, and battlestaves.

## Pottery

| Item | Level | XP | Process |
|------|-------|----|---------|
| Pot | 1 | 6.3 (+6.3 shaping) | Soft clay → Potter's wheel → Pottery oven |
| Pie dish | 7 | 10 (+15 shaping) | Soft clay → Potter's wheel → Pottery oven |
| Bowl | 8 | 15 (+18 shaping) | Soft clay → Potter's wheel → Pottery oven |

- **Materials:** Mine clay (Mining 1: Varrock SE mine (3180, 3372), Rimmington (2986, 3239)), use a bucket, jug or bowl of water on it to soften. Bucket costs 2 gp at the Lumbridge General Store. [v 2026-10-10 conductor2w2 local]
- **Water sources:** watersource locs (sink, sink2, mortton_sink, fountain, goldfountain) fill a Bucket, Jug, Vial or Bowl, one container per use; wells (well, desertwell) take only a Bucket (`general_use/scripts/water_sources.rs2`, `configs/water_sources.loc`). Message "You fill the <container> from the <source>.". Quest locs named Fountain/Well are not water sources ("nothing interesting happens"): `quest_priestperil/priestperil.loc:374`, `quest_upass/upass.loc:482`, `quest_haunted/quest_haunted.loc:27`.
  - Lumbridge castle courtyard fountain (3221, 3210): 10 buckets in 8.4 s. Falador park fountain (3038, 3353): 4 buckets, a 52 s walk from the Barbarian Village wheel; Barbarian Village has no water source. [v 2026-10-11 conductor2w5 local]
  - Unverified (task description only): Varrock sink (3146, 3451), Varrock fountains (3190, 3468), Lumbridge sink (3205, 3215), Lumbridge well (3142, 3208).
- **Containers:** a Jug softens clay like a Bucket, and `fill` fills Jugs. General stores stock only 2 Buckets + 2 Jugs each (`learnings/shops.md`). Rimmington General Store (2947, 3217) is next to the Rimmington clay (2986, 3239). [v 2026-10-11 conductor2 local]
- **Loop (plan `conductor/plans/pottery-craft.ts`):** 8 containers + 8 clay per trip, fill at the Falador fountain, wheel and oven at Barbarian Village. One loop took Crafting 1 -> 23, the next 23 -> 35 (11,002 xp, ~6.5k xp per loop). Per clay: pot 12.6 xp x25, bowl 33 xp x25 (bowl needs Crafting 8). Falador East bank (3013, 3355) is the practical bank between fountain and Rimmington. The fountain fill failed once with "no water source in view" on arrival; a re-run worked. [v 2026-10-11 conductor2 local]
- **Location:** Barbarian Village potter's wheel (3087, 3409) and pottery oven (3084, 3407), ground floor, no gate, no stairs. [v 2026-10-10 conductor2w2 local]
- **Unusable wheels:** soft clay on the two East Ardougne wheels (2595, 3321) and (2595, 3324) and on the Digsite wheel (3358, 3332) gives "I can't reach that!": a wheel is used only from the side its `forceapproach` names, and there that tile is a wall, a table or a closed-in nook (`wiki/services/pottery-wheel.md` lists them unreached). [v 2026-10-19 t9check1 local]
- **Softening:** one soft clay per use, message "You now have some soft workable clay."; the container returns empty. The player is then delayed (`p_delay(1)`, pottery.rs2), so any send in that tick is silently dropped: wait for the message before the next action. [v 2026-10-10 conductor2w2 local]
- **Wheel make menu:** one item per pick. At the oven a cracked pot is a normal outcome; the item is removed either way and XP is given only for the success (pottery.rs2). Firing needs no level.
- **XP here:** shaping XP is the struct's `processexp` (at the wheel), firing is `productexp` (at the oven). Pot 6.3/6.3, pie dish 15 shape/10 fire, bowl 18 shape/15 fire, times 25 locally. Observed: 7 pots (shape + fire) gave 2,205 Crafting XP, level 1 -> 16, in 64 s. [v 2026-10-10 conductor2w2 local]
- Start of that run: 4 soft clay, 3 clay, 3 buckets of water at (3090, 3409).

## Leather

| Item | Level | Leather Type |
|------|-------|-------------|
| Leather gloves | 1 | Normal leather |
| Leather boots | 7 | Normal leather |
| Leather body | 14 | Normal leather |
| Leather chaps | 18 | Normal leather |
| Hardleather body | 28 | Hard leather |
| Leather vambraces | 11 | Normal leather |
| Leather cowl | 9 | Normal leather |
| Coif | 38 | Normal leather |
| Studded body | 41 | Studded leather (add steel studs) |
| Studded chaps | 44 | Studded leather (add steel studs) |
| Green d'hide body | 63 | Green dragonhide |
| Blue d'hide body | 71 | Blue dragonhide |
| Red d'hide body | 77 | Red dragonhide |
| Black d'hide body | 84 | Black dragonhide |

- **Materials:** Cow hide → Tannery in Al Kharid (toll gate), thread + needle
- **Dragonhide:** Obtained from killing dragons, tanned into leather

## Gems

Cut uncut gems with a chisel to increase value. Used in jewelry.

| Gem | Level |
|-----|-------|
| Opal | 1 |
| Jade | 13 |
| Red topaz | 16 |
| Sapphire | 20 |
| Emerald | 27 |
| Ruby | 34 |
| Diamond | 43 |
| Dragonstone | 55 |

## Jewelry

Smelt a gold bar with a mould at a furnace. Gems can be added for bonus stats.

| Item | Level | Mould | Gem |
|------|-------|-------|-----|
| Gold ring | 5 | Ring mould | None |
| Sapphire ring | 20 | Ring mould | Sapphire |
| Gold necklace | 6 | Necklace mould | None |
| Sapphire necklace | 20 | Necklace mould | Sapphire |
| Gold amulet (u) | 8 | Amulet mould | None |
| Sapphire amulet | 24 | Amulet mould | Sapphire |
| Emerald ring | 27 | Ring mould | Emerald |
| Emerald necklace | 29 | Necklace mould | Emerald |
| Emerald amulet | 31 | Amulet mould | Emerald |
| Ruby ring | 34 | Ring mould | Ruby |
| Ruby necklace | 40 | Necklace mould | Ruby |
| Ruby amulet | 50 | Amulet mould | Ruby |
| Diamond ring | 43 | Ring mould | Diamond |
| Diamond necklace | 56 | Necklace mould | Diamond |
| Diamond amulet | 70 | Amulet mould | Diamond |
| Dragonstone ring | 55 | Ring mould | Dragonstone |
| Dragonstone necklace | 72 | Necklace mould | Dragonstone |
| Dragonstone amulet | 80 | Amulet mould | Dragonstone |

- Amulets need to be strung with wool before wearing or enchanting.

## Holy & Unholy Symbols

| Item | Level | Materials |
|------|-------|----------|
| Holy symbol | 16 | Silver bar + Holy mould → Furnace |
| Unholy symbol | 17 | Silver bar + Unholy mould → Furnace |

- String with wool, then get blessed by Brother Jered at the Monastery (31 Prayer required).

## Glassmaking

1. Heat seaweed → Soda ash
2. Combine soda ash + bucket of sand at furnace → Molten glass
3. Use glass-blowing pipe on molten glass

- Glassblowing levels: beer glass 1 (17.5 XP), vial 33 (35), unpowered orb 46 (52.5); melting glass 20 XP.
- **Seaweed:** Big net fishing or Entrana Island
- **Sand:** Bucket from sandpit
- **Glass-blowing pipe:** Entrana

## Bowstrings

Spin flax on a spinning wheel (a ground-level wheel at (3081, 3430) in Barbarian Village is unverified) to create bowstrings (level 10, 15 XP each; wool to ball of wool needs no level, 2.5 XP). Useful for Fletching.

- **Seers' Village loop (plan `conductor/plans/flax-spin.ts`; tasks `pick`, `spinning`):** pick flax in the field (2732-2755, 3433-3456; area (2743, 3445) r10; 3 in 16 picks remove the plant until it respawns), climb the ladder at (2715, 3470) (stand (2714, 3470) on both floors) to the spinning wheel at (2711, 3471) on level 1, spin all 28 (Make X), bank at the Seers bank (2727, 3494) on level 0. 375 XP per bow string at 25x. About 300 ticks per 28 strings: walk to the wheel 26-32, spin 97-118 (each level-up stops the spin queue and it is restarted), bank 31, walk back 33, pick 88 (3.1 ticks per flax). Crafting 43 -> 61 in 10 min, +51,000 XP (~306k XP/h; 315-340k once level-ups thin out). [v 2026-10-16 conductor2w1 local]
- **Crafting 1-80 plan `conductor/plans/crafting80.ts`:** 55.8 min, +267,375 XP (RESULT done "reached Crafting level 80"). Shears + 5 Wool from the bank; two shear phases at the Ardougne sheep with `interact` `npcId: 43` (skips shorn sheep; 13 + 2 runs, 18 wool, ~100 s); spin wool at the Gnome Stronghold wheel to Crafting 10 (+1,125 XP, 57 s); then 27 flax laps (pick, spin bow strings, bank, walk down to the field): pick 960 s, spin 1,207 s (+266,250 XP), bank 418 s (26 trips), descend 304 s. ~332k XP/h in the loop; time split spin 42%, pick 33%, bank 14%, descend 11%. [v 2026-10-24 conductor3 local]
- **Wool (shearing):** Sheep have no Shear option; use Shears on the Sheep (interact task: target npc + `use`). Message "You get some wool."; about 2.8 s per wool; "The sheep manages to get away" about 1 in 4 tries. Sheep stand at the stile north of Ardougne (2647, 3375) and in the field beyond it (2650, 3372). A shorn sheep keeps the name "Sheep" but becomes NPC type 42 (`sheepsheered`) for 100 ticks, then regrows; a woolly one is type 43 (`sheepunsheered`); shears on a shorn one say "This sheep has already been shorn." (`shear_sheep.rs2`), so target id 43, not the name. Shears: [Khazard General Store](../shops/khazard-general-store.md), 1 gp. [v 2026-10-23 conductor3 local]
- **Gnome Stronghold wheel platform (2476, 3398, level 1):** travel cannot path off it: first `interact` the Staircase at (2475, 3400) to leave the platform, then `travel` works. A `travel` phase from Ardougne does reach the platform. [v 2026-10-23 conductor3 local]
- **Ardougne sheep field reach:** an interact `at` tolerance of 12 skips the stile crossing, so the bot stands outside the fence and every sheep is unreachable; use `at` (2653, 3367) inside the field with tolerance 2. [v 2026-10-23 conductor3 local]

## Battlestaves (Members)

1. Make an unpowered orb (glassmaking)
2. Enchant at the appropriate obelisk (requires high Magic)
3. Attach to a battlestaff

| Staff | Crafting Level | Magic Level |
|-------|---------------|-------------|
| Water battlestaff | 54 | 56 |
| Earth battlestaff | 58 | 60 |
| Fire battlestaff | 62 | 63 |
| Air battlestaff | 66 | 66 |

## Crafting Guild

- **Location:** West of Port Sarim, north of Rimmington
- **Requirement:** 40 Crafting + Brown apron equipped
- **Features:** Pottery oven, wheels, spinning wheels, gold/silver rocks, tanner

Levels checked against `server/content/scripts/skill_crafting/configs/{leather/leather.dbrow,studded/studded.struct,gem/gem.dbrow,jewellery/jewellery.struct,pottery/pottery.struct,battlestaves/battlestaves.struct,glass/glass.struct,spinning/spinning.struct}` (XP there is in tenths). Studded body and sapphire necklace were wrong and are fixed; all other levels in this page match. Pottery XP column is the firing XP; Magic levels for staves and the guild/process notes are unchecked. [v 2026-10-09 conductor1 local]
