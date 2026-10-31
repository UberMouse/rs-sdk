// Witch's House (server/content/scripts/quests/quest_ball, quest id ball, varp ballquest 0-7).
// The boy (~(2929,3447)) starts it. The front door key is under the potted plant at (2900,3474) (Look-under); the door
// (2901,3473) opens with it; the diary lies on the floor upstairs at (2900,3473, level 1); the ladder (2907,3476) goes down to
// the basement (z + 6400); the iron gate (2902,9873) shocks bare hands (leather gloves worn), the cupboard (2898,9873) is
// Opened then Searched for the magnet; back up, cheese on the mouse hole (2903,3466) lures the mouse (it lives 50 ticks: the
// magnet goes on it at once), which unlocks the back door (2901,3465). Reading the diary after that moves the varp to 5, so a
// witch catch (Nora T. Hagg, patrols z 3463 x 2904-2930, Check witch.rs2) no longer resets the quest. The fountain
// (2909,3470, Check = op2) gives the shed key; the shed door (2934,3463) with the key spawns the experiment, four forms
// that each turn into the next on death; the ball is on the shed floor (2935,3460).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'ball';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const lastDone = (v: PlanView, name: string) => v.last?.phase === name && v.last.status === 'done';
/** Position lags the end of a ladder interact: the last phase counts too. */
const underground = (v: PlanView) => (pz(v) > 9000 && !lastDone(v, 'up')) || lastDone(v, 'down');
const surface = (v: PlanView) => !underground(v);
const npcNear = (v: PlanView, re: RegExp) => v.state.nearbyNpcs.some(n => re.test(n.name));
const started = (v: PlanView) => v.quest(ID) === 'started';
const R = { onFail: 'continue', maxFails: 6 } as const;
const SHED = { x: 2935, z: 3461, radius: 6 };
const experimentNear = (v: PlanView) => npcNear(v, /^Witches experiment/);
const hasShedKey = (v: PlanView) => v.inv(/^Key$/) > 0;
const FORMS = [
    'Witches experiment',
    'Witches experiment second form',
    'Witches experiment third form',
    'Witches experiment fourth form',
];

// --- the garden: Nora T. Hagg (patrols z 3463, x 2904-2930, hunts within 3 tiles with line of sight) catches a player
// unless a hedge lies on the tile next to them away from her. Two rows are walked: the strip z 3460 (south, hedge row z 3461
// north of it: pockets x 2907-2909, 2915-2917, 2923-2925, 2929-2931) from the west column (x 2899-2901) to the corridor
// x 2933, and the strip z 3466 (hedge row z 3465 south of it: pockets x 2912-2914, 2919-2921, 2926-2928, 2932) from the
// corridor to the fountain yard (2909-2912, 3469-3475). A hop crosses a gap only while she is far from it.
const witchX = (v: PlanView) => v.state.nearbyNpcs.find(n => /^Nora T\. Hagg$/.test(n.name))?.x;
const witchOut = (v: PlanView, ok: (x: number) => boolean) => {
    const x = witchX(v);
    return x !== undefined && ok(x);
};
/** She is at least 6 columns clear of the gap (hunt radius 3, plus her walk during the hop). */
const clear = (start: number, end: number) => (v: PlanView) => witchOut(v, x => x >= end + 6 || x <= start - 6);
const at = (v: PlanView, x: number, z: number) => Math.abs(px(v) - x) <= 1 && Math.abs(pz(v) - z) <= 1;
const needKey = (v: PlanView) => !hasShedKey(v) && v.inv('Ball') === 0 && v.runs('form1') === 0 && v.runs('read') > 0;
const needBall = (v: PlanView) => v.runs('form4') > 0 && v.inv('Ball') === 0 && !experimentNear(v);
const going = (v: PlanView) => hasShedKey(v) && v.runs('form1') === 0 && !lastDone(v, 'shed');
const coming = (v: PlanView) => v.inv('Ball') > 0;
/** One hop across a gap in a row, and the wait for the witch to be far enough. */
const HOP = (
    name: string,
    z: number,
    fromX: number,
    toX: number,
    ok: (v: PlanView) => boolean,
    dir: (v: PlanView) => boolean,
) => [
    phase(
        travel,
        { to: { x: toX, z }, tolerance: 1, minFood: 0 },
        { name, when: v => dir(v) && at(v, fromX, z) && ok(v), ...R },
    ),
    phase(
        pickup,
        { area: { x: fromX, z, radius: 2 }, items: [{ item: 'Bones' }], maxWaitSeconds: 60 },
        {
            name: `${name}-wait`,
            when: v => dir(v) && at(v, fromX, z) && !ok(v),
            until: ok,
            onFail: 'continue',
            maxFails: 20,
        },
    ),
];
/** Both directions of the gaps of the strip z 3460, from the west column (x 2900) to the corridor (x 2933). */
const ZROW = [
    { x0: 2900, x1: 2908, ok: clear(2901, 2906) },
    { x0: 2908, x1: 2916, ok: clear(2910, 2914) },
    { x0: 2916, x1: 2924, ok: clear(2918, 2922) },
    { x0: 2924, x1: 2930, ok: clear(2926, 2928) },
    { x0: 2930, x1: 2933, ok: (v: PlanView) => witchOut(v, x => x <= 2925) },
];
/** The gaps of the strip z 3466, from the corridor (x 2932) west to the yard (x 2913). */
const SROW = [
    { x0: 2927, x1: 2932, ok: (v: PlanView) => witchOut(v, x => x <= 2919) },
    { x0: 2920, x1: 2927, ok: (v: PlanView) => witchOut(v, x => x <= 2917) },
    { x0: 2913, x1: 2920, ok: (v: PlanView) => witchOut(v, x => x >= 2923 || x <= 2910) },
];

