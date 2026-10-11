// Ranged on Lumbridge chickens while arrows last; one Varrock visit buys arrows AND runes; then Wind Strike and Ranged to 40.
import { definePlan, phase } from '@conductor/lib/plan';
import combat from '@conductor/tasks/combat';
import shop from '@conductor/tasks/shop';
import type { PlanView } from '@conductor/lib/plan';

const chickens = { x: 3231, z: 3295, radius: 8 };
const food = ['Trout', 'Salmon'];
const MIN_ARROWS = 30;
const MIN_RUNES = 5;

const arrows = (v: PlanView) =>
    v.inv('Bronze arrow') +
    v.state.equipment.filter(i => /^bronze arrow$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
const runesOk = (v: PlanView) =>
    v.level('Magic') >= 40 || (v.inv('Mind rune') >= MIN_RUNES && v.inv('Air rune') >= MIN_RUNES);
const arrowsOk = (v: PlanView) => v.level('Ranged') >= 40 || arrows(v) >= MIN_ARROWS;
const ready = (v: PlanView) => runesOk(v) && arrowsOk(v);

export default definePlan({
    name: 'ranged-magic-chickens',
    description:
        'Train Magic (Wind Strike) and Ranged on Lumbridge chickens; one Varrock trip restocks arrows and runes',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    until: v => v.level('Ranged') >= 40 && v.level('Magic') >= 40,
    phases: [
        phase(
            combat,
            { target: 'Chicken', skill: 'Magic', spell: 'Wind Strike', area: chickens, food, loot: ['Feather'] },
            { name: 'magic', when: v => ready(v) && v.level('Magic') < 40, until: v => v.level('Magic') >= 40 },
        ),
        phase(
            combat,
            {
                target: 'Chicken',
                skill: 'Ranged',
                weapon: 'Shortbow',
                ammo: 'Bronze arrow',
                area: chickens,
                food,
                loot: ['Bronze arrow'],
            },
            { name: 'ranged', when: v => ready(v) && v.level('Ranged') < 40, until: v => v.level('Ranged') >= 40 },
        ),
        phase(
            shop,
            {
                npc: 'Aubury',
                at: { x: 3253, z: 3402 },
                buy: [
                    { item: 'Mind rune', count: 110 },
                    { item: 'Air rune', count: 110 },
                ],
            },
            { name: 'runes', when: v => !runesOk(v) },
        ),
        phase(
            shop,
            { npc: 'Lowe', at: { x: 3232, z: 3423 }, buy: [{ item: 'Bronze arrow', count: 150 }] },
            { name: 'arrows', when: v => !arrowsOk(v) },
        ),
    ],
});
