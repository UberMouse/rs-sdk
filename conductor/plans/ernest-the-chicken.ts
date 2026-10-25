// Ernest the Chicken (server/content/scripts/quests/quest_haunted/scripts/quest_haunted.rs2, areas/area_draynor/
// scripts/{veronica,professor_oddenstein}.rs2):
//   Veronica (start) -> Spade, Poison (ground floor), Fish food (first floor) -> Poison on Fish food -> pour it in the
//   fountain, search it (Pressure gauge) -> Spade on the compost heap (Key) -> Key on the closet door, Rubber tube,
//   Key again to get out -> ladder in the west garden to the lever basement -> Oil can (lever puzzle) -> back up ->
//   stairs to the top floor -> Professor Oddenstein (stage 1: asks for the parts, stage 2: takes them).
// Restart-safe: phases come from held items, the quest tab, the floor and the position. The lever basement keeps its
// lever bits only on the server, so its steps are keyed on (where the bot stands, how many Salmon were dropped as
// step markers): the ladder resets every lever, and a basement position no step knows climbs out and starts over.
// Start: 10 Salmon (the lumbridge-quests save), a weapon. Manor facts: learnings/draynor-manor.md (the front door
// opens from the south only; the back door at (3123,3360) leaves).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';

const ID = 'haunted';
const SALMON = 10;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const near = (v: PlanView, x: number, z: number, r: number, level = 0) =>
    lvl(v) === level && Math.max(Math.abs(px(v) - x), Math.abs(pz(v) - z)) <= r;
const inBasement = (v: PlanView) => pz(v) > 9700 && px(v) > 3085 && px(v) < 3125;
const marks = (v: PlanView) => SALMON - v.inv('Salmon');
const allThree = (v: PlanView) => v.inv('Pressure gauge') > 0 && v.inv('Oil can') > 0 && v.inv('Rubber tube') > 0;
const inCloset = (v: PlanView) => near(v, 3110, 3367, 2);

