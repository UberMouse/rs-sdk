# Fletching

Fletching creates bows, arrows, crossbow bolts, and throwing darts from logs and other materials. Members only.

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Arrow shafts (knife on normal logs), logs chopped nearby | (3224, 3202) knife spawn | 1-17 | 15 shafts per log, ~12 logs/min | ~139k (local, includes early levels) | 2026-10-09 conductor1 local |
| Arrow shafts, Make 10 batches (`fletching` task) | anywhere | 60+ (no level-up breaks) | 15 shafts per log, ~0.8 s per log (20 logs in 26.4 s vs 48.0 s with Make 1) | ~200k (local; 187.5 XP per log (75 tenths x 2.5) at ~45 logs/min, 20-log runs, not a stats.ts figure) | 2026-10-11 conductor2w4 local |
| Headless arrows (feathers on shafts) | anywhere | 17-27 | 1 feather + 1 shaft each, 95 in ~40 s | ~328k (local, includes feather XP) | 2026-10-09 conductor1 local |
| Longbow (u), knife on normal logs | (3224, 3202) knife spawn | 27-34 | one per call, ~2.4 s per log, 16 in 1 min | ~240k (local, 4000 XP in 1 min, not a stats.ts figure) | 2026-10-09 conductor1 local |

## Bow Making

1. Use a knife on logs to cut an unstrung bow
2. Spin flax on a spinning wheel to make a bowstring
3. Use bowstring on unstrung bow to complete it

### Bows

| Bow | Fletching Level (cut/string) | Ranged Level to Wield |
|-----|-----------------------------|-----------------------|
| Shortbow | 5 / 5 | 1 |
| Longbow | 10 / 10 | 1 |
| Oak shortbow | 20 / 20 | 5 |
| Oak longbow | 25 / 25 | 5 |
| Willow shortbow | 35 / 35 | 20 |
| Willow longbow | 40 / 40 | 20 |
| Maple shortbow | 50 / 50 | 30 |
| Maple longbow | 55 / 55 | 30 |
| Yew shortbow | 65 / 65 | 40 |
| Yew longbow | 70 / 70 | 40 |
| Magic shortbow | 80 / 80 | 50 |
| Magic longbow | 85 / 85 | 50 |

## Arrow Making

1. Use a knife on normal logs → Arrow shafts (15 per log); 600 shafts (40 logs) take Fletching 1->30 (7500 XP), and shafts stack [v 2026-10-11 conductor2 local]
2. Use feathers on arrow shafts → Headless arrows
3. Use arrowheads on headless arrows → Finished arrows

### Arrow Types

| Arrow | Fletching Level | Min Bow |
|-------|----------------|---------|
| Bronze | 1 | Any |
| Iron | 15 | Any |
| Steel | 30 | Oak |
| Mithril | 45 | Willow |
| Adamant | 60 | Maple |
| Rune | 75 | Yew |

- Arrowheads can be smithed or purchased.

## Crossbow Bolts

| Step | Fletching Level | XP |
|------|----------------|----|
| Cut opal bolt tips (chisel) | 11 | 1.5 |
| Cut oyster pearl bolt tips (chisel) | 41 | 3.2 |
| Attach opal tips to bolts | 11 | 1.6 |
| Attach pearl tips to bolts | 41 | 3.2 |
| Attach barbed tips to bolts (barbed tips: Ranging Guild) | 51 | 9.5 |

## Throwing Darts

Requires completion of **The Tourist Trap** quest.

1. Smith dart tips from bars
2. Add feathers to tips

Dart types range from Bronze (1 Ranged) to Rune (40 Ranged).

| Dart | Fletching Level | XP |
|------|----------------|----|
| Bronze | 1 | 1.8 |
| Iron | 22 | 3.8 |
| Steel | 37 | 7.5 |
| Mithril | 52 | 11.2 |
| Adamant | 67 | 15 |
| Rune | 81 | 18.8 |

Levels checked against `server/content/scripts/skill_fletching/configs/{cut_logs/cut_logs.dbrow,stringing/bows.dbrow,arrows/arrows.dbrow,bolts/bolts.dbrow,darts/darts.dbrow}` (bow cut/string levels and arrow levels match; bolt-tip levels fixed; dart levels added) and bow wield levels against `server/content/scripts/levelrequire/scripts/tier*.rs2`. XP is in tenths in the dbrows. The Tourist Trap dart requirement and rune dart Ranged 40 are unverified (darts.rs2 only has a todo). [v 2026-10-09 conductor1 local]

## Bows: XP and ticks (server data)

- Real XP is the config's tenths x 2.5 (25x rate). Cut (u) bow per log: willow short 832 / long 1,037, maple 1,250 / 1,457, yew 1,687 / 1,875, magic 2,082 / 2,287; oak long 625 at Fletching 25 (`skill_fletching/configs/cut_logs/cut_logs.dbrow`). Stringing gives the same again (`stringing/bows.dbrow`), so a willow longbow cut + strung is ~2,075 XP per log vs 187.5 for arrow shafts. [server data, unverified in game 2026-10-16]
- Cutting runs one log per 2 ticks in a Make-10 batch (`cut_logs.rs2:83-86,103`); stringing (bow string on an unstrung bow) has no delay or animation (`bows.rs2:35-42`), so the loop is bound by chopping. At Woodcutting 80 with a steel axe, willow (~12 ticks/log) out-earns maple, yew and magic per tick; a willow longbow loop at Seers (trees by the bank (2726, 3495), bow strings from the flax-spin bank) models ~1.05M Fletching XP/h plus ~1,687 Woodcutting XP per log. [model, research 2026-10-16]
- Arrows: 15 per use, instant; XP per arrow bronze 32, iron 62, steel 125, mithril 187.5, adamant 250, rune 312 (+25 per headless arrow). Darts: 10 per use, instant, 45-470 XP each (`darts.dbrow`), tips smithed 10 per bar. Both are bound by tip/bar supply, not clicks. [server data, unverified in game 2026-10-16]

