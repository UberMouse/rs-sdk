// Superheat smithing loop B (banked ore): Varrock East bank -> superheat the ore at the bank (worn Staff of fire,
// nature runes) -> iron platebodies at the Varrock East anvil (3247,3404) -> bank. 25 ore = 25 bars = 5 platebodies.
// Needs Magic 43, Smithing 18+, a hammer, a Staff of fire worn, ore + nature runes banked. Never carries coal.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import smithing from '@conductor/tasks/smithing';
import spellItems from '@conductor/tasks/spell-items';
import travel from '@conductor/tasks/travel';

const anvil = { x: 3247, z: 3404, radius: 5 };
const eastBank = { x: 3254, z: 3420, radius: 3 };
type V = { state: { player?: { worldX: number; worldZ: number } | null } };
const far = (v: V, c: { x: number; z: number }, r: number) => {
    const p = v.state.player;
    return !p || Math.abs(p.worldX - c.x) > r || Math.abs(p.worldZ - c.z) > r;
};

export default definePlan({
    name: 'superheat-banked',
    method: 'superheat-iron-varrock-east-platebody',
    description: 'Banked iron ore: superheat at Varrock East bank, smith platebodies at the SE anvil, bank',
    requires: { 'Magic 43+': v => v.level('Magic') >= 43 },
    phases: [
        phase(
            smithing,
            { mode: 'smith', bar: 'iron', product: 'platebody', area: anvil },
            { name: 'smith', when: v => v.inv('Iron bar') >= 5 && v.inv('Hammer') > 0 && !far(v, anvil, 8) },
        ),
        phase(
            travel,
            { to: { x: 3247, z: 3406 }, tolerance: 3 },
            { name: 'to-anvil', when: v => v.inv('Iron bar') >= 5 && far(v, anvil, 8) },
        ),
        phase(
            spellItems,
            { spell: 'superheat', item: '^iron ore$' },
            { name: 'cast', when: v => v.inv('Iron ore') > 0 && v.inv('Nature rune') > 0 },
        ),
        phase(
            bank,
            {
                area: eastBank,
                depositAllExcept: ['Hammer'],
                withdraw: [
                    { item: 'Nature rune', count: 30 },
                    { item: 'Iron ore', count: 25 },
                ],
            },
            { name: 'bank', when: v => v.inv('Iron ore') === 0 && v.inv('Iron bar') < 5 },
        ),
    ],
});
