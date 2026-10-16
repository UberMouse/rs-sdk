// Bankless superheat loop at Port Khazard: mine 25 iron, superheat at the rocks, smith platebodies at the
// anvil (2651,3165) and drop them, walk back. No bank, no coal.
import { definePlan, phase } from '@conductor/lib/plan';
import mining from '@conductor/tasks/mining';
import smithing from '@conductor/tasks/smithing';
import spellItems from '@conductor/tasks/spell-items';
import travel from '@conductor/tasks/travel';

const anvil = { x: 2651, z: 3165, radius: 5 };
const mine = { x: 2630, z: 3143, radius: 8 };
const pick = 'Adamant pickaxe';
type V = { state: { player?: { worldX: number; worldZ: number } | null } };
const far = (v: V, c: { x: number; z: number }, r: number) => {
    const p = v.state.player;
    return !p || Math.abs(p.worldX - c.x) > r || Math.abs(p.worldZ - c.z) > r;
};

export default definePlan({
    name: 'khazard-superheat',
    description:
        'Mine iron at Port Khazard, superheat at the rocks, smith platebodies at the anvil and drop them; no bank',
    requires: { 'Magic 43+': v => v.level('Magic') >= 43 },
    phases: [
        phase(
            smithing,
            { mode: 'smith', bar: 'iron', product: 'platebody', onDone: 'drop', area: anvil },
            { name: 'smith', when: v => v.inv('Iron bar') >= 5 && v.inv('Hammer') > 0 && !far(v, anvil, 8) },
        ),
        phase(
            travel,
            { to: { x: 2651, z: 3164 }, tolerance: 3 },
            { name: 'to-anvil', when: v => v.inv('Iron bar') >= 5 && far(v, anvil, 8) },
        ),
        phase(
            spellItems,
            { spell: 'superheat', item: '^iron ore$' },
            { name: 'cast', when: v => v.inv('Iron ore') > 0 && v.inv('Nature rune') > 0 },
        ),
        phase(
            travel,
            { to: { x: 2630, z: 3142 }, tolerance: 4 },
            { name: 'to-mine', when: v => v.inv(pick) > 0 && v.inv('Iron ore') === 0 && far(v, mine, 10) },
        ),
        phase(
            mining,
            { rock: 'iron', onFull: 'stop', area: mine },
            { name: 'mine', when: v => v.inv(pick) > 0 && v.inv('Iron ore') === 0 && !far(v, mine, 10) },
        ),
    ],
});
