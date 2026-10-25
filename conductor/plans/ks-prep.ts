// Knight's Sword prep: 2 Iron bars + a Redberry pie. Smithing 1 -> 15 on 13 bronze bars (Rimmington tin + copper, Falador furnace),
// then Rimmington iron/clay/containers, Port Sarim flour + redberries (Wydin), iron bars at the Falador furnace,
// a pie dish at the Barbarian Village wheel, dough, pie shell, uncooked pie, cooked on a Falador range.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import crafting from '@conductor/tasks/crafting';
import fill from '@conductor/tasks/fill';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import mining from '@conductor/tasks/mining';
import shop from '@conductor/tasks/shop';
import smithing from '@conductor/tasks/smithing';

const FURN = { x: 2975, z: 3368, radius: 5 };
const WBANK = { x: 2947, z: 3368, radius: 4 };
const MINE = { x: 2980, z: 3240, radius: 14 };
const SINK = { x: 2966, z: 3209, radius: 6 };
const WHEEL = { x: 3086, z: 3410, radius: 6 };
const RANGE = { x: 3039, z: 3366, tolerance: 3 };
const L15 = (v: PlanView) => v.level('Smithing') >= 15;
const water = (v: PlanView) => v.inv(/^(bucket|jug) of water$/i);
const clay = (v: PlanView) => v.inv(/^(soft )?clay$/i);

export default definePlan({
    name: 'ks-prep',
    description: "Knight's Sword prep: Smithing 15 via bronze, 2 iron bars, Redberry pie",
    until: v => v.inv('Redberry pie') > 0 && v.inv('Iron bar') >= 2,
    phases: [
        phase(
            interact,
            {
                target: 'loc',
                name: '^Range$',
                at: RANGE,
                use: { item: '^Uncooked berry pie$' },
                expect: 'successfully|burn',
            },
            { name: 'cook-pie', when: v => v.inv('Uncooked berry pie') > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Pie shell$', on: '^Redberries$' } },
            { name: 'combine-berries', when: v => v.inv('Pie shell') > 0 && v.inv('Redberries') > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Pie dish$', on: '^Pastry dough$' } },
            { name: 'combine-shell', when: v => v.inv('Pie dish') > 0 && v.inv('Pastry dough') > 0 },
        ),
        phase(
            items,
            // The dough combine opens a menu (bread/pastry/pizza/pitta): pick pastry.
            { combine: { use: '^Pot of flour$', on: '^(Bucket|Jug) of water$', choice: '^Pastry dough' } },
            {
                name: 'make-dough',
                when: v => v.inv('Pot of flour') > 0 && water(v) > 0 && v.inv('Pie dish') > 0,
            },
        ),
        phase(
            crafting,
            { product: 'pie dish', fire: true, area: WHEEL },
            {
                name: 'craft-dish',
                when: v =>
                    v.inv('Pie dish') === 0 &&
                    v.inv('Pie shell') === 0 &&
                    v.inv('Pastry dough') === 0 &&
                    v.inv('Uncooked berry pie') === 0 &&
                    v.inv('Iron bar') >= 2 &&
                    clay(v) > 0 &&
                    water(v) >= 2 &&
                    v.inv('Pot of flour') > 0 &&
                    v.inv('Redberries') > 0,
            },
        ),
        phase(
            bank,
            { area: WBANK, deposit: [{ item: 'Bronze bar' }] },
            { name: 'bank-bronze', when: v => v.inv('Bronze bar') > 0 },
        ),
        phase(
            smithing,
            { mode: 'smelt', bar: 'iron', area: FURN },
            {
                name: 'smelt-iron',
                when: v =>
                    L15(v) &&
                    v.inv('Iron ore') > 0 &&
                    clay(v) > 0 &&
                    water(v) >= 2 &&
                    v.inv('Pot of flour') > 0 &&
                    v.inv('Redberries') > 0,
            },
        ),
        // Rimmington and Port Sarim errands, once Smithing 15 is reached.
        phase(
            shop,
            {
                npc: 'Shop keeper',
                at: { x: 2947, z: 3217 },
                buy: [
                    { item: 'Bucket', count: 1 },
                    { item: 'Jug', count: 1 },
                ],
            },
            { name: 'shop-containers', when: v => L15(v) && v.runs('shop-containers') === 0 },
        ),
        phase(
            fill,
            { container: 'Bucket', area: SINK },
            { name: 'fill-bucket', when: v => clay(v) > 0 && v.inv(/^bucket$/i) > 0 },
        ),
        phase(
            fill,
            { container: 'Jug', area: SINK },
            { name: 'fill-jug', when: v => clay(v) > 0 && v.inv(/^jug$/i) > 0 },
        ),
        phase(
            mining,
            { rock: 'clay', onFull: 'stop', area: MINE },
            {
                name: 'mine-clay',
                when: v => L15(v) && v.runs('shop-containers') > 0 && clay(v) === 0 && v.runs('mine-clay') === 0,
                until: v => clay(v) >= 1,
            },
        ),
        phase(
            mining,
            { rock: 'iron', onFull: 'stop', area: MINE },
            {
                name: 'mine-iron',
                when: v => L15(v) && clay(v) > 0 && v.inv('Iron ore') === 0 && v.inv('Iron bar') < 2,
                until: v => v.inv('Iron ore') >= 8,
            },
        ),
        phase(
            shop,
            {
                npc: 'Wydin',
                at: { x: 3014, z: 3204 },
                buy: [
                    { item: 'Pot of flour', count: 1 },
                    { item: 'Redberries', count: 1 },
                ],
            },
            {
                name: 'shop-flour',
                when: v => v.inv('Iron ore') > 0 && v.inv('Pot of flour') === 0 && v.runs('shop-flour') === 0,
            },
        ),
        // Smithing 1 -> 15: 13 tin + 13 copper -> 13 bronze bars.
        phase(
            smithing,
            { mode: 'smelt', bar: 'bronze', area: FURN },
            { name: 'smelt-bronze', when: v => !L15(v) && v.inv('Copper ore') > 0 && v.inv('Tin ore') > 0 },
        ),
        phase(
            mining,
            { rock: 'tin', onFull: 'stop', area: MINE },
            { name: 'mine-tin', when: v => !L15(v) && v.inv('Tin ore') < 13, until: v => v.inv('Tin ore') >= 13 },
        ),
        phase(
            mining,
            { rock: 'copper', onFull: 'stop', area: MINE },
            {
                name: 'mine-copper',
                when: v => !L15(v) && v.inv('Copper ore') < 13,
                until: v => v.inv('Copper ore') >= 13,
            },
        ),
    ],
});
