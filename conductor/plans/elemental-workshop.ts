// Elemental Workshop (server/content/scripts/quests/quest_elemental_workshop, quest id elemental_workshop), start to done.
// Verified from the server scripts: bookcase (2716,3481) gives the Battered book; reading it starts the quest; a knife
// (or any slash weapon) on the book cuts out the Battered key; the key on the Odd looking wall (2709/2710,3495) in the
// Seers' smithy opens it; the Staircase (2710,3497) leads down to the workshop (2716,9888) on the same level.
// Ore first: the Pile of Rock (Mine) spawns an Earth elemental that drops Elemental ore when killed.
// Then the prep, in script order: Crate (2717,9894) gives a stone bowl; Water Valve (2726,9908) then Water Valve
// (2713,9908) then Lever (2722,9906) start the water wheel; Fix a Bellows (leather, needle, thread, Crafting 20); Lever
// (2734,9887) pumps the bellows; the bowl on the Lava trough then on the Furnace lights it; the ore and 4 coal on the
// Furnace make Elemental metal; the bar on the Workbench (hammer, the book, Smithing 20) makes the shield and ends it.
// Puzzle state is a varp the client never sees, so the prep reads it from the game messages (50 deep), which the prep
// phases alone produce (the ore is held first, so the fight cannot push them out).
// Needs: Mining/Smithing/Crafting 20, combat ~50, a knife or bronze sword, a pickaxe, a hammer, a needle, thread, leather
// (or the Boxes at (2724,9894) give it), 4 coal, swordfish or lobsters.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';

const ID = 'elemental_workshop';
const BOWL_EMPTY = 2888;
const BOWL_FULL = 2889;

const pos = (v: PlanView) => v.state.player;
const inWorkshop = (v: PlanView) => (pos(v)?.worldZ ?? 0) > 9000 && (pos(v)?.worldX ?? 0) < 2760;
const idCount = (v: PlanView, n: number) => v.state.inventory.filter(i => i.id === n).reduce((a, i) => a + i.count, 0);

interface Puzzle {
    turns: number;
    water: boolean;
    air: boolean;
    lit: boolean;
}
// The puzzle as the messages of this session tell it (oldest first).
function puzzle(v: PlanView): Puzzle {
    const p: Puzzle = { turns: 0, water: false, air: false, lit: false };
    for (const m of v.state.gameMessages) {
        const t = m.text;
        if (/you turn the handle/i.test(t)) p.turns++;
        else if (/flow gates resetting/i.test(t)) p.turns = 0;
        else if (/water wheel starting up/i.test(t)) {
            p.water = true;
            p.turns = 0;
        } else if (/water wheel coming to a standstill/i.test(t)) {
            p.water = false;
            p.air = false;
        } else if (/bellows pump air down/i.test(t)) p.air = true;
        else if (/bellows stop pumping/i.test(t)) p.air = false;
        else if (/furnace bursts in to life|little difference to the furnace/i.test(t)) p.lit = true;
        else if (/furnace needs to be hotter/i.test(t)) p.air = false;
        else if (/furnace is cold/i.test(t)) p.lit = false;
    }
    return p;
}

const done = (v: PlanView) => v.questDone(ID);
const ore = (v: PlanView) => v.inv('Elemental ore');
const bar = (v: PlanView) => v.inv('Elemental metal');
const bowls = (v: PlanView) => idCount(v, BOWL_EMPTY) + idCount(v, BOWL_FULL);
// Prep runs once the ore is held and the bar not yet made.
const prep = (v: PlanView) => inWorkshop(v) && !done(v) && ore(v) > 0 && bar(v) === 0;

const loc = (name: string, option: string, x: number, z: number, extra: object = {}) => ({
    target: 'loc' as const,
    name,
    option,
    at: { x, z, tolerance: 2 },
    tile: { x, z },
    ...extra,
});

