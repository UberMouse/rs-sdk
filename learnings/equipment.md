# Equipment progression

Where the next tier of gear comes from. Item stats and full shop stock are in the generated
`wiki/items/` and `wiki/shops/`; this page records what a bot actually has to do to get it.

## Tools

| Item | Requirement | Where | Cost | Verified |
|---|---|---|---|---|
| Bronze axe, bronze pickaxe | — | starter kit after `skipTutorial()` | free | 2026-10-09 conductor1 local |
| Iron, steel axe | none to chop (works from the inventory); Attack 1 / 5 to wield | Bob's Brilliant Axes, Lumbridge (3232, 3203) | 56 / 200 gp | steel axe bought for exactly 200 gp, 2026-10-10 conductor2 local; iron price read from content |
| Black, mithril, adamant, rune axe | none to chop; Attack 10/20/30/40 to wield | no shop sells them; smith mithril/adamant/rune at Smithing 51/71/86 (1 bar); black is not smithable. Adamant axe made by a bot: 1 adamantite ore + 6 coal, Falador furnace, Dwarven Mine anvil (3012, 9813), Hammer in pack ([woodcutting](../wiki/skills/woodcutting.md#axes)) | — | 2026-10-10 conductor2 local, read from content; adamant route 2026-10-24 conductor3 local |
| Iron to rune pickaxe | Mining 1/6/21/31/41 (iron/steel/mithril/adamant/rune) to use; Attack to wield | Nurmof's Pickaxe Shop, Dwarven Mine (2998, 9844); not smithable | 140 / 500 / 1,300 / 3,200 / 32,000 gp | iron 140 gp bought 2026-10-11 conductor2w1 local; adamant 3,200 gp bought 2026-10-11 conductor2 local (Falador mine stairs, no scorpion trouble at combat ~22-24); other tiers read from content |

Wearing a tool frees an inventory slot: a worn adamant pickaxe (wield Attack 31) mines essence with the `mining` task unchanged, and wielding it moves the previous weapon into the inventory (bank it). The catalog has no equip task; the `combat` task with `weapon` set and a phase `until` that the item is worn equips it and stops in under 1 s without fighting. [v 2026-10-16 conductor2 local]

How much each tier speeds up chopping and mining: `wiki/skills/woodcutting.md` (Chop speed) and
`wiki/skills/mining.md` (Mining speed).

## Combat gear

| Slot / tier | Requirement | Where | Cost | Verified |
|---|---|---|---|---|
| Bronze dagger, bronze sword, wooden shield, shortbow + 25 bronze arrows, starter runes | — | starter kit after `skipTutorial()` (in inventory, not equipped) | free | 2026-10-09 conductor1 local |
| Adamant full helm (Defence 30), Mithril platebody (Defence 20), Mithril platelegs (Defence 20) | Defence 30 / 20 / 20 to wear (`levelrequire/scripts/tier30.rs2:27`, `tier20.rs2:24,27`) | `shop` task by NPC name: Peksa (Barbarian Village helmets) helm; Horvik (Varrock) platebody; Louie Legs (Al Kharid) platelegs. | 3,520 / 5,200 / 2,600 gp | all three bought and worn at Defence 40, 2026-10-24 conductor3 local (plan waterfall-armour) |
