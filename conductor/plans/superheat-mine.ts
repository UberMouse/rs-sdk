// Superheat smithing loop A (mine and superheat): mine 25 iron at the SE Varrock mine, superheat it there
// (worn Staff of fire, nature runes), walk to the SE anvil (3247,3404), smith iron platebodies (5 bars each),
// bank at Varrock East and go back. Never carries coal.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import mining from '@conductor/tasks/mining';
import smithing from '@conductor/tasks/smithing';
import spellItems from '@conductor/tasks/spell-items';
import travel from '@conductor/tasks/travel';

const anvil = { x: 3247, z: 3404, radius: 5 };
const eastBank = { x: 3254, z: 3420, radius: 3 };
const mine = { x: 3285, z: 3365, radius: 10 };
const pick = 'Adamant pickaxe';
type V = { state: { player?: { worldX: number; worldZ: number } | null } };
const far = (v: V, c: { x: number; z: number }, r: number) => {
    const p = v.state.player;
    return !p || Math.abs(p.worldX - c.x) > r || Math.abs(p.worldZ - c.z) > r;
};

export default definePlan({
    name: 'superheat-mine',
    method: 'iron-se-varrock-superheat-platebody-bank',
    description: 'Mine iron at SE Varrock, superheat at the mine, smith platebodies at the SE anvil, bank East',
    requires: { 'Magic 43+': v => v.level('Magic') >= 43 },
    phases: [
        phase(
            smithing,
            { mode: 'smith', bar: 'iron', product: 'platebody', area: anvil },
            { name: 'smith', when: v => v.inv('Iron bar') >= 5 && v.inv('Hammer') > 0 && !far(v, anvil, 8) },
        ),
        phase(
            travel,
            { to: { x: 3247, z: 3406 }, tolerance: 3, waypoints: [{ x: 3265, z: 3385 }] },
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
                depositAllExcept: ['Hammer', pick],
                withdraw: [{ item: 'Nature rune', count: 30 }],
            },
            {
                name: 'bank',
                when: v =>
                    v.inv('Iron ore') === 0 &&
                    v.inv('Iron bar') < 5 &&
                    (v.inv(/platebody$/i) > 0 || v.inv('Nature rune') < 25),
            },
        ),
        phase(
            travel,
            { to: { x: 3286, z: 3368 }, tolerance: 4, waypoints: [{ x: 3260, z: 3400 }] },
            { name: 'to-mine', when: v => v.inv(pick) > 0 && v.inv('Iron ore') === 0 && far(v, mine, 12) },
        ),
        phase(
            mining,
            { rock: 'iron', onFull: 'stop', area: mine },
            { name: 'mine', when: v => v.inv(pick) > 0 && v.inv('Iron ore') === 0 && !far(v, mine, 12) },
        ),
    ],
});
