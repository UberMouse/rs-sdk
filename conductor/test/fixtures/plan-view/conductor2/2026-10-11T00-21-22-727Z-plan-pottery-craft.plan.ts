// Pottery for Crafting: collect 8 water containers (the general stores stock 2 buckets and 2 jugs
// each), then loop: mine clay (Rimmington) -> fill containers (Falador fountain) -> shape and fire
// at Barbarian Village (pots until level 8, then bowls) -> bank the pottery at Falador East.
// Ends at Crafting 30 with the pottery banked.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import crafting from '@conductor/tasks/crafting';
import fill from '@conductor/tasks/fill';
import mining from '@conductor/tasks/mining';
import shop from '@conductor/tasks/shop';

const NEED = 8;
const wheel = { x: 3086, z: 3408, radius: 6 };
const keep = ['Bronze pickaxe', 'Bucket', 'Bucket of water', 'Jug', 'Jug of water'];
const raw = /clay|^unfired/i;
const pottery = /^(pot|pie dish|bowl)$/i;
const containers = /^(bucket|jug)$/i;
const waters = /^(bucket|jug) of water$/i;
const worked = /^(soft clay|unfired)/i;
const stock = [
    { item: 'Bucket', count: 2, maxUnitPrice: 3 },
    { item: 'Jug', count: 2, maxUnitPrice: 3 },
];

export default definePlan({
    name: 'pottery-craft',
    description: 'Rimmington clay -> Falador fountain -> Barbarian Village wheel/oven -> Falador East bank',
    until: v => v.level('Crafting') >= 30 && v.inv(pottery) === 0,
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            bank,
            { area: { x: 3013, z: 3355, radius: 4 }, depositAllExcept: keep },
            {
                name: 'bank-pottery',
                when: v => v.inv(pottery) > 0 && v.inv(raw) === 0 && v.inv(waters) === 0,
            },
        ),
        phase(
            crafting,
            { product: 'bowl', fire: true, area: wheel },
            {
                name: 'craft-bowl',
                when: v =>
                    v.level('Crafting') >= 8 && (v.inv(worked) > 0 || (v.inv(/^clay$/i) > 0 && v.inv(waters) > 0)),
            },
        ),
        phase(
            crafting,
            { product: 'pot', fire: true, area: wheel },
            {
                name: 'craft-pot',
                when: v => v.inv(worked) > 0 || (v.inv(/^clay$/i) > 0 && v.inv(waters) > 0),
                until: v => v.level('Crafting') >= 8,
            },
        ),
        phase(
            fill,
            { container: 'Bucket', area: { x: 3038, z: 3353, radius: 6 } },
            { name: 'fill-bucket', when: v => v.inv(/^clay$/i) > 0 && v.inv(/^bucket$/i) > 0 },
        ),
        phase(
            fill,
            { container: 'Jug', area: { x: 3038, z: 3353, radius: 6 } },
            { name: 'fill-jug', when: v => v.inv(/^clay$/i) > 0 && v.inv(/^jug$/i) > 0 },
        ),
        phase(
            mining,
            { rock: 'clay', onFull: 'stop', area: { x: 2986, z: 3239, radius: 6 } },
            {
                when: v => v.inv(containers) >= NEED && v.inv(raw) === 0,
                until: v => v.inv(/^clay$/i) >= NEED,
            },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 2947, z: 3217 }, buy: stock },
            { name: 'shop-rimmington', when: v => v.runs('shop-lumbridge') > 0 && v.runs('shop-rimmington') === 0 },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 3212, z: 3247 }, buy: [{ item: 'Jug', count: 2, maxUnitPrice: 3 }] },
            { name: 'shop-lumbridge', when: v => v.inv('Bronze pickaxe') > 0 && v.runs('shop-lumbridge') === 0 },
        ),
        phase(
            bank,
            {
                area: { x: 3092, z: 3243, radius: 3 },
                depositAllExcept: [],
                withdraw: [
                    { item: 'Coins', count: 30 },
                    { item: 'Bronze pickaxe', count: 1 },
                ],
            },
            { name: 'prep', when: v => v.runs('prep') === 0 && v.inv('Bronze pickaxe') === 0 },
        ),
    ],
});
