// Iron smithing loop (Smithing 24+): SE Varrock iron -> Lumbridge furnace -> Varrock West anvil -> Varrock West bank.
// Runs until the run's --until (e.g. level:Smithing:N). Routes avoid the Varrock stone circle (3223,3373) with travel waypoints.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import mining from '@conductor/tasks/mining';
import smithing from '@conductor/tasks/smithing';
import travel from '@conductor/tasks/travel';

const anvil = { x: 3188, z: 3421, radius: 5 };
const furnace = { x: 3225, z: 3256, radius: 4 };
const mine = { x: 3285, z: 3365, radius: 10 };
const keep = ['Adamant pickaxe', 'Hammer', 'Bronze sword', 'Wooden shield', 'Coins'];
const products = /^iron (kiteshield|battleaxe|warhammer)$/i;
const far = (
    v: { state: { player?: { worldX: number; worldZ: number } | null } },
    c: { x: number; z: number },
    r: number,
) => {
    const p = v.state.player;
    return !p || Math.abs(p.worldX - c.x) > r || Math.abs(p.worldZ - c.z) > r;
};

export default definePlan({
    name: 'iron-smith',
    description: 'SE Varrock iron -> Lumbridge furnace -> Varrock West anvil + bank',
    requires: {
        'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5,
        // Below 24 no smith phase applies and bars pile up at the anvil.
        'Smithing 24+': v => v.level('Smithing') >= 24,
    },
    phases: [
        phase(
            bank,
            { area: { x: 3185, z: 3436, radius: 5 }, depositAllExcept: keep },
            {
                name: 'bank-products',
                when: v => v.inv(products) > 0 && v.inv('Iron bar') < 3 && v.inv('Iron ore') === 0,
            },
        ),
        phase(
            smithing,
            { mode: 'smith', bar: 'iron', product: 'kiteshield', area: anvil },
            { name: 'smith-kite', when: v => v.inv('Iron bar') >= 3 && v.level('Smithing') >= 27 && !far(v, anvil, 8) },
        ),
        phase(
            smithing,
            { mode: 'smith', bar: 'iron', product: 'battleaxe', area: anvil },
            {
                name: 'smith-axe',
                when: v =>
                    v.inv('Iron bar') >= 3 &&
                    v.level('Smithing') >= 25 &&
                    v.level('Smithing') < 27 &&
                    !far(v, anvil, 8),
            },
        ),
        phase(
            smithing,
            { mode: 'smith', bar: 'iron', product: 'warhammer', area: anvil },
            {
                name: 'smith-hammer',
                when: v =>
                    v.inv('Iron bar') >= 3 &&
                    v.level('Smithing') >= 24 &&
                    v.level('Smithing') < 25 &&
                    !far(v, anvil, 8),
            },
        ),
        phase(
            travel,
            {
                to: { x: 3188, z: 3425 },
                tolerance: 3,
                waypoints: [
                    { x: 3200, z: 3300 },
                    { x: 3180, z: 3350 },
                ],
            },
            {
                name: 'to-anvil',
                when: v =>
                    (v.inv('Iron bar') >= 3 || v.inv(products) > 0) && v.inv('Iron ore') === 0 && far(v, anvil, 8),
            },
        ),
        phase(
            smithing,
            { mode: 'smelt', bar: 'iron', area: furnace },
            { name: 'smelt', when: v => v.inv('Iron ore') > 0 },
        ),
        phase(
            travel,
            { to: { x: 3286, z: 3368 }, tolerance: 4, waypoints: [{ x: 3260, z: 3400 }] },
            { name: 'to-mine', when: v => v.inv('Iron ore') === 0 && v.inv('Iron bar') < 3 && far(v, mine, 12) },
        ),
        phase(
            mining,
            { rock: 'iron', onFull: 'stop', area: mine },
            { name: 'mine', when: v => v.inv('Iron ore') === 0 && v.inv('Iron bar') < 3 && !far(v, mine, 12) },
        ),
    ],
});
