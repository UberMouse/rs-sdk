// Imp Catcher (wiki/quests/imp-catcher.md): Wizard Mizgog (Wizards' Tower top floor, by its stairs) starts the
// quest; imps drop the four beads (5/128 each per kill); Mizgog takes the beads and completes it.
// Imps are single spawns here (the far clusters held none in game 2026-10-23), so the bead hunt rotates
// over Lumbridge and the Varrock imp spots: when one spot has no free imp, the next is tried.
// Phases are chosen from the quest tab and what is held (the previous phase only picks the next spot), so the plan
// resumes at any stage.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const mizgog = { npc: '^Wizard Mizgog$', at: { x: 3104, z: 3162, level: 2, tolerance: 3 } };
const BEADS = ['Red bead', 'Yellow bead', 'Black bead', 'White bead'];
const anyBead = (v: { inv(n: string): number }) => BEADS.some(b => v.inv(b) > 0);
// The quest tab says started; a bead held covers a tab not yet read.
const started = (v: PlanView) => v.quest('imp') !== 'none' || anyBead(v);
const hasAll = (v: { inv(n: string): number }) => BEADS.every(b => v.inv(b) > 0);

// Camp the Falador-south spawn cluster with a wide area and a long respawn wait; the wide stray areas behind it run only
// when the camp phase ends empty. combat attacks only inside `area`, so every area is wide. Areas stay south of z 3520
// (the Wilderness).
const SPOTS = [
    { name: 'imp-camp-falador-s', x: 3012, z: 3311, radius: 55, wait: 600 },
    { name: 'imp-lumbridge', x: 3205, z: 3240, radius: 60, wait: 60 },
    { name: 'imp-draynor', x: 3073, z: 3252, radius: 55, wait: 60 },
    { name: 'imp-champions', x: 3205, z: 3355, radius: 55, wait: 0 },
    { name: 'imp-varrock-e', x: 3235, z: 3400, radius: 60, wait: 0 },
    { name: 'imp-edgeville', x: 3085, z: 3455, radius: 55, wait: 0 },
];
const isSpot = (name: string | undefined) => SPOTS.some(s => s.name === name);

export default definePlan({
    name: 'imp-catcher',
    description: 'Imp Catcher: talk Mizgog, rotate over single imp spots for four beads, talk Mizgog again.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(talk, { ...mizgog }, { name: 'finish', when: v => hasAll(v) && started(v) }),
        // A long walk planned from Mizgog's floor finds no route: step down to the ground floor first.
        phase(
            travel,
            { to: { x: 3109, z: 3168, level: 0 }, tolerance: 2 },
            { name: 'leave-tower', when: v => !hasAll(v) && started(v) && v.state.player?.level === 2 },
        ),
        ...SPOTS.map((s, i) =>
            phase(
                combat,
                {
                    target: 'Imp',
                    area: { x: s.x, z: s.z, radius: s.radius },
                    loot: BEADS,
                    respawnWaitTicks: s.wait,
                    skill: 'Strength',
                },
                {
                    name: s.name,
                    // Ring: after a spot fails the next one runs; any other previous phase starts at the first spot
                    // or where the last attempt was.
                    when: v => {
                        if (hasAll(v) || !started(v)) return false;
                        const last = v.last?.phase;
                        if (!isSpot(last)) return i === 0;
                        return SPOTS[(i + SPOTS.length - 1) % SPOTS.length]!.name === last;
                    },
                    until: hasAll,
                    onFail: 'continue',
                    maxFails: 100,
                },
            ),
        ),
        phase(
            talk,
            { ...mizgog, choices: ['^Give me a quest!$', '^Give me a quest please'] },
            { name: 'start', when: v => !started(v) },
        ),
    ],
    until: v => v.inv('Amulet of accuracy') > 0,
});
