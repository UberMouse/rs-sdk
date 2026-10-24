// Monk's Friend (quest id drunkmonk; wiki/quests/monks-friend.md; script server/content/scripts/quests/quest_drunkmonk):
// Brother Omad (monastery 2604,3209) sends you for the child's blanket in the thieves' den under the ring of stones
// (a ladder appears at 2561,3222 once Omad has told you; the blanket lies below), then for Brother Cedric (2614,3259, drunk
// in the forest by the zoo), who wants a jug of water and then a log, and last back to Omad, who throws the party.
// Buys a jug in the Khazard general store, fills it at a sink, chops one log by the zoo. The quest tab shows
// none/started/done only, so the stage is the highest one whose line is in the dialog history (stages only go up); with
// nothing in the history a plain talk with Omad puts a line back.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import fill from '@conductor/tasks/fill';
import interact from '@conductor/tasks/interact';
import pickup from '@conductor/tasks/pickup';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';
import woodcutting from '@conductor/tasks/woodcutting';

const ID = 'drunkmonk';

// one line per stage, in quest order (Omad's and Cedric's pages)
const MARKERS = [
    /secret cave|have the blanket/i, // 0 told by Omad
    /sleeping well|off to bed/i, // 1 blanket handed in
    /won't be far/i, // 2 sent to look for Cedric
    /jug of water/i, // 3 Cedric wants water
    /fix this cart|that's better/i, // 4 water given
    /need some wood|get some wood/i, // 5 Cedric wants wood
    /almost done|i'll be there soon/i, // 6 logs given: back to Omad
];

const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const underground = (v: PlanView) => pz(v) > 9000;
const surface = (v: PlanView) => pz(v) < 6000 && (v.state.player?.level ?? 0) === 0;
const started = (v: PlanView) => v.quest(ID) === 'started';
const stage = (v: PlanView) => {
    let best = -1;
    for (const p of v.state.recentDialogs) {
        const t = p.text.join(' ');
        MARKERS.forEach((m, i) => {
            if (i > best && m.test(t)) best = i;
        });
    }
    return best;
};
const jug = (v: PlanView) => v.inv('Jug');
const water = (v: PlanView) => v.inv('Jug of water');
const logs = (v: PlanView) => v.inv('Logs');
const blanket = (v: PlanView) => v.inv("Child's blanket");

// Omad wanders out to the passage west of the chapel door (2602,3209); the closed door (it swings shut again) makes him
// unreachable from inside, which an Omad talk reports as a failure
const omadBlocked = (v: PlanView) =>
    v.last?.status === 'failed' && /unreachable/.test(v.last.reason ?? '') && px(v) >= 2603;

const omad = { npc: '^Brother Omad$', at: { x: 2604, z: 3209, tolerance: 4 } };
const cedric = { npc: '^Brother Cedric$', at: { x: 2614, z: 3259, tolerance: 4 } };
const ZOO_TREES = { x: 2610, z: 3260, radius: 12 };

