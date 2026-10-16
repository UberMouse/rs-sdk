// Magic 66 via Wind Blast on the Edgeville Dungeon giants: Varrock East bank (coins, food), Aubury (death runes),
// Zaff (Staff of air + Staff of fire), walk to Edgeville and down, cast with the worn Staff of air; restock at Edgeville.
import { definePlan, phase } from '@conductor/lib/plan';
import type { PlanView } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import shop from '@conductor/tasks/shop';
import travel from '@conductor/tasks/travel';

const giants = { x: 3107, z: 9834, radius: 12 };
const eastBank = { x: 3254, z: 3420, radius: 3 };
const edgeBank = { x: 3094, z: 3492, radius: 3 };
const food = ['Salmon', 'Trout'];
const MIN_FOOD = 4;
const MIN_DEATH = 5;
const DEATH = 145;
const foodN = (v: PlanView) => v.inv('Salmon') + v.inv('Trout');
const hasStaff = (v: PlanView) =>
    v.inv('Staff of air') > 0 || v.state.equipment.some(i => /^staff of air$/i.test(i.name));
const below = (v: PlanView) => (v.state.player?.worldZ ?? 0) > 9000;
const farFromEast = (v: PlanView) => {
    const p = v.state.player;
    return !p || Math.abs(p.worldX - eastBank.x) > 25 || Math.abs(p.worldZ - eastBank.z) > 25;
};
const ready = (v: PlanView) => hasStaff(v) && v.inv('Death rune') >= MIN_DEATH;

export default definePlan({
    name: 'magic-blast-giants',
    description:
        'Magic 66: Wind Blast with a Staff of air on the Edgeville Dungeon giants; buys staves and death runes in Varrock',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    until: v => v.level('Magic') >= 66,
    phases: [
        phase(
            interact,
            { target: 'item', name: '^Staff of air$', option: '^wield' },
            { name: 'wield-staff', when: v => v.inv('Staff of air') > 0 && v.free >= 1 && below(v) },
        ),
        phase(
            combat,
            {
                target: 'Giant',
                skill: 'Magic',
                spell: 'Wind Blast',
                weapon: 'Staff of air',
                food,
                eatBelow: 0.5,
                buryBones: true,
                area: giants,
            },
            {
                name: 'cast',
                when: v => ready(v) && v.inv('Staff of air') === 0 && foodN(v) >= MIN_FOOD && below(v),
                onFail: 'continue',
            },
        ),
        phase(
            bank,
            {
                area: edgeBank,
                depositAllExcept: ['Coins', 'Death rune', 'Staff of air'],
                withdraw: [
                    { item: 'Salmon', count: 8, upTo: true },
                    { item: 'Trout', count: 8, upTo: true },
                ],
            },
            {
                name: 'restock',
                when: v => ready(v) && (foodN(v) < MIN_FOOD || (v.inv('Staff of air') > 0 && v.free < 1)),
            },
        ),
        phase(
            travel,
            {
                to: { x: 3107, z: 9834 },
                tolerance: 6,
                waypoints: [
                    { x: 3200, z: 3430 },
                    { x: 3100, z: 3440 },
                ],
            },
            { name: 'to-giants', when: v => ready(v) && foodN(v) >= MIN_FOOD && !below(v) },
        ),
        phase(
            shop,
            {
                npc: 'Zaff',
                at: { x: 3203, z: 3433 },
                buy: [
                    { item: 'Staff of air', count: 1 },
                    { item: 'Staff of fire', count: 1 },
                ],
            },
            { name: 'zaff', when: v => !hasStaff(v) && v.inv('Death rune') >= MIN_DEATH },
        ),
        phase(
            shop,
            { npc: 'Aubury', at: { x: 3253, z: 3402 }, buy: [{ item: 'Death rune', count: DEATH }] },
            { name: 'aubury', when: v => v.runs('bank-east') > 0 && v.inv('Death rune') < MIN_DEATH },
        ),
        phase(
            bank,
            {
                area: eastBank,
                depositAllExcept: ['Coins'],
                withdraw: [
                    { item: 'Coins', count: 14000 },
                    { item: 'Salmon', count: 8, upTo: true },
                    { item: 'Trout', count: 8, upTo: true },
                ],
            },
            { name: 'bank-east', when: v => v.runs('bank-east') === 0 && !farFromEast(v) },
        ),
        phase(
            travel,
            {
                to: { x: 3254, z: 3418 },
                tolerance: 3,
                waypoints: [
                    { x: 3253, z: 3290 },
                    { x: 3260, z: 3335 },
                    { x: 3260, z: 3400 },
                ],
            },
            { name: 'to-varrock', when: v => v.runs('bank-east') === 0 && farFromEast(v) },
        ),
    ],
});
