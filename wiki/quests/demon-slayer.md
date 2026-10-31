# Demon Slayer

| Detail     | Info       |
|------------|------------|
| Difficulty | Novice     |
| Length     | Medium     |
| Quest Points | 3       |

## Requirements

None.

Recommended: 41+ Combat level.

## Items Needed

- 1 coin
- Bucket
- 25 bones

## Rewards

- Silverlight (demon-slaying sword)

## Walkthrough

1. Speak to the **Gypsy** in **Varrock Square**. Pay her 1 coin for a fortune reading. She reveals that the demon Delrith is being summoned and only Silverlight can defeat him. She tells you the incantation needed.
2. Speak to **Sir Prysin** in **Varrock Palace** about Silverlight. He locked it away and split the key into three parts, each held by a different person.

### Key 1 - Captain Rovin

3. Go to the top floor of Varrock Palace and speak to **Captain Rovin**. Convince him of the demon threat and he gives you his key piece.

### Key 2 - Drain Key

4. Go to the kitchen in Varrock Palace. Fill a **bucket** with water and use it on the **drain** outside the palace (northeast corner). Go into the **Varrock Sewers** (manhole near the palace) and search the area to find the key that washed down.

### Key 3 - Wizard Traiborn

5. Travel to the **Wizard Tower** south of Draynor Village. Speak to **Wizard Traiborn** on the 1st floor. He requires **25 bones** to perform the ritual to recover his key. Bring him the bones.

### Defeating Delrith

6. Return to Sir Prysin with all three key pieces. He gives you **Silverlight**.
7. Equip Silverlight and go to the **stone circle** south of Varrock (near the Dark Wizards).
8. Fight **Delrith**. When his health is depleted, recite the correct **incantation** (given by the Gypsy) to banish him.

## Key NPCs & Locations

| NPC / Location         | Where                                      |
|------------------------|---------------------------------------------|
| Gypsy                  | Varrock Square                               |
| Sir Prysin             | Varrock Palace, ground floor                 |
| Captain Rovin          | Varrock Palace, top floor                    |
| Wizard Traiborn        | Wizard Tower, 1st floor                      |
| Stone circle           | South of Varrock                             |
| Varrock Sewers         | Manhole near Varrock Palace                  |

## Verified route (plan `conductor/plans/demon-slayer.ts`, fresh load of `lib:demon-slayer-start`, done in 472 s)

Save: Varrock square (3216, 3433) ((3213, 3428) is fountain water, no path); Att/Str/Def 60, HP 65, rune armour and scimitar; pack 25 Bones (one per slot); Bucket and 15 Swordfish banked (bones fill the pack; the plan withdraws them at Varrock West after Traiborn). No death, HP 65/65 at the end. Phase seconds: gypsy 32, prysin-keys 36, traiborn-ask 117 (incl. walk to the tower), traiborn-bones 28, bank 91, rovin 40, fill 14, drain 3, sewer-key 33, prysin-sword 28, sword-wait 12, delrith 32, incantation 4. [v 2026-11-01 questw1 local]

- Gypsy Aris (3203, 3424): choices `here you go`, `Very interesting`, `Who.s Delrith`, `How am I meant`, `Where can I find Silverlight`, `Okay, thanks`; demonstart becomes 1. [v 2026-11-01 questw1 local]
- The incantation is fixed, not rolled: "Carlem Aber Camerinthum Purchai Gabindo", option 4 of 4 in Delrith's p_choice4 (`delrith.rs2:19-31`, script; confirmed by the in-game pick). [v 2026-11-01 questw1 local]
- Sir Prysin (3204, 3473): first talk has 6 choices (`Gypsy Aris said`, `find Silverlight`, `crystal ball`, `give me the keys`, `Captain Rovin`, `key hunting`) and sets stage 2. With all 3 keys he needs no choices and hands over Silverlight a few ticks after the dialog closes (inventory lags: gate on the item through a wait phase). [v 2026-11-01 questw1 local]
- Traiborn: NPC name is `Traiborn` (not "Wizard Traiborn"), at (3112, 3162) on level 1 of the Wizards' Tower; `talk at` walks the stairs itself. Choices `need to get a key`, `any keys`, `get the bones`. A second talk with no choices gives the bones; he takes them one per tick after the dialog closes and the Key arrives after the last bone. [v 2026-11-01 questw1 local]
- Captain Rovin (3204, 3496) level 2: `talk at` with level 2 walks up the palace stairs itself. Choices `this is important`, `demon who wants`; works only at stage 2 or later. [v 2026-11-01 questw1 local]
- Kitchen Sink (3224, 3494) and Drain (3225, 3495), both level 0 ("You fill the bucket from the sink."; drain: "Ok, I think I've washed the key down to the sewer."). Both `at`s need `level: 0` explicitly: after Rovin the bot stood at (3223, 3492) on level 2, within x/z tolerance, and the interact never walked down. [v 2026-11-01 questw1 local]
- The washed-down Key lies at (3225, 9897) in the Varrock Sewers; pickup area {3225, 9897, r3} with count 3 works (all three keys are named "Key"). The walker reaches the sewer via the manhole (3237, 3458). [v 2026-11-01 questw1 local]
- Delrith spawns at the stone circle (3229, 3369): combat area {3229, 3369, r10}, exact target `Delrith`. At low HP a dialog opens ("Now what was that incantation again?"); `combat` with `stopOnDialog` ends done, then `talk continue` with the incantation choice finishes the quest. Silverlight must be worn or the attack is refused (`npc_combat.rs2:174-186`, script). Delrith died in ~30 s to Att/Str/Def 60 without eating. [v 2026-11-01 questw1 local]
- Obj ids: Traiborn's key 2399, Rovin's 2400, drain key 2401, Silverlight 2402. [server data, unverified in game 2026-11-01]
