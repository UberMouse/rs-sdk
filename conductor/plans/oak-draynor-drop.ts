// Woodcutting 1 -> 50: buy a steel axe at Bob's (Lumbridge), chop normal trees north of Draynor to 15, then the oaks
// there; every log dropped as cut. Site tree:draynor-village:1, clear of the jail guards. Method: oak-draynor-drop.
import { definePlan, phase } from '@conductor/lib/plan';
import shop from '@conductor/tasks/shop';
import woodcutting from '@conductor/tasks/woodcutting';

const area = { x: 3095, z: 3283, radius: 16 };

export default definePlan({
    name: 'oak-draynor-drop',
    description: 'Steel axe, normal trees to WC 15, Draynor oaks (logs dropped) to WC 50',
    method: 'oak-draynor-drop',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    until: v => v.level('Woodcutting') >= 50,
    phases: [
        phase(
            shop,
            { npc: 'Bob', at: { x: 3232, z: 3203 }, buy: [{ item: 'Steel axe', count: 1, maxUnitPrice: 250 }] },
            {
                name: 'buy-axe',
                when: v => v.inv(/axe$/i) === 0 || (v.inv('Steel axe') === 0 && v.runs('buy-axe') === 0),
            },
        ),
        phase(
            woodcutting,
            { tree: 'oak', onFull: 'drop', area },
            { name: 'oaks', when: v => v.level('Woodcutting') >= 15 },
        ),
        phase(
            woodcutting,
            { tree: 'tree', onFull: 'drop', area },
            { name: 'normals', until: v => v.level('Woodcutting') >= 15 },
        ),
    ],
});
