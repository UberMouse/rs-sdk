// Clock Tower (server scripts: quests/quest_cog/scripts/{quest_cog,locs/*,objs/cogs}.rs2; varp cogquest 0..5, bits in cog_bits).
// Brother Kojo (2569,3249) starts it. Four cogs, one carried at a time, each to its own spindle in the tower:
//   red   (obj 23, dungeon (2583,9613))  -> ground floor spindle (2568,3243)
//   black (obj 21, dungeon (2613,9639))  -> basement spindle (2570,9642); hot: picked up only with ice gloves worn
//   white (obj 20, dungeon (2577,9655))  -> level 2 spindle (2567,3241); behind the rat gate (2579,9656): pull the lever
//         (2591,9661) (opens the cage gate (2595,9657)), rat poison (2564,9662) used on the Food trough (2586,9654) kills the rats
//         and lets the gate open from inside
//   blue  (obj 22, dungeon (2574,9633))  -> level 1 spindle (2569,3240); the cog sits in a railing cell the main dungeon does
//         not reach. Its region (the corridor x 2580 and the cell) is entered by the surface ladder (2621,3261) down to
//         (2621,9661); the secret "Wall" (2575,9631) is pushed from the corridor side (2576,9631); leave by the same ladder.
// The tower ladder (2566,3242) goes down to the main dungeon (2566,9643). Stairs (2572,3240): Staircase Climb-up / Climb-down.
// Start save: lib:clock-tower-start (ice gloves worn, 8 swordfish).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';

const ID = 'cog';
const WHITE = 20;
const BLACK = 21;
const BLUE = 22;
const RED = 23;
const POISON = 24;
const has = (v: PlanView, id: number) => v.state.inventory.some(i => i.id === id);
const holdsCog = (v: PlanView) => [WHITE, BLACK, BLUE, RED].some(id => has(v, id));
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const below = (v: PlanView) => pz(v) > 9000;
const ran = (v: PlanView, name: string) => v.runs(name) > 0;
const placed = (v: PlanView, c: string) => ran(v, `place-${c}`);
const allPlaced = (v: PlanView) => placed(v, 'red') && placed(v, 'black') && placed(v, 'white') && placed(v, 'blue');
/** The cog still to fetch: red, black, white, blue in that order. */
const next = (v: PlanView) =>
    !placed(v, 'red')
        ? 'red'
        : !placed(v, 'black')
          ? 'black'
          : !placed(v, 'white')
            ? 'white'
            : !placed(v, 'blue')
              ? 'blue'
              : 'none';
const started = (v: PlanView) => v.quest(ID) === 'started';
/** Wanting a cog from the ground: started, empty-handed, not all placed. */
const fetching = (v: PlanView, c: string) => started(v) && !holdsCog(v) && next(v) === c;
const R = { onFail: 'continue', maxFails: 6 } as const;

const spindle = (id: number, tile: { x: number; z: number; level: number }) =>
    ({
        target: 'loc',
        name: '^Clock spindle$',
        use: { item: { id } },
        tile,
        at: { x: tile.x, z: tile.z + 1, level: tile.level, tolerance: 2 },
    }) as const;
const grab = (x: number, z: number) => ({ area: { x, z, radius: 2 }, items: [{ item: 'Cog', count: 1 }] }) as const;