export default definePlan({
    name: 'elemental-workshop',
    description:
        'Elemental Workshop: book, key, odd wall, stairs, ore from the rock elemental, bowl, valves, lever, bellows, lava, furnace, shield.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // Workshop elementals are aggressive: whatever attacks is fought first.
        phase(
            combat,
            {
                target: 'elemental',
                area: { x: 2715, z: 9895, radius: 30 },
                food: ['Swordfish', 'Lobster'],
                maxLevelGap: 25,
            },
            {
                name: 'defend',
                when: v =>
                    inWorkshop(v) &&
                    !done(v) &&
                    v.state.player?.combat.inCombat === true &&
                    v.hp.current > 0 &&
                    v.inv(/^(Swordfish|Lobster)$/) > 0,
                until: v => v.state.player?.combat.inCombat !== true,
                onFail: 'continue',
                maxFails: 10,
            },
        ),
        // --- the finish: bar to shield ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Workbench$',
                use: { item: '^Elemental metal$' },
                at: { x: 2717, z: 9888, tolerance: 2 },
                expect: 'you make an elemental shield',
            },
            { name: 'shield', when: v => inWorkshop(v) && bar(v) > 0 && !done(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Furnace$',
                use: { item: '^Elemental ore$' },
                at: { x: 2724, z: 9876, tolerance: 2 },
                expect: 'retrieve a bar of elemental metal|needs to be hotter|furnace is cold|four heaps',
            },
            {
                name: 'smelt',
                when: v => {
                    const p = puzzle(v);
                    return prep(v) && p.water && p.air && p.lit;
                },
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Furnace$',
                use: { item: { id: BOWL_FULL } },
                at: { x: 2724, z: 9876, tolerance: 2 },
                expect: 'bursts in to life|little difference',
            },
            { name: 'light', when: v => prep(v) && idCount(v, BOWL_FULL) > 0, maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Lava trough$',
                use: { item: { id: BOWL_EMPTY } },
                at: { x: 2714, z: 9873, tolerance: 2 },
                expect: 'fill the bowl with hot lava',
            },
            {
                name: 'fill',
                when: v => {
                    const p = puzzle(v);
                    return prep(v) && p.water && p.air && !p.lit && idCount(v, BOWL_EMPTY) > 0;
                },
                maxFails: 4,
            },
        ),
        phase(
            interact,
            loc('^Lever$', '^Pull$', 2734, 9887, { expect: 'bellows pump air down|nothing happens|bellows stop' }),
            {
                name: 'air-lever',
                when: v => {
                    const p = puzzle(v);
                    return prep(v) && p.water && !p.air && v.inv('Leather') === 0 && v.runs('bellows') > 0;
                },
                maxFails: 4,
            },
        ),
        phase(interact, loc('^Bellows$', '^Fix$', 2734, 9882, { expect: 'stitch the leather|already look fixed' }), {
            name: 'bellows',
            when: v => prep(v) && puzzle(v).water && v.inv('Leather') > 0,
            maxFails: 4,
        }),
        phase(
            interact,
            loc('^Lever$', '^Pull$', 2722, 9906, { expect: 'water wheel starting up|flow gates resetting' }),
            {
                name: 'water-lever',
                when: v => prep(v) && bowls(v) > 0 && !puzzle(v).water && puzzle(v).turns >= 2,
                maxFails: 4,
            },
        ),
        phase(interact, loc('^Water Valve$', '^Turn$', 2713, 9908, { expect: 'you turn the handle' }), {
            name: 'valve-left',
            when: v => prep(v) && bowls(v) > 0 && !puzzle(v).water && puzzle(v).turns === 1,
            maxFails: 4,
        }),
        phase(interact, loc('^Water Valve$', '^Turn$', 2726, 9908, { expect: 'you turn the handle' }), {
            name: 'valve-right',
            when: v => prep(v) && bowls(v) > 0 && !puzzle(v).water && puzzle(v).turns === 0,
            maxFails: 4,
        }),
        phase(
            interact,
            { target: 'item', name: '^(Swordfish|Lobster)$', option: '^Eat$' },
            {
                name: 'make-room',
                when: v => prep(v) && v.free < 2 && v.inv(/^(Swordfish|Lobster)$/) > 8,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(interact, loc('^Boxes$', '^Search$', 2724, 9894), {
            name: 'leather',
            when: v => prep(v) && v.inv('Leather') === 0 && v.runs('leather') === 0,
            onFail: 'continue',
            maxFails: 3,
        }),
        phase(interact, loc('^Crate$', '^Search$', 2717, 9894), {
            name: 'bowl',
            when: v => prep(v) && bowls(v) === 0,
            maxFails: 4,
        }),
        phase(
            pickup,
            { area: { x: 2703, z: 9905, radius: 14 }, items: [{ item: 'Elemental ore' }], maxWaitSeconds: 20 },
            {
                name: 'take-ore',
                when: v =>
                    inWorkshop(v) &&
                    !done(v) &&
                    ore(v) === 0 &&
                    bar(v) === 0 &&
                    v.state.player?.combat.inCombat !== true &&
                    v.state.groundItems.some(g => /^elemental ore$/i.test(g.name)),
                onFail: 'continue',
                maxFails: 10,
            },
        ),
        // --- the ore: mine the rock, kill the elemental it calls, take the ore ---
        phase(
            combat,
            {
                target: 'Earth elemental',
                area: { x: 2703, z: 9905, radius: 14 },
                food: ['Swordfish', 'Lobster'],
                loot: ['Elemental ore'],
                maxLevelGap: 25,
                respawnWaitTicks: 40,
            },
            {
                name: 'fight',
                when: v =>
                    inWorkshop(v) &&
                    !done(v) &&
                    ore(v) === 0 &&
                    bar(v) === 0 &&
                    v.state.player?.combat.inCombat === true &&
                    v.state.nearbyNpcs.some(n => /^earth elemental$/i.test(n.name)),
                until: v => ore(v) > 0,
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Pile of Rock$',
                option: '^Mine$',
                at: { x: 2706, z: 9903, tolerance: 2 },
                expect: 'Ge.roff my rock|earth elemental',
            },
            {
                name: 'rock',
                when: v => inWorkshop(v) && !done(v) && ore(v) === 0 && bar(v) === 0,
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        // --- down into the workshop (stairs first: it fails until the wall is open, and the wall phase follows) ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Climb-down$',
                at: { x: 2710, z: 3498, tolerance: 1 },
                tile: { x: 2710, z: 3497 },
            },
            {
                name: 'stairs',
                when: v => !inWorkshop(v) && !done(v) && v.inv('Battered key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Odd looking wall$',
                use: { item: '^Battered key$' },
                at: { x: 2710, z: 3494, tolerance: 1 },
                expect: 'wall|door|open',
            },
            {
                name: 'wall',
                when: v => !inWorkshop(v) && !done(v) && v.inv('Battered key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            items,
            { combine: { use: '^(Knife|Bronze sword)$', on: '^Battered book$', product: '^Battered key$' } },
            {
                name: 'cut',
                when: v =>
                    !inWorkshop(v) &&
                    !done(v) &&
                    v.inv('Battered book') > 0 &&
                    v.inv('Battered key') === 0 &&
                    v.quest(ID) !== 'none',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'item', name: '^Battered book$', option: '^Read$' },
            {
                name: 'read',
                when: v =>
                    !inWorkshop(v) &&
                    !done(v) &&
                    v.inv('Battered book') > 0 &&
                    v.inv('Battered key') === 0 &&
                    v.quest(ID) === 'none',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Bookcase$',
                option: '^Search$',
                at: { x: 2714, z: 3481, tolerance: 1 },
                tile: { x: 2716, z: 3481 },
            },
            {
                name: 'bookcase',
                when: v => !inWorkshop(v) && !done(v) && v.inv('Battered book') === 0 && v.inv('Battered key') === 0,
                maxFails: 3,
            },
        ),
    ],
    until: done,
});
