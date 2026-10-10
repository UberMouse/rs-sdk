// Chop the Lumbridge trees until the inventory is full, burn the logs in the field east of the
// general store, and go back to chopping (spots: wiki/skills/woodcutting.md, firemaking.md).
// Firemaking sits above woodcutting so a plan started on a full inventory of logs burns them first.
import { definePlan, phase } from '@conductor/lib/plan';
import firemaking from '@conductor/tasks/firemaking';
import woodcutting from '@conductor/tasks/woodcutting';

export default definePlan({
    name: 'chop-burn',
    description: 'Chop normal trees at Lumbridge until full, burn the logs east of the general store; repeat.',
    phases: [
        phase(
            firemaking,
            { logs: 'Logs', area: { x: 3230, z: 3240, radius: 6 } },
            { when: v => v.full && v.inv('Logs') > 0 },
        ),
        phase(woodcutting, { tree: 'tree', onFull: 'stop', area: { x: 3195, z: 3220, radius: 12 } }),
    ],
});
