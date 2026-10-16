// Pickpocket Knights of Ardougne (Thieving 55+, 50 gp each); coins and lobsters banked at Ardougne South.
// Prep from anywhere east of Catherby: buy a lobster pot at Harry's, cage-fish and cook lobsters at Catherby.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import cooking from '@conductor/tasks/cooking';
import fishing from '@conductor/tasks/fishing';
import shop from '@conductor/tasks/shop';
import thieving from '@conductor/tasks/thieving';
import travel from '@conductor/tasks/travel';
import type { PlanView } from '@conductor/lib/plan';

const area = { x: 2660, z: 3306, radius: 14 };
const bankArea = { x: 2657, z: 3285, radius: 4 };
const catherbyFish = { x: 2841, z: 3430, radius: 6 };
const catherbyRange = { x: 2817, z: 3444, radius: 5 };
const food = /^lobster$/i;
const px = (v: PlanView): number => v.state.player?.worldX ?? 0;
const nearArdougne = (v: PlanView): boolean => px(v) < 2720;

export default definePlan({
    name: 'knight-thieve',
    description: 'Knights of Ardougne with Lobsters (fished at Catherby); coins banked at Ardougne South',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            bank,
            { area: bankArea, deposit: [{ item: 'Coins' }, { item: 'Lobster', count: 14 }], withdraw: [] },
            { name: 'stash', when: v => nearArdougne(v) && v.inv(food) > 14 && v.runs('stash') === 0 },
        ),
        phase(
            bank,
            { area: bankArea, deposit: [{ item: 'Coins' }], withdraw: [{ item: 'Lobster', count: 14, upTo: true }] },
            { name: 'restock', when: v => nearArdougne(v) && v.inv(food) === 0 && (v.bank(food) ?? 1) > 0 },
        ),
        phase(
            thieving,
            { npc: 'Knight of Ardougne', area, food: ['Lobster'], eatBelow: 0.6 },
            { when: v => v.inv(food) > 0 && nearArdougne(v), until: v => v.inv(food) === 0 },
        ),
        phase(
            travel,
            { to: { x: 2659, z: 3300 }, tolerance: 6, minFood: 3 },
            { name: 'to-ardougne', when: v => v.inv(food) >= 8 && !nearArdougne(v) },
        ),
        phase(
            cooking,
            { food: 'Raw lobster', area: catherbyRange, dropBurnt: true },
            { when: v => v.inv(/^raw lobster$/i) > 0 },
        ),
        phase(
            fishing,
            { method: 'cage', area: catherbyFish, onFull: 'stop' },
            {
                when: v =>
                    v.inv('Lobster pot') > 0 &&
                    v.inv(food) < 8 &&
                    v.inv(/^raw lobster$/i) === 0 &&
                    px(v) < 2900 &&
                    px(v) > 2750,
            },
        ),
        phase(
            shop,
            { npc: 'Harry', at: { x: 2834, z: 3445 }, buy: [{ item: 'Lobster pot', count: 1 }] },
            { when: v => v.inv('Lobster pot') === 0 && v.inv(food) === 0 && px(v) < 2900 && px(v) > 2750 },
        ),
        phase(
            travel,
            { to: { x: 2834, z: 3443 }, tolerance: 4, minFood: 3 },
            {
                name: 'to-catherby',
                when: v =>
                    v.inv(food) < 8 && (px(v) >= 2900 || (nearArdougne(v) && v.inv(food) === 0 && v.bank(food) === 0)),
            },
        ),
    ],
});
