# Ships (Port Sarim, Karamja, Entrana, Brimhaven, Ardougne)

No walk takes a ship (`conductor/lib/walk-graph.ts`), and gangplanks are left out of the climb table, so each crossing is a plan of two catalog phases. Quest pages that need a ship link here.

Recipe per crossing (committed in 539323a31, smoke itest 3/3 passing): a `talk` phase with `travels:true` (done on arrival; fails "no journey followed the talk with <npc> (fare unpaid, or weapons or armour refused?)"), then an `interact` Cross on the deck gangplank picked by `tile`. `travels` is refused together with `continue`, and without an `npc`. The ship lands the player on the destination deck at level 1, so a plan keys the disembark phase on `level === 1`. [v 2026-10-23 questw4 local]

## Routes

| Route | Fare | talk params | Arrives (L1) | Gangplank tile (L1) | Quay |
|---|---|---|---|---|---|
| Port Sarim -> Musa Point | 30 | `{npc:"Captain Tobias", at:{x:3028,z:3216,tolerance:3}, choices:["Yes please"], travels:true}` | (2956,3143) | (2956,3144) | ~(2956,3146) |
| Musa Point -> Port Sarim | 30 | `{npc:"Customs officer", choices:["Can I journey","Search away","^Ok"], travels:true}` | (3032,3217) | (3031,3217) | ~(3029,3217) |
| Port Sarim -> Entrana (members world only) | free | `{npc:"Monk of Entrana", at:{x:3047,z:3236,tolerance:2}, choices:["Yes, okay"], travels:true}` | (2834,3331) | (2834,3333) | |
| Entrana -> Port Sarim | free | `{npc:"Monk of Entrana", at:{x:2835,z:3336,tolerance:2}, choices:["Yes, I'm ready"], travels:true}` | (3048,3231) | (3048,3232) | |
| Ardougne -> Brimhaven | 30 | `{npc:"Captain Barnaby", at:{x:2679,z:3275,tolerance:3}, choices:["Yes please"], travels:true}` | (2775,3234) | (2774,3234) | (2772,3234) |
| Brimhaven -> Ardougne | 30 | `{npc:"Customs officer", at:{x:2772,z:3228,tolerance:3}, choices:["Can I journey","Search away","^Ok"], travels:true}` | (2683,3268) | (2683,3269) | |

Gangplank phase: `interact {target:"loc", name:"^Gangplank$", option:"Cross", tile:{x,z,level:1}}`. All rows verified both ways. [v 2026-10-23 questw4 local]

## Script facts (server/content/scripts/)

- Captain Tobias, Seaman Thresnor (3026,3217) and Seaman Lorris (3028,3221) share the `_sailor` dialog: 30 coins, no search (`areas/area_port_sarim/scripts/sailors.rs2`). After speaking to Oziach the dialog adds "I'd rather go to Crandor Isle", which the sailor refuses. Captain Barnaby uses the same `karamja_sailor_dialogue` label at 30 coins. Captain Shanks (Shilo/Cairn) needs a ticket (untested).
- Customs officer (`areas/area_karamja/scripts/customs_officer.rs2`): the route follows the officer's x (below 2815: Brimhaven -> Ardougne, otherwise Karamja -> Port Sarim). 30 coins. He confiscates karamja_rum. `%hunt >= 2` skips the search.
- Monk of Entrana (`areas/area_port_sarim/scripts/monk_of_entrana.rs2`): the Port Sarim one (shipmonk, ~(3047,3235)) works only on members worlds. `has_entrana_restricted_items` refuses any carried or worn item in these categories: armour (hands, helmet, body, legs, shield, cape, godcape), staff, all melee weapon types, axes and pickaxes, bows, crossbows, javelins, thrown weapons, cannon parts. A refusal ends the dialog with no sail. The way back is the Entrana dock monk (shipmonk2, ~(2835,3335)), free. All four monks are named "Monk of Entrana"; the nearest reachable is chosen.
- Sailing delay: 14 ticks back from Entrana, 13 out, 7 on the sailors' routes.
- Arrival (`interface_boat/scripts/sail.rs2`): the sail proc closes the interface and shows a message box "The ship arrives at <place>." The deck gangplank is the `*_off` loc at level 1. Cross teleports 1 tile, then telejumps down a level and 2 tiles onto the quay (`general_use/scripts/gangplank.rs2`). The dock `*_on` gangplank is a free teleport onto the deck that says to speak to the sailor first; nothing needs it.
- The Merlin's Crystal crate lands the player inside the dialog script (`p_telejump` in `quest_arthur.rs2`), so `talk continue` needs no journey wait.
