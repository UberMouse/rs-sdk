// Dwarf Cannon (server scripts: quests/quest_mcannon/scripts/, varp mcannon 0-10, 11 = done), start to done.
// The quest tab shows only none/started/done, so the stages ride on held items, position and the dialog history:
//   0 -> 1 Dwarf Commander (camp 2571,3463): six Railings; 1: replace the six broken railings (loc ids 15-20, "Try to
//   replace", a Crafting roll, a failed try cuts 3 HP); report (-> 2); 2: the watchtower south (ladder 2570,3441), take the
//   Dwarf remains, hand them in (-> 3); 3: the cave entrance by the goblins (~2623,3394) -> 4 -> the crate with Lollk
//   (cave) -> 5; back to the Commander (Tool kit, -> 6); the Broken MultiCannon in the shed (door 2576,3461): the first
//   inspect (-> 7), then Pipe, Barrel, Axle, Shaft (Crafting/Smithing rolls) and a last inspect (-> 8); the Commander
//   (-> 9, send to Nulodion, Ice Mountain south 3011,3453, door 3015,3453); Nulodion gives the notes and the mould (-> 10);
//   the Commander takes them (-> done).
// Start save: lib:dwarf-cannon-start (Crafting 85, Smithing 87 so the repair rolls rarely fail; 10 swordfish; nothing else).
// Restart-safe: gates read held items, the position, locs and the dialog and message history, never run counts.
// A failed railing try changes nothing the idle rail sees, so a `nudge` walk to a fresh tile follows each failure.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'mcannon';
const n = (v: PlanView, name: string) => v.inv(name);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const started = (v: PlanView) => v.quest(ID) === 'started';
const surface = (v: PlanView) => pz(v) < 6000;
const level = (v: PlanView) => v.state.player?.level ?? 0;

const railings = (v: PlanView) => n(v, 'Railing');
const remains = (v: PlanView) => n(v, 'Dwarf remains');
const kit = (v: PlanView) => n(v, 'Tool kit');
const mould = (v: PlanView) => n(v, 'Ammo mould');
const notes = (v: PlanView) => n(v, "Nulodion's notes.");

const toldTower = (v: PlanView) => heard(v, /Black Guard watch tower/i);
const handedRemains = (v: PlanView) => heard(v, /seek out the Goblins base/i);
const freedChild = (v: PlanView) => heard(v, /Thank the heavens, you saved me/i);
const fixedCannon = (v: PlanView) => heard(v, /working order/i);
const sentToNulodion = (v: PlanView) => heard(v, /located just South of the Ice Mountain/i);

const CAMP = { x: 2571, z: 3462, tolerance: 3 };
const COMMANDER = { npc: '^Dwarf Commander$', at: CAMP };

// The six broken railings, loc ids 15-20 (id 14 is a sound one), in the order tried, with the Commander's six held.
const BROKEN = [
    { x: 2572, z: 3460 },
    { x: 2564, z: 3460 },
    { x: 2559, z: 3462 },
    { x: 2557, z: 3464 },
    { x: 2558, z: 3472 },
    { x: 2556, z: 3475 },
];
// Nudge targets inside the camp, spaced so each walk really moves; picked by HP so repeated failures differ.
const NUDGE = [
    { x: 2563, z: 3464 },
    { x: 2566, z: 3464 },
    { x: 2569, z: 3465 },
    { x: 2572, z: 3465 },
    { x: 2565, z: 3468 },
    { x: 2568, z: 3469 },
    { x: 2571, z: 3469 },
];
const failedTry = (v: PlanView) => {
    const last = v.last?.phase ?? '';
    const k = /^fix-(\d)$/.exec(last);
    return k !== null && railings(v) === 6 - Number(k[1]);
};

