// Fletching 1 -> 99 (99 = ~998k XP on this server's level table; 40 = 15.8k).
// 1 -> 40: knife from the Lumbridge ground spawn, Lumbridge trees -> arrow shafts (187.5 XP/log, stack).
// 40 -> 99: Seers willows -> Willow longbow -> string, 13 per trip, strings from the Seers bank; when the
// bank holds < 13 strings, a flax trip (27 flax -> 27 strings) refills it. Slots at Seers: Knife + Adamant axe + 13 strings + 13 logs
// = 28; flax trip: Knife + 27 flax = 28.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import fletching from '@conductor/tasks/fletching';
import pickup from '@conductor/tasks/pickup';
import pick from '@conductor/tasks/pick';
import spinning from '@conductor/tasks/spinning';
import travel from '@conductor/tasks/travel';
import woodcutting from '@conductor/tasks/woodcutting';

const WILLOW_LONGBOW_UNSTRUNG = 58;
const PAIRS = 13;
type V = { state: { inventory: { id: number; count: number }[]; player?: { worldX: number; worldZ: number } | null } };
const unstrung = (v: V) =>
    v.state.inventory.filter(i => i.id === WILLOW_LONGBOW_UNSTRUNG).reduce((n, i) => n + i.count, 0);
const far = (v: V) => {
    const p = v.state.player;
    return !p || Math.abs(p.worldX - 2740) > 80 || Math.abs(p.worldZ - 3470) > 80;
};

export default definePlan({
    name: 'fletch-99',
    description: 'Fletching 1-99: Lumbridge arrow shafts to 40, then Seers willow longbows (strung, flax refills)',
    until: v => v.level('fletching') >= 99,
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        // ---- 40+: Seers
        phase(
            travel,
            { to: { x: 2743, z: 3445 }, tolerance: 6 },
            {
                name: 'to-seers',
                when: v => v.level('fletching') >= 40 && far(v),
            },
        ),
        phase(
            fletching,
            { product: 'long bow', logs: 'Willow logs', string: true, batch: 10 },
            {
                name: 'cut-and-string',
                when: v =>
                    v.level('fletching') >= 40 &&
                    (v.inv('Willow logs') > 0 || unstrung(v) > 0) &&
                    v.inv('Bow string') > 0,
            },
        ),
        phase(
            spinning,
            { material: 'flax', wheel: { x: 2711, z: 3471, level: 1 } },
            { name: 'spin', when: v => v.level('fletching') >= 40 && v.inv('Flax') > 0 && v.full },
        ),
        phase(
            bank,
            {
                area: { x: 2727, z: 3494, radius: 3, level: 0 },
                depositAllExcept: ['Knife', 'Adamant axe'],
                withdraw: [
                    { item: 'Adamant axe', count: 1, upTo: true },
                    { item: 'Bow string', count: PAIRS, upTo: true },
                ],
            },
            {
                name: 'bank-strings',
                when: v => v.level('fletching') >= 40 && v.inv('Bow string') > PAIRS && v.inv('Flax') === 0,
            },
        ),
        phase(
            bank,
            {
                area: { x: 2727, z: 3494, radius: 3, level: 0 },
                depositAllExcept: ['Knife', 'Adamant axe'],
                withdraw: [
                    { item: 'Adamant axe', count: 1, upTo: true },
                    { item: 'Bow string', count: PAIRS, upTo: true },
                ],
            },
            {
                name: 'bank-and-fetch',
                when: v =>
                    v.level('fletching') >= 40 &&
                    v.inv('Flax') === 0 &&
                    (v.inv('Adamant axe') === 0 ||
                        (v.inv('Bow string') < PAIRS &&
                            (v.runs('bank-and-fetch') === 0 ||
                                (v.bank('Bow string') ?? 0) >= PAIRS ||
                                v.inv('Willow logs') > 0 ||
                                unstrung(v) > 0))),
            },
        ),
        phase(
            pick,
            { loc: 'Flax', item: 'Flax', area: { x: 2743, z: 3445, radius: 10 } },
            {
                name: 'flax',
                when: v =>
                    v.level('fletching') >= 40 &&
                    v.inv('Adamant axe') > 0 &&
                    v.inv('Bow string') < PAIRS &&
                    v.inv('Willow logs') === 0,
            },
        ),
        phase(
            woodcutting,
            { tree: 'willow', onFull: 'stop', area: { x: 2711, z: 3509, radius: 9, level: 0 } },
            {
                name: 'chop',
                when: v => v.level('fletching') >= 40 && v.inv('Adamant axe') > 0 && v.inv('Bow string') >= PAIRS,
                until: v => v.inv('Willow logs') >= PAIRS,
            },
        ),
        // ---- 1-40: Lumbridge shafts
        phase(
            pickup,
            { items: [{ item: 'Knife', count: 1 }], area: { x: 3224, z: 3202, radius: 4 } },
            { name: 'knife', when: v => v.level('fletching') < 40 && v.inv('Knife') === 0 },
        ),
        phase(
            fletching,
            { product: 'arrow shaft', logs: 'Logs' },
            { name: 'shafts', when: v => v.level('fletching') < 40 && v.inv('Logs') > 0 && v.inv('Knife') > 0 },
        ),
        phase(
            woodcutting,
            { tree: 'tree', onFull: 'stop', area: { x: 3195, z: 3220, radius: 12 } },
            {
                name: 'chop-lumbridge',
                when: v => v.level('fletching') < 40,
            },
        ),
    ],
});
