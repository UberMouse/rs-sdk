// The Restless Ghost (server/content/scripts/quests/quest_priest, areas/area_lumbridge/scripts/father_{aereck,urhney}.rs2)
// as phases chosen from the inventory, the worn items and the previous phase, so it resumes after any phase:
//   Father Aereck (Lumbridge chapel) -> Father Urhney (swamp house; Ghostspeak amulet) -> wear the amulet ->
//   open the coffin in the graveyard behind the chapel, talk to the Restless ghost (it stays 100 ticks after
//   the coffin is opened) -> Wizards' Tower basement: take the Skull from the ground (a level-13 skeleton
//   appears and attacks; flee it to the coffin) -> open the coffin again, use the Skull on it.
// The quest tab (green = done) ends the plan, but it shows no stage, so a phase whose conversation depends on the
// stage (Aereck, the ghost) runs with onFail 'continue' and the next phase is chosen from `last`: a conversation
// from a later quest state offers other choices, fails, and the plan moves on.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const AMULET = /^Ghostspeak amulet$/i;
const COFFIN_SPOT = { x: 3248, z: 3195, tolerance: 2 };
const SKULL_SPOT = { x: 3120, z: 9567 };

const worn = (v: PlanView) => v.state.equipment.some(i => AMULET.test(i.name));
const inCombat = (v: PlanView) => !!v.state.player?.combat.inCombat;
const lastWas = (v: PlanView, name: string) => v.last?.phase === name;

export default definePlan({
    name: 'restless-ghost',
    description:
        'The Restless Ghost: Father Aereck -> Father Urhney (amulet) -> wear it -> ghost at the coffin -> Wizards Tower basement skull -> skull on the coffin; resumes from the inventory.',
    phases: [
        // The finish: the coffin was just opened (or already was): use the skull on it.
        phase(
            talk,
            { use: { items: ['^Skull$'], onLoc: '^Coffin$' }, at: COFFIN_SPOT },
            { name: 'use-skull', when: v => v.inv('Skull') > 0 && lastWas(v, 'open-coffin-final') },
        ),
        phase(
            interact,
            { target: 'item', name: AMULET.source, option: '^wear' },
            { name: 'wear-amulet', when: v => v.inv(AMULET) > 0 },
        ),
        // The skeleton the skull summons is chasing: run to the coffin (travel may start in combat).
        phase(
            travel,
            { to: { x: COFFIN_SPOT.x, z: COFFIN_SPOT.z, level: 0 }, tolerance: 3, flee: true },
            { name: 'flee-skeleton', when: v => v.inv('Skull') > 0 && inCombat(v) },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Coffin$', option: '^Open$', at: COFFIN_SPOT },
            { name: 'open-coffin-final', when: v => v.inv('Skull') > 0, onFail: 'continue' },
        ),
        phase(
            pickup,
            { area: { ...SKULL_SPOT, radius: 3 }, items: [{ item: 'Skull' }] },
            {
                name: 'fetch-skull',
                when: v => worn(v) && (v.runs('ghost-talk') > 0 || lastWas(v, 'ghost-talk')),
            },
        ),
        phase(
            talk,
            { npc: 'Restless ghost', at: COFFIN_SPOT, choices: ['now tell me what the problem is'] },
            { name: 'ghost-talk', when: v => lastWas(v, 'open-coffin'), onFail: 'continue' },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Coffin$', option: '^Open$', at: COFFIN_SPOT },
            { name: 'open-coffin', when: v => worn(v) && !lastWas(v, 'ghost-talk'), onFail: 'continue' },
        ),
        phase(
            talk,
            {
                npc: 'Father Urhney',
                at: { x: 3235, z: 3153, tolerance: 2 },
                choices: ['Father Aereck sent me', 'ghost haunting his graveyard'],
            },
            { name: 'urhney', when: v => v.runs('aerick') > 0 || lastWas(v, 'aerick') },
        ),
        phase(
            talk,
            { npc: 'Father Aereck', at: { x: 3244, z: 3206, tolerance: 3 }, choices: ["I'm looking for a quest"] },
            { name: 'aerick', onFail: 'continue' },
        ),
    ],
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone('priest'),
});
