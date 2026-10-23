// Pickpocket Knights of Ardougne with swordfish/tuna from the bank; coins and food at Ardougne South.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import thieving from '@conductor/tasks/thieving';
import travel from '@conductor/tasks/travel';
import type { PlanView } from '@conductor/lib/plan';

const area = { x: 2659, z: 3308, radius: 20 };
const bankArea = { x: 2657, z: 3285, radius: 4 };
const food = /^(swordfish|tuna|salmon|trout)$/i;
const px = (v: PlanView): number => v.state.player?.worldX ?? 0;
const nearArdougne = (v: PlanView): boolean => px(v) < 2720;
const bankFood = (v: PlanView): number =>
    (v.bank('Swordfish') ?? 0) + (v.bank('Tuna') ?? 0) + (v.bank('Salmon') ?? 0) + (v.bank('Trout') ?? 0);

export default definePlan({
    name: 'knight-thieve-bankfood',
    method: 'knight-ardougne-pickpocket',
    description: 'Knights of Ardougne with banked swordfish/tuna; coins banked at Ardougne South',
    until: v => v.level('Thieving') >= 99,
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            thieving,
            { npc: 'Knight of Ardougne', area, food: ['Swordfish', 'Tuna', 'Salmon', 'Trout'], eatBelow: 0.6 },
            { when: v => v.inv(food) > 0 && nearArdougne(v), until: v => v.inv(food) === 0 },
        ),
        phase(
            bank,
            {
                area: bankArea,
                deposit: [{ item: 'Coins' }],
                withdraw: [
                    { item: 'Swordfish', count: 16, upTo: true },
                    { item: 'Tuna', count: 8, upTo: true },
                ],
            },
            {
                name: 'restock',
                when: v =>
                    nearArdougne(v) && v.inv(food) === 0 && (v.bank('Swordfish') === undefined || bankFood(v) > 0),
            },
        ),
        phase(
            travel,
            {
                to: { x: 2659, z: 3290 },
                tolerance: 6,
                waypoints: [
                    { x: 2800, z: 3440 },
                    { x: 2725, z: 3485 },
                ],
            },
            { name: 'to-ardougne', when: v => !nearArdougne(v) },
        ),
    ],
});
