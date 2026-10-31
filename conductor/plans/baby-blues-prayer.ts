// Prayer on Taverley Dungeon baby blue dragons: combat buries the Babydragon bones, bank food at Falador West, defend against Lesser demons at the Dusty-key gate.
import { definePlan, phase } from '@conductor/lib/plan';
import type { PlanView } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import travel from '@conductor/tasks/travel';

const food = ['Swordfish', 'Tuna', 'Lobster', 'Salmon'];
const foodN = (v: PlanView) => food.reduce((n, f) => n + v.inv(f), 0);
const below = (v: PlanView) => (v.state.player?.worldZ ?? 0) > 9000;
const inCombat = (v: PlanView) => v.state.player?.combat.inCombat === true;
// the gate approach: outside the baby-dragon room, near the Dusty-key gate (2924,9803)
const nearGate = (v: PlanView) => (v.state.player?.worldX ?? 0) > 2908 && (v.state.player?.worldZ ?? 0) > 9780;

export default definePlan({
    name: 'baby-blues-prayer',
    method: 'baby-blue-dragons-taverley',
    description: 'Prayer from baby blue dragon bones in Taverley Dungeon, food from Falador West',
    requires: { 'Dusty key': v => v.inv('Dusty key') > 0 || !below(v) },
    phases: [
        phase(
            combat,
            {
                target: 'Lesser demon',
                skill: 'Strength',
                food,
                eatBelow: 0.5,
                area: { x: 2926, z: 9800, radius: 12 },
                maxLevelGap: 40,
            },
            {
                name: 'defend',
                when: v => below(v) && inCombat(v) && nearGate(v),
                until: v => !inCombat(v),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            combat,
            {
                target: 'Baby blue dragon',
                skill: 'Attack',
                food,
                eatBelow: 0.5,
                buryBones: true,
                area: { x: 2898, z: 9766, radius: 13 },
                respawnWaitTicks: 60,
                maxLevelGap: 60,
            },
            {
                name: 'fight-attack',
                when: v => v.level('Attack') < 99 && below(v) && foodN(v) >= 3 && v.inv('Dusty key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            combat,
            {
                target: 'Baby blue dragon',
                skill: 'Defence',
                food,
                eatBelow: 0.5,
                buryBones: true,
                area: { x: 2898, z: 9766, radius: 13 },
                respawnWaitTicks: 60,
                maxLevelGap: 60,
            },
            {
                name: 'fight-defence',
                when: v =>
                    v.level('Attack') >= 99 &&
                    v.level('Defence') < 99 &&
                    below(v) &&
                    foodN(v) >= 3 &&
                    v.inv('Dusty key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            combat,
            {
                target: 'Baby blue dragon',
                skill: 'Strength',
                allowMaxed: true,
                food,
                eatBelow: 0.5,
                buryBones: true,
                area: { x: 2898, z: 9766, radius: 13 },
                respawnWaitTicks: 60,
                maxLevelGap: 60,
            },
            {
                name: 'fight-strength',
                when: v =>
                    v.level('Attack') >= 99 &&
                    v.level('Defence') >= 99 &&
                    below(v) &&
                    foodN(v) >= 3 &&
                    v.inv('Dusty key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            travel,
            { to: { x: 2947, z: 3370 }, tolerance: 3, flee: true },
            { name: 'leave', when: v => below(v) && foodN(v) < 3, maxFails: 4 },
        ),
        phase(
            bank,
            {
                area: { x: 2947, z: 3367, radius: 6 },
                depositAllExcept: ['Dusty key', 'Coins'],
                withdraw: [
                    { item: 'Swordfish', count: 8, upTo: true },
                    { item: 'Lobster', count: 8, upTo: true },
                    { item: 'Tuna', count: 6, upTo: true },
                    { item: 'Salmon', count: 4, upTo: true },
                ],
            },
            { name: 'restock', when: v => foodN(v) < 3 },
        ),
        phase(
            travel,
            { to: { x: 2898, z: 9768 }, tolerance: 5 },
            { name: 'to-dragons', when: v => !below(v) && foodN(v) >= 3 },
        ),
    ],
});
