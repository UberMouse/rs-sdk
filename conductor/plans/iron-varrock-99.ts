// Mining to 99 on the SE Varrock iron (dropped as mined), adamant pickaxe from the Falador West bank.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import mining from '@conductor/tasks/mining';

export default definePlan({
    name: 'iron-varrock-99',
    description: 'Adamant pickaxe from the Falador West bank, SE Varrock iron (dropped) to Mining 99',
    method: 'iron-se-varrock-drop',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    until: v => v.level('Mining') >= 99,
    phases: [
        phase(
            mining,
            { rock: 'iron', onFull: 'drop', area: { x: 3286, z: 3369, radius: 4 } },
            {
                name: 'iron',
                when: v => v.inv('Adamant pickaxe') > 0,
                until: v => v.level('Mining') >= 99,
            },
        ),
        phase(
            bank,
            {
                area: { x: 2947, z: 3367, radius: 6 },
                depositAllExcept: ['Dusty key', 'Coins'],
                withdraw: [{ item: 'Adamant pickaxe', count: 1 }],
            },
            { name: 'get-pickaxe', when: v => v.inv('Adamant pickaxe') === 0 },
        ),
    ],
});
