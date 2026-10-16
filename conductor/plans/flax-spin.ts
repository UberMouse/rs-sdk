// Seers' Village bow strings: pick flax in the field (2732-2755, 3433-3456) until the inventory is full ->
// climb to the spinning wheel (2711,3471) on the first floor of the house and spin it all -> bank the
// strings at the Seers bank (2726,3495) -> repeat. The first bank trip also banks the coins, so a full
// trip is 28 flax. Needs Crafting 10 and a members world.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import pick from '@conductor/tasks/pick';
import spinning from '@conductor/tasks/spinning';

const BOW_STRING = 'Bow string';
const FLAX = 'Flax';

export default definePlan({
    name: 'flax-spin',
    description: "Seers' flax field -> spinning wheel -> Seers bank bow string loop",
    phases: [
        phase(
            spinning,
            { material: 'flax', wheel: { x: 2711, z: 3471, level: 1 } },
            { when: v => v.inv(FLAX) > 0 && v.full },
        ),
        phase(
            bank,
            { area: { x: 2727, z: 3494, radius: 3, level: 0 }, depositAllExcept: [] },
            { name: 'bank-strings', when: v => v.inv(BOW_STRING) > 0 && v.inv(FLAX) === 0 },
        ),
        phase(pick, {
            loc: 'Flax',
            item: 'Flax',
            area: { x: 2743, z: 3445, radius: 10 },
        }),
    ],
});
