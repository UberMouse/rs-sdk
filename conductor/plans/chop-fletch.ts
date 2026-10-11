// Burn stray oak logs, fletch the normal logs into arrow shafts (stack, no inventory growth),
// chop Lumbridge trees for more. Ends at Fletching 30.
import { definePlan, phase } from '@conductor/lib/plan';
import firemaking from '@conductor/tasks/firemaking';
import fletching from '@conductor/tasks/fletching';
import woodcutting from '@conductor/tasks/woodcutting';

export default definePlan({
    name: 'chop-fletch',
    description: 'Lumbridge trees -> arrow shafts until Fletching 30',
    until: v => v.level('fletching') >= 30,
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            firemaking,
            { logs: 'Oak logs', area: { x: 3230, z: 3240, radius: 6 } },
            { name: 'burn-oak', when: v => v.inv('Oak logs') > 0 },
        ),
        phase(
            fletching,
            { product: 'arrow shaft', logs: 'Logs' },
            { when: v => v.inv('Logs') > 0 && v.inv('Oak logs') === 0 },
        ),
        phase(woodcutting, { tree: 'tree', onFull: 'stop', area: { x: 3195, z: 3220, radius: 12 } }),
    ],
});
