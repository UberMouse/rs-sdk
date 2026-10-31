// Ranged 40 -> 99 on Taverley baby blue dragons: Oak shortbow + Steel arrows (Iron fallback) from Lowe's, bones buried, food from Falador West.
import { definePlan, phase } from '@conductor/lib/plan';
import type { PlanView } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import shop from '@conductor/tasks/shop';
import travel from '@conductor/tasks/travel';

const food = ['Swordfish', 'Tuna', 'Lobster', 'Salmon'];
const foodN = (v: PlanView) => food.reduce((n, f) => n + v.inv(f), 0);
const held = (v: PlanView, name: string): number =>
    v.inv(name) +
    v.state.equipment.filter(i => i.name.toLowerCase() === name.toLowerCase()).reduce((n, i) => n + i.count, 0);
const below = (v: PlanView) => (v.state.player?.worldZ ?? 0) > 9000;
const inCombat = (v: PlanView) => v.state.player?.combat.inCombat === true;
const nearGate = (v: PlanView) => (v.state.player?.worldX ?? 0) > 2908 && (v.state.player?.worldZ ?? 0) > 9780;
const steel = (v: PlanView) => held(v, 'Steel arrow');
const iron = (v: PlanView) => held(v, 'Iron arrow');
const ready = (v: PlanView) => below(v) && foodN(v) >= 3 && v.inv('Dusty key') > 0 && v.level('Ranged') < 99;

const dragons = {
    target: 'Baby blue dragon',
    skill: 'Ranged' as const,
    weapon: 'Oak shortbow',
    food,
    eatBelow: 0.5,
    buryBones: true,
    area: { x: 2898, z: 9766, radius: 13 },
    respawnWaitTicks: 60,
    maxLevelGap: 60,
};

export default definePlan({
    name: 'ranged-dragons',
    method: 'baby-blue-dragons-taverley',
    description: 'Ranged (Oak shortbow, Steel arrows) and Prayer on Taverley baby blue dragons',
    requires: { 'Dusty key': v => v.inv('Dusty key') > 0 || !below(v) },
    until: v => v.level('Ranged') >= 99,
    phases: [
        phase(
            combat,
            {
                target: 'Lesser demon',
                skill: 'Strength',
                allowMaxed: true,
                weapon: 'Excalibur',
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
            { ...dragons, ammo: 'Steel arrow', loot: ['Steel arrow'] },
            {
                name: 'fight-steel',
                when: v => ready(v) && steel(v) > 0,
                until: v => v.level('Ranged') >= 99,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            combat,
            { ...dragons, ammo: 'Iron arrow', loot: ['Iron arrow'] },
            {
                name: 'fight-iron',
                when: v => ready(v) && iron(v) > 0,
                until: v => v.level('Ranged') >= 99,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            travel,
            { to: { x: 2947, z: 3370 }, tolerance: 3, flee: true },
            {
                name: 'leave',
                when: v => below(v) && (foodN(v) < 3 || (steel(v) === 0 && iron(v) === 0)),
                maxFails: 4,
            },
        ),
        phase(
            shop,
            {
                npc: 'Lowe',
                at: { x: 3232, z: 3423 },
                buy: [
                    { item: 'Oak shortbow', count: 1, maxUnitPrice: 150 },
                    { item: 'Steel arrow', count: 100, maxUnitPrice: 40 },
                    { item: 'Steel arrow', count: 100, maxUnitPrice: 40 },
                    { item: 'Steel arrow', count: 100, maxUnitPrice: 40 },
                ],
            },
            { name: 'lowes', when: v => !below(v) && held(v, 'Oak shortbow') === 0 && v.runs('lowes') === 0 },
        ),
        phase(
            bank,
            {
                area: { x: 2947, z: 3367, radius: 6 },
                depositAllExcept: [
                    'Dusty key',
                    'Coins',
                    'Excalibur',
                    'Dragonfire shield',
                    'Oak shortbow',
                    'Steel arrow',
                    'Iron arrow',
                ],
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
