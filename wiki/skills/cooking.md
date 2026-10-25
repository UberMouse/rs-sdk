# Cooking

Cooking prepares raw food into edible items that restore hitpoints. Use raw food on a stove/range or campfire.

## Food Table

| Level | Food | Heals | XP |
|-------|------|-------|----|
| 1 | Cooked meat | 3 | 30 |
| 1 | Shrimp | 3 | 30 |
| 1 | Bread | 4 | 40 |
| 1 | Sardine | 4 | 40 |
| 5 | Herring | 5 | 50 |
| 10 | Mackerel | 6 | 60 |
| 10 | Redberry pie | 6 (2 bites) | 78 |
| 15 | Trout | 7 | 70 |
| 1 | Anchovies | 3 | 30 |
| 18 | Cod | 7 | 70 |
| 20 | Pike | 8 | 80 |
| 20 | Meat pie | 8 (2 bites) | 110 |
| 25 | Salmon | 9 | 90 |
| 25 | Stew | 9 | 117 |
| 30 | Chompy bird | 10 | 100 |
| 30 | Tuna | 10 | 100 |
| 30 | Apple pie | 10 (2 bites) | 130 |
| 35 | Wine | 15 | 110 |
| 35 | Pizza | 10 (2 bites) | 143 |
| 40 | Lobster | 12 | 120 |
| 40 | Cake | 12 (3 bites) | 180 |
| 43 | Bass | 13 | 130 |
| 45 | Swordfish | 14 | 140 |
| 45 | Meat pizza | 14 (2 bites) | 26 |
| 50 | Chocolate cake | 15 (3 bites) | 30 |
| 50 | Oomlie wrap | 14 | 30 |
| 53 | Lava eel | 14 | 140 |
| 1 | Ugthanki kebab | 19 | 12 |
| 60 | Curry | 19 | 280 |
| 65 | Pineapple pizza | 20 (2 bites) | 45 |
| 80 | Shark | 20 | 210 |
| 82 | Sea turtle | 20 | 211.3 |
| 91 | Manta ray | 22 | 216.3 |

Levels and XP checked against `server/content/scripts/skill_cooking/configs/cooking_source/cooking_generic.dbrow` (experience is in tenths), `cooking_inv/configs/pizza/pizza.struct` and `cooking_inv/scripts/{cakes,wine,ugthanki_kebab,oomlie_bird_meat}/*.rs2`. [v 2026-10-09 conductor1 local]
Pizza/cake/kebab/wrap rows give the XP of the step at that level (pizza 143 at 35 is the cooking step; meat/anchovy/pineapple toppings add 26/39/45 at 45/55/65; chocolate cake step 30 at 50; kebab and wrap-making steps are separate). Chompy bird, Heals column and non-fish food rows not checked.

## Cooking Methods

| Method | How |
|--------|-----|
| Meat/Fish | Use raw item on range or fire |
| Bread | Mix flour + water → dough → cook on range |
| Stew | Bowl of water + cooked meat + potato → cook on range |
| Pizza | Flour + water → dough → tomato → cheese → cook → add topping |
| Cake | Flour + egg + milk → cake tin → cook on range |
| Wine | Grapes + jug of water |
| Curry | Bowl of water + cooked meat + spice → cook on range |
| Pies | Pastry dough + pie dish + filling → cook on range |

## Cooking Guild

- **Location:** Northwest of Varrock
- **Requirement:** 32 Cooking + Chef's hat equipped
- **Features:** Flour mill, water supply, stoves, apples, chocolate

## Verified training spots

| Spot | Centre (x, z) | Level | Notes | XP/hr | Verified |
|---|---|---|---|---|---|
| Lumbridge Range | (3230, 3196) | 1 | south of Bob's Brilliant Axes; reachable from x 3231 and from (3230,3195), not from the west tiles (3229,3195..3197): from the west the cooking task walks round to it. Not the quest-gated castle "Cooking range" | - | 2026-10-11 conductor2w3 local |
| Lumbridge general store Cooking pot | (3232, 3238) | 1 | open ground, no side caveat; 7 shrimps in 16 s; cooking area radius 6. Burns very few salmon/trout at Cooking 60-83 (Cooking +227,500 xp in 18 min alongside lure fishing) | ~210k xp/hr in the lure-cook-bank plan | 2026-10-11 conductor2 local |
| Catherby range (swordfish) | (2817, 3444) | 45 | plan `conductor/plans/catherby-swordfish.ts` cooks the fill at the range (53 s for 26 swordfish), banks at (2809, 3443). Cooking 71->99 in plan runs (95->99 was +262,500 XP in 186 s of cooking-phase time; at Cooking 99 skip the range and bank raw fish). See [fishing](fishing.md) | ~5.1M xp/hr of cooking-phase time at 95-99 (swordfish/tuna); ~840k xp/hr plan total in the 1020 s run | 2026-10-23 conductor3 local |

## Notes

- Ranges burn food less often than campfires.
- Higher cooking level = lower burn rate.
- You can deliberately burn food but gain no XP for doing so.
