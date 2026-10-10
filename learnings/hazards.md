# Hazards

Places and NPCs that kill or rob a low-level bot. Each row says when it stops mattering, so the
conductor can tell whether a spot is safe for the bot's current combat level.

| Hazard | Where (x, z) | Danger | Safe from | Verified |
|---|---|---|---|---|
| Giant rats (combat 3–6) | Lumbridge trees, around (3186, 3223) | a combat-3 bot with nothing equipped, idle there between runs, died to one in ~17s and dropped its axe; `wiki/npcs/giant-rat.md` says not aggressive, and how the fight started is unconfirmed. A 3-minute active woodcutting run there (combat 3, HP 10) saw no attack. Don't leave a low-level bot idle here | combat ~10 (estimate) | 2026-10-09 conductor1 local |
| Level-2 NPCs (Giant spider confirmed) near Lumbridge general store | around (3209–3213, 3240), on walks through there (north-east out of Lumbridge; between the firemaking field at (3230, 3240) and the Lumbridge trees) | attack unarmed combat-3 bots (Attack 1, nothing wielded) in transit. Seen twice: at (3213, 3240) a level-2 NPC (unidentified) made the `under-attack` guard fail a mining run (0 damage, the fight ended by itself after 40 ticks); at (3209, 3240) a Giant spider attacked a woodcutting run walking back to the trees, whose guard fought it for ~40 ticks (the bot's combat target was the spider, whose HP it wore down) and then carried on chopping, the bot losing 2 HP. Men and Rats are also nearby. Wield a weapon (or train a little combat) before long walks from Lumbridge. A combat-20 bot (Bronze sword + Wooden shield wielded) walked from the chicken coop (~3231, 3299) to the SE Varrock mine unattacked | combat ~20 (one unattacked walk) | 2026-10-10 conductor2, integration-tests local |
| Dark wizards | Draynor willows, spawns around (3084, 3236) and (3085, 3238) | aggressive, cast magic | combat ~20 | unverified (from `learnings/woodcutting.md`) |
| Wilderness | north of Edgeville / Varrock (z > 3520) | other players and aggressive NPCs; items lost on death | never for an unattended bot | unverified |
