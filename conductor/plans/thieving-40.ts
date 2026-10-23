// Raw chicken, then Men in Lumbridge to Thieving 25, then bank, shrimps in Al Kharid and Al-Kharid warriors to 40.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import cooking from '@conductor/tasks/cooking';
import fishing from '@conductor/tasks/fishing';
import thieving from '@conductor/tasks/thieving';

const food = ['Shrimps', 'Bread'];
const kept = ['Coins', 'Small fishing net', 'Bronze axe', 'Bronze pickaxe', 'Tinderbox', 'Shrimps', 'Bread'];

export default definePlan({
    name: 'thieving-40',
    description: 'Raw chicken, Men to Thieving 25, bank, net+cook shrimps at Al Kharid, warriors to Thieving 40',
    until: v => v.level('Thieving') >= 40,
    phases: [
        phase(
            thieving,
            { npc: 'Al-Kharid warrior', area: { x: 3292, z: 3172, radius: 6 }, food },
            {
                name: 'warriors',
                when: v => v.level('Thieving') >= 25 && v.runs('bank') > 0 && v.inv('Shrimps') >= 8,
                until: v => v.inv('Shrimps') === 0 && v.inv('Bread') === 0,
            },
        ),
        phase(
            cooking,
            { food: 'Raw shrimps', area: { x: 3271, z: 3180, radius: 6 } },
            { when: v => v.inv('Raw shrimps') >= 10 || (v.full && v.inv('Raw shrimps') > 0) },
        ),
        phase(
            fishing,
            { method: 'net', area: { x: 3268, z: 3148, radius: 5 }, onFull: 'stop' },
            {
                name: 'net',
                when: v => v.level('Thieving') >= 25 && v.runs('bank') > 0 && v.inv('Shrimps') < 8,
                until: v => v.inv('Raw shrimps') >= 14,
            },
        ),
        phase(
            bank,
            { area: { x: 3269, z: 3167, radius: 5 }, depositAllExcept: kept },
            { name: 'bank', when: v => v.level('Thieving') >= 25 && v.runs('bank') === 0 },
        ),
        phase(
            thieving,
            { npc: 'Man', area: { x: 3222, z: 3218, radius: 6 }, food },
            {
                name: 'men',
                when: v => v.level('Thieving') < 25 && (v.inv('Raw chicken') > 0 || v.runs('chicken') > 0),
                until: v => v.level('Thieving') >= 25,
            },
        ),
        phase(
            combat,
            {
                target: 'Chicken',
                skill: 'Attack',
                weapon: 'Bronze sword',
                shield: 'Wooden shield',
                area: { x: 3231, z: 3295, radius: 8 },
                food,
                loot: ['Raw chicken'],
            },
            {
                name: 'chicken',
                when: v => v.inv('Raw chicken') === 0 && v.runs('chicken') === 0,
                until: v => v.inv('Raw chicken') > 0,
            },
        ),
    ],
});