export default definePlan({
    name: 'monks-friend',
    description: "Monk's Friend: blanket from the thieves' den, then water and a log for Brother Cedric, back to Omad.",
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // a level-up page (the first log) left open blocks the next talk
        phase(
            talk,
            { continue: true },
            { name: 'dismiss', when: v => v.state.dialog?.isOpen === true, onFail: 'continue' },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Door$', option: '^Open$', at: { x: 2603, z: 3209, tolerance: 1 } },
            { name: 'omad-door', when: v => surface(v) && omadBlocked(v), maxFails: 2 },
        ),
        // --- the party ---
        phase(talk, omad, {
            name: 'party',
            onFail: 'continue',
            maxFails: 6,
            when: v => started(v) && stage(v) >= 6 && surface(v),
        }),
        // --- Cedric ---
        phase(talk, cedric, {
            name: 'cedric-wood',
            when: v => started(v) && stage(v) === 5 && logs(v) > 0 && surface(v),
        }),
        phase(
            talk,
            { ...cedric, choices: ["Yes, I'd be happy"] },
            {
                name: 'cedric-help',
                when: v =>
                    started(v) && surface(v) && logs(v) > 0 && ((stage(v) === 3 && water(v) > 0) || stage(v) === 4),
            },
        ),
        phase(talk, cedric, { name: 'cedric-ask', when: v => started(v) && stage(v) === 2 && surface(v) }),
        // --- the things Cedric asks for ---
        phase(
            woodcutting,
            { tree: 'tree', area: ZOO_TREES, onFull: 'drop' },
            {
                name: 'chop',
                when: v =>
                    started(v) &&
                    surface(v) &&
                    logs(v) === 0 &&
                    stage(v) >= 2 &&
                    stage(v) <= 5 &&
                    (water(v) > 0 || stage(v) >= 4),
                until: v => logs(v) > 0,
            },
        ),
        phase(
            fill,
            { container: 'Jug', area: { x: 2629, z: 3311, radius: 8 } },
            { name: 'fill', when: v => jug(v) > 0 && water(v) === 0 && v.quest(ID) !== 'done' && surface(v) },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 2641, z: 3171 }, buy: [{ item: 'Jug', count: 1 }] },
            {
                name: 'buy-jug',
                when: v => v.quest(ID) !== 'done' && jug(v) === 0 && water(v) === 0 && stage(v) < 4 && surface(v),
                maxFails: 4,
            },
        ),
        // --- the blanket ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2561, z: 9622 },
                at: { x: 2561, z: 9621, level: 0, tolerance: 1 },
            },
            { name: 'den-out', when: v => underground(v) && blanket(v) > 0 && v.last?.phase !== 'den-out' },
        ),
        // an ordinary cellar ladder (2566,3227) leads to a sealed room (2565,9627), not the den: climb back out
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 2565, z: 9627, level: 0, tolerance: 1 } },
            { name: 'wrong-room', when: v => underground(v) && pz(v) >= 9625 && v.last?.phase !== 'wrong-room' },
        ),
        phase(
            travel,
            { to: { x: 2562, z: 3223, level: 0 }, tolerance: 2 },
            {
                name: 'room-settle',
                when: v => v.last?.phase === 'wrong-room' || v.last?.phase === 'den-out',
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            pickup,
            { area: { x: 2570, z: 9606, radius: 4 }, items: [{ item: "Child's blanket", count: 1 }] },
            { name: 'blanket', when: v => underground(v) && blanket(v) === 0 },
        ),
        phase(talk, omad, {
            name: 'hand-blanket',
            onFail: 'continue',
            maxFails: 6,
            when: v => started(v) && blanket(v) > 0 && surface(v),
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2561, z: 3222 },
                at: { x: 2562, z: 3223, tolerance: 1 },
            },
            {
                name: 'den-in',
                when: v => started(v) && stage(v) === 0 && blanket(v) === 0 && surface(v) && v.last?.phase !== 'den-in',
                maxFails: 4,
            },
        ),
        // the climb ends on its animation, before the move down shows in the view: settle there
        phase(
            travel,
            { to: { x: 2561, z: 9622, level: 0 }, tolerance: 6 },
            {
                name: 'den-settle',
                when: v => surface(v) && v.last?.phase === 'den-in',
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        // --- Omad ---
        phase(
            talk,
            { ...omad, choices: ["Who's Brother Cedric", 'Where should I look'] },
            {
                name: 'omad-cedric',
                onFail: 'continue',
                maxFails: 6,
                when: v => started(v) && stage(v) === 1 && surface(v),
            },
        ),
        phase(
            talk,
            { ...omad, choices: ["Why can't you sleep", 'Can I help at all'] },
            { name: 'start', onFail: 'continue', maxFails: 6, when: v => v.quest(ID) === 'none' && surface(v) },
        ),
        phase(talk, omad, {
            name: 'probe',
            onFail: 'continue',
            maxFails: 6,
            when: v => started(v) && stage(v) < 0 && surface(v),
        }),
    ],
    until: v => v.questDone(ID),
});
