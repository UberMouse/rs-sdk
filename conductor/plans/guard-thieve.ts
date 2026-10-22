// Pickpocket Falador guards; food and coins at Falador East (one account-wide bank).
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import thieving from '@conductor/tasks/thieving';

const area = { x: 3006, z: 3321, radius: 8 };
const bankArea = { x: 3013, z: 3355, radius: 5 };
const food = /^(trout|salmon)$/i;

export default definePlan({
    name: 'guard-thieve',
    method: 'guard-falador-pickpocket',
    description: 'Falador guards with Trout/Salmon, banked at Falador East when food runs out',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            bank,
            {
                area: bankArea,
                depositAllExcept: [],
                withdraw: [
                    { item: 'Salmon', count: 14, upTo: true },
                    { item: 'Trout', count: 14, upTo: true },
                ],
            },
            { name: 'restock', when: v => v.inv(food) === 0 },
        ),
        phase(
            thieving,
            { npc: 'Guard', area, food: ['Trout', 'Salmon'], eatBelow: 0.6 },
            { when: v => v.inv(food) > 0 },
        ),
    ],
});
