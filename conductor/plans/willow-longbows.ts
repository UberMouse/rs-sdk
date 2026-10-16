// Seers' willow-longbow loop: chop the willows NW of the bank (2704-2719, 3505-3513) until 13 logs are held -> cut them all into
// Willow longbows (u) (Make-10 batches) -> string them with the 13 banked Bow strings -> bank the
// longbows -> withdraw 13 strings -> repeat. 27 slots: Knife + 13 strings + 13 logs; the axe is
// wielded. Needs Fletching 40, Woodcutting 30+ and a stock of Bow strings in the Seers bank (the
// flax-spin plan makes them). A strung and an unstrung bow share a name, so unstrung ones are counted by id.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import fletching from '@conductor/tasks/fletching';
import woodcutting from '@conductor/tasks/woodcutting';

const WILLOW_LONGBOW_UNSTRUNG = 58;
const PAIRS = 13;
const unstrung = (v: { state: { inventory: { id: number; count: number }[] } }) =>
    v.state.inventory.filter(i => i.id === WILLOW_LONGBOW_UNSTRUNG).reduce((n, i) => n + i.count, 0);

export default definePlan({
    name: 'willow-longbows',
    description: 'Seers willows -> Willow longbow (u) -> string -> Seers bank, 13 per trip',
    requires: { 'fletching 40+': v => v.level('fletching') >= 40 },
    phases: [
        phase(
            fletching,
            { product: 'long bow', logs: 'Willow logs', string: true, batch: 10 },
            {
                name: 'cut-and-string',
                when: v => (v.inv('Willow logs') > 0 || unstrung(v) > 0) && v.inv('Bow string') > 0,
            },
        ),
        phase(
            bank,
            {
                area: { x: 2726, z: 3495, radius: 3, level: 0 },
                depositAllExcept: ['Knife'],
                withdraw: [{ item: 'Bow string', count: PAIRS }],
            },
            {
                name: 'bank-and-fetch',
                when: v => v.inv('Willow logs') === 0 && unstrung(v) === 0 && v.inv('Bow string') < PAIRS,
            },
        ),
        phase(
            woodcutting,
            { tree: 'willow', onFull: 'stop', area: { x: 2711, z: 3509, radius: 9, level: 0 } },
            { name: 'chop', until: v => v.inv('Willow logs') >= PAIRS },
        ),
    ],
});
