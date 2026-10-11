// Fish at the Draynor net spot, cook at the Lumbridge cooking pot (3232,3238), bank the cooked
// fish at Draynor so every fishing trip starts empty. Ends with 20+ cooked fish in the bank.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import cooking from '@conductor/tasks/cooking';
import fishing from '@conductor/tasks/fishing';

const cooked = /^(shrimps|anchovies)$/i;
const pot = { x: 3232, z: 3238, radius: 5 };

export default definePlan({
    name: 'fish-cook-bank',
    description: 'Draynor net fishing -> pot cooking -> Draynor bank of cooked fish',
    until: v => (v.bank('Shrimps') ?? 0) + (v.bank('Anchovies') ?? 0) >= 20 && v.inv(cooked) === 0,
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            bank,
            { area: { x: 3092, z: 3243, radius: 3 }, depositAllExcept: ['Small fishing net'] },
            { name: 'bank-cooked', when: v => v.inv(cooked) > 0 && v.inv(/^raw /i) === 0 },
        ),
        phase(
            cooking,
            { food: 'Raw anchovies', area: pot, dropBurnt: true },
            { name: 'cook-anchovies', when: v => v.inv('Raw anchovies') > 0, onFail: 'continue' },
        ),
        phase(
            cooking,
            { food: 'Raw shrimps', area: pot, dropBurnt: true },
            { name: 'cook-shrimps', when: v => v.inv('Raw shrimps') > 0 },
        ),
        phase(fishing, { method: 'net', onFull: 'stop', area: { x: 3086, z: 3227, radius: 2 } }),
    ],
});
