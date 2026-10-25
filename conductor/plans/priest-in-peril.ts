// Priest in Peril (server/content/scripts/quests/quest_priestperil, areas/area_mausoleum, areas/area_varrock/scripts/king_roald.rs2)
// from the start to quest done AND stage 61 (the barrier talk), chosen from held items, position and what is seen.
// The quest tab shows only none/started/done, so the stages in between ride on these markers:
//   * A Pot is the "before stage 8" flag (dropped with the empty Bucket once Drezel has been told of the coffin);
//     started without a Pot = the essence era.
//   * No Bucket + Pot = stages 1-3 (Roald, knock, dog); the Bucket is bought after the dog, so its presence = stage 3+.
//     The shop is a waypoint that tells Roald's second talk (stage 3 -> 4) apart from the first at the same palace.
//   * Golden key + plain Bucket on level 2 = the cell door talk is done (stage 5); on level 0 it is not yet.
//   * Murky/blessed bucket and Iron/Golden keys mark stages 5-7 by themselves.
//   * Stage 61: Drezel's last line ("I will keep it equipped whenever I fight werewolves") stays in the client's
//     dialog history (10 pages), and the barrier only passes at 61, landing on the Morytania side (3423,3485).
// Needs: Rune Mysteries done (essence teleport), a Pot, a pickaxe, 2+ coins, melee gear (combat ~50) and food.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import essenceMine from '@conductor/tasks/essence-mine';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import mining from '@conductor/tasks/mining';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'priestperil';
const FOOD = ['Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout', 'Cooked meat', 'Bread'];
const MET = ['quest:priestperil>=4'];
// Walk tokens per gate (wiki/world/gate-list.ts): the dungeon Gate 1 needs >=5, Gate 2 >=8, the cell door >=6.
const MET5 = [...MET, 'quest:priestperil>=5'];
const MET6 = [...MET5, 'quest:priestperil>=6'];
const MET8 = [...MET6, 'quest:priestperil>=8'];
const BUCKET = 1925;
const MURKY = 2953;
const BLESSED = 2954;

const id = (v: PlanView, n: number) => v.state.inventory.filter(i => i.id === n).reduce((a, i) => a + i.count, 0);
const pos = (v: PlanView) => v.state.player;
const dungeon = (v: PlanView) => (pos(v)?.worldZ ?? 0) > 9000;
const level = (v: PlanView) => pos(v)?.level ?? 0;
const px = (v: PlanView) => pos(v)?.worldX ?? 0;
const pz = (v: PlanView) => pos(v)?.worldZ ?? 0;
const inMine = (v: PlanView) => px(v) >= 2880 && px(v) < 2944 && pz(v) >= 4800 && pz(v) < 4864;
const surface0 = (v: PlanView) => level(v) === 0 && !dungeon(v) && !inMine(v);
// The Morytania side of the holy barrier, east of the temple (the barrier lands at (3423,3485)).
const east = (v: PlanView) => surface0(v) && px(v) >= 3420 && px(v) <= 3445 && pz(v) >= 3470 && pz(v) <= 3500;
const started = (v: PlanView) => v.quest(ID) === 'started';
const done = (v: PlanView) => v.questDone(ID);
const pot = (v: PlanView) => v.inv('Pot');
const plain = (v: PlanView) => id(v, BUCKET);
const gold = (v: PlanView) => v.inv('Golden key');
const iron = (v: PlanView) => v.inv('Iron key');
const noKeys = (v: PlanView) => gold(v) + iron(v) === 0;
const noWater = (v: PlanView) => id(v, MURKY) + id(v, BLESSED) === 0;
const ess = (v: PlanView) => v.inv(/^rune essence$/i);
const late = (v: PlanView) => started(v) && pot(v) === 0;
const dogNear = (v: PlanView) => v.state.nearbyNpcs.some(n => /^temple guardian$/i.test(n.name));
const talked61 = (v: PlanView) =>
    v.state.recentDialogs.some(d => d.text.some(t => /keep it equipped whenever I fight werewolves/i.test(t)));
// The cell door talk (stage 4 -> 5) ends with Drezel's "find the key to your cell"; it stays in the 10-page dialog history.
const cellDone = (v: PlanView) =>
    v.state.recentDialogs.some(d => d.text.some(t => /find the key to your cell/i.test(t)));
const insideTemple = (v: PlanView) => surface0(v) && px(v) >= 3409 && px(v) <= 3418 && pz(v) >= 3481 && pz(v) <= 3495;
// Walks cannot plan from the temple's upper floors to the dungeon or Varrock: climb down with the ladder and stairs.
const wantDown = (v: PlanView) => (gold(v) > 0 && plain(v) > 0 && cellDone(v)) || late(v);
// Stages 6-7 need the top floor (Iron key, murky or blessed bucket); a walk from outside cannot reach it.
const needTop = (v: PlanView) => iron(v) > 0 || (id(v, MURKY) > 0 && noKeys(v)) || id(v, BLESSED) > 0;
// The dog room: the ladder landing is (3405,9906), the dog spawns at (3405,9902).
const atLanding = (v: PlanView) => dungeon(v) && pz(v) >= 9904;
// Stages 1-3: a Pot, started, no Bucket yet.
const early = (v: PlanView) => started(v) && pot(v) > 0 && plain(v) === 0 && noKeys(v) && noWater(v);
const atDoor = (v: PlanView) => surface0(v) && px(v) >= 3400 && pz(v) <= 3496;

