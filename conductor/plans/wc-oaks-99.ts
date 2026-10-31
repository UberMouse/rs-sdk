// Woodcutting 97 -> 99: Draynor north oaks, logs dropped (adamant axe held).
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import woodcutting from '@conductor/tasks/woodcutting';

export default definePlan({
    name: 'wc-oaks-99',
    description: 'Draynor oaks (logs dropped) to WC 99',
    method: 'oak-draynor-drop',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    until: v => v.level('Woodcutting') >= 99,
    phases: [
        phase(
            woodcutting,
            { tree: 'oak', onFull: 'drop', area: { x: 3095, z: 3283, radius: 16 } },
            { name: 'oaks', when: v => v.inv('Adamant axe') > 0, until: v => v.level('Woodcutting') >= 99 },
        ),
        phase(
            bank,
            {
                area: { x: 2947, z: 3367, radius: 6 },
                depositAllExcept: ['Dusty key', 'Coins', 'Adamant pickaxe'],
                withdraw: [{ item: 'Adamant axe', count: 1 }],
            },
            { name: 'get-axe', when: v => v.inv('Adamant axe') === 0 },
        ),
    ],
});
