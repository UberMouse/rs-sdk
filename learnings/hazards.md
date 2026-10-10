# Hazards

Places and NPCs that kill or rob a low-level bot. Each row says when it stops mattering, so the
conductor can tell whether a spot is safe for the bot's current combat level.

| Hazard | Where (x, z) | Danger | Safe from | Verified |
|---|---|---|---|---|
| Giant rats (combat 3–6) | Lumbridge trees, around (3186, 3223) | a combat-3 bot with nothing equipped, idle there between runs, died to one in ~17s and dropped its axe; `wiki/npcs/giant-rat.md` says not aggressive, and how the fight started is unconfirmed. A 3-minute active woodcutting run there (combat 3, HP 10) saw no attack. Don't leave a low-level bot idle here | combat ~10 (estimate) | 2026-10-09 conductor1 local |
| Level-2 NPC near Lumbridge general store | around (3213, 3240), on the walk north-east out of Lumbridge | attacked an unarmed combat-3 bot (Attack 1, nothing wielded, 1 dmg/hit) in transit; auto-retaliate fought for 40 ticks, the `under-attack` guard failed the mining run. The bot took 0 damage and the fight ended by itself. Attacker was a level-2 NPC (Goblin or Imp, unconfirmed); Giant spiders, Men and Rats are also nearby. Wield a weapon (or train a little combat) before long walks from Lumbridge. A combat-20 bot (Bronze sword + Wooden shield wielded) walked from the chicken coop (~3231, 3299) to the SE Varrock mine unattacked | combat ~20 (one unattacked walk) | 2026-10-10 conductor2 local |
| Dark wizards | Draynor willows, spawns around (3084, 3236) and (3085, 3238) | aggressive, cast magic | combat ~20 | unverified (from `learnings/woodcutting.md`) |
| Wilderness | north of Edgeville / Varrock (z > 3520) | other players and aggressive NPCs; items lost on death | never for an unattended bot | unverified |