const railingPhases = BROKEN.flatMap((r, i) => [
    phase(
        interact,
        {
            target: 'loc',
            name: '^Railing$',
            option: '^Inspect$',
            tile: r,
            at: { x: r.x, z: r.z, tolerance: 2 },
            expect: 'railing is broken',
            choices: ['Try to replace'],
        },
        {
            name: `fix-${i}`,
            when: v => started(v) && railings(v) === 6 - i && !(failedTry(v) && v.last?.phase === `fix-${i}`),
            maxFails: 6,
            onFail: 'continue',
        },
    ),
]);

const nudgePhases = NUDGE.map((t, i) =>
    phase(
        travel,
        { to: t, tolerance: 1 },
        {
            name: `nudge-${i}`,
            when: v => started(v) && failedTry(v) && v.hp.current % NUDGE.length === i,
            maxFails: 3,
            onFail: 'continue',
        },
    ),
);

export default definePlan({
    name: 'dwarf-cannon',
    description:
        'Dwarf Cannon: the Commander, six railings, the watchtower remains, Lollk in the goblin cave, the cannon repair in the shed, Nulodion at Ice Mountain, back to the Commander.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        // --- the finish ---
        phase(
            talk,
            { ...COMMANDER },
            { name: 'finish', when: v => started(v) && surface(v) && mould(v) > 0 && notes(v) > 0, maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Nulodion$', at: { x: 3011, z: 3453, tolerance: 2 } },
            {
                name: 'nulodion',
                when: v => started(v) && surface(v) && sentToNulodion(v) && mould(v) === 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { ...COMMANDER, choices: ['just for you'] },
            {
                name: 'to-nulodion',
                when: v =>
                    started(v) && surface(v) && kit(v) > 0 && fixedCannon(v) && !sentToNulodion(v) && mould(v) === 0,
                maxFails: 3,
            },
        ),
        // --- the cannon in the shed ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Broken MultiCannon$',
                option: '^Inspect$',
                at: { x: 2576, z: 3461, tolerance: 3 },
                expect: 'working order',
            },
            {
                name: 'inspect-last',
                when: v =>
                    started(v) && kit(v) > 0 && !fixedCannon(v) && heard(v, /fix the <?shaft/i) && !sentToNulodion(v),
                maxFails: 4,
                onFail: 'continue',
            },
        ),
        ...['pipe', 'barrel', 'axle', 'shaft'].map((part, i, all) =>
            phase(
                interact,
                {
                    target: 'loc',
                    name: '^Broken MultiCannon$',
                    option: '^Inspect$',
                    at: { x: 2576, z: 3461, tolerance: 3 },
                    choices: [part],
                },
                {
                    name: `repair-${part}`,
                    when: v =>
                        started(v) &&
                        kit(v) > 0 &&
                        heard(v, /better fix it with the toolkit|damaged components/i) &&
                        !fixedCannon(v) &&
                        !sentToNulodion(v) &&
                        all.slice(0, i).every(p => heard(v, new RegExp(`fix the <?${p}`, 'i'))) &&
                        !heard(v, new RegExp(`fix the <?${part}`, 'i')),
                    maxFails: 4,
                    onFail: 'continue',
                },
            ),
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Broken MultiCannon$',
                option: '^Inspect$',
                at: { x: 2576, z: 3461, tolerance: 3 },
            },
            {
                name: 'inspect-first',
                when: v =>
                    started(v) &&
                    kit(v) > 0 &&
                    !heard(v, /better fix it with the toolkit|damaged components|fix the <?pipe/i) &&
                    !fixedCannon(v) &&
                    !sentToNulodion(v),
                maxFails: 3,
            },
        ),
        // --- Lollk is back: the Commander gives the Tool kit ---
        phase(
            talk,
            { ...COMMANDER, choices: ["Ok, I'll see what I can do"] },
            {
                name: 'toolkit',
                when: v =>
                    started(v) && surface(v) && freedChild(v) && kit(v) === 0 && !fixedCannon(v) && !sentToNulodion(v),
                maxFails: 3,
            },
        ),
        // --- the goblin cave ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mud pile$',
                option: '^Climb-over$',
                tile: { x: 2621, z: 9796 },
                at: { x: 2620, z: 9797, tolerance: 1 },
            },
            {
                name: 'cave-out',
                until: v => surface(v),
                when: v => started(v) && !surface(v) && freedChild(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                option: '^Search$',
                expect: 'Thank the heavens',
                tile: { x: 2571, z: 9850 },
                at: { x: 2570, z: 9850, tolerance: 2 },
            },
            {
                name: 'crate',
                when: v =>
                    started(v) &&
                    !surface(v) &&
                    !freedChild(v) &&
                    Math.abs(px(v) - 2571) <= 12 &&
                    Math.abs(pz(v) - 9851) <= 12,
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 2571, z: 9849 }, tolerance: 3 },
            {
                name: 'cave-walk',
                until: v => Math.abs(px(v) - 2571) <= 12 && Math.abs(pz(v) - 9851) <= 12,
                when: v => started(v) && !surface(v) && !freedChild(v),
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 2621, z: 3393 }, tolerance: 3 },
            {
                name: 'to-cave',
                until: v => !surface(v) || Math.abs(px(v) - 2621) <= 4,
                when: v =>
                    started(v) &&
                    surface(v) &&
                    handedRemains(v) &&
                    !freedChild(v) &&
                    kit(v) === 0 &&
                    Math.abs(px(v) - 2621) > 4,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cave Entrance$', option: '^Enter$', at: { x: 2621, z: 3394, tolerance: 3 } },
            {
                name: 'cave-in',
                until: v => !surface(v),
                when: v => started(v) && surface(v) && handedRemains(v) && !freedChild(v) && kit(v) === 0,
                maxFails: 3,
            },
        ),
        // --- the watchtower ---
        phase(
            talk,
            { ...COMMANDER },
            {
                name: 'remains-in',
                when: v => started(v) && surface(v) && level(v) === 0 && remains(v) > 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { ...COMMANDER },
            {
                name: 'report-fences',
                when: v =>
                    started(v) && surface(v) && railings(v) === 0 && !toldTower(v) && remains(v) === 0 && kit(v) === 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2570, z: 3441 },
                at: { x: 2569, z: 3441, tolerance: 1 },
            },
            {
                name: 'tower-down-1',
                until: v => level(v) === 0,
                when: v => started(v) && remains(v) > 0 && level(v) === 1,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2570, z: 3443 },
                at: { x: 2569, z: 3443, tolerance: 1 },
            },
            {
                name: 'tower-down-2',
                until: v => level(v) === 1,
                when: v => started(v) && remains(v) > 0 && level(v) === 2,
                maxFails: 3,
            },
        ),
        phase(
            pickup,
            { area: { x: 2570, z: 3442, radius: 7, level: 2 }, items: [{ item: 'Dwarf remains' }] },
            {
                name: 'remains-take',
                when: v => started(v) && toldTower(v) && !handedRemains(v) && remains(v) === 0 && level(v) === 2,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2570, z: 3443 },
                at: { x: 2569, z: 3443, tolerance: 1 },
            },
            {
                name: 'tower-up-2',
                until: v => level(v) === 2,
                when: v => started(v) && toldTower(v) && !handedRemains(v) && remains(v) === 0 && level(v) === 1,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2570, z: 3441 },
                at: { x: 2569, z: 3441, tolerance: 1 },
            },
            {
                name: 'tower-up-1',
                until: v => level(v) === 1,
                when: v => started(v) && toldTower(v) && !handedRemains(v) && remains(v) === 0 && level(v) === 0,
                maxFails: 3,
            },
        ),
        // --- the railings ---
        ...nudgePhases,
        ...railingPhases,
        phase(
            talk,
            { ...COMMANDER, choices: ['love to help'] },
            { name: 'start', when: v => v.quest(ID) === 'none' && surface(v), maxFails: 3 },
        ),
    ],
});
