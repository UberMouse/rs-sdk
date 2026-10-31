// Gertrude's Cat (server/content/scripts/quests/quest_fluffs/scripts/quest_fluffs.rs2, areas/area_varrock/scripts/gertrude.rs2, shilop.rs2;
// quest id fluffs): Gertrude (3151,3410) -> Shilop/Wilough in Varrock square, pay 100 coins -> the lumber yard (3296-3319, 3495-3518,
// entered over the Broken fence at 3305,3493) -> Gertrudes cat upstairs (ladder 3310,3509): milk, then a seasoned sardine (doogle
// leaves, ground spawns at 3151-3157,3399-3401, used on a raw sardine) -> the kitten is in one of six "Crate" npcs downstairs, picked
// at random at the feeding (3305,3500 3310,3499 3307,3507 3303,3506 3298,3514 3311,3511) -> kitten used on the cat -> Gertrude again.
// Start save: lib:gertrudes-cat-start (150 coins, bucket of milk, raw sardine).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';

const ID = 'fluffs';
const gertrude = { x: 3151, z: 3410, tolerance: 4 };
const square = { x: 3217, z: 3432, tolerance: 5 };
const level = (v: PlanView) => v.state.player?.level ?? 0;
const hasMilk = (v: PlanView) => v.inv(/^Bucket of milk$/i) > 0;
const hasSeasoned = (v: PlanView) => v.inv(/^Seasoned sardine$/i) > 0;
const hasKitten = (v: PlanView) => v.inv(/kitten/i) > 0;
const paid = (v: PlanView) => v.inv('Coins') < 100;
const homeTime = (v: PlanView) => level(v) === 0 && v.runs('return-kitten') > 0 && v.quest(ID) !== 'done';
const cat = '^Gertrudes cat$';
const crates: [number, number][] = [
    [3305, 3500],
    [3310, 3499],
    [3307, 3507],
    [3303, 3506],
    [3298, 3514],
    [3311, 3511],
];
const searching = (v: PlanView) =>
    v.quest(ID) === 'started' && paid(v) && !hasMilk(v) && !hasSeasoned(v) && !hasKitten(v);

export default definePlan({
    name: 'gertrudes-cat',
    description:
        "Gertrude's Cat: season a sardine, pay Shilop, feed Fluffs upstairs at the lumber yard, search the crates, return the kitten.",
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            talk,
            { npc: '^Gertrude$', at: gertrude },
            {
                name: 'finish',
                when: v => homeTime(v) && (v.last?.phase === 'open-door-2' || v.last?.status === 'failed'),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 3150, z: 3412 },
                at: { x: 3150, z: 3414, tolerance: 2 },
            },
            { name: 'open-door-2', when: v => homeTime(v) && v.last?.phase !== 'open-door-2', onFail: 'continue' },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: cat,
                use: { item: "Fluffs' kitten" },
                at: { x: 3306, z: 3512, level: 1, tolerance: 4 },
            },
            { name: 'return-kitten', when: v => hasKitten(v) && level(v) === 1 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 3309, z: 3509, tolerance: 1 } },
            {
                name: 'climb-up',
                when: v => level(v) === 0 && paid(v) && (hasMilk(v) || hasSeasoned(v) || hasKitten(v)),
            },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: cat,
                use: { item: '^Seasoned sardine$' },
                at: { x: 3306, z: 3512, level: 1, tolerance: 4 },
            },
            { name: 'feed-sardine', when: v => level(v) === 1 && hasSeasoned(v) && !hasMilk(v) },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: cat,
                use: { item: '^Bucket of milk$' },
                at: { x: 3306, z: 3512, level: 1, tolerance: 4 },
            },
            { name: 'feed-milk', when: v => level(v) === 1 && hasMilk(v) },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 3309, z: 3509, level: 1, tolerance: 1 },
            },
            {
                name: 'climb-down',
                until: v => level(v) === 0,
                when: v => level(v) === 1 && !hasMilk(v) && !hasSeasoned(v) && !hasKitten(v),
            },
        ),
        ...crates.map(([x, z], i) =>
            phase(
                interact,
                {
                    target: 'npc',
                    name: '^Crate$',
                    option: '^Search$',
                    expect: '^You find',
                    tile: { x, z },
                    at: { x: x, z: z - 1, level: 0, tolerance: 2 },
                },
                {
                    name: `crate-${i}`,
                    when: v => level(v) === 0 && searching(v) && v.runs(`crate-${i}`) === 0,
                    onFail: 'continue',
                    maxFails: 8,
                },
            ),
        ),
        // The first talk right after the quest starts sometimes closes before its choices; later attempts go through.
        ...['shilop', 'shilop-2', 'shilop-3'].map(name =>
            phase(
                talk,
                {
                    npc: '^(Shilop|Wilough)$',
                    at: square,
                    choices: ['What will make you tell me', "Okay then, I'll pay"],
                },
                { name, when: v => v.quest(ID) === 'started' && !paid(v) && hasSeasoned(v), onFail: 'continue' },
            ),
        ),
        // Gertrude's house door (north wall): the walker does not open it, so Gertrude reads as unreachable.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 3150, z: 3412 },
                at: { x: 3150, z: 3414, tolerance: 2 },
            },
            {
                name: 'open-door',
                when: v => v.quest(ID) === 'none' && hasSeasoned(v) && v.runs('open-door') === 0,
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { npc: '^Gertrude$', at: gertrude, choices: ['Well, I suppose I could'] },
            { name: 'start', when: v => v.quest(ID) === 'none' && hasSeasoned(v) },
        ),
        phase(
            items,
            { combine: { use: 'Doogle leaves', on: 'Raw sardine', product: 'Seasoned sardine' } },
            { name: 'season', when: v => v.inv('Doogle leaves') > 0 && v.inv('Raw sardine') > 0 },
        ),
        phase(
            pickup,
            { area: { x: 3153, z: 3400, radius: 6 }, items: [{ item: 'Doogle leaves' }] },
            { name: 'leaves', when: v => v.inv('Doogle leaves') === 0 && v.inv('Raw sardine') > 0 && !hasSeasoned(v) },
        ),
    ],
});
