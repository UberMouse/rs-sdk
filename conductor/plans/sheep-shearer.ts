// Sheep Shearer (server/content/scripts/quests/quest_sheep, areas/area_lumbridge/scripts/fred_the_farmer.rs2).
// Fred the Farmer (3190,3273) asks for 20 balls of wool; the unsheared sheep graze in his pen (3193-3210, 3261-3272);
// the Lumbridge Castle spinning wheel (3209,3212, level 1) spins the wool; Fred takes the balls one per tick.
// Start save: lib:sheep-shearer-start (shears in the pack, Lumbridge courtyard).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import spinning from '@conductor/tasks/spinning';
import talk from '@conductor/tasks/talk';

const ID = 'sheep';
const fred = { npc: '^Fred the Farmer$', at: { x: 3190, z: 3273, level: 0, tolerance: 3 } };
const R = { onFail: 'continue', maxFails: 10 } as const;
const balls = (v: PlanView) => v.inv('Ball of wool');
const wool = (v: PlanView) => v.inv('Wool');

// A shear that finds no woolly sheep in reach fails; a copy below gets the turn (sheep regrow wool in time).
const shear = (name: string) =>
    phase(
        interact,
        {
            target: 'npc',
            name: '^Sheep$',
            use: { item: '^Shears$' },
            npcId: 43,
            expect: 'you get some wool',
            at: { x: 3200, z: 3266, tolerance: 3 },
        },
        {
            name,
            when: v => v.quest(ID) === 'started' && wool(v) < 20 && balls(v) === 0,
            maxFails: 40,
            onFail: 'continue',
        },
    );

export default definePlan({
    name: 'sheep-shearer',
    description:
        'Sheep Shearer: Fred, shear 20 wool in his pen, spin it at the Lumbridge Castle wheel, hand in 20 balls.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            talk,
            { ...fred },
            {
                name: 'hand-in',
                when: v => v.quest(ID) === 'started' && balls(v) >= 20 && v.last?.phase !== 'hand-in',
                ...R,
            },
        ),
        phase(
            talk,
            { ...fred },
            { name: 'hand-in-again', when: v => v.quest(ID) === 'started' && balls(v) > 0 && wool(v) === 0, ...R },
        ),
        phase(
            spinning,
            { material: 'wool', wheel: { x: 3209, z: 3213, level: 1 } },
            { name: 'spin', when: v => wool(v) >= 20 || (wool(v) > 0 && v.free === 0), ...R },
        ),
        ...['shear', 'shear2', 'shear3', 'shear4'].map(name => shear(name)),
        phase(
            talk,
            { ...fred, choices: ['looking for a quest', 'Yes okay'] },
            { name: 'fred-start', when: v => v.quest(ID) === 'none' },
        ),
    ],
});
