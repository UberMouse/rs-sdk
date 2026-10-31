// Doric's Quest (server/content/scripts/quests/quest_doric/scripts/quest_doric.rs2, id doric, varp doricquest 0..100):
// Doric (2951,3451) asks for 6 Clay, 4 Copper ore and 2 Iron ore (checked with inv_total, so the pack may hold more), pays 180 gp.
// The ores are mined at the Rimmington mine (clay, copper and iron within x 2968-2987, z 3233-3248), then Doric is told twice:
// once to start (anvils, "Yes, I will get you materials"), once to hand over. Start save: lib:dorics-quest-start.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import mining from '@conductor/tasks/mining';
import talk from '@conductor/tasks/talk';

const ID = 'doric';
const mine = { x: 2978, z: 3241, radius: 16 };
const doric = { x: 2951, z: 3451, tolerance: 4 };
const haveAll = (v: PlanView) => v.inv('Clay') >= 6 && v.inv('Copper ore') >= 4 && v.inv('Iron ore') >= 2;

export default definePlan({
    name: 'dorics-quest',
    description: "Doric's Quest: mine 6 clay, 4 copper ore and 2 iron ore at Rimmington, talk to Doric twice.",
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            talk,
            { npc: 'Doric', at: doric, choices: ['Yes, I will get you materials'] },
            { name: 'hand-over', when: v => haveAll(v) && v.quest(ID) === 'started' && v.last?.phase !== 'start' },
        ),
        // The quest tab lags the dialog's end: a talk with no dialog open waits a few ticks and fails.
        phase(
            talk,
            { continue: true },
            {
                name: 'start-wait',
                when: v =>
                    haveAll(v) && v.quest(ID) !== 'done' && v.last?.phase === 'start' && v.last.status === 'done',
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        // Doric's house has a closed door on its south wall; the walker does not open it (Doric reads as unreachable).
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2949, z: 3450 },
                at: { x: 2949, z: 3448, tolerance: 2 },
            },
            { name: 'open-door', when: v => haveAll(v) && v.quest(ID) === 'none' && v.runs('open-door') === 0 },
        ),
        phase(
            talk,
            { npc: 'Doric', at: doric, choices: ['I wanted to use your anvils', 'Yes, I will get you materials'] },
            { name: 'start', when: v => haveAll(v) && v.quest(ID) === 'none' },
        ),
        phase(
            mining,
            { rock: 'clay', onFull: 'stop', area: mine },
            { name: 'mine-clay', when: v => v.inv('Clay') < 6, until: v => v.inv('Clay') >= 6 },
        ),
        phase(
            mining,
            { rock: 'copper', onFull: 'stop', area: mine },
            { name: 'mine-copper', when: v => v.inv('Copper ore') < 4, until: v => v.inv('Copper ore') >= 4 },
        ),
        phase(
            mining,
            { rock: 'iron', onFull: 'stop', area: mine },
            { name: 'mine-iron', when: v => v.inv('Iron ore') < 2, until: v => v.inv('Iron ore') >= 2 },
        ),
    ],
});
