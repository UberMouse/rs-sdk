// Strength on Edgeville Dungeon hill giants: bank at Varrock West, buy Mithril scimitar at Zeke (Al Kharid),
// walk (avoiding the stone circle) to Edgeville, down the trapdoor, fight with burying; restock fish at Edgeville bank.
import { definePlan, phase } from '@conductor/lib/plan';
import type { PlanView } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import shop from '@conductor/tasks/shop';
import travel from '@conductor/tasks/travel';

const giants = { x: 3107, z: 9834, radius: 12 };
const edgeBank = { x: 3094, z: 3492, radius: 3 };
const food = ['Salmon', 'Trout'];
const MIN_FOOD = 4;
const foodN = (v: PlanView) => v.inv('Salmon') + v.inv('Trout');
const hasScim = (v: PlanView) =>
    v.inv('Mithril scimitar') > 0 || v.state.equipment.some(i => /^mithril scimitar$/i.test(i.name));
const below = (v: PlanView) => (v.state.player?.worldZ ?? 0) > 9000;

export default definePlan({
    name: 'hill-giants',
    method: 'hill-giants-edgeville',
    description: 'Strength on Edgeville Dungeon hill giants with a Mithril scimitar, burying big bones',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            combat,
            {
                target: 'Giant',
                skill: 'Strength',
                weapon: 'Mithril scimitar',
                shield: 'Iron kiteshield',
                food,
                eatBelow: 0.5,
                buryBones: true,
                area: giants,
            },
            { name: 'fight', when: v => hasScim(v) && foodN(v) >= MIN_FOOD && below(v) },
        ),
        phase(
            bank,
            {
                area: edgeBank,
                depositAllExcept: ['Coins'],
                withdraw: [
                    { item: 'Salmon', count: 9, upTo: true },
                    { item: 'Trout', count: 9, upTo: true },
                ],
            },
            { name: 'restock', when: v => hasScim(v) && foodN(v) < MIN_FOOD },
        ),
        phase(
            travel,
            {
                to: { x: 3107, z: 9834 },
                tolerance: 6,
                waypoints: [
                    { x: 3300, z: 3315 },
                    { x: 3260, z: 3335 },
                    { x: 3260, z: 3400 },
                    { x: 3200, z: 3430 },
                    { x: 3100, z: 3440 },
                ],
            },
            { name: 'to-giants', when: v => hasScim(v) && foodN(v) >= MIN_FOOD && !below(v) },
        ),
        phase(
            bank,
            {
                depositAllExcept: [],
                withdraw: [
                    { item: 'Coins', count: 1600 },
                    { item: 'Salmon', count: 9, upTo: true },
                    { item: 'Trout', count: 9, upTo: true },
                    { item: 'Iron kiteshield', count: 1 },
                ],
            },
            { name: 'bank-west', when: v => !hasScim(v) && v.runs('bank-west') === 0 },
        ),
        phase(
            shop,
            { npc: 'Zeke', at: { x: 3288, z: 3190 }, buy: [{ item: 'Mithril scimitar', count: 1 }] },
            { name: 'scimitar', when: v => !hasScim(v) && v.runs('bank-west') > 0 && v.inv('Coins') >= 1040 },
        ),
    ],
});
