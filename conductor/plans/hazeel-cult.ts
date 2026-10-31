// Hazeel Cult, Carnillean (good) side (server/content/scripts/quests/quest_hazeelcult, quest id hazeelcult, varps
// hazeelcultquest 0-9, hazeelcult_valves, hazeelcult_side).
// Route: Ceril (mansion, 2565,3271) starts it; Clivet in the sewer cave (cave entrance 2585,3233 -> sewer 2570,9682) is refused
// ("You're crazy"), which sets side good and removes him; the five surface sewer valves are set (1,2,4,5 Turn-right, 3 Turn-left;
// the bits are cumulative so the raft only reaches the hideout with all five); the raft at (2567,9679) takes the bot to the
// hideout (2606,9692); Alomone (level 13, 2609,9670) is killed and drops the Carnillean armour; the raft back to the entrance,
// the stairs up (2570,9683 -> 2587,3237), Ceril UPSTAIRS (level 1, 2573,3268: on level 0 he says "come upstairs" and stops)
// takes the armour, then the cupboard at (2573,3267) (Open, then Search with Ceril and Jones near) accuses Jones: quest done.
// The evil side needs the poison on the kitchen range, the amulet, the same valves, the crate key, the chest scroll and a
// second raft trip: longer, so this plan takes the fight (Alomone is weak).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'hazeelcult';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const done = (v: PlanView) => v.questDone(ID);
const underground = (v: PlanView) => pz(v) >= 9000;
const surface = (v: PlanView) => !underground(v);
const hasArmour = (v: PlanView) => v.inv('Carnillean armour') > 0;
const valvesSet = (v: PlanView) => v.runs('valve5') > 0;
const gaveArmour = (v: PlanView) => v.runs('give-armour') > 0;
const clivetDone = (v: PlanView) => v.runs('clivet') > 0 || v.runs('stairs-up-valves') > 0;
const clivetNear = (v: PlanView) => v.state.nearbyNpcs.some(n => /^Clivet$/i.test(n.name));
const atHideout = (v: PlanView) => underground(v) && px(v) >= 2595 && pz(v) < 9700;
const alomoneNear = (v: PlanView) => v.state.nearbyNpcs.some(n => /^Alomone$/i.test(n.name));
const atEntrance = (v: PlanView) => underground(v) && px(v) < 2580;

const VALVE = (n: number, x: number, z: number, option: string) =>
    phase(
        interact,
        { target: 'loc', name: '^Sewer valve$', option, tile: { x, z }, at: { x, z, tolerance: 2 } },
        {
            name: `valve${n}`,
            when: v =>
                surface(v) && clivetDone(v) && v.runs(`valve${n}`) === 0 && (n === 1 || v.runs(`valve${n - 1}`) > 0),
            onFail: 'continue',
            maxFails: 8,
        },
    );