const roald = { npc: 'King Roald', at: { x: 3222, z: 3476, tolerance: 2 } };
const drezelDungeon = { npc: '^Drezel$', at: { x: 3438, z: 9895, tolerance: 3, met: MET8 } };
const drezelCell = { npc: '^Drezel$', at: { x: 3417, z: 3490, level: 2, tolerance: 1, met: MET6 } };
const cellDoor = { x: 3414, z: 3489, level: 2, tolerance: 1, met: MET6 };
const barrier = {
    target: 'loc' as const,
    name: '^Holy barrier$',
    option: '^Pass-through$',
    expect: 'pass through the holy barrier',
    at: { x: 3440, z: 9889, tolerance: 2 },
};

export default definePlan({
    name: 'priest-in-peril',
    description:
        'Priest in Peril to done and stage 61: Roald, knock, dog, bucket, Roald, monk key, cell door, well, monument key swap, Iron key, blessed water on the coffin, 50 rune essence to Drezel, the barrier talk.',
    requires: {
        ...QUEST_TAB_REQUIRED,
        'a Pot (stage marker) unless the quest is started': v => v.quest(ID) !== 'none' || v.inv('Pot') > 0,
        'no Bucket before the quest starts': v => v.quest(ID) !== 'none' || id(v, BUCKET) === 0,
    },
    phases: [
        // --- done: the stage 61 talk, then through the barrier ---
        phase(interact, barrier, {
            name: 'pass',
            when: v => done(v) && dungeon(v) && talked61(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(talk, drezelDungeon, {
            name: 'drezel-61',
            when: v => done(v) && !east(v) && !talked61(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(interact, barrier, {
            name: 'pass-try',
            when: v => done(v) && dungeon(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        // --- stages 8-60: 50 rune essence, Drezel meets us in the dungeon, then takes it ---
        phase(talk, drezelDungeon, { name: 'give', when: v => late(v) && ess(v) > 0 && !inMine(v), maxFails: 5 }),
        phase(essenceMine, { action: 'leave' }, { name: 'leave-mine', when: v => inMine(v) && v.full }),
        phase(mining, { rock: 'essence', onFull: 'stop' }, { name: 'mine', when: v => inMine(v) && !v.full }),
        // essence-mine takes no walk tokens: climb out of the dungeon with a travel that has them.
        phase(
            travel,
            { to: { x: 3405, z: 3504 }, tolerance: 2, met: MET8 },
            { name: 'leave-dungeon', when: v => late(v) && ess(v) === 0 && dungeon(v) },
        ),
        phase(
            essenceMine,
            { action: 'enter' },
            { name: 'enter-mine', when: v => late(v) && ess(v) === 0 && !inMine(v) && level(v) === 0 },
        ),
        // --- stages 5-7: the cell, the well, the monuments, the coffin ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 3410, z: 3487, level: 2, tolerance: 1 },
            },
            { name: 'down-ladder', when: v => level(v) === 2 && wantDown(v) },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Climb-down$',
                at: { x: 3416, z: 3485, level: 1, tolerance: 1 },
            },
            { name: 'down-stairs', when: v => level(v) === 1 && wantDown(v) },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 3411, z: 3485, level: 1, tolerance: 1 } },
            { name: 'up-ladder', when: v => level(v) === 1 && needTop(v) },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Staircase$', option: '^Climb-up$', at: { x: 3415, z: 3485, tolerance: 2 } },
            { name: 'up-stairs', when: v => needTop(v) && insideTemple(v) },
        ),
        phase(
            travel,
            { to: { x: 3413, z: 3488 }, tolerance: 2, met: MET5 },
            { name: 'enter-temple', when: v => needTop(v) && level(v) === 0 && !insideTemple(v) },
        ),
        phase(
            items,
            { drop: [{ item: '^Pot$' }, { item: '^Bucket$' }] },
            {
                name: 'drop-marker',
                when: v => pot(v) > 0 && plain(v) > 0 && level(v) === 2 && noKeys(v) && noWater(v) && px(v) >= 3416,
            },
        ),
        phase(talk, drezelCell, {
            name: 'cell-7',
            when: v => pot(v) > 0 && plain(v) > 0 && level(v) === 2 && noKeys(v) && noWater(v) && px(v) <= 3415,
        }),
        phase(
            talk,
            {
                use: { items: [{ id: BLESSED }], onLoc: '^Coffin$' },
                at: { x: 3414, z: 3487, level: 2, tolerance: 1, met: MET6 },
            },
            { name: 'pour', onFail: 'continue', when: v => id(v, BLESSED) > 0 },
        ),
        phase(talk, drezelCell, {
            name: 'bless',
            onFail: 'continue',
            when: v => id(v, MURKY) > 0 && noKeys(v),
        }),
        phase(
            talk,
            { use: { items: ['^Iron key$'], onLoc: '^Cell door$' }, at: cellDoor },
            { name: 'unlock', onFail: 'continue', when: v => iron(v) > 0 },
        ),
        phase(
            talk,
            {
                use: { items: ['^Golden key$'], onLoc: '^Monument$', tile: { x: 3428, z: 9890 } },
                at: { x: 3430, z: 9890, tolerance: 1, met: MET5 },
            },
            { name: 'swap', onFail: 'continue', when: v => gold(v) > 0 && id(v, MURKY) > 0 },
        ),
        phase(
            talk,
            { continue: true, choices: ['Tell me anyway', '^Yes'] },
            {
                name: 'cell-choices',
                when: v => gold(v) > 0 && plain(v) > 0 && level(v) === 2 && v.state.dialog.isOpen,
            },
        ),
        phase(
            talk,
            { use: { items: [{ id: BUCKET }], onLoc: '^Well$' }, at: { x: 3422, z: 9889, tolerance: 2, met: MET5 } },
            {
                name: 'fill',
                onFail: 'continue',
                when: v => gold(v) > 0 && plain(v) > 0 && cellDone(v) && level(v) === 0,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cell door$', option: '^Talk-through$', at: cellDoor },
            {
                name: 'cell-door',
                when: v => gold(v) > 0 && plain(v) > 0 && !cellDone(v) && level(v) !== 2 && !dungeon(v),
            },
        ),
        // --- stage 4: the level 30 monk drops the Golden key ---
        phase(
            combat,
            {
                target: 'Monk of Zamorak',
                level: 30,
                skill: 'Strength',
                area: { x: 3413, z: 3488, radius: 6 },
                food: FOOD,
                loot: ['Golden key'],
                maxLevelGap: 20,
            },
            {
                name: 'monks',
                when: v =>
                    started(v) &&
                    pot(v) > 0 &&
                    plain(v) > 0 &&
                    noKeys(v) &&
                    noWater(v) &&
                    surface0(v) &&
                    (pz(v) >= 3459 || px(v) >= 3400),
                until: v => gold(v) > 0,
            },
        ),
        // --- stages 3-4: Roald again, from the shop (the bucket is bought first) ---
        phase(talk, roald, {
            name: 'roald-dog',
            when: v =>
                started(v) &&
                pot(v) > 0 &&
                plain(v) > 0 &&
                noKeys(v) &&
                noWater(v) &&
                surface0(v) &&
                pz(v) >= 3446 &&
                pz(v) <= 3458 &&
                px(v) < 3400,
        }),
        // The walk north from the shop sticks in Varrock's western square; go round by the east side.
        phase(
            travel,
            { to: { x: 3216, z: 3452 }, tolerance: 2, waypoints: [{ x: 3236, z: 3437 }] },
            {
                name: 'to-palace',
                when: v =>
                    started(v) &&
                    pot(v) > 0 &&
                    plain(v) > 0 &&
                    noKeys(v) &&
                    noWater(v) &&
                    surface0(v) &&
                    pz(v) < 3446 &&
                    px(v) < 3400,
            },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 3218, z: 3413 }, buy: [{ item: 'Bucket', count: 1 }] },
            {
                name: 'bucket',
                when: v =>
                    early(v) &&
                    ((surface0(v) && px(v) >= 3400 && pz(v) >= 3498) || (dungeon(v) && !dogNear(v) && !atLanding(v))),
            },
        ),
        // --- stages 1-2: knock, then the dog ---
        phase(
            talk,
            { continue: true, choices: ['Roald sent me', '^Sure'] },
            { name: 'knock-talk', when: v => early(v) && atDoor(v) && v.state.dialog.isOpen },
        ),
        phase(
            combat,
            {
                target: 'Temple guardian',
                skill: 'Strength',
                area: { x: 3405, z: 9902, radius: 8 },
                food: FOOD,
                maxLevelGap: 20,
            },
            {
                name: 'dog',
                when: v => early(v) && ((dungeon(v) && (dogNear(v) || atLanding(v))) || atDoor(v)),
                until: v => dungeon(v) && !dogNear(v) && pz(v) <= 9903,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Large door$', option: '^Knock-at$', at: { x: 3405, z: 3489, tolerance: 2 } },
            { name: 'knock', when: v => early(v) && surface0(v) && px(v) < 3400 },
        ),
        phase(talk, { ...roald, choices: ['^Sure'] }, { name: 'roald-start', when: v => v.quest(ID) === 'none' }),
    ],
    until: v => done(v) && east(v),
});
