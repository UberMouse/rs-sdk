// Earth runecraft with a 28-slot layout: bank everything but the pickaxe and Earth talisman, wield the pickaxe
// (the scimitar goes to the bank), then loop Aubury teleport -> mine essence until full -> portal -> Earth altar.
import { definePlan, phase } from '@conductor/lib/plan';
import { inEssenceMine } from '@conductor/lib/runecraft';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import essenceMine from '@conductor/tasks/essence-mine';
import mining from '@conductor/tasks/mining';
import runecraft from '@conductor/tasks/runecraft';

const ESS = /^rune essence$/i;
const PICK = /^adamant pickaxe$/i;
const SCIM = /^(steel|mithril) scimitar$/i;
const BANK_AREA = { x: 3254, z: 3420, radius: 5 };
const pickWorn = (v: { state: { equipment: { name: string }[] } }) => v.state.equipment.some(i => PICK.test(i.name));

export default definePlan({
    name: 'earth-runecraft-28',
    method: 'earth-runecraft-aubury-essence',
    description: 'Earth runecraft loop carrying only the Earth talisman and essence (pickaxe wielded)',
    requires: { 'Earth talisman or banked': v => v.inv('Earth talisman') > 0 || v.runs('bank-1') === 0 },
    phases: [
        phase(
            bank,
            {
                area: BANK_AREA,
                depositAllExcept: ['Adamant pickaxe', 'Earth talisman'],
                withdraw: [
                    { item: 'Adamant pickaxe', count: 1, upTo: true },
                    { item: 'Earth talisman', count: 1, upTo: true },
                ],
            },
            { name: 'bank-1', when: v => v.runs('bank-1') === 0 },
        ),
        phase(
            combat,
            { target: 'Man', area: { x: 3238, z: 3404, radius: 14 }, skill: 'Strength', weapon: 'Adamant pickaxe' },
            {
                name: 'wield',
                when: v => v.runs('bank-1') > 0 && v.inv(PICK) > 0 && !inEssenceMine(v.state),
                until: pickWorn,
            },
        ),
        phase(
            bank,
            { area: BANK_AREA, depositAllExcept: ['Earth talisman'] },
            { name: 'bank-2', when: v => v.inv(SCIM) > 0 && !inEssenceMine(v.state) },
        ),
        phase(
            runecraft,
            { altar: 'earth' },
            { name: 'craft-earth', when: v => v.inv(ESS) > 0 && !inEssenceMine(v.state) },
        ),
        phase(essenceMine, { action: 'leave' }, { name: 'leave-mine', when: v => inEssenceMine(v.state) && v.full }),
        phase(mining, { rock: 'essence', onFull: 'stop' }, { name: 'mine-essence', when: v => inEssenceMine(v.state) }),
        phase(
            essenceMine,
            { action: 'enter' },
            {
                name: 'enter-mine',
                when: v =>
                    v.inv(ESS) === 0 && v.inv(SCIM) === 0 && v.inv(PICK) === 0 && v.runs('bank-1') > 0 && pickWorn(v),
            },
        ),
    ],
});
