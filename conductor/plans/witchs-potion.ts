// Witch's Potion (quest id hetty, varp %hetty 0 -> 1 started -> 2 objects given -> 3 done). Hetty (Rimmington, 2968,3206)
// starts it ("I am in search of a quest" -> "Yes help me become one with my darker side"). Ingredients: rat's tail (a rat
// drops it only while the quest is started), burnt meat (from the save: burning is a random chance, 4 of 4 raw beef cooked fine on the Rimmington range), onion
// (picked in the field north of Rimmington), eye of newt (3 gp, Betty's Magic Emporium, Port Sarim). Give all four to
// Hetty, then Drink From her cauldron: 325 Magic XP.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import pick from '@conductor/tasks/pick';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';

const ID = 'hetty';
const HETTY = { x: 2968, z: 3206, tolerance: 3 };
const started = (v: PlanView) => v.quest(ID) === 'started';
const hasTail = (v: PlanView) => v.inv("Rat's tail") > 0;
const hasBurnt = (v: PlanView) => v.inv('Burnt meat') > 0;
const hasOnion = (v: PlanView) => v.inv('Onion') > 0;
const hasNewt = (v: PlanView) => v.inv('Eye of newt') > 0;
const gave = (v: PlanView) => v.runs('give') > 0 && v.last?.phase === 'give' && v.last.status === 'done';

const DRINK = {
    target: 'loc',
    name: '^Cauldron$',
    option: '^Drink From$',
    at: { x: 2968, z: 3207, tolerance: 2 },
} as const;
const GIVE = { npc: '^Hetty$', at: HETTY, choices: [] };

export default definePlan({
    name: 'witchs-potion',
    description:
        "Witch's Potion: Hetty, rat's tail, onion field, eye of newt at Betty's, hand in, drink from the cauldron.",
    requires: QUEST_TAB_REQUIRED,
    until: v => v.questDone(ID),
    phases: [
        phase(interact, DRINK, { name: 'drink-b', when: v => v.runs('drink') > 0, maxFails: 3 }),
        phase(interact, DRINK, { name: 'drink', when: gave, onFail: 'continue', maxFails: 4 }),
        phase(talk, GIVE, {
            name: 'give',
            when: v => started(v) && hasTail(v) && hasBurnt(v) && hasOnion(v) && hasNewt(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(
            shop,
            { npc: 'Betty', at: { x: 3012, z: 3259 }, buy: [{ item: 'Eye of newt', count: 1 }] },
            {
                name: 'newt',
                when: v => started(v) && hasTail(v) && hasBurnt(v) && hasOnion(v) && !hasNewt(v),
                maxFails: 3,
            },
        ),
        phase(
            pick,
            { loc: 'Onion', item: 'Onion', count: 1, area: { x: 2951, z: 3250, radius: 14 } },
            { name: 'onion', when: v => started(v) && hasTail(v) && hasBurnt(v) && !hasOnion(v), maxFails: 3 },
        ),
        phase(
            combat,
            {
                target: 'Rat',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 2957, z: 3204, radius: 29 },
                loot: ["Rat's tail"],
                maxLevelGap: 10,
            },
            { name: 'rat', when: v => started(v) && !hasTail(v), until: hasTail, maxFails: 4 },
        ),
        phase(
            talk,
            { npc: '^Hetty$', at: HETTY, choices: ['in search of a quest', 'darker side'] },
            {
                name: 'start',
                when: v => v.quest(ID) === 'none',
                maxFails: 3,
            },
        ),
    ],
});
