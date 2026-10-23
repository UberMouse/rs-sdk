// Melee 20 (Attack, Strength, Defence) on the Lumbridge chickens with a Bronze sword and Wooden shield.
import { definePlan, phase } from '@conductor/lib/plan';
import combat from '@conductor/tasks/combat';

const chickens = { x: 3231, z: 3295, radius: 8 };
const base = {
    target: 'Chicken',
    weapon: 'Bronze sword',
    shield: 'Wooden shield',
    area: chickens,
    food: ['Shrimps', 'Bread'],
    buryBones: true,
    loot: ['Feather'],
};

export default definePlan({
    name: 'melee-chickens',
    description: 'Attack, Strength and Defence to 20 on Lumbridge chickens, burying bones, keeping feathers',
    method: 'chickens-lumbridge',
    until: v => v.level('Attack') >= 20 && v.level('Strength') >= 20 && v.level('Defence') >= 20,
    phases: [
        phase(
            combat,
            { ...base, skill: 'Attack' },
            { name: 'attack', when: v => v.level('Attack') < 20, until: v => v.level('Attack') >= 20 },
        ),
        phase(
            combat,
            { ...base, skill: 'Strength' },
            { name: 'strength', when: v => v.level('Strength') < 20, until: v => v.level('Strength') >= 20 },
        ),
        phase(
            combat,
            { ...base, skill: 'Defence' },
            { name: 'defence', when: v => v.level('Defence') < 20, until: v => v.level('Defence') >= 20 },
        ),
    ],
});