// ---- the lever basement ----
// Lever bits (A..F = 0..5, pulled = down), doors, and the solution found by search over the script's conditions:
//   pull A, B; door 4-7 (to the east hall E4); pull D; door 4-5; door 5-8 (back to the entry hall H); pull A, B again;
//   door 5-8 (to R5), 5-6, 3-6 (to R3); pull E, F; door 2-3, 1-2 (E4); pull C; 1-2 back, 2-3; pull E; 2-3; 2-5; 5-8
//   (H); 8-9 (oil can room).
// Door landings are exact (the door script teleports to the tile on the far side); a pull leaves the bot within one
// tile of the lever. Salmon drops (marks) tell apart the visits that would look the same.
interface Spot {
    x: number;
    z: number;
    r: number;
    marks: number;
    /** Narrows the square: levers E and F are two tiles apart, so their squares are split. */
    zone?: (x: number, z: number) => boolean;
}
interface Step {
    name: string;
    gate: Spot;
    task: 'interact' | 'items';
    params: object;
}
const lever = (n: string, x: number, z: number) => ({
    target: 'loc' as const,
    name: `^Lever ${n}$`,
    option: '^Pull$',
    tile: { x, z },
    at: { x, z, level: 0, tolerance: 1 },
});
// No `at`: the bot already stands on the right side (a walk to a tile next to the wall would open the door itself).
const door = (tx: number, tz: number, from?: { x: number; z: number }) => ({
    target: 'loc' as const,
    name: '^Door$',
    option: '^Open$',
    tile: { x: tx, z: tz },
    ...(from ? { at: { ...from, level: 0, tolerance: 1 } } : {}),
});
const LEV = {
    A: [3108, 9745],
    B: [3118, 9752],
    C: [3112, 9760],
    D: [3108, 9767],
    E: [3097, 9767],
    F: [3096, 9765],
} as const;
const at = (x: number, z: number, m: number, r = 0): Spot => ({ x, z, r, marks: m });
const atLever = (n: keyof typeof LEV, m: number): Spot => at(LEV[n][0], LEV[n][1], m, 1);
const step = (name: string, gate: Spot, task: 'lever' | 'door' | 'mark', params: object): Step => ({
    name,
    gate,
    task: task === 'mark' ? 'items' : 'interact',
    params,
});
const pull = (n: keyof typeof LEV) => lever(n, LEV[n][0], LEV[n][1]);
const MARK = { drop: [{ item: '^Salmon$', count: 1 }] };
const LAND = {
    ladder: [3116, 9754],
    d47N: [3108, 9758],
    d45W: [3104, 9760],
    d58S: [3102, 9757],
    d58N: [3102, 9758],
    d56W: [3099, 9760],
    d36N: [3097, 9763],
    d23E: [3100, 9765],
    d12E: [3105, 9765],
    d12W: [3104, 9765],
    d23W: [3099, 9765],
    d25S: [3102, 9762],
    d89W: [3099, 9755],
} as const;
const L = (k: keyof typeof LAND, m: number) => at(LAND[k][0], LAND[k][1], m);
const atExact = (n: 'E' | 'F', m: number): Spot => ({
    ...at(LEV[n][0], LEV[n][1], m, 1),
    zone: n === 'E' ? (x, z) => x >= 3097 && z >= 9766 : (x, z) => !(x >= 3097 && z >= 9766),
});
const puzzle: Step[] = [
    step('pull-A1', L('ladder', 0), 'lever', pull('A')),
    step('pull-B1', atLever('A', 0), 'lever', pull('B')),
    step('door-47', atLever('B', 0), 'door', door(3108, 9758)),
    step('pull-D', L('d47N', 0), 'lever', pull('D')),
    step('door-45', atLever('D', 0), 'door', door(3105, 9760)),
    step('door-58-to-H', L('d45W', 0), 'door', door(3102, 9758)),
    step('mark-1', L('d58S', 0), 'mark', MARK),
    step('pull-A2', L('d58S', 1), 'lever', pull('A')),
    step('pull-B2', atLever('A', 1), 'lever', pull('B')),
    step('door-58-to-R5', atLever('B', 1), 'door', door(3102, 9758, { x: 3102, z: 9756 })),
    step('door-56', L('d58N', 1), 'door', door(3100, 9760)),
    step('door-36', L('d56W', 1), 'door', door(3097, 9763)),
    step('pull-E1', L('d36N', 1), 'lever', pull('E')),
    step('pull-F', atExact('E', 1), 'lever', pull('F')),
    step('mark-2', atExact('F', 1), 'mark', MARK),
    step('door-23-to-R2', atExact('F', 2), 'door', door(3100, 9765)),
    step('door-12-to-E4', L('d23E', 2), 'door', door(3105, 9765)),
    step('pull-C', L('d12E', 2), 'lever', pull('C')),
    step('door-12-to-R2', atLever('C', 2), 'door', door(3105, 9765)),
    step('door-23-to-R3', L('d12W', 2), 'door', door(3100, 9765)),
    step('pull-E2', L('d23W', 2), 'lever', pull('E')),
    step('mark-3', atExact('E', 2), 'mark', MARK),
    step('door-23-to-R2b', atExact('E', 3), 'door', door(3100, 9765)),
    step('door-25', L('d23E', 3), 'door', door(3102, 9763)),
    step('door-58-to-H2', L('d25S', 3), 'door', door(3102, 9758)),
    step('door-89', L('d58S', 3), 'door', door(3100, 9755)),
];
const holds = (v: PlanView, s: Spot) =>
    v.inv('Oil can') === 0 && marks(v) === s.marks && near(v, s.x, s.z, s.r) && (s.zone?.(px(v), pz(v)) ?? true);
const puzzlePhases = puzzle.map(st => {
    const opts = { name: st.name, when: (v: PlanView) => holds(v, st.gate), onFail: 'continue' as const, maxFails: 4 };
    return st.task === 'items' ? phase(items, st.params as never, opts) : phase(interact, st.params as never, opts);
});