export default definePlan({
    name: 'hazeel-cult',
    description:
        'Hazeel Cult, Carnillean side: Ceril, refuse Clivet, five sewer valves, raft, kill Alomone for the armour, raft back, Ceril upstairs, cupboard.',
    requires: {
        ...QUEST_TAB_REQUIRED,
        'combat able to kill Alomone (level 13)': v => (v.state.player?.combatLevel ?? 0) >= 20,
    },
    until: v => done(v),
    phases: [
        // --- the end: Jones exposed in the cupboard upstairs ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cupboard$',
                option: '^Search$',
                tile: { x: 2573, z: 3267, level: 1 },
                at: { x: 2574, z: 3267, level: 1, tolerance: 1 },
            },
            {
                name: 'search-cupboard-wait',
                when: v => gaveArmour(v) && v.runs('open-cupboard') > 0 && v.runs('search-cupboard-wait') === 0,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cupboard$',
                option: '^Search$',
                tile: { x: 2573, z: 3267, level: 1 },
                at: { x: 2574, z: 3267, level: 1, tolerance: 1 },
            },
            {
                name: 'search-cupboard',
                when: v => gaveArmour(v) && v.runs('open-cupboard') > 0 && v.runs('search-cupboard-wait') > 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cupboard$',
                option: '^Open$',
                tile: { x: 2573, z: 3267, level: 1 },
                at: { x: 2574, z: 3267, level: 1, tolerance: 1 },
            },
            { name: 'open-cupboard', when: v => gaveArmour(v) && v.runs('open-cupboard') === 0, maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Ceril Carnillean$', at: { x: 2573, z: 3268, level: 1, tolerance: 2 }, choices: [] },
            { name: 'give-armour', when: v => hasArmour(v) && surface(v) && !gaveArmour(v), maxFails: 3 },
        ),
        // --- back from the hideout ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Stairs$',
                option: '^Climb-up$',
                tile: { x: 2570, z: 9683 },
                at: { x: 2570, z: 9683, tolerance: 2 },
            },
            { name: 'stairs-up', when: v => atEntrance(v) && hasArmour(v), maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Raft$', option: '^Board$', at: { x: 2606, z: 9691, tolerance: 2 } },
            { name: 'raft-back', when: v => atHideout(v) && hasArmour(v), maxFails: 3 },
        ),
        phase(
            travel,
            { to: { x: 2608, z: 9673 }, tolerance: 2 },
            { name: 'to-alomone', when: v => atHideout(v) && !hasArmour(v) && !alomoneNear(v), maxFails: 3 },
        ),
        phase(
            combat,
            {
                target: 'Alomone',
                skill: 'Strength',
                area: { x: 2608, z: 9672, radius: 10 },
                food: ['Swordfish'],
                eatBelow: 0.5,
                loot: ['Carnillean armour'],
                maxLevelGap: 60,
            },
            { name: 'alomone', when: v => atHideout(v) && !hasArmour(v), until: v => hasArmour(v), maxFails: 3 },
        ),
        // --- the valves are set: the raft to the hideout ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Raft$',
                option: '^Board$',
                tile: { x: 2567, z: 9679 },
                at: { x: 2568, z: 9680, tolerance: 2 },
            },
            { name: 'raft', when: v => atEntrance(v) && valvesSet(v) && !hasArmour(v), maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cave entrance$', option: '^Enter$', at: { x: 2585, z: 3233, tolerance: 2 } },
            {
                name: 'enter-cave-2',
                when: v => surface(v) && valvesSet(v) && !hasArmour(v) && !gaveArmour(v),
                maxFails: 3,
            },
        ),
        VALVE(5, 2609, 3243, '^Turn-right$'),
        VALVE(4, 2597, 3263, '^Turn-right$'),
        VALVE(3, 2585, 3245, '^Turn-left$'),
        VALVE(2, 2572, 3263, '^Turn-right$'),
        VALVE(1, 2562, 3247, '^Turn-right$'),
        // --- the sewer cave: refuse Clivet, then up for the valves ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Stairs$',
                option: '^Climb-up$',
                tile: { x: 2570, z: 9683 },
                at: { x: 2570, z: 9683, tolerance: 2 },
            },
            {
                name: 'stairs-up-valves',
                when: v => atEntrance(v) && !clivetNear(v) && !valvesSet(v) && !hasArmour(v),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Clivet$',
                at: { x: 2567, z: 9682, tolerance: 2 },
                choices: ['What do you mean', "You're crazy"],
            },
            { name: 'clivet', when: v => atEntrance(v) && clivetNear(v), maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cave entrance$', option: '^Enter$', at: { x: 2585, z: 3233, tolerance: 2 } },
            {
                name: 'enter-cave',
                when: v => surface(v) && v.quest(ID) === 'started' && !clivetDone(v),
                maxFails: 3,
            },
        ),
        // --- the start ---
        phase(
            talk,
            {
                npc: '^Ceril Carnillean$',
                at: { x: 2565, z: 3271, tolerance: 3 },
                choices: ["What's wrong", 'Yes, of course'],
            },
            { name: 'ceril', when: v => v.quest(ID) === 'none' && lvl(v) === 0, maxFails: 3 },
        ),
    ],
});
