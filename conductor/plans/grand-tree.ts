// The Grand Tree (server/content/scripts/quests/quest_grandtree, areas/area_gnome, quest id grandtree, varp grandtree 0-160),
// start to done, from the quest tab, held items, position, nearby locs and the dialog history.
// Stages (grandtree): 0 none; 10 started (King Narnode: bark sample + translation book); 20 Hazelmere took the bark (scroll);
// 30 the King was told the translation; 40 Glough told; 50 King allowed the prisoner talk; 60 Charlie talked to; 70 Glough's
// journal found (cupboard, Glough's house level 1); 80 Glough had me jailed, the King freed me (glider pilot);
// 90 foreman gave the lumber order (Karamja); 100 Charlie named Anita; 110 invasion plans (key on Glough's chest);
// 120 King gave the twigs; 130 twigs on the pillars (trapdoor opens); 140 Black demon dead; 150 searching the roots; 160 done.
// The quest tab shows only none/started/done, so stages ride on held items and dialog markers (see the predicates).
// Needs: melee able to kill the Black demon (level 172: Att/Str/Def 80, rune set), swordfish, 3000 coins (the ship, Femi's fee
// if the boxes were declined), Agility 25 (the climb-tree in Glough's house).
import { definePlan, phase, type PhaseOptions, type PlanView, type Predicate } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'grandtree';
const FOOD = ['Swordfish'];
const TWIG_T = 789;
const TWIG_U = 790;
const TWIG_Z = 791;
const TWIG_O = 792;

const idCount = (v: PlanView, n: number) => v.state.inventory.filter(i => i.id === n).reduce((a, i) => a + i.count, 0);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const level = (v: PlanView) => v.state.player?.level ?? 0;
const near = (v: PlanView, x: number, z: number, r: number) => Math.abs(px(v) - x) <= r && Math.abs(pz(v) - z) <= r;
const done = (v: PlanView) => v.questDone(ID);
const started = (v: PlanView) => v.quest(ID) === 'started';
/** Game ticks since a dialog page matching `re` was shown (Infinity when none is in the history). */
const sinceSaid = (v: PlanView, re: RegExp) => {
    const t = Math.max(-1, ...v.state.recentDialogs.filter(d => d.text.some(x => re.test(x))).map(d => d.tick));
    return t < 0 ? Infinity : v.state.tick - t;
};
/** The Glough cutscene (its first page, then the Black demon spawns some 40 ticks on) is still running. */
const cutscene = (v: PlanView) => sinceSaid(v, /headache/i) < 80;
const nearNpc = (v: PlanView, re: RegExp) => v.state.nearbyNpcs.some(n => re.test(n.name));

const bark = (v: PlanView) => v.inv('Bark sample');
const scroll = (v: PlanView) => v.inv("Hazelmere's scroll");
const journal = (v: PlanView) => v.inv("Glough's journal");
const order = (v: PlanView) => v.inv('Lumber order');
const key = (v: PlanView) => v.inv("Glough's key");
const plans = (v: PlanView) => v.inv('Invasion plans');
const rock = (v: PlanView) => v.inv('Daconia rock');
const twigs = (v: PlanView) => idCount(v, TWIG_T) + idCount(v, TWIG_U) + idCount(v, TWIG_Z) + idCount(v, TWIG_O);

