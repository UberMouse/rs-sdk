// Edgeville bank (food only) -> travel into the Wilderness to the course door -> laps until food runs short -> travel back -> bank, repeat.
import { definePlan, phase } from '@conductor/lib/plan';
import agility from '@conductor/tasks/agility';
import bank from '@conductor/tasks/bank';
import travel from '@conductor/tasks/travel';

const FOOD = /^(salmon|trout)$/i;
const DOOR = { x: 2998, z: 3915 };
const EDGEVILLE = { x: 3094, z: 3492 };
type V = { inv: (i: RegExp | string) => number; state: { player?: { worldX: number; worldZ: number } | null } };
const food = (v: V) => v.inv(FOOD);
const pos = (v: V) => v.state.player;
const atCourse = (v: V) => {
    const p = pos(v);
    return !!p && p.worldZ >= 3880 && p.worldX >= 2985 && p.worldX <= 3012;
};
const inWild = (v: V) => {
    const p = pos(v);
    return !!p && p.worldZ > 3523;
};

export default definePlan({
    name: 'agility-wilderness',
    method: 'agility-wilderness-course',
    description:
        'Wilderness agility course (Agility 52+): bank food at Edgeville, travel in, laps until food is short, travel out, repeat',
    phases: [
        // consumers first: laps while at the course with food for a lap
        phase(agility, { course: 'wilderness', minFood: 4 }, { when: v => atCourse(v) && food(v) >= 4 }),
        // out of the Wilderness once food is short
        phase(
            travel,
            { to: EDGEVILLE, wilderness: true, minFood: 1, tolerance: 6 },
            { name: 'leave', when: v => inWild(v) && food(v) < 4 },
        ),
        // in: stocked up at the bank
        phase(
            travel,
            { to: DOOR, wilderness: true, minFood: 3, tolerance: 2 },
            { name: 'enter', when: v => !inWild(v) && food(v) >= 10 },
        ),
        phase(
            bank,
            {
                area: { x: 3094, z: 3492, radius: 5 },
                depositAllExcept: ['Salmon', 'Trout'],
                withdraw: [{ item: 'Salmon', count: 15, upTo: true }],
            },
            { when: v => !inWild(v) && food(v) < 10 },
        ),
    ],
});
