// Lumbridge river fly fishing (trout/salmon) -> Lumbridge cooking pot -> Varrock East bank of cooked fish.
// Runs until the run's --until (a level, or minutes); the cooked fish are the account's food stock.
// The lure spots hop between (3238,3251-3252) and (3239,3241-3242): the fishing area covers both.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import cooking from '@conductor/tasks/cooking';
import fishing from '@conductor/tasks/fishing';

const cooked = /^(trout|salmon)$/i;
const raw = /^raw (trout|salmon)$/i;
const pot = { x: 3232, z: 3238, radius: 5 };
const vbank = { x: 3254, z: 3420, radius: 3 };
const keep = ['Fly fishing rod', 'Feather', 'Coins'];

export default definePlan({
    name: 'lure-cook-bank',
    description: 'Lumbridge fly fishing -> Lumbridge cooking pot -> Varrock East bank of cooked trout/salmon',
    requires: {
        'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5,
        // Salmon: Fishing 30 to catch, Cooking 25 to cook.
        'Fishing 30+': v => v.level('Fishing') >= 30,
        'Cooking 25+': v => v.level('Cooking') >= 25,
    },
    phases: [
        phase(
            bank,
            { area: vbank, depositAllExcept: keep },
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
        phase(fishing, { method: 'lure', onFull: 'stop', area: { x: 3239, z: 3248, radius: 10 } }),
    ],
});