const FIGHT = (form: string, i: number) =>
    phase(
        combat,
        {
            target: form,
            skill: 'Strength',
            allowMaxed: true,
            area: SHED,
            food: ['Swordfish'],
            eatBelow: 0.5,
            maxLevelGap: 60,
            respawnWaitTicks: 2,
        },
        {
            name: `form${i + 1}`,
            when: v =>
                npcNear(v, new RegExp(`^${form}$`)) || (i === 0 ? lastDone(v, 'shed') : v.last?.phase === `form${i}`),
            onFail: 'continue',
            maxFails: 6,
        },
    );

export default definePlan({
    name: 'witchs-house',
    description:
        "Witch's House: the boy, door key under the pot, diary upstairs, magnet from the basement cupboard, cheese and magnet on the mouse, diary read, fountain key, the shed, the four-form experiment, the ball back to the boy.",
    requires: {
        ...QUEST_TAB_REQUIRED,
        'combat level 45+': v => (v.state.player?.combatLevel ?? 0) >= 45,
    },
    until: v => v.questDone(ID),
    phases: [
        phase(
            interact,
            { target: 'item', name: '^Leather gloves$', option: '^Wear$' },
            { name: 'wear', when: v => v.inv('Leather gloves') > 0 && started(v), ...R },
        ),
        phase(
            talk,
            { npc: '^Boy$', at: { x: 2929, z: 3447, tolerance: 3 } },
            { name: 'finish', when: v => coming(v) && px(v) <= 2901 && pz(v) <= 3465, maxFails: 4 },
        ),
        // back out: the corridor, then the strip z 3460 westward
        ...ZROW.flatMap((g, k) => HOP(`zw${k}`, 3460, g.x1, g.x0, g.ok, coming)),
        phase(
            travel,
            { to: { x: 2933, z: 3460 }, tolerance: 1, minFood: 0 },
            { name: 'leave-shed', when: v => coming(v) && px(v) >= 2933 && pz(v) >= 3461, ...R },
        ),
        phase(
            pickup,
            { area: { x: 2935, z: 3460, radius: 3 }, items: [{ item: 'Ball' }], maxWaitSeconds: 90 },
            { name: 'ball', when: v => needBall(v) && px(v) >= 2931, ...R },
        ),
        // --- the experiment: each form turns into the next on death ---
        ...FORMS.map(FIGHT).toReversed(),
        // to the shed with the key: the strip z 3466 eastward from the yard
        ...SROW.flatMap((g, k) => HOP(`se${k}`, 3466, g.x0, g.x1, g.ok, going)),
        phase(
            travel,
            { to: { x: 2913, z: 3466 }, tolerance: 1, minFood: 0 },
            { name: 'to-p1', when: v => going(v) && pz(v) >= 3467 && px(v) <= 2912, ...R },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 2934, z: 3463 },
                at: { x: 2933, z: 3463, tolerance: 1 },
            },
            { name: 'shed', when: v => going(v) && px(v) >= 2931 && !experimentNear(v), ...R },
        ),
        // to the fountain: the strip z 3466 westward from the corridor, after the strip z 3460 eastward from the west column
        phase(
            travel,
            { to: { x: 2911, z: 3470 }, tolerance: 1, minFood: 0 },
            { name: 'to-yard', when: v => needKey(v) && at(v, 2913, 3466), ...R },
        ),
        ...SROW.flatMap((g, k) => HOP(`sw${k}`, 3466, g.x1, g.x0, g.ok, needKey)),
        phase(
            travel,
            { to: { x: 2932, z: 3466 }, tolerance: 1, minFood: 0 },
            { name: 'corridor-up', when: v => needKey(v) && at(v, 2933, 3460), ...R },
        ),
        ...ZROW.flatMap((g, k) => HOP(`ze${k}`, 3460, g.x0, g.x1, g.ok, v => needKey(v) || needBall(v))),
        phase(
            travel,
            { to: { x: 2900, z: 3460 }, tolerance: 1, minFood: 0 },
            {
                name: 'enter-col',
                when: v => (needKey(v) || needBall(v)) && (pz(v) <= 3458 || (px(v) <= 2908 && pz(v) >= 3466)),
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Fountain$',
                option: '^Check$',
                tile: { x: 2909, z: 3470 },
                at: { x: 2910, z: 3471, tolerance: 1 },
            },
            { name: 'fountain', when: v => needKey(v) && px(v) >= 2909 && px(v) <= 2913 && pz(v) >= 3468, ...R },
        ),
        phase(
            interact,
            { target: 'item', name: '^Diary$', option: '^Read$' },
            { name: 'read', when: v => v.runs('magnet') > 0 && v.inv('Diary') > 0 && v.runs('read') === 0, ...R },
        ),
        // --- the basement: gloves, gate, cupboard, magnet, back up ---
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$' },
            { name: 'up', when: v => underground(v) && v.inv('Magnet') > 0 && v.runs('gate-out') > 0, ...R },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Gate$', option: '^Open$', tile: { x: 2902, z: 9873 } },
            { name: 'gate-out', when: v => underground(v) && v.inv('Magnet') > 0 && v.runs('gate-out') === 0, ...R },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cupboard$', option: '^Search$' },
            {
                name: 'cupboard-search',
                when: v => underground(v) && v.runs('cupboard-open') > 0 && v.inv('Magnet') === 0,
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cupboard$', option: '^Open$' },
            {
                name: 'cupboard-open',
                when: v => underground(v) && v.runs('gate-in') > 0 && v.runs('cupboard-open') === 0,
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Gate$', option: '^Open$', tile: { x: 2902, z: 9873 } },
            {
                name: 'gate-in',
                when: v => underground(v) && v.inv('Leather gloves') === 0 && v.runs('gate-in') === 0,
                ...R,
            },
        ),
        // --- the mouse: the magnet goes on it within its 50 ticks ---
        phase(
            interact,
            { target: 'npc', name: '^Mouse$', use: { item: '^Magnet$' } },
            { name: 'magnet', when: v => surface(v) && v.inv('Magnet') > 0 && npcNear(v, /^Mouse$/), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mouse hole$',
                use: { item: '^Cheese$' },
                at: { x: 2903, z: 3467, tolerance: 1 },
                expect: 'mouse runs out',
            },
            {
                name: 'cheese',
                when: v => surface(v) && v.inv('Magnet') > 0 && v.inv('Cheese') > 0 && !npcNear(v, /^Mouse$/),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2907, z: 3476 },
                at: { x: 2906, z: 3475, tolerance: 1 },
            },
            {
                name: 'down',
                when: v =>
                    surface(v) &&
                    lvl(v) === 0 &&
                    v.inv('Magnet') === 0 &&
                    v.inv('Diary') > 0 &&
                    v.runs('magnet') === 0 &&
                    v.runs('down') === 0,
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Staircase$', option: '^Walk-down$' },
            { name: 'stairs-down', when: v => lvl(v) === 1 && v.inv('Diary') > 0 && v.runs('stairs-down') === 0, ...R },
        ),
        phase(
            pickup,
            { area: { x: 2901, z: 3472, radius: 3, level: 1 }, items: [{ item: 'Diary' }], maxWaitSeconds: 20 },
            { name: 'diary', when: v => lvl(v) === 1 && v.inv('Diary') === 0, ...R },
        ),
        phase(
            travel,
            { to: { x: 2902, z: 3471, level: 1 }, tolerance: 2, minFood: 0 },
            {
                name: 'stairs-up',
                when: v => v.runs('enter') > 0 && v.inv('Diary') === 0 && lvl(v) === 0 && v.runs('stairs-up') === 0,
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Door$', option: '^Open$', tile: { x: 2901, z: 3473 } },
            {
                name: 'enter',
                when: v =>
                    v.inv('Door key') > 0 &&
                    started(v) &&
                    (v.runs('enter') === 0 || (v.last?.phase === 'cheese' && v.last.status !== 'done')),
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Potted plant$',
                option: '^Look-under$',
                tile: { x: 2900, z: 3474 },
                at: { x: 2899, z: 3474, tolerance: 2 },
            },
            { name: 'plant', when: v => started(v) && v.inv('Door key') === 0 && v.runs('enter') === 0, ...R },
        ),
        phase(
            talk,
            { npc: '^Boy$', at: { x: 2929, z: 3447, tolerance: 3 }, choices: ['What.s the matter', 'Ok, I.ll see'] },
            { name: 'start', when: v => v.quest(ID) === 'none', maxFails: 3 },
        ),
    ],
});