export default definePlan({
    name: 'ernest-the-chicken',
    description:
        'Ernest the Chicken: Veronica, spade/poison/fish food, fountain (gauge), compost (key), closet (tube), lever basement (oil can), Professor Oddenstein.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        // ---- the end: top floor ----
        phase(
            talk,
            {
                npc: 'Professor Oddenstein',
                at: { x: 3110, z: 3367, level: 2, tolerance: 4 },
                choices: ['looking for a guy', 'Change him back'],
            },
            {
                name: 'oddenstein-ask',
                when: v => allThree(v) && v.quest(ID) === 'started' && lvl(v) === 2,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { npc: 'Professor Oddenstein', at: { x: 3110, z: 3367, level: 2, tolerance: 4 } },
            { name: 'oddenstein-final', when: v => allThree(v) && v.quest(ID) === 'started' && lvl(v) === 2 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Climb-up$',
                tile: { x: 3104, z: 3362 },
                at: { x: 3104, z: 3361, level: 1, tolerance: 1 },
            },
            { name: 'spiral-up', when: v => allThree(v) && lvl(v) === 1 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Walk-up$',
                at: { x: 3108, z: 3362, level: 0, tolerance: 1 },
            },
            { name: 'stairs-up-final', when: v => allThree(v) && lvl(v) === 0 && !inBasement(v) },
        ),
        // ---- oil can: basement ----
        // The oil can room's door opens from the inside under the same lever bits (E down-up, F down): open it by hand,
        // the walker does not.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 3100, z: 9755 },
                at: { x: 3097, z: 9755, level: 0, tolerance: 1 },
            },
            {
                name: 'door-89-out',
                when: v =>
                    inBasement(v) &&
                    v.inv('Oil can') > 0 &&
                    px(v) >= 3090 &&
                    px(v) <= 3099 &&
                    pz(v) >= 9753 &&
                    pz(v) <= 9757,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 3116, z: 9754, level: 0, tolerance: 1 } },
            { name: 'ladder-up', when: v => inBasement(v) && v.inv('Oil can') > 0 },
        ),
        phase(
            pickup,
            { area: { x: 3094, z: 9755, radius: 5 }, items: [{ item: 'Oil can', count: 1 }] },
            {
                name: 'oil-can',
                when: v =>
                    inBasement(v) &&
                    v.inv('Oil can') === 0 &&
                    px(v) >= 3090 &&
                    px(v) <= 3099 &&
                    pz(v) >= 9753 &&
                    pz(v) <= 9757,
            },
        ),
        ...puzzlePhases,
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 3116, z: 9754, level: 0, tolerance: 1 } },
            {
                name: 'basement-reset',
                when: v =>
                    inBasement(v) &&
                    v.inv('Oil can') === 0 &&
                    !puzzle.some(s => holds(v, s.gate)) &&
                    !(px(v) >= 3090 && px(v) <= 3099 && pz(v) >= 9753 && pz(v) <= 9757),
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 3093, z: 3363, level: 0, tolerance: 1 },
            },
            {
                name: 'ladder-down',
                when: v =>
                    v.inv('Pressure gauge') > 0 &&
                    v.inv('Rubber tube') > 0 &&
                    v.inv('Oil can') === 0 &&
                    lvl(v) === 0 &&
                    !inBasement(v) &&
                    !inCloset(v),
            },
        ),
        // ---- rubber tube ----
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 3107, z: 3367 },
                at: { x: 3108, z: 3367, level: 0, tolerance: 1 },
            },
            { name: 'closet-exit', when: v => v.inv('Rubber tube') > 0 && inCloset(v) },
        ),
        phase(
            pickup,
            { area: { x: 3110, z: 3367, radius: 3 }, items: [{ item: 'Rubber tube', count: 1 }] },
            { name: 'tube', when: v => v.inv('Key') > 0 && v.inv('Rubber tube') === 0 && inCloset(v) },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 3107, z: 3367 },
                at: { x: 3107, z: 3367, level: 0, tolerance: 1 },
            },
            { name: 'closet-enter', when: v => v.inv('Key') > 0 && v.inv('Rubber tube') === 0 && !inCloset(v) },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Compost heap$',
                use: { item: '^Spade$' },
                at: { x: 3086, z: 3358, level: 0, tolerance: 2 },
            },
            {
                name: 'compost',
                when: v =>
                    v.inv('Pressure gauge') > 0 &&
                    v.inv('Spade') > 0 &&
                    v.inv('Key') === 0 &&
                    v.inv('Rubber tube') === 0,
            },
        ),
        // ---- pressure gauge ----
        phase(
            interact,
            {
                target: 'loc',
                name: '^Fountain$',
                option: '^Search$',
                expect: 'pressure gauge',
                at: { x: 3088, z: 3332, level: 0, tolerance: 2 },
            },
            {
                name: 'fountain-search',
                when: v =>
                    v.inv('Pressure gauge') === 0 &&
                    v.inv('Poison') + v.inv('Fish food') + v.inv('Poisoned fish food') === 0 &&
                    near(v, 3087, 3334, 6),
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Fountain$',
                use: { item: '^Poisoned fish food$' },
                at: { x: 3088, z: 3332, level: 0, tolerance: 2 },
            },
            { name: 'fountain-pour', when: v => v.inv('Poisoned fish food') > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Poison$', on: '^Fish food$', product: '^Poisoned fish food$' } },
            { name: 'combine', when: v => v.inv('Poison') > 0 && v.inv('Fish food') > 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Walk-down$',
                at: { x: 3108, z: 3366, level: 1, tolerance: 1 },
            },
            {
                name: 'stairs-down',
                when: v => lvl(v) === 1 && !allThree(v) && v.inv('Fish food') + v.inv('Poisoned fish food') > 0,
            },
        ),
        // ---- fetch: fish food (first floor), poison, spade ----
        phase(
            pickup,
            { area: { x: 3108, z: 3356, radius: 4, level: 1 }, items: [{ item: 'Fish food', count: 1 }] },
            { name: 'fish-food', when: v => v.inv('Fish food') === 0 && v.inv('Poison') > 0 && lvl(v) === 1 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Walk-up$',
                at: { x: 3108, z: 3362, level: 0, tolerance: 1 },
            },
            {
                name: 'stairs-up-fish',
                when: v =>
                    v.inv('Fish food') === 0 &&
                    v.inv('Poison') > 0 &&
                    v.inv('Poisoned fish food') === 0 &&
                    v.inv('Pressure gauge') === 0 &&
                    lvl(v) === 0,
            },
        ),
        phase(
            pickup,
            { area: { x: 3097, z: 3366, radius: 3 }, items: [{ item: 'Poison', count: 1 }] },
            {
                name: 'poison',
                when: v =>
                    v.inv('Poison') + v.inv('Fish food') + v.inv('Poisoned fish food') + v.inv('Pressure gauge') ===
                        0 && v.inv('Spade') > 0,
            },
        ),
        phase(
            pickup,
            { area: { x: 3120, z: 3359, radius: 3 }, items: [{ item: 'Spade', count: 1 }] },
            {
                name: 'spade',
                when: v =>
                    v.inv('Spade') === 0 &&
                    v.inv('Key') + v.inv('Rubber tube') + v.inv('Pressure gauge') === 0 &&
                    v.quest(ID) !== 'none',
            },
        ),
        phase(
            talk,
            { npc: 'Veronica', at: { x: 3110, z: 3330, level: 0, tolerance: 4 }, choices: ['sounds like a quest'] },
            { name: 'veronica', when: v => v.quest(ID) === 'none' },
        ),
    ],
    until: v => v.questDone(ID),
});
