// Catherby: buy a harpoon (Harry) -> harpoon tuna/swordfish -> cook at the Catherby range -> bank at Catherby.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import cooking from '@conductor/tasks/cooking';
import fishing from '@conductor/tasks/fishing';
import shop from '@conductor/tasks/shop';
import travel from '@conductor/tasks/travel';

const cooked = /^(swordfish|tuna|trout|salmon)$/i;
const rawAny = /^raw /i;
const range = { x: 2817, z: 3443, radius: 5 };
const bankArea = { x: 2809, z: 3441, radius: 3 };

export default definePlan({
    name: 'catherby-swordfish',
    method: 'swordfish-catherby-cook-bank',
    description: 'Harry harpoon -> Catherby harpoon fishing -> range cooking -> Catherby bank',
    until: v =>
        (v.bank('Swordfish') ?? 0) >= 100 &&
        v.level('Fishing') >= 80 &&
        v.level('Cooking') >= 85 &&
        v.inv(cooked) === 0,
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            travel,
            {
                to: { x: 2812, z: 3441 },
                waypoints: [
                    { x: 2650, z: 3295 },
                    { x: 2725, z: 3485 },
                    { x: 2800, z: 3440 },
                ],
            },
            { name: 'to-catherby', when: v => (v.state.player?.worldX ?? 9999) < 2780 },
        ),
        phase(
            shop,
            { npc: 'Harry', at: { x: 2834, z: 3445 }, buy: [{ item: 'Harpoon', count: 1 }] },
            { name: 'buy-harpoon', when: v => v.inv('Harpoon') === 0 && v.inv('Coins') >= 5 },
        ),
        phase(
            bank,
            { area: bankArea, depositAllExcept: ['Harpoon', 'Coins'] },
            { name: 'bank-cooked', when: v => v.inv(cooked) > 0 && v.inv(rawAny) === 0 },
        ),
        phase(
            cooking,
            { food: 'Raw swordfish', area: range, dropBurnt: true },
            { name: 'cook-swordfish', when: v => v.inv('Raw swordfish') > 0, onFail: 'continue' },
        ),
        phase(
            cooking,
            { food: 'Raw tuna', area: range, dropBurnt: true },
            { name: 'cook-tuna', when: v => v.inv('Raw tuna') > 0 },
        ),
        phase(fishing, { method: 'harpoon', onFull: 'stop', area: { x: 2848, z: 3428, radius: 14 } }),
    ],
});
