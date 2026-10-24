// Observatory Quest (server/content/scripts/quests/quest_itgronigen, id itgronigen, varp 0-6, 7 = done), start to done.
// The quest tab shows only none/started/done, so the stages ride on held items, position and the dialog history:
//   0 -> 1 Professor (reception, 2438,3186); 1 -> 2 three Planks; 2 -> 3 Bronze bar; 3 -> 4 Molten glass;
//   4: the Lens mould is under a Sack (2389,9454) in the dungeon (ladder 2444,3191 down, arrival 2420,9459) behind the
//   Keep gate (2390,9457), opened by a Keep key from the chest at (2428,9419) (Open, then Search; the other chests hold
//   poisonous spiders); the Professor takes the mould (-> 5) and hands the glass back; the mould used on the glass makes a
//   Lens; the Lens to the Professor (-> 6, "Meet me at the Observatory"); dungeon ladder up (2423,9439) into the dome
//   (2440,3165), Telescope (2440,3157) Use: a random constellation, the Professor finishes the quest.
// Start save: lib:observatory-start (3 planks, bronze bar and molten glass held: no cheap source; 10 swordfish).
// Restart-safe: gates read held items, the position and the dialog and message history, never run counts.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import talk from '@conductor/tasks/talk';

const ID = 'itgronigen';
const n = (v: PlanView, name: string) => v.inv(name);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const started = (v: PlanView) => v.quest(ID) === 'started';
const done = (v: PlanView) => v.questDone(ID);
const dungeon = (v: PlanView) => pz(v) > 9000;
const surface = (v: PlanView) => pz(v) < 6000;
const dome = (v: PlanView) => surface(v) && px(v) >= 2430 && px(v) <= 2450 && pz(v) >= 3150 && pz(v) <= 3174;

const planks = (v: PlanView) => n(v, 'Plank');
const bar = (v: PlanView) => n(v, 'Bronze bar');
const glass = (v: PlanView) => n(v, 'Molten glass');
const mould = (v: PlanView) => n(v, 'Lens mould');
const lens = (v: PlanView) => n(v, 'Lens');
const key = (v: PlanView) => n(v, 'Keep key');
const told = (v: PlanView) => heard(v, /at last I can fix the telescope/i);
const allHanded = (v: PlanView) => planks(v) === 0 && bar(v) === 0 && glass(v) === 0 && mould(v) === 0 && lens(v) === 0;
const needMould = (v: PlanView) => started(v) && allHanded(v) && !told(v);
// The sack alcove south of the Keep gate (2390,9457): reached from the north once the gate is open.
const alcove = (v: PlanView) => px(v) >= 2388 && px(v) <= 2393 && pz(v) >= 9449 && pz(v) <= 9457;

const PROF = { npc: '^Observatory professor$', at: { x: 2438, z: 3184, tolerance: 2 } };
const talkWhen = (f: (v: PlanView) => boolean) => (v: PlanView) => started(v) && surface(v) && f(v);

export default definePlan({
    name: 'observatory',
    description:
        'Observatory Quest: the Professor, planks, bronze bar, molten glass, the dungeon (keep key chest, gate, lens mould sack), the lens, the telescope.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        // --- the finish: the telescope in the dome ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Telescope$',
                option: '^Use$',
                at: { x: 2440, z: 3159, tolerance: 2 },
                choices: ['constellation'],
            },
            { name: 'telescope', when: v => !done(v) && told(v) && dome(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2423, z: 9439 },
                at: { x: 2423, z: 9441, tolerance: 1 },
            },
            { name: 'dome-ladder', until: v => surface(v), when: v => !done(v) && told(v) && dungeon(v), maxFails: 3 },
        ),
        // --- hand-ins at the Professor ---
        phase(
            talk,
            { ...PROF, choices: ['look through that telescope', 'Sounds interesting'] },
            { name: 'start', when: v => v.quest(ID) === 'none' && surface(v), maxFails: 3 },
        ),
        phase(talk, { ...PROF }, { name: 'give-lens', when: talkWhen(v => lens(v) > 0 && !told(v)), maxFails: 3 }),
        phase(
            items,
            { combine: { use: '^Molten glass$', on: '^Lens mould$', product: '^Lens$' } },
            { name: 'make-lens', when: v => started(v) && glass(v) > 0 && mould(v) > 0 && lens(v) === 0, maxFails: 3 },
        ),
        phase(
            talk,
            { ...PROF },
            { name: 'give-mould', when: talkWhen(v => mould(v) > 0 && glass(v) === 0 && lens(v) === 0), maxFails: 3 },
        ),
        phase(
            talk,
            { ...PROF },
            {
                name: 'give-glass',
                when: talkWhen(v => glass(v) > 0 && bar(v) === 0 && planks(v) === 0 && mould(v) === 0 && lens(v) === 0),
                maxFails: 3,
            },
        ),
        phase(talk, { ...PROF }, { name: 'give-bar', when: talkWhen(v => bar(v) > 0 && planks(v) === 0), maxFails: 3 }),
        phase(talk, { ...PROF }, { name: 'give-planks', when: talkWhen(v => planks(v) >= 3), maxFails: 3 }),
        // --- the dungeon ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2420, z: 9460 },
                at: { x: 2420, z: 9458, tolerance: 1 },
            },
            {
                name: 'ladder-up',
                until: v => surface(v),
                when: v => started(v) && dungeon(v) && !told(v) && !needMould(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Sack$', option: '^Search$', tile: { x: 2389, z: 9454 } },
            { name: 'sack', when: v => needMould(v) && dungeon(v) && alcove(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Keep gate$',
                use: { item: '^Keep key$' },
                at: { x: 2391, z: 9459, tolerance: 1 },
            },
            {
                name: 'gate',
                when: v => needMould(v) && dungeon(v) && !alcove(v) && key(v) > 0,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Chest$',
                option: '^Search$',
                tile: { x: 2428, z: 9419 },
                at: { x: 2428, z: 9420, tolerance: 1 },
            },
            {
                name: 'chest-search',
                when: v => needMould(v) && dungeon(v) && !alcove(v) && key(v) === 0,
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Chest$',
                option: '^Open$',
                tile: { x: 2428, z: 9419 },
                at: { x: 2428, z: 9420, tolerance: 1 },
            },
            {
                name: 'chest-open',
                when: v => needMould(v) && dungeon(v) && !alcove(v) && key(v) === 0,
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2444, z: 3191 },
                at: { x: 2444, z: 3189, tolerance: 1 },
            },
            {
                name: 'ladder-down',
                until: v => dungeon(v),
                when: v => started(v) && surface(v) && !dome(v) && (needMould(v) || told(v)),
                maxFails: 3,
            },
        ),
    ],
});
