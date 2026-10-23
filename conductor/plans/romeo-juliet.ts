// Romeo & Juliet (server/content/scripts/areas/area_varrock/scripts/{juliet,romeo,father_lawrence,apothecary}.rs2).
// Juliet can start the quest herself ("I guess I could find him" -> message, stage 2), so stage 1 never occurs.
// The quest tab shows no stage, so the next step rides on the items held and on where the bot stands (the last
// NPC it talked to): Juliet -> Romeo (message) -> Father Lawrence -> Apothecary -> cadava berries (ground spawn
// south-east of Varrock) -> Apothecary (potion) -> Juliet (potion) -> Romeo (finish). Every conversation is
// harmless in a stage it does not advance, so a restart from any place and inventory walks the chain again.
// The route from Lumbridge avoids the Varrock stone circle dark wizards (learnings/hazards.md) via (3260,3335).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'romeojuliet';
const juliet = { npc: 'Juliet', at: { x: 3158, z: 3425, level: 1, tolerance: 3 } };
const romeo = { npc: 'Romeo', at: { x: 3211, z: 3425, level: 0, tolerance: 4 } };
const lawrence = { npc: 'Father Lawrence', at: { x: 3254, z: 3475, level: 0, tolerance: 3 } };
const apothecary = { npc: 'Apothecary', at: { x: 3195, z: 3404, level: 0, tolerance: 2 } };
const BERRIES = { x: 3272, z: 3369, radius: 10 };

const near = (v: PlanView, c: { x: number; z: number }, r: number, level = 0) => {
    const p = v.state.player;
    return !!p && p.level === level && Math.max(Math.abs(p.worldX - c.x), Math.abs(p.worldZ - c.z)) <= r;
};
const atJuliet = (v: PlanView) => near(v, juliet.at, 8, 1);
const atRomeo = (v: PlanView) => near(v, romeo.at, 14);
const atLawrence = (v: PlanView) => near(v, lawrence.at, 8);
const atApothecary = (v: PlanView) => near(v, apothecary.at, 6);
const started = (v: PlanView) => v.quest(ID) === 'started';
const noItems = (v: PlanView) => v.inv('Message') + v.inv('Cadava berries') + v.inv('Cadava potion') === 0;

export default definePlan({
    name: 'romeo-juliet',
    description:
        "Romeo & Juliet: Juliet (start, message) -> Romeo -> Father Lawrence -> Apothecary -> cadava berries -> Apothecary -> Juliet -> Romeo; chosen from the held items and the last NPC's place.",
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(
            talk,
            { ...juliet },
            { name: 'juliet-potion', when: v => v.inv('Cadava potion') > 0, onFail: 'continue', maxFails: 8 },
        ),
        phase(
            talk,
            { ...apothecary },
            { name: 'apothecary-potion', when: v => v.inv('Cadava berries') > 0, onFail: 'continue', maxFails: 8 },
        ),
        phase(
            talk,
            { ...romeo },
            { name: 'romeo-message', when: v => v.inv('Message') > 0, onFail: 'continue', maxFails: 8 },
        ),
        phase(
            talk,
            { ...romeo },
            {
                name: 'romeo-finish',
                when: v => started(v) && noItems(v) && atJuliet(v),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            pickup,
            { area: BERRIES, items: [{ item: 'Cadava berries', count: 1 }] },
            {
                name: 'berries',
                when: v => started(v) && noItems(v) && atApothecary(v),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            talk,
            { ...apothecary },
            {
                name: 'apothecary-start',
                when: v => started(v) && noItems(v) && atLawrence(v),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            talk,
            { ...lawrence },
            { name: 'lawrence', when: v => started(v) && noItems(v) && atRomeo(v), onFail: 'continue', maxFails: 8 },
        ),
        // Out of Lumbridge: approach Varrock from the south-east, past the stone circle.
        phase(
            travel,
            { to: { x: 3262, z: 3400, level: 0 }, tolerance: 4, waypoints: [{ x: 3260, z: 3335 }] },
            {
                name: 'approach',
                when: v => (v.state.player?.worldZ ?? 9999) < 3330 && (v.state.player?.level ?? 0) === 0,
            },
        ),
        phase(
            talk,
            { ...juliet, choices: ['I guess I could find him'] },
            { name: 'juliet-start', when: v => v.quest(ID) === 'none' },
        ),
        // Started, no items, at no known place: Romeo is the safe probe (finishes the quest at the last stage).
        phase(
            talk,
            { ...romeo },
            { name: 'romeo-probe', when: v => started(v) && noItems(v), onFail: 'continue', maxFails: 8 },
        ),
    ],
    until: v => v.questDone(ID),
});
