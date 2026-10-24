// Attack and Defence 40 on the Falador farm cows (targetRange visible), Mithril scimitar from Zeke (Al Kharid).
import { definePlan, phase } from '@conductor/lib/plan';
import type { PlanView } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import shop from '@conductor/tasks/shop';
import travel from '@conductor/tasks/travel';

const farm = { x: 3027, z: 3307, radius: 22 };
const hasScim = (v: PlanView) =>
    v.inv('Mithril scimitar') > 0 || v.state.equipment.some(i => /^mithril scimitar$/i.test(i.name));
const dist = (v: PlanView) =>
    Math.max(Math.abs((v.state.player?.worldX ?? 0) - farm.x), Math.abs((v.state.player?.worldZ ?? 0) - farm.z));
const atFarm = (v: PlanView) => v.state.player?.level === 0 && dist(v) <= 30;
const done = (v: PlanView) => v.level('Attack') >= 40 && v.level('Defence') >= 40;

export default definePlan({
    name: 'melee40',
    method: 'cows-falador-farm',
    description: 'Attack then Defence to 40 on Falador farm cows with a Mithril scimitar',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    until: done,
    phases: [
        phase(
            combat,
            {
                target: 'Cow',
                skill: 'Attack',
                weapon: 'Mithril scimitar',
                shield: 'Wooden shield',
                targetRange: 'visible',
                area: farm,
                respawnWaitTicks: 30,
            },
            {
                name: 'fight-attack',
                when: v => hasScim(v) && atFarm(v) && v.level('Attack') < 40,
                until: v => v.level('Attack') >= 40,
            },
        ),
        phase(
            combat,
            {
                target: 'Cow',
                skill: 'Defence',
                weapon: 'Mithril scimitar',
                shield: 'Wooden shield',
                targetRange: 'visible',
                area: farm,
                respawnWaitTicks: 30,
            },
            {
                name: 'fight-defence',
                when: v => hasScim(v) && atFarm(v) && v.level('Attack') >= 40 && v.level('Defence') < 40,
            },
        ),
        phase(
            travel,
            { to: { x: 3027, z: 3307 }, tolerance: 6 },
            { name: 'to-farm', when: v => hasScim(v) && v.state.player?.level === 0 && !atFarm(v) },
        ),
        phase(
            shop,
            { npc: 'Zeke', at: { x: 3288, z: 3190 }, buy: [{ item: 'Mithril scimitar', count: 1 }] },
            {
                name: 'scimitar',
                when: v =>
                    !hasScim(v) && v.runs('bank-start') > 0 && v.state.player?.level === 0 && v.inv('Coins') >= 1040,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Climb-down$',
                at: { x: 2475, z: 3401, level: 1, tolerance: 2 },
            },
            { name: 'descend', when: v => v.runs('bank-start') > 0 && v.state.player?.level === 1 },
        ),
        phase(
            bank,
            {
                area: { x: 2445, z: 3425, radius: 4, level: 1 },
                depositAllExcept: [],
                withdraw: [{ item: 'Coins', count: 2000 }],
            },
            { name: 'bank-start', when: v => v.runs('bank-start') === 0 },
        ),
    ],
});
