// Buy a steel axe (Bob, Lumbridge) and a fly fishing rod (Gerrant, Port Sarim), then fly fish -> cook -> bank
// at Lumbridge/Varrock East until Fishing 60, Cooking 55 and 50 cooked trout/salmon are banked.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import cooking from '@conductor/tasks/cooking';
import fishing from '@conductor/tasks/fishing';
import shop from '@conductor/tasks/shop';

const cooked = /^(trout|salmon)$/i;
const raw = /^raw (trout|salmon)$/i;
const pot = { x: 3232, z: 3238, radius: 5 };
const vbank = { x: 3254, z: 3420, radius: 3 };
const keep = ['Fly fishing rod', 'Feather', 'Coins'];

export default definePlan({
    name: 'tools-food',
    description: 'Buy steel axe + fly rod, then Lumbridge fly fishing -> cook -> Varrock East bank',
    requires: {
        'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5,
        'Fishing 30+': v => v.level('Fishing') >= 30,
        'Cooking 25+': v => v.level('Cooking') >= 25,
    },
    until: v =>
        v.level('Fishing') >= 60 &&
        v.level('Cooking') >= 55 &&
        v.inv(cooked) === 0 &&
        (v.bank('Trout') ?? 0) + (v.bank('Salmon') ?? 0) >= 50,
    phases: [
        phase(
            bank,
            {
                area: { x: 3269, z: 3167, radius: 3 },
                depositAllExcept: ['Coins'],
                withdraw: [{ item: 'Feather', count: 155, upTo: true }],
            },
            {
                name: 'bank-start',
                when: v => v.runs('bank-start') === 0 && v.inv('Steel axe') === 0 && v.inv('Fly fishing rod') === 0,
            },
        ),
        phase(
            shop,
            { npc: 'Bob', at: { x: 3232, z: 3203 }, buy: [{ item: 'Steel axe', count: 1 }] },
            {
                name: 'buy-axe',
                when: v => v.runs('buy-axe') === 0 && v.inv('Steel axe') === 0 && v.inv('Coins') >= 200,
            },
        ),
        phase(
            shop,
            { npc: 'Gerrant', at: { x: 3013, z: 3225 }, buy: [{ item: 'Fly fishing rod', count: 1 }] },
            { name: 'buy-rod', when: v => v.runs('buy-rod') === 0 && v.inv('Fly fishing rod') === 0 },
        ),
        phase(
            bank,
            { area: vbank, depositAllExcept: keep, withdraw: [{ item: 'Feather', count: 150, upTo: true }] },
            { name: 'bank-cooked', when: v => v.inv(cooked) > 0 && v.inv(raw) === 0 },
        ),
        phase(
            cooking,
            { food: 'Raw salmon', area: pot, dropBurnt: true },
            { name: 'cook-salmon', when: v => v.inv('Raw salmon') > 0, onFail: 'continue' },
        ),
        phase(
            cooking,
            { food: 'Raw trout', area: pot, dropBurnt: true },
            { name: 'cook-trout', when: v => v.inv('Raw trout') > 0 },
        ),
        phase(
            fishing,
            { method: 'lure', onFull: 'stop', area: { x: 3239, z: 3248, radius: 10 } },
            {
                when: v => v.inv('Fly fishing rod') > 0 && v.inv('Feather') > 0,
            },
        ),
    ],
});
