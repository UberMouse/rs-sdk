// Gertrude's Cat (quest id fluffs; server/content/scripts/quests/quest_fluffs/; route: wiki/quests/gertudes-cat.md).
// Start save: lib:gertrudes-cat-start (150 coins, bucket of milk, raw sardine).
import type { PlanView } from '@conductor/lib/plan';
import { defineQuest, journal, step } from '@conductor/lib/quest';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import wait from '@conductor/tasks/wait';

const gertrude = { x: 3151, z: 3410, tolerance: 4 };
const cat = '^Gertrudes cat$';
const catAt = { x: 3306, z: 3512, level: 1, tolerance: 4 };
const up = (v: PlanView) => v.state.player?.level === 1;
const down = (v: PlanView) => v.state.player?.level === 0;
const hasSeasoned = (v: PlanView) => v.inv(/^Seasoned sardine$/i) > 0;
const hasKitten = (v: PlanView) => v.inv("Fluffs' kitten") > 0;
// The walker does not open her door, so Gertrude reads as unreachable until it is open.
const gertrudeReachable = (v: PlanView) => v.state.nearbyNpcs.some(n => n.name === 'Gertrude' && n.reachable === true);
const crates: [number, number][] = [
    [3305, 3500],
    [3310, 3499],
    [3307, 3507],
    [3303, 3506],
    [3298, 3514],
    [3311, 3511],
];
const door = {
    target: 'loc',
    name: '^Door$',
    option: '^Open$',
    tile: { x: 3150, z: 3412 },
    at: { x: 3150, z: 3414, tolerance: 2 },
} as const;
const ladderUp = {
    target: 'loc',
    name: '^Ladder$',
    option: '^Climb-up$',
    at: { x: 3309, z: 3509, tolerance: 1 },
} as const;
const ladderDown = {
    target: 'loc',
    name: '^Ladder$',
    option: '^Climb-down$',
    at: { x: 3309, z: 3509, level: 1, tolerance: 1 },
} as const;

export default defineQuest({
    id: 'fluffs',
    name: 'gertrudes-cat',
    description:
        "Gertrude's Cat: season a sardine, pay Shilop, feed Fluffs upstairs at the lumber yard, search the crates, return the kitten.",
    steps: [
        step(
            'leaves',
            pickup,
            { area: { x: 3153, z: 3400, radius: 6 }, items: [{ item: 'Doogle leaves' }] },
            { done: v => v.inv('Doogle leaves') > 0 || hasSeasoned(v) },
        ),
        step(
            'season',
            items,
            { combine: { use: 'Doogle leaves', on: 'Raw sardine', product: 'Seasoned sardine' } },
            { done: hasSeasoned },
        ),
        step('open-door', interact, door, { skip: gertrudeReachable }),
        step(
            'start',
            talk,
            { npc: '^Gertrude$', at: gertrude, choices: ['Well, I suppose I could'] },
            { reached: v => v.quest('fluffs') !== 'none' },
        ),
        // The first talk right after the quest starts sometimes closes before its choices: the journal says whether
        // it paid, and the quest's retry runs it again.
        step(
            'pay',
            talk,
            {
                npc: '^(Shilop|Wilough)$',
                at: { x: 3217, z: 3432, tolerance: 5 },
                choices: ['What will make you tell me', "Okay then, I'll pay"],
            },
            { reached: journal(/I spoke to Shilop/) },
        ),
        step('climb-up', interact, ladderUp, { until: up }),
        step(
            'feed-milk',
            interact,
            { target: 'npc', name: cat, use: { item: '^Bucket of milk$' }, at: catAt },
            { reached: journal(/I found the lost cat but it won't come back/) },
        ),
        step(
            'feed-sardine',
            interact,
            { target: 'npc', name: cat, use: { item: '^Seasoned sardine$' }, at: catAt },
            { reached: journal(/I gave the cat milk and sardines/) },
        ),
        step('climb-down', interact, ladderDown, { until: down, skip: hasKitten }),
        ...crates.map(([x, z], i) =>
            step(
                `crate-${i}`,
                interact,
                {
                    target: 'npc',
                    name: '^Crate$',
                    option: '^Search$',
                    expect: '^You find',
                    tile: { x, z },
                    at: { x, z: z - 1, level: 0, tolerance: 2 },
                },
                { skip: hasKitten, maxFails: 8 },
            ),
        ),
        step('climb-up-2', interact, ladderUp, { until: up }),
        step(
            'return-kitten',
            interact,
            // The stage moves some ticks after the use, as Fluffs leaves: `until` ends the step then, so no journal read
            // comes before the move. `expect` keeps the pickup animation from ending it first; the lite client does not
            // record that message box (learnings/dialogs.md), so the until is what ends it.
            { target: 'npc', name: cat, use: { item: "Fluffs' kitten" }, at: catAt, expect: 'run off home' },
            {
                reached: journal(/I gave Fluffs her kitten back/),
                until: v => up(v) && !hasKitten(v) && v.npcs('Gertrudes cat') === 0,
            },
        ),
        step('climb-down-2', interact, ladderDown, { until: down }),
        step('open-door-2', interact, door, { skip: gertrudeReachable }),
        step('finish', talk, { npc: '^Gertrude$', at: gertrude }),
        // The tab shows the quest complete some ticks after her dialog closes.
        step('reward', wait, { ticks: 20, orFail: true }, { until: v => v.questDone('fluffs') }),
    ],
});
