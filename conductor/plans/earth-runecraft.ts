// Earth runecraft: bank errand -> air trips while Runecraft < 9 -> hunt Men near Aubury for an Earth talisman
// -> earth loop (Aubury teleport -> mine essence until full -> portal back -> earth ruins craft).
import { definePlan, phase } from '@conductor/lib/plan';
import { inEssenceMine } from '@conductor/lib/runecraft';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import essenceMine from '@conductor/tasks/essence-mine';
import mining from '@conductor/tasks/mining';
import runecraft from '@conductor/tasks/runecraft';

const ESS = /^rune essence$/i;
const ROCK_AREA = { x: 2891, z: 4847, radius: 6 };
const earthReady = (v: { inv(n: string): number; level(s: string): number }) =>
    v.inv('Earth talisman') > 0 && v.level('Runecraft') >= 9;

export default definePlan({
    name: 'earth-runecraft',
    description: 'Hunt an Earth talisman, then Aubury -> essence mine -> Earth altar loop',
    requires: {
        'Air talisman or Earth talisman': v =>
            v.inv('Air talisman') + v.inv('Earth talisman') > 0 || v.runs('bank') === 0,
    },
    phases: [
        phase(
            bank,
            {
                area: { x: 3185, z: 3436, radius: 6 },
                depositAllExcept: ['Adamant pickaxe', 'Coins'],
                withdraw: [{ item: 'Air talisman', count: 1 }],
            },
            { when: v => v.runs('bank') === 0 },
        ),
        phase(
            runecraft,
            { altar: 'earth' },
            { name: 'craft-earth', when: v => v.inv(ESS) > 0 && !inEssenceMine(v.state) && earthReady(v) },
        ),
        phase(
            runecraft,
            { altar: 'air' },
            { name: 'craft-air', when: v => v.inv(ESS) > 0 && !inEssenceMine(v.state) && !earthReady(v) },
        ),
        phase(essenceMine, { action: 'leave' }, { name: 'leave-mine', when: v => inEssenceMine(v.state) && v.full }),
        phase(
            mining,
            { rock: 'essence', onFull: 'stop', area: ROCK_AREA },
            { name: 'mine-essence', when: v => inEssenceMine(v.state) },
        ),
        phase(
            combat,
            { target: 'Man', area: { x: 3238, z: 3404, radius: 14 }, skill: 'Strength', loot: ['Earth talisman'] },
            {
                name: 'hunt',
                when: v => v.runs('bank') > 0 && v.level('Runecraft') >= 9 && v.inv('Earth talisman') === 0,
                until: v => v.inv('Earth talisman') > 0,
            },
        ),
        phase(
            essenceMine,
            { action: 'enter' },
            {
                name: 'enter-mine',
                when: v =>
                    v.inv(ESS) === 0 && v.runs('bank') > 0 && (v.level('Runecraft') < 9 || v.inv('Earth talisman') > 0),
            },
        ),
    ],
});
