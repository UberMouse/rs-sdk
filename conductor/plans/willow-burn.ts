// Fetch an axe + tinderbox at Draynor bank, chop the Draynor willows until full, burn the logs
// on open ground by the bank/trees, repeat. Dark wizards there hunt combat <= 40.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import firemaking from '@conductor/tasks/firemaking';
import woodcutting from '@conductor/tasks/woodcutting';

const hasAxe = (v: { inv(i: RegExp): number }) => v.inv(/axe$/i) > 0;

export default definePlan({
    name: 'willow-burn',
    description: 'Draynor willows: chop until full, line-burn the willow logs, repeat.',
    requires: { 'combat level 45+': v => (v.state.player?.combatLevel ?? 0) >= 45 },
    phases: [
        phase(
            firemaking,
            { logs: 'Willow logs', area: { x: 3088, z: 3247, radius: 6 } },
            { when: v => v.full && v.inv('Willow logs') > 0 && v.inv('Tinderbox') > 0 },
        ),
        phase(
            bank,
            {
                area: { x: 3092, z: 3243, radius: 3 },
                depositAllExcept: ['Coins', 'Steel axe', 'Tinderbox'],
                withdraw: [
                    { item: 'Adamant axe', count: 1, upTo: true },
                    { item: 'Mithril axe', count: 1, upTo: true },
                    { item: 'Black axe', count: 1, upTo: true },
                    { item: 'Steel axe', count: 1, upTo: true },
                    { item: 'Trout', count: 3, upTo: true },
                    { item: 'Tinderbox', count: 1, upTo: true },
                ],
            },
            { name: 'fetch', when: v => !hasAxe(v) || v.inv('Tinderbox') === 0 || v.inv('Trout') > 3 },
        ),
        phase(
            woodcutting,
            { tree: 'willow', onFull: 'stop', area: { x: 3087, z: 3235, radius: 8 } },
            {
                when: v => hasAxe(v) && v.inv('Tinderbox') > 0,
            },
        ),
    ],
});
