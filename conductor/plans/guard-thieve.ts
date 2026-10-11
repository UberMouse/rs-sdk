// Pickpocket Falador guards with food from the Draynor bank; coins banked once at Falador East when
// the fish run out (a stack of coins takes one slot, so no bank trips in between).
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import thieving from '@conductor/tasks/thieving';

const area = { x: 3006, z: 3321, radius: 8 };
const bankArea = { x: 3013, z: 3355, radius: 5 };
const food = /^(shrimps|anchovies)$/i;

export default definePlan({
    name: 'guard-thieve',
    description: 'Falador guards with Draynor fish, coins banked at Falador East',
    until: v => v.runs('bank-coins') > 0,
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            bank,
            { area: bankArea, depositAllExcept: [] },
            { name: 'bank-coins', when: v => v.runs('fetch-food') > 0 && v.inv(food) === 0 },
        ),
        phase(
            bank,
            {
                area: { x: 3092, z: 3243, radius: 3 },
                depositAllExcept: ['Coins'],
                withdraw: [
                    { item: 'Shrimps', count: 27, upTo: true },
                    { item: 'Anchovies', count: 27, upTo: true },
                ],
            },
            { name: 'fetch-food', when: v => v.runs('fetch-food') === 0 },
        ),
        phase(
            thieving,
            { npc: 'Guard', area, food: ['Shrimps', 'Anchovies'], eatBelow: 0.6 },
            {
                when: v => v.inv(food) > 0,
                until: v => v.runs('fetch-food') > 0 && v.inv(food) === 0,
            },
        ),
    ],
});
