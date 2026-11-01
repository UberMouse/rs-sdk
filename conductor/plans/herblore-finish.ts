// Finish potions from banked clean Guam leaves: batch of leaves+vials of water+newts from the Falador West bank; supply trip to Jatix + Taverley fountain when the bank runs short.
import { definePlan, phase } from '@conductor/lib/plan';
import type { PlanView } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import fill from '@conductor/tasks/fill';
import herblore from '@conductor/tasks/herblore';
import shop from '@conductor/tasks/shop';

const bankArea = { x: 2947, z: 3367, radius: 6 };
const pairs = [{ unf: 'guam', secondary: 'Eye of newt' }];
const water = (v: PlanView) => v.inv('Vial of water');
const newts = (v: PlanView) => v.inv('Eye of newt');
const leaves = (v: PlanView) => v.inv('Guam leaf');
const brewable = (v: PlanView) => leaves(v) > 0 && water(v) > 0 && newts(v) > 0;
const bankGuam = (v: PlanView) => v.bank('Guam leaf') ?? 99;
const needs = (v: PlanView) =>
    bankGuam(v) >= 8 && ((v.bank('Vial of water') ?? 99) < 8 || (v.bank('Eye of newt') ?? 99) < 8);

export default definePlan({
    name: 'herblore-finish',
    description: 'Herblore: Attack potions from banked Guam leaves',
    until: v => v.level('Herblore') >= 99,
    phases: [
        phase(herblore, { mode: 'all', pairs }, { name: 'brew', when: brewable, onFail: 'continue' }),
        phase(
            bank,
            { area: bankArea, depositAllExcept: ['Dusty key', 'Coins'] },
            { name: 'stash', when: v => v.runs('buy') > v.runs('stash') && water(v) > 0 && v.inv('Vial') === 0 },
        ),
        phase(
            fill,
            { container: 'Vial', area: { x: 2891, z: 3438, radius: 3 } },
            { name: 'fill', when: v => v.inv('Vial') > 0 },
        ),
        phase(
            shop,
            {
                npc: 'Jatix',
                at: { x: 2899, z: 3427 },
                buy: [
                    { item: 'Vial', count: 13, maxUnitPrice: 3 },
                    { item: 'Eye of newt', count: 13, maxUnitPrice: 5 },
                ],
            },
            { name: 'buy', when: v => needs(v) && v.free >= 26 && v.runs('buy') === v.runs('stash') },
        ),
        phase(
            bank,
            { area: bankArea, depositAllExcept: ['Dusty key', 'Coins'] },
            { name: 'strip', when: v => needs(v) && v.free < 26 && v.runs('buy') === v.runs('stash') },
        ),
        phase(
            bank,
            {
                area: bankArea,
                depositAllExcept: ['Dusty key', 'Coins'],
                withdraw: [
                    { item: 'Guam leaf', count: 8, upTo: true },
                    { item: 'Vial of water', count: 8, upTo: true },
                    { item: 'Eye of newt', count: 8, upTo: true },
                ],
            },
            { name: 'batch', when: v => !needs(v) && !brewable(v) && bankGuam(v) > 0 && v.inv('Vial') === 0 },
        ),
    ],
});