// Dialog markers (stage reached), each a line the game says only once that stage is passed.
const m30 = (v: PlanView) => said(v, /chief tree guardian/i);
const m40 = (v: PlanView) => said(v, /take care of this/i);
const m50 = (v: PlanView) => said(v, /top level/i);
const m60 = (v: PlanView) => said(v, /better search/i);
// The History keeps only the last ~20 pages, so a second line stands in once Glough's default talk has pushed the first out.
const m80 = (v: PlanView) => said(v, /glider pilot|shouldn't be here human/i);
const m100 = (v: PlanView) => said(v, /chest keys|toad swamp/i);
const m110 = (v: PlanView) => said(v, /odd twigs|not proof/i);
const m130 = (v: PlanView) => heard(v, /grinding|pulley/i);
const m150 = (v: PlanView) => said(v, /help us search|more Daconia/i);
const kfollow = (v: PlanView) => said(v, /not here, follow me/i);
const ffollow = (v: PlanView) => said(v, /my office/i);

// Places.
const inStronghold = (v: PlanView) => px(v) >= 2380 && px(v) <= 2500 && pz(v) >= 3390 && pz(v) <= 3540 && level(v) <= 3;
const inDungeon = (v: PlanView) => pz(v) >= 9800 && px(v) >= 2400 && px(v) <= 2560;
const onKaramja = (v: PlanView) => px(v) >= 2760 && px(v) <= 3100 && pz(v) >= 2900 && pz(v) <= 3260;
const inYard = (v: PlanView) => px(v) >= 2945 && px(v) <= 3010 && pz(v) >= 3005 && pz(v) <= 3075;

type Spot = { x: number; z: number; level?: number };
const atSpot = (v: PlanView, s: Spot, r: number) => near(v, s.x, s.z, r) && level(v) === (s.level ?? 0);
/**
 * An act at a spot, and the travel there when the bot is not near it: the walk of talk and interact does not clear
 * Femi's boxes at the entrance gate (its dialog guard is off) and mis-plans the Grand Tree's scripted doors, so the
 * `travel` task brings the bot to the spot and the act is the one step done where it stands.
 */
const visit = (
    name: string,
    spot: Spot,
    r: number,
    want: Predicate,
    act: (o: PhaseOptions) => ReturnType<typeof phase>,
    opts: PhaseOptions = {},
    tree = spot === KING || spot === CHARLIE || spot === PILOT,
) => [
    act({ ...opts, name, when: v => want(v) && atSpot(v, spot, r), maxFails: opts.maxFails ?? 3 }),
    ...(tree
        ? [
              // A walk inside the Stronghold's fence to a spot inside the Grand Tree leaves by the entrance gate and
              // comes back (actions/walk.ts leaveGnomeStronghold: the tree interior is outside the fence fill), which
              // the guard forbids at stage 90: open the Tree Door from the square in front of it instead.
              phase(
                  interact,
                  { target: 'loc', name: '^Tree Door$', option: '^Open$' },
                  {
                      name: `${name}-door`,
                      when: v => want(v) && !atSpot(v, spot, r) && onSquare(v) && near(v, SQUARE.x, SQUARE.z, 2),
                      onFail: 'continue',
                      maxFails: 6,
                  },
              ),
              phase(
                  travel,
                  { to: { ...SQUARE, level: 0 }, tolerance: 1, minFood: 0 },
                  {
                      name: `${name}-square`,
                      when: v => want(v) && !atSpot(v, spot, r) && onSquare(v) && !near(v, SQUARE.x, SQUARE.z, 2),
                      maxFails: 3,
                  },
              ),
          ]
        : []),
    phase(
        travel,
        { to: { ...spot, level: spot.level ?? 0 }, tolerance: 2, minFood: 0, flee: spot === BRIMHAVEN },
        {
            name: `${name}-go`,
            when: v => want(v) && !atSpot(v, spot, r) && !(tree && onSquare(v)) && (!inDungeon(v) || spot.z > 9000),
            maxFails: 3,
        },
    ),
];

// The Stronghold ground south of the Grand Tree's doors (inside the entrance fence, outside the tree).
const SQUARE = { x: 2465, z: 3489 };
const onSquare = (v: PlanView) => level(v) === 0 && px(v) >= 2380 && px(v) <= 2500 && pz(v) >= 3390 && pz(v) <= 3491;

const KING = { x: 2465, z: 3495 };
const KING_DEEP = { x: 2464, z: 9896 };
const GLOUGH = { x: 2479, z: 3463, level: 1 };
const CHARLIE = { x: 2467, z: 3496, level: 3 };
const ANITA = { x: 2392, z: 3514, level: 1 };
const HAZELMERE = { x: 2679, z: 3086, level: 1 };
const PILOT = { x: 2466, z: 3500, level: 3 };
const CUPBOARD = { x: 2477, z: 3465, level: 1 };
const CHEST = { x: 2482, z: 3463, level: 1 };
const TREE = { x: 2483, z: 3465, level: 1 };
const PILLARS = { x: 2486, z: 3466, level: 2 };
const TRAPDOOR = { x: 2487, z: 3465, level: 2 };
const GATE = { x: 2943, z: 3042 };
const FOREMAN = { x: 2990, z: 3048 };
const BRIMHAVEN = { x: 2772, z: 3229 };
const FEMI = { x: 2459, z: 3378 };

// Charlie sits behind the cell door: the client cannot route to him, the approach op reaches him from the landing.
const CHARLIE_TALK = {
    target: 'npc',
    name: '^Charlie$',
    option: '^Talk-to$',
    unreachable: true,
    at: { ...CHARLIE, tolerance: 2 },
} as const;
const tk = (npc: string, choices: string[] = []) => ({ npc, choices });
const king = '^King Narnode Shareen$';

// The fifteen roots of the Grand Tree cave (loc 'Root'), searched in this order, each phase starting where the last ended.
const ROOTS: [number, number][] = [
    [2467, 9896],
    [2465, 9891],
    [2468, 9890],
    [2473, 9897],
    [2481, 9904],
    [2485, 9885],
    [2490, 9889],
    [2467, 9872],
    [2457, 9881],
    [2456, 9886],
    [2455, 9874],
    [2443, 9878],
    [2439, 9881],
    [2444, 9893],
    [2452, 9893],
];
const RING: [number, number][] = [
    [2493, 9865],
    [2490, 9865],
    [2487, 9865],
    [2487, 9862],
    [2490, 9862],
    [2493, 9862],
];
const searching = (v: PlanView) => started(v) && inDungeon(v) && rock(v) === 0 && m150(v);
const rootPhases = ROOTS.map(([x, z], i) =>
    phase(
        interact,
        {
            target: 'loc',
            name: '^Root$',
            option: '^Search$',
            tile: { x, z },
            at: { x, z: z - 1, tolerance: 2 },
            expect: 'find|found|nothing',
        },
        {
            name: `root-${i + 1}`,
            when: v =>
                searching(v) &&
                (i === 0 || !near(v, x, z - 1, 2)) &&
                (i === 0
                    ? !ROOTS.some(([rx, rz]) => near(v, rx, rz - 1, 2)) || near(v, ROOTS[14]![0], ROOTS[14]![1] - 1, 2)
                    : near(v, ROOTS[i - 1]![0], ROOTS[i - 1]![1] - 1, 3)),
            onFail: 'continue',
            maxFails: 20,
        },
    ),
);

const drop = (name: string, item: string, want: Predicate) =>
    phase(items, { drop: [{ item, count: 1 }] }, { name, when: v => started(v) && want(v), maxFails: 3 });

export default definePlan({
    name: 'grand-tree',
    description:
        'The Grand Tree: King Narnode, Hazelmere, translation, Glough, Charlie, journal, Karamja foreman, Anita key, chest plans, twigs on the pillars, Black demon, Daconia rock.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // Open dialogs with no choice to make (conversations that close and reopen mid-script).
        phase(
            talk,
            { continue: true },
            {
                name: 'continue',
                when: v => !done(v) && v.state.dialog.isOpen && v.state.dialog.options.length <= 1,
                onFail: 'continue',
                maxFails: 12,
            },
        ),
        // Spent quest items go, so the King has the four free slots for the twigs.
        drop('drop-journal', "^Glough's journal$", v => journal(v) > 0 && order(v) > 0),
        drop('drop-scroll', "^Hazelmere's scroll$", v => scroll(v) > 0 && order(v) > 0),
        drop('drop-book', '^Translation book$', v => v.inv('Translation book') > 0 && order(v) > 0),
        drop('drop-order', '^Lumber order$', v => order(v) > 0 && key(v) > 0),
        // --- stage 150: the rock to the King ---
        ...visit(
            'finish',
            KING_DEEP,
            6,
            v => started(v) && rock(v) > 0,
            o => phase(talk, tk(king), o),
        ),
        // The King's talk closes while the guard walks up (6 ticks, longer than a talk waits): continue when it reopens.
        phase(
            talk,
            { continue: true },
            {
                name: 'king-below-wait',
                when: v =>
                    started(v) &&
                    inDungeon(v) &&
                    rock(v) === 0 &&
                    !m150(v) &&
                    said(v, /set a demon on me/i) &&
                    v.state.dialog.isOpen,
                onFail: 'continue',
                maxFails: 12,
            },
        ),
        // ...and the gaps between its pages, with the dialog closed (the guard walks up): wait for the next page.
        ...[0, 1].map(parity =>
            phase(
                talk,
                { continue: true },
                {
                    name: `king-below-gap-${parity}`,
                    when: v =>
                        started(v) &&
                        inDungeon(v) &&
                        rock(v) === 0 &&
                        !m150(v) &&
                        said(v, /set a demon on me/i) &&
                        !v.state.dialog.isOpen &&
                        Math.floor(v.state.tick / 4) % 2 === parity,
                    onFail: 'continue',
                    maxFails: 20,
                },
            ),
        ),
        // While the scene runs on (Glough's pages, then the demon spawns; the King's guard walks up), walk a ring of tiles so
        // the plan sees a changing world, not a stall.
        ...RING.map(([x, z], k) =>
            phase(
                travel,
                { to: { x, z, level: 0 }, tolerance: 1, minFood: 0 },
                {
                    name: `wait-${k}`,
                    when: v => {
                        const prev = RING[(k + RING.length - 1) % RING.length]!;
                        const here = RING.some(([rx, rz]) => near(v, rx, rz, 1));
                        return (
                            started(v) &&
                            inDungeon(v) &&
                            rock(v) === 0 &&
                            !m150(v) &&
                            !nearNpc(v, /^black demon$/i) &&
                            cutscene(v) &&
                            !v.state.dialog.isOpen &&
                            (here ? near(v, prev[0], prev[1], 1) : k === 0)
                        );
                    },
                    onFail: 'continue',
                    maxFails: 12,
                },
            ),
        ),
        ...rootPhases,
        // --- stage 140: the King below, after the demon ---
        ...visit(
            'king-below',
            KING_DEEP,
            6,
            v =>
                started(v) &&
                inDungeon(v) &&
                rock(v) === 0 &&
                !nearNpc(v, /^black demon$/i) &&
                !m150(v) &&
                !said(v, /set a demon on me/i) &&
                said(v, /headache/i) &&
                !cutscene(v),
            o => phase(talk, { ...tk(king), at: { x: 2467, z: 9899, tolerance: 1 } }, o),
            { onFail: 'continue', maxFails: 6 },
        ),
        // --- stage 130: the trapdoor and the Black demon ---
        phase(
            combat,
            {
                target: 'Black Demon',
                area: { x: 2482, z: 9866, radius: 16 },
                food: FOOD,
                maxLevelGap: 100,
                respawnWaitTicks: 40,
                stopOnDialog: false,
            },
            {
                name: 'demon',
                when: v => started(v) && inDungeon(v) && nearNpc(v, /^black demon$/i),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        ...visit(
            'trapdoor',
            TRAPDOOR,
            3,
            v => started(v) && !inDungeon(v) && twigs(v) === 0 && key(v) > 0 && plans(v) === 0 && m130(v),
            o =>
                phase(
                    interact,
                    {
                        target: 'loc',
                        name: '^Trapdoor$',
                        option: '^Open$',
                        tile: { x: 2487, z: 3464, level: 2 },
                        expect: 'headache',
                    },
                    o,
                ),
        ),
        // --- stage 120: the four twigs on the pillars T U Z O ---
        ...(
            [
                ['T', TWIG_T, 2485],
                ['U', TWIG_U, 2486],
                ['Z', TWIG_Z, 2487],
                ['O', TWIG_O, 2488],
            ] as const
        ).flatMap(([letter, id, x]) =>
            visit(
                `pillar-${letter}`,
                PILLARS,
                4,
                v => started(v) && idCount(v, id) > 0 && level(v) === 2,
                o =>
                    phase(
                        interact,
                        { target: 'loc', name: '^Pillar$', use: { item: { id } }, tile: { x, z: 3467, level: 2 } },
                        o,
                    ),
            ),
        ),
        // The climb-tree (Agility 25) up from Glough's house, before any pillar can be reached.
        ...visit(
            'climb-tree',
            TREE,
            3,
            v => started(v) && twigs(v) > 0 && level(v) === 1,
            o => phase(interact, { target: 'loc', name: '^Tree$', option: '^Climb-up$' }, o),
        ),
        phase(
            travel,
            { to: { ...TREE, level: 1 }, tolerance: 2, minFood: 0 },
            { name: 'to-house-twigs', when: v => started(v) && twigs(v) > 0 && level(v) === 0, maxFails: 3 },
        ),
        // --- stage 110: the plans to the King ---
        ...visit(
            'king-plans',
            KING,
            5,
            v => started(v) && plans(v) > 0,
            o => phase(talk, tk(king), o),
        ),
        // --- stage 100: Anita's key, the chest ---
        ...visit(
            'chest',
            CHEST,
            3,
            v => started(v) && key(v) > 0 && plans(v) === 0 && twigs(v) === 0 && !m110(v) && !m130(v),
            o =>
                phase(
                    interact,
                    {
                        target: 'loc',
                        name: '^Closed chest$',
                        use: { item: "^Glough's key$" },
                        tile: { x: 2482, z: 3462, level: 1 },
                    },
                    o,
                ),
        ),
        ...visit(
            'anita',
            ANITA,
            4,
            v => started(v) && order(v) > 0 && key(v) === 0 && m100(v) && inStronghold(v),
            o => phase(talk, tk('^Anita$'), o),
        ),
        // --- stage 90: back from Karamja, Charlie names Anita ---
        ...visit(
            'charlie-anita',
            CHARLIE,
            3,
            v => started(v) && order(v) > 0 && key(v) === 0 && !m100(v) && inStronghold(v),
            o => phase(interact, CHARLIE_TALK, o),
        ),
        // Femi's cart: 1000 coins when the boxes were declined at the gate, free otherwise.
        phase(talk, tk('^Femi$', ['pay']), {
            name: 'femi-pay',
            when: v => started(v) && order(v) > 0 && key(v) === 0 && !inStronghold(v) && atSpot(v, FEMI, 6),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(talk, tk('^Femi$'), {
            name: 'femi-free',
            when: v => started(v) && order(v) > 0 && key(v) === 0 && !inStronghold(v) && atSpot(v, FEMI, 6),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(
            travel,
            { to: { ...FEMI, level: 0 }, tolerance: 2, minFood: 0 },
            {
                name: 'to-femi',
                when: v =>
                    started(v) &&
                    order(v) > 0 &&
                    key(v) === 0 &&
                    !inStronghold(v) &&
                    !onKaramja(v) &&
                    level(v) === 0 &&
                    !atSpot(v, FEMI, 6),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Gangplank$', option: '^Cross$', tile: { x: 2683, z: 3269, level: 1 } },
            {
                name: 'disembark',
                when: v => started(v) && order(v) > 0 && level(v) === 1 && near(v, 2683, 3268, 6),
                maxFails: 3,
            },
        ),
        // Out of the shipyard peninsula: the walk crosses the river log (A wooden log, Cross) on its way west; jungle spiders
        // attack there, so the walk flees on.
        phase(
            travel,
            { to: { x: 2850, z: 3050, level: 0 }, tolerance: 3, minFood: 0, flee: true },
            {
                name: 'cross-karamja',
                when: v => started(v) && order(v) > 0 && onKaramja(v) && px(v) > 2880,
                maxFails: 3,
            },
        ),
        ...visit(
            'sail-ardougne',
            BRIMHAVEN,
            6,
            v => started(v) && order(v) > 0 && onKaramja(v),
            o =>
                phase(
                    talk,
                    {
                        npc: '^Customs officer$',
                        choices: ['Can I journey', 'Search away', '^Ok'],
                        travels: true,
                    },
                    o,
                ),
        ),
        // --- stage 80: Karamja shipyard ---
        phase(
            talk,
            { npc: '^Foreman$', choices: ['no longer with us', 'worm holes', '^Anita'] },
            {
                name: 'foreman-quiz',
                when: v => started(v) && order(v) === 0 && inYard(v) && ffollow(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        ...visit(
            'foreman',
            FOREMAN,
            10,
            v => started(v) && order(v) === 0 && inYard(v) && !ffollow(v),
            o => phase(talk, tk('^Foreman$'), o),
        ),
        ...visit(
            'shipyard-gate',
            GATE,
            2,
            v => started(v) && order(v) === 0 && onKaramja(v) && !inYard(v),
            o =>
                phase(
                    interact,
                    {
                        target: 'loc',
                        name: '^Gate$',
                        option: '^Open$',
                        choices: ['Glough sent me', '^Ka\\.', '^Lu\\.', '^Min\\.'],
                    },
                    o,
                ),
        ),
        ...visit(
            'pilot',
            PILOT,
            4,
            v => started(v) && journal(v) > 0 && order(v) === 0 && m80(v) && !onKaramja(v),
            o => phase(talk, tk('^Gnome pilot$', ['Take me to Karamja']), o),
        ),
        // The arrest scene closes its dialog between pages (Glough walks off, the cell, the King): wait for the next page.
        // Two phases take turns by the game tick so the idle rail does not read one phase repeating as a stall.
        ...[0, 1].map(parity =>
            phase(
                talk,
                { continue: true },
                {
                    name: `arrest-gap-${parity}`,
                    when: v =>
                        started(v) &&
                        journal(v) > 0 &&
                        order(v) === 0 &&
                        !m80(v) &&
                        said(v, /Guards! Guards!/) &&
                        !v.state.dialog.isOpen &&
                        Math.floor(v.state.tick / 4) % 2 === parity,
                    onFail: 'continue',
                    maxFails: 20,
                },
            ),
        ),
        // --- stage 70: Glough has me jailed (the dialogs run on through `continue`) ---
        ...visit(
            'glough-arrest',
            GLOUGH,
            4,
            v => started(v) && journal(v) > 0 && order(v) === 0 && !m80(v) && !onKaramja(v),
            o => phase(talk, tk('^Glough$'), o),
        ),
        // --- stage 60: the cupboard in Glough's house ---
        ...visit(
            'cupboard-search',
            CUPBOARD,
            3,
            v => started(v) && m60(v) && journal(v) === 0 && order(v) === 0,
            o =>
                phase(
                    interact,
                    {
                        target: 'loc',
                        name: '^Cupboard$',
                        option: '^Search$',
                        tile: { x: 2476, z: 3465, level: 1 },
                    },
                    o,
                ),
            { onFail: 'continue', maxFails: 6 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cupboard$',
                option: '^Open$',
                tile: { x: 2476, z: 3465, level: 1 },
            },
            {
                name: 'cupboard-open',
                when: v => started(v) && m60(v) && journal(v) === 0 && order(v) === 0 && atSpot(v, CUPBOARD, 3),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        // --- stages 30-60 ---
        ...visit(
            'charlie-prisoner',
            CHARLIE,
            3,
            v => started(v) && m50(v) && !m60(v) && journal(v) === 0,
            o => phase(interact, CHARLIE_TALK, o),
        ),
        ...visit(
            'king-prisoner',
            KING,
            5,
            v => started(v) && m40(v) && !m50(v) && journal(v) === 0,
            o => phase(talk, tk(king), o),
        ),
        ...visit(
            'glough-told',
            GLOUGH,
            4,
            v => started(v) && m30(v) && !m40(v) && journal(v) === 0,
            o => phase(talk, tk('^Glough$'), o),
        ),
        ...visit(
            'translate',
            KING,
            5,
            v => started(v) && scroll(v) > 0 && !m30(v) && bark(v) === 0,
            o =>
                phase(
                    talk,
                    tk(king, [
                        'I think so',
                        'None of the above',
                        'None of the above',
                        'A man came',
                        'I gave the man',
                        'Daconia rocks will kill',
                    ]),
                    o,
                ),
        ),
        ...visit(
            'hazelmere',
            HAZELMERE,
            4,
            v => started(v) && bark(v) > 0,
            o => phase(talk, tk('^Hazelmere$'), o),
        ),
        // --- the start ---
        phase(
            talk,
            { continue: true, choices: ['happy to help'] },
            {
                name: 'king-help',
                when: v => v.quest(ID) === 'none' && kfollow(v) && v.state.dialog.isOpen,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        // The King walks to the trapdoor first: wait for the conversation to reopen below.
        phase(
            talk,
            { continue: true },
            {
                name: 'king-start-gap',
                when: v => v.quest(ID) === 'none' && kfollow(v) && !inDungeon(v) && !v.state.dialog.isOpen,
                onFail: 'continue',
                maxFails: 12,
            },
        ),
        // The King's script walks the bot back up the trapdoor after the start: wait for it.
        phase(
            talk,
            { continue: true },
            {
                name: 'king-up-gap',
                when: v => started(v) && bark(v) > 0 && inDungeon(v),
                onFail: 'continue',
                maxFails: 12,
            },
        ),
        // The conversation runs on below the tree once the King has walked down; talking again reopens it.
        phase(talk, tk(king, ['happy to help']), {
            name: 'king-help-talk',
            when: v => v.quest(ID) === 'none' && kfollow(v) && inDungeon(v),
            onFail: 'continue',
            maxFails: 6,
        }),
        ...visit(
            'king-start',
            KING,
            5,
            v => v.quest(ID) === 'none' && !kfollow(v),
            o => phase(talk, tk(king, ['worried']), o),
        ),
    ],
    until: done,
});
