// Rune Mysteries (wiki/quests/rune-mysteries.md) as talk phases, chosen from the inventory so it resumes
// at any stage: Duke Horacio (Lumbridge castle, 2nd floor) gives the air talisman; Sedridor (Wizards' Tower
// basement, via the ground floor ladder, never upstairs: a lesser demon lives on the top floor) takes it and
// gives the research package; Aubury (Varrock rune shop) takes the package, and on a second talk gives the
// research notes; Sedridor takes the notes: the quest is complete and the talisman comes back.
// Dialog texts from server/content/scripts/areas/{area_lumbridge/duke_horacio,area_wizard_tower/sedridor,area_varrock/aubury}.rs2.
import { definePlan, phase } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import talk from '@conductor/tasks/talk';

const duke = { npc: 'Duke Horacio', at: { x: 3211, z: 3221, level: 1 } };
const sedridor = { npc: 'Sedridor', at: { x: 3104, z: 9570, level: 0, tolerance: 2 } };
const aubury = { npc: 'Aubury', at: { x: 3252, z: 3402, tolerance: 2 } };

export default definePlan({
    name: 'rune-mysteries',
    description:
        'Rune Mysteries: Duke Horacio -> Sedridor -> Aubury (package, then notes) -> Sedridor; resumes from the inventory.',
    phases: [
        // The finish: Sedridor takes the notes (no choices) and completes the quest.
        phase(talk, { ...sedridor }, { name: 'sedridor-notes', when: v => v.inv(/^notes$/i) > 0 }),
        // Aubury has the package: talk again for his notes.
        phase(
            talk,
            { ...aubury },
            {
                name: 'aubury-notes',
                when: v => v.runs('aubury-package') > 0 && v.inv('Research package') === 0 && v.inv(/^notes$/i) === 0,
            },
        ),
        phase(
            talk,
            { ...aubury, choices: ['sent here with a package'] },
            { name: 'aubury-package', when: v => v.inv('Research package') > 0 },
        ),
        phase(
            talk,
            { ...sedridor, choices: ['looking for the head wizard', 'Ok, here you are', 'Yes, certainly'] },
            { name: 'sedridor-talisman', when: v => v.inv('Air talisman') > 0 && v.runs('sedridor-talisman') === 0 },
        ),
        phase(talk, { ...duke, choices: ['quests for me', 'Sure, no problem'] }, { name: 'duke' }),
    ],
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone('runemysteries'),
});