export default definePlan({
    name: 'clock-tower',
    description:
        'Clock Tower: Kojo, red/black/white (rat poison on the trough)/blue (surface ladder 2621,3261, secret wall) cogs from the dungeon to their spindles, Kojo.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            combat,
            {
                target: '.',
                skill: 'Strength',
                allowMaxed: true,
                targetRange: 'visible',
                area: { x: 2580, z: 9640, radius: 40 },
                food: ['Swordfish'],
                maxLevelGap: 30,
            },
            {
                name: 'fight',
                when: v =>
                    !!v.state.player?.combat.inCombat ||
                    (v.last?.status === 'failed' && /attacked/.test(v.last.reason ?? '')),
                until: v =>
                    !v.state.player?.combat.inCombat && v.last?.phase !== 'get-red' && v.last?.phase !== 'get-black',
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        phase(
            talk,
            { npc: '^Brother Kojo$', at: { x: 2569, z: 3249, tolerance: 3 } },
            { name: 'finish', when: v => allPlaced(v) && !below(v) && lvl(v) === 0, maxFails: 3 },
        ),
        // Place the cogs.
        phase(interact, spindle(RED, { x: 2568, z: 3243, level: 0 }), {
            name: 'place-red',
            when: v => has(v, RED) && !below(v) && lvl(v) === 0,
            ...R,
        }),
        phase(interact, spindle(BLACK, { x: 2570, z: 9642, level: 0 }), {
            name: 'place-black',
            when: v => has(v, BLACK) && below(v),
            ...R,
        }),
        phase(interact, spindle(BLUE, { x: 2569, z: 3240, level: 1 }), {
            name: 'place-blue',
            when: v => has(v, BLUE) && !below(v) && lvl(v) === 1,
            ...R,
        }),
        phase(interact, spindle(WHITE, { x: 2567, z: 3241, level: 2 }), {
            name: 'place-white',
            when: v => has(v, WHITE) && !below(v) && lvl(v) === 2,
            ...R,
        }),
        // Up the tower with white (level 2) or blue (level 1).
        phase(
            interact,
            { target: 'loc', name: '^Staircase$', option: '^Climb-up$', at: { x: 2572, z: 3242, tolerance: 2 } },
            {
                name: 'up0',
                when: v => !below(v) && lvl(v) === 0 && (has(v, WHITE) || has(v, BLUE)),
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Staircase$', option: '^Climb-up$' },
            {
                name: 'up',
                when: v => !below(v) && lvl(v) > 0 && has(v, WHITE) && lvl(v) < 2,
                ...R,
            },
        ),
        // Down the tower empty-handed (after a placement upstairs).
        phase(
            interact,
            { target: 'loc', name: '^Staircase$', option: '^Climb-down$' },
            { name: 'down-stairs', when: v => !below(v) && lvl(v) > 0 && !holdsCog(v), ...R },
        ),
        // Out of the dungeon with a cog: blue by the east ladder, the others by the tower ladder.
        // The secret wall closes behind the player: push it again from inside the cell.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Wall$',
                option: '^Push$',
                tile: { x: 2575, z: 9631 },
                at: { x: 2574, z: 9631, tolerance: 1 },
            },
            {
                name: 'repush',
                when: v =>
                    has(v, BLUE) &&
                    below(v) &&
                    (v.state.player?.worldX ?? 0) <= 2575 &&
                    pz(v) >= 9630 &&
                    pz(v) <= 9634 &&
                    !ran(v, 'repush'),
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2621, z: 9661 },
                at: { x: 2620, z: 9661, tolerance: 2 },
            },
            { name: 'leave-blue', when: v => has(v, BLUE) && below(v), ...R },
        ),
        // Back out of the white cog's room through the same gate (it opens from either side once the rats are dead).
        phase(
            interact,
            {
                target: 'loc',
                name: '^Gate$',
                option: '^Go-through$',
                tile: { x: 2579, z: 9656 },
                at: { x: 2578, z: 9656, tolerance: 1 },
            },
            {
                name: 'regate',
                when: v =>
                    has(v, WHITE) &&
                    below(v) &&
                    (v.state.player?.worldX ?? 0) < 2579 &&
                    pz(v) >= 9650 &&
                    !ran(v, 'regate'),
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2566, z: 9642 },
                at: { x: 2566, z: 9643, tolerance: 2 },
            },
            { name: 'leave', when: v => (has(v, RED) || has(v, WHITE)) && below(v), ...R },
        ),
        // Black.
        phase(pickup, grab(2613, 9639), { name: 'get-black', when: v => fetching(v, 'black') && below(v), ...R }),
        // Red.
        phase(pickup, grab(2583, 9613), { name: 'get-red', when: v => fetching(v, 'red') && below(v), ...R }),
        // Blue: ladder down at (2621,3261), push the secret wall, take the cog.
        phase(pickup, grab(2574, 9633), {
            name: 'get-blue',
            when: v => fetching(v, 'blue') && below(v) && ran(v, 'push'),
            ...R,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Wall$',
                option: '^Push$',
                tile: { x: 2575, z: 9631 },
                at: { x: 2576, z: 9631, tolerance: 1 },
            },
            { name: 'push', when: v => fetching(v, 'blue') && below(v) && ran(v, 'enter-c') && !ran(v, 'push'), ...R },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2621, z: 3261 },
                at: { x: 2621, z: 3262, tolerance: 2 },
            },
            {
                name: 'enter-c',
                when: v => fetching(v, 'blue') && !below(v) && lvl(v) === 0 && v.runs('enter-c') < 3,
                ...R,
            },
        ),
        // White: poison, lever, trough, then the cog.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Gate$',
                option: '^Go-through$',
                tile: { x: 2579, z: 9656 },
                at: { x: 2580, z: 9656, tolerance: 1 },
            },
            { name: 'gate', when: v => fetching(v, 'white') && below(v) && ran(v, 'trough') && !ran(v, 'gate'), ...R },
        ),
        phase(pickup, grab(2577, 9655), {
            name: 'get-white',
            when: v => fetching(v, 'white') && below(v) && ran(v, 'trough'),
            ...R,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Food trough$',
                use: { item: { id: POISON } },
                at: { x: 2585, z: 9654, tolerance: 2 },
            },
            {
                name: 'trough',
                when: v => fetching(v, 'white') && has(v, POISON) && ran(v, 'lever') && !ran(v, 'trough'),
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Lever$',
                option: '^Pull$',
                tile: { x: 2591, z: 9661 },
                at: { x: 2591, z: 9660, tolerance: 1 },
            },
            { name: 'lever', when: v => fetching(v, 'white') && has(v, POISON) && !ran(v, 'lever'), ...R },
        ),
        phase(
            pickup,
            { area: { x: 2564, z: 9662, radius: 2 }, items: [{ item: 'Rat poison', count: 1 }] },
            {
                name: 'get-poison',
                when: v => fetching(v, 'white') && below(v) && !has(v, POISON) && !ran(v, 'trough'),
                ...R,
            },
        ),
        // Into the dungeon by the tower ladder (red, black, white).
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2566, z: 3242 },
                at: { x: 2569, z: 3242, tolerance: 2 },
            },
            {
                name: 'down',
                when: v =>
                    started(v) && !holdsCog(v) && !below(v) && lvl(v) === 0 && next(v) !== 'blue' && next(v) !== 'none',
                ...R,
            },
        ),
        phase(
            talk,
            { npc: '^Brother Kojo$', at: { x: 2569, z: 3249, tolerance: 3 }, choices: ['OK old monk'] },
            { name: 'start', when: v => v.quest(ID) === 'none', maxFails: 3 },
        ),
    ],
});
