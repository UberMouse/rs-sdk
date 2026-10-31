# Eadgar's Ruse

Status: not completed. The draft plan reached the Stronghold prison but not the kitchen; two worker deaths on the Thrower Troll ridge ended the attempt. Requirements and reward are in the [README](README.md) row.

## Start save

`lib:eadgars-ruse-start`: Burthorpe (2897,3531); Att/Str/Def/HP 85, Prayer 99, Agility 30, Herblore 31; rune kit and climbing boots; varps 80=3 (Druidic Ritual stage 3), 314=80, 315=201326600, 317=50, 318=63 (bit 0 of 318 is troll_freed_eadgar). Pack: Drunk parrot, 2 Logs, Tinderbox, Pestle and mortar, Unfinished potion (Ranarr, id 99), 5 Raw chicken, 10 Grain, 6 Swordfish. Six swordfish is too little food for the trips. [v 2026-10-31 questw2 local]

- The promoted [Troll Stronghold](troll-stronghold.md) plan frees only Godric (varp 318 = 62); an account that ran it must free Eadgar first. [v 2026-10-31 questw2 local]

## Route facts

- Sanfew (2897,3426) is upstairs (L1). The talk task climbs the stairs, but a `travel` from there needs `level: 0` or it fails "No path". [v 2026-10-31 questw2 local]
- The walker's route from Taverley north takes the Death Plateau path east along z 3604 past the Thrower Trolls (2851-2878,3598-3601), about 45 hp, and uses death_climbingrocks (2880,3594). The route that avoids it: Burthorpe, hut, stile, secret path, rocks (2857,3612). [v 2026-10-31 questw2 local]
- From the rocks the walker goes (2859,3626), (2878,3623), the pass cave (2903,3644) to (2906,10036), out at (2908,3654), rocks (2910,3687), shortcut rocks (2885,3684), thistle plateau (2891,3676); the pass exit to the plateau took 41 s. [v 2026-10-31 questw2 local]
- Hazard on that last leg: Thrower Trolls at (2886-2902,3696-3700) and Mountain Trolls at (2904-2909,3641-3642); see [hazards](../../learnings/hazards.md). The pass exit to the plateau cost about 17 hp without prayer; with Protect from Missiles on it cost 0 hp and 20 prayer points (99 to 79). [v 2026-10-31 questw2 local]
- Secret Door at (2827,3647): with troll_quest = 50 it opens straight into the Stronghold prison at (2823,10050) L0. [v 2026-10-31 questw2 local]
- The walker has no connectors for the Stronghold's custom "Stone Staircase" stairs. Any `at` inside the Stronghold on another level routes out the Exit and around the mountain past the Thrower Trolls. Inside, drive the stairs with `interact` (tile adjacent, no `at`) after a `travel` within one level. [v 2026-10-31 questw2 local]
- Eadgar's cave entrance (2892,3672) needs troll_freed_eadgar (bit 0 of varp 318); without it the entrance lands on level 0. Free Eadgar with Berry's Cell key 2 at cell (2832,10082). [scripts: unverified in game]

## Stronghold layout (scripts, unverified in game)

- Stone Staircase Climb-up at (2852,10061) L0, (2842,10051) L1, (2852,10106) L0, (2842,10108) L1; Climb-down at (2852,10061) L1, (2843,10051) L2, (2852,10107) L1, (2843,10108) L2.
- Cave exit (2892,10072) L2; Eadgar (2890,10086) L2.
- Kitchen with Burntmeat (2844,10057) L1, beside the (2852,10061) stairs; kitchen drawers (2852,10049) and (2854,10049) L1.
- Storeroom door (2869,10085) L0; Goutweed crates (2856,10074) and (2857,10074) L0; sleeping guard (2857,10075); Rack (2828,10096) L0.
- troll_quest >= 30 makes the prison door (2848,10107) L1 free to pass.

## Quest mechanics (scripts, unverified in game)

- Tegid (2913,3417) hands out the Dirty robe only at stage 70.
- The potion needs Herblore 31 and the Ranarr unfinished potion; the thistle dries only on a fire, not a range; mixing works only at stage 80.
- The parrot cannot be re-caught after stage 50.
- Taking goutweed knocks the player out (0-6 damage) and teleports them to (2865,10088) L0 inside the storeroom; the door (2869,10085) lets you out when you stand on its tile.
- The quest makes about 8 trips between the cave plateau and the Stronghold.
